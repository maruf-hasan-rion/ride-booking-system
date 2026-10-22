import { Ride } from "./ride.model";
import { ClientSession, PipelineStage } from "mongoose";
import { User } from "../user/user.model";
import { Driver } from "../driver/driver.model";
import { IRide, RideCancelReason, RideStatus } from "./ride.interface";
import httpStatus from "http-status-codes";
import AppError from "../../errorHelpers/AppError";
import { RiderStatus } from "../user/user.interface";
import { calculateFare } from "../../utils/fareProvider";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { withTransaction } from "../../utils/withTransaction";
import { MAX_LIMIT } from "../../constants";
import {
  RIDER_ACTIVE_RIDE_STATUSES,
  RIDE_REQUEST_TTL_MS,
} from "./ride.constants";

export const rideSearchableFields = ["status"];

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const expireStaleRequestedRides = async () => {
  const cutoff = new Date(Date.now() - RIDE_REQUEST_TTL_MS);

  const stale = await Ride.find({
    status: RideStatus.REQUESTED,
    "timestamps.requestedAt": { $lt: cutoff },
  })
    .select("_id riderId")
    .lean();

  if (stale.length === 0) {
    return;
  }

  const staleIds = stale.map((ride) => ride._id);
  const riderIds = [...new Set(stale.map((ride) => ride.riderId))];

  // The ride cancellation and the rider release must be one unit of work.
  // Otherwise a crash/timeout between them leaves a rider with no live ride
  // but a blocking REQUESTED status, which no future expiry scan can repair.
  const session = await Ride.startSession();
  session.startTransaction();

  try {
    await Ride.updateMany(
      {
        _id: { $in: staleIds },
        status: RideStatus.REQUESTED,
        "timestamps.requestedAt": { $lt: cutoff },
      },
      {
        $set: {
          status: RideStatus.CANCELLED,
          cancelReason: RideCancelReason.NO_DRIVER,
          "timestamps.cancelledAt": new Date(),
        },
      },
      { session },
    );

    // Only reset riders that have no remaining live ride.
    const stillLiveRiderIds = await Ride.find({
      riderId: { $in: riderIds },
      status: { $in: RIDER_ACTIVE_RIDE_STATUSES },
    })
      .distinct("riderId")
      .session(session);
    const stillLiveSet = new Set(
      stillLiveRiderIds.map((id) => id.toString()),
    );
    const ridersToReset = riderIds.filter(
      (id) => !stillLiveSet.has(id.toString()),
    );

    if (ridersToReset.length > 0) {
      await User.updateMany(
        { _id: { $in: ridersToReset }, riderStatus: RiderStatus.REQUESTED },
        { riderStatus: RiderStatus.IDLE },
        { session },
      );
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
};

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

const findIdempotentRide = async (key: string, riderId: string) => {
  const existing = await Ride.findOne({ idempotencyKey: key });
  if (!existing) {
    return null;
  }

  if (String(existing.riderId) !== String(riderId)) {
    throw new AppError(
      httpStatus.CONFLICT,
      "This idempotency key belongs to another rider.",
    );
  }

  return { data: existing };
};

const requestRide = async (payload: IRide, idempotencyKey?: string) => {
  const key = idempotencyKey?.trim();

  if (key && !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Invalid Idempotency-Key. Use 8-100 letters, numbers, underscores or hyphens.",
    );
  }

  if (key) {
    const existing = await findIdempotentRide(key, String(payload.riderId));
    if (existing) {
      return existing;
    }
  }

  // Expire stale requests before opening the transaction so the rider-state
  // checks below observe the reset instead of a stale snapshot.
  await expireStaleRequestedRides();

  const rider = await User.findById(payload.riderId).lean();
  if (!rider) {
    throw new AppError(httpStatus.NOT_FOUND, "Rider not found.");
  }

  if (
    rider.riderStatus === RiderStatus.REQUESTED ||
    rider.riderStatus === RiderStatus.ON_RIDE
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `You already have a ride in ${rider.riderStatus} state.`,
    );
  }

  // Never hold a MongoDB transaction open across an external provider call.
  const { distanceKm, fare } = await calculateFare(
    payload.pickupLocation.coordinates,
    payload.destination.coordinates,
  );

  try {
    return await withTransaction(async (session) => {
      const currentRider = await User.findById(payload.riderId).session(session);
      if (!currentRider) {
        throw new AppError(httpStatus.NOT_FOUND, "Rider not found.");
      }

      // Re-check inside the transaction: another booking may have won while
      // the fare provider was running.
      if (
        currentRider.riderStatus === RiderStatus.REQUESTED ||
        currentRider.riderStatus === RiderStatus.ON_RIDE
      ) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `You already have a ride in ${currentRider.riderStatus} state.`,
        );
      }

      const ride = await Ride.create(
        [
          {
            ...payload,
            distance: distanceKm,
            fare,
            ...(key ? { idempotencyKey: key } : {}),
          },
        ],
        { session },
      );

      await User.findByIdAndUpdate(
        payload.riderId,
        { riderStatus: RiderStatus.REQUESTED },
        { session },
      );

      return { data: ride[0] };
    });
  } catch (error) {
    // A concurrent retry with the same key may lose the unique-index race or
    // observe the winner's riderStatus. Return the winner if it exists.
    if (key) {
      const existing = await findIdempotentRide(key, String(payload.riderId));
      if (existing) {
        return existing;
      }
    }

    throw error;
  }
};

