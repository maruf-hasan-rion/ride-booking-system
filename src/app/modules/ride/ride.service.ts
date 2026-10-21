import { Ride } from "./ride.model";
import { ClientSession, PipelineStage } from "mongoose";
import { User } from "../user/user.model";
import { IRide, RideCancelReason, RideStatus } from "./ride.interface";
import httpStatus from "http-status-codes";
import AppError from "../../errorHelpers/AppError";
import { RiderStatus } from "../user/user.interface";
import { fareCalulator } from "../../utils/fareCalculator";
import { QueryBuilder } from "../../utils/QueryBuilder";
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
  );

  // Only reset riders that have no remaining live ride.
  const stillLiveRiderIds = await Ride.distinct("riderId", {
    riderId: { $in: riderIds },
    status: { $in: RIDER_ACTIVE_RIDE_STATUSES },
  });
  const stillLiveSet = new Set(stillLiveRiderIds.map((id) => id.toString()));
  const ridersToReset = riderIds.filter((id) => !stillLiveSet.has(id.toString()));

  if (ridersToReset.length > 0) {
    await User.updateMany(
      { _id: { $in: ridersToReset }, riderStatus: RiderStatus.REQUESTED },
      { riderStatus: RiderStatus.IDLE },
    );
  }
};

const requestRide = async (payload: IRide) => {
  // Expire stale requests before opening the transaction so the rider-state
  // checks below observe the reset instead of a stale snapshot.
  await expireStaleRequestedRides();

  const session = await Ride.startSession();
  session.startTransaction();

  try {
    const rider = await User.findById(payload.riderId).session(session);
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

    const { distanceKm, fare } = await fareCalulator(
      payload.pickupLocation.coordinates,
      payload.destination.coordinates,
    );

    const ride = await Ride.create(
      [{ ...payload, distance: distanceKm, fare }],
      { session },
    );

    await User.findByIdAndUpdate(
      payload.riderId,
      { riderStatus: RiderStatus.REQUESTED },
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    return { data: ride[0] };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
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
  const session = await Ride.startSession();
  session.startTransaction();

  try {
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

    await session.commitTransaction();
    session.endSession();

    return ride;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
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

const singleRide = async (rideId: string, riderId: string) => {
  const data = await Ride.findById(rideId).populate({
    path: "driverId",
    populate: { path: "user" },
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
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
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
  riderHistory,
  getSingleRideForAdmin,
  getAllRidesForAdmin,
};