const requestedRide = async (userId: string) => {
  const latestRide = await Ride.findOne({
    riderId: userId,
    status: { $in: RIDER_ACTIVE_RIDE_STATUSES },
  })
    .sort({ createdAt: -1 })
    .lean();
  return { data: latestRide };
};

/**
 * Rider cancellation: allowed while REQUESTED or ACCEPTED (before pickup).
 * The ownership + state claim happens atomically in the update filter, so a
 * rider cancelling at the same moment a driver accepts gets a predictable
 * conflict response instead of corrupting state.
 */
const cancelRide = async (rideId: string, riderId: string) => {
  return withTransaction(async (session) => {
    const ride = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        riderId: riderId,
        status: { $in: [RideStatus.REQUESTED, RideStatus.ACCEPTED] },
      },
      {
        $set: {
          status: RideStatus.CANCELLED,
          cancelReason: RideCancelReason.BY_RIDER,
          cancelledBy: riderId,
          "timestamps.cancelledAt": new Date(),
        },
      },
      { returnDocument: "after", session },
    );

    if (!ride) {
      await explainCancelBlock(rideId, riderId, session);
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Ride cannot be cancelled.",
      );
    }

    await User.findByIdAndUpdate(
      riderId,
      { riderStatus: RiderStatus.IDLE },
      { session },
    );

    if (ride.driverId) {
      await Driver.updateOne(
        { _id: ride.driverId, activeRideId: ride._id },
        { $set: { activeRideId: null } },
        { session },
      );
    }

    return ride;
  });
};

/** Throws the precise error for a failed cancel claim. */
const explainCancelBlock = async (
  rideId: string,
  riderId: string,
  session: ClientSession,
): Promise<never> => {
  const existing = await Ride.findById(rideId).session(session);

  if (!existing) {
    throw new AppError(httpStatus.NOT_FOUND, "Ride not found");
  }
  if (existing.riderId.toString() !== riderId) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Not authorized to cancel this ride",
    );
  }
  if (
    existing.status === RideStatus.PICKED_UP ||
    existing.status === RideStatus.IN_TRANSIT ||
    existing.status === RideStatus.ARRIVED
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "The ride has started and can no longer be cancelled.",
    );
  }
  throw new AppError(
    httpStatus.BAD_REQUEST,
    `Ride cannot be cancelled in ${existing.status} state.`,
  );
};

const ADMIN_CANCELLABLE_STATUSES: RideStatus[] = [
  RideStatus.REQUESTED,
  RideStatus.ACCEPTED,
  RideStatus.PICKED_UP,
  RideStatus.IN_TRANSIT,
  RideStatus.ARRIVED,
];

/**
 * Operational escape hatch: an admin can stop any ride that is not already
 * terminal. This releases the rider and the driver's active-ride lock, which
 * is the recovery path for a suspended/abandoned driver after pickup.
 */
const adminCancelRide = async (
  rideId: string,
  adminId: string,
  reason: string,
) => {
  return withTransaction(async (session) => {
    const ride = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        status: { $in: ADMIN_CANCELLABLE_STATUSES },
      },
      {
        $set: {
          status: RideStatus.CANCELLED,
          cancelReason: RideCancelReason.BY_ADMIN,
          cancelNote: reason,
          cancelledBy: adminId,
          "timestamps.cancelledAt": new Date(),
        },
      },
      { returnDocument: "after", session },
    );

    if (!ride) {
      await explainAdminCancelBlock(rideId, session);
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Ride cannot be cancelled.",
      );
    }

    await User.updateOne(
      {
        _id: ride.riderId,
        riderStatus: { $in: [RiderStatus.REQUESTED, RiderStatus.ON_RIDE] },
      },
      { $set: { riderStatus: RiderStatus.IDLE } },
      { session },
    );

    if (ride.driverId) {
      await Driver.updateOne(
        { _id: ride.driverId, activeRideId: ride._id },
        { $set: { activeRideId: null } },
        { session },
      );
    }

    return ride;
  });
};

const explainAdminCancelBlock = async (
  rideId: string,
  session: ClientSession,
): Promise<never> => {
  const existing = await Ride.findById(rideId).session(session);

  if (!existing) {
    throw new AppError(httpStatus.NOT_FOUND, "Ride not found");
  }

  if (
    existing.status === RideStatus.COMPLETED ||
    existing.status === RideStatus.CANCELLED ||
    existing.status === RideStatus.REJECTED
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Ride is already ${existing.status} and cannot be cancelled.`,
    );
  }

  throw new AppError(
    httpStatus.BAD_REQUEST,
    `Ride cannot be cancelled in ${existing.status} state.`,
  );
};

const singleRide = async (rideId: string, riderId: string) => {
  const data = await Ride.findById(rideId).populate({
    path: "driverId",
    select: "vehicleInfo",
    populate: { path: "user", select: "name contactNo" },
  });

  if (!data) {
    throw new AppError(httpStatus.NOT_FOUND, "Ride Information Not Found");
  }

  if (String(data.riderId) !== riderId) {
    throw new AppError(httpStatus.BAD_REQUEST, "This Ride Is Not Yours!");
  }

  return {
    data,
  };
};

const allRides = async (riderId: string, query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder(
    Ride.find({ riderId }).populate("driverId"),
    query,
  );

  const rideData = queryBuilder
    .filter()
    .search(rideSearchableFields)
    .sort()
    .fields()
    .dateSearch()
    .fareRange()
    .paginate();

  const [data, meta] = await Promise.all([
    rideData.build(),
    queryBuilder.getMeta(),
  ]);

  return {
    data,
    meta,
  };
};

const riderHistory = async (riderId: string) => {
  return Ride.find({ riderId }).populate("driverId").sort({ createdAt: -1 });
};

// ADMIN

const getSingleRideForAdmin = async (rideId: string) => {
  const data = await Ride.findById(rideId).populate("driverId");

  if (!data) {
    throw new AppError(httpStatus.NOT_FOUND, "Ride Information Not Found");
  }

  return {
    data,
  };
};

interface AdminRideRow {
  _id: string;
  status: string;
  fare?: number;
  distance?: number;
  riderId: {
    _id?: string;
    name?: string;
    email?: string;
    contactNo?: string;
  } | string;
  driverId: {
    _id?: string;
    vehicleInfo?: string;
    user?: { _id?: string; name?: string; email?: string; contactNo?: string };
    userDoc?: unknown;
  } | string | null;
  timestamps?: Record<string, Date | undefined>;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Server-side filtered, paginated admin ride list. Rider/driver text search is
 * resolved in the database through $lookup stages — no full collection scan in
 * JavaScript, and the pagination meta always matches the filtered total. */
const getAllRidesForAdmin = async (query: Record<string, string>) => {
  const page = Math.max(1, Number(query.page) || 1);
  const requestedLimit = Number(query.limit) || 10;
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);
  const skip = (page - 1) * limit;

  const matchStage: Record<string, unknown> = {};

  const statusFilter = query.status?.trim();
  if (statusFilter) {
    matchStage.status = statusFilter;
  }

  if (query.dateSearch?.trim()) {
    const startOfDay = new Date(`${query.dateSearch}T00:00:00.000Z`);
    if (!Number.isNaN(startOfDay.getTime())) {
      const endOfDay = new Date(startOfDay);
      endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
      matchStage.createdAt = { $gte: startOfDay, $lt: endOfDay };
    }
  }

  const searchTerm = query.searchTerm?.trim().toLowerCase() ?? "";
  const riderSearch = query.riderSearch?.trim().toLowerCase() ?? "";
  const driverSearch = query.driverSearch?.trim().toLowerCase() ?? "";

  const pipeline: PipelineStage[] = [
    { $match: matchStage },
    {
      $lookup: {
        from: "users",
        localField: "riderId",
        foreignField: "_id",
        as: "rider",
        pipeline: [{ $project: { _id: 1, name: 1, email: 1, contactNo: 1 } }],
      },
    },
    { $unwind: { path: "$rider", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "drivers",
        localField: "driverId",
        foreignField: "_id",
        as: "driver",
        pipeline: [
          {
            $lookup: {
              from: "users",
              localField: "user",
              foreignField: "_id",
              as: "user",
              pipeline: [
                { $project: { _id: 1, name: 1, email: 1, contactNo: 1 } },
              ],
            },
          },
          {
            $project: {
              _id: 1,
              vehicleInfo: 1,
              user: { $arrayElemAt: ["$user", 0] },
            },
          },
        ],
      },
    },
    { $unwind: { path: "$driver", preserveNullAndEmptyArrays: true } },
  ];

  if (searchTerm) {
    const re = new RegExp(escapeRegExp(searchTerm), "i");
    const idRegex = escapeRegExp(searchTerm);
    pipeline.push({
      $match: {
        $or: [
          {
            $expr: {
              $regexMatch: { input: { $toString: "$_id" }, regex: idRegex, options: "i" },
            },
          },
          { "rider.name": re },
          { "rider.email": re },
          { "rider.contactNo": re },
          { "driver.vehicleInfo": re },
          { "driver.user.name": re },
          { "driver.user.email": re },
          { "driver.user.contactNo": re },
          { status: re },
        ],
      },
    } as PipelineStage);
  }

  if (riderSearch) {
    const re = new RegExp(escapeRegExp(riderSearch), "i");
    pipeline.push({
      $match: {
        $or: [{ "rider.name": re }, { "rider.email": re }, { "rider.contactNo": re }],
      },
    } as PipelineStage);
  }

  if (driverSearch) {
    const re = new RegExp(escapeRegExp(driverSearch), "i");
    pipeline.push({
      $match: {
        $or: [
          { "driver.vehicleInfo": re },
          { "driver.user.name": re },
          { "driver.user.email": re },
          { "driver.user.contactNo": re },
        ],
      },
    } as PipelineStage);
  }

  pipeline.push(
    { $sort: { createdAt: -1 } },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        total: [{ $count: "count" }],
      },
    } as unknown as PipelineStage,
  );

  const [faceted] = await Ride.aggregate<{
    data: Record<string, unknown>[];
    total: { count: number }[];
  }>(pipeline);

  const total = faceted?.total?.[0]?.count ?? 0;
  const rows = faceted?.data ?? [];

  const data = rows.map((row) => {
    const { rider, driver, __v, ...rest } = row as Record<string, unknown> & {
      rider?: unknown;
      driver?: unknown;
      __v?: unknown;
    };

    void __v;

    const mapped: AdminRideRow = {
      ...(rest as unknown as AdminRideRow),
      riderId: (rider as AdminRideRow["riderId"]) ?? (rest.riderId as AdminRideRow["riderId"]),
      driverId: driver
        ? (driver as adminDriverRow)
        : null,
    };

    return mapped;
  });

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

type adminDriverRow = NonNullable<AdminRideRow["driverId"]>;

export const RideServices = {
  requestRide,
  requestedRide,
  singleRide,
  allRides,
  cancelRide,
  adminCancelRide,
  riderHistory,
  getSingleRideForAdmin,
  getAllRidesForAdmin,
};
