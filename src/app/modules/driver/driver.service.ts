import { Driver } from "./driver.model";
import { User } from "../user/user.model";
import { Ride } from "../ride/ride.model";
import { RideStatus } from "../ride/ride.interface";
import { AccountStatus, RiderStatus } from "../user/user.interface";
import AppError from "../../errorHelpers/AppError";
import httpStatus from "http-status-codes";
import { Types, ClientSession, PipelineStage } from "mongoose";
import {
  DRIVER_ACTIVE_RIDE_STATUSES,
  RIDE_TRANSITION_SOURCE,
  RIDE_TRANSITION_TIMESTAMP_FIELD,
} from "../ride/ride.constants";
import { expireStaleRequestedRides } from "../ride/ride.service";

/**
 * Loads the driver profile for `userId` or throws. Enforces the
 * approved/online gate when the caller runs a ride-action flow.
 */
const requireDriverProfile = async (
  userId: string,
  options: { approvedAndOnline?: boolean } = {},
) => {
  const profile = await Driver.findOne({ user: userId });

  if (!profile) {
    throw new AppError(httpStatus.NOT_FOUND, "Driver profile not found.");
  }

  if (
    options.approvedAndOnline &&
    (!profile.isApproved || !profile.isOnline)
  ) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Driver is not approved or online.",
    );
  }

  return profile;
};

const createDriver = async (userId: string, vehicleInfo?: string) => {
  const user = await User.findById(userId);

  if (!user || user.role !== "DRIVER") {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid driver user.");
  }

  const exists = await Driver.findOne({ user: userId });
  if (exists) {
    throw new AppError(httpStatus.CONFLICT, "Driver profile already exists.");
  }

  return Driver.create({ user: userId, vehicleInfo });
};

const updateDriverProfile = async (userId: string, vehicleInfo: string) => {
  const profile = await Driver.findOneAndUpdate(
    { user: userId },
    { vehicleInfo },
    { returnDocument: "after", runValidators: true }
  );

  if (!profile) {
    throw new AppError(httpStatus.NOT_FOUND, "Driver profile not found.");
  }

  return profile;
};

/** Driver incoming-requests list: filters run at DB level (rider info resolved
 * with $lookup), so pagination totals are correct and the collection is not
 * post-scanned in JavaScript. */
const getIncomingRequests = async (
  userId: string,
  query: Record<string, string> = {}
) => {
  const driverProfile = await requireDriverProfile(userId);

  await expireStaleRequestedRides();

  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const skip = (page - 1) * limit;

  const searchTerm = query.searchTerm?.trim().toLowerCase() ?? "";

  const pipeline: PipelineStage[] = [
    {
      $match: {
        status: RideStatus.REQUESTED,
        rejectedBy: { $ne: driverProfile._id },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "riderId",
        foreignField: "_id",
        as: "rider",
        pipeline: [
          { $project: { _id: 1, name: 1, email: 1, contactNo: 1 } },
        ],
      },
    },
    { $unwind: { path: "$rider", preserveNullAndEmptyArrays: true } },
  ];

  if (searchTerm) {
    const escapeRegExp = (text: string) =>
      text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escapeRegExp(searchTerm), "i");
    pipeline.push({
      $match: {
        $or: [
          { "rider.name": re },
          { "rider.email": re },
          { "rider.contactNo": re },
          {
            $expr: {
              $regexMatch: {
                input: { $toString: "$_id" },
                regex: escapeRegExp(searchTerm),
                options: "i",
              },
            },
          },
        ],
      },
    } as PipelineStage);
  }

  pipeline.push({
    $facet: {
      data: [{ $sort: { createdAt: -1 } }, { $skip: skip }, { $limit: limit }],
      total: [{ $count: "count" }],
    },
  });

  const [faceted] = await Ride.aggregate<{
    data: Record<string, unknown>[];
    total: { count: number }[];
  }>(pipeline);

  const rows = faceted?.data ?? [];
  const total = faceted?.total?.[0]?.count ?? 0;

  const data = rows.map((row) => {
    const { rider, __v, ...rest } = row as Record<string, unknown> & {
      rider?: unknown;
      __v?: unknown;
    };

    void __v;

    return {
      ...rest,
      riderId: (rider ?? rest.riderId) as Record<string, unknown>,
    };
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

const getActiveRide = async (userId: string) => {
  const driverProfile = await requireDriverProfile(userId);

  const ride = await Ride.findOne({
    driverId: driverProfile._id,
    status: { $in: DRIVER_ACTIVE_RIDE_STATUSES },
  })
    .populate("riderId", "name email contactNo")
    .sort({ createdAt: -1 })
    .lean();

  return { data: ride };
};

const getMyProfile = async (userId: string) => {
  const profile = await Driver.findOne({ user: userId })
    .populate("user", "name email role")
    .lean();

  // Keep API stable without throwing when profile is not created yet.
  return { data: profile ?? null };
};

/**
 * Accepts a ride by atomically claiming it while it is still REQUESTED.
 * Two drivers racing to accept the same ride get exactly one winner; the
 * loser receives a 409 with a clear message. Concurrent claim attempts can
 * additionally hit MongoDB write-conflicts: those are retried a couple of
 * times, and if the ride is gone by then the conditional update itself
 * rejects with a clean 409.
 */
const acceptRide = async (rideId: string, driverId: string) => {
  const MAX_RETRIES = 2;

  await expireStaleRequestedRides();

  const attempt = async (): Promise<unknown> => {
    const session = await Ride.startSession();
    session.startTransaction();

    try {
      const driverProfile = await Driver.findOne({ user: driverId }).session(session);
      if (!driverProfile || !driverProfile.isApproved || !driverProfile.isOnline) {
        throw new AppError(
          httpStatus.FORBIDDEN,
          "Driver is not approved or online.",
        );
      }

      const hasActiveRide = await Ride.exists({
        driverId: driverProfile._id,
        status: { $in: DRIVER_ACTIVE_RIDE_STATUSES },
      }).session(session);

      if (hasActiveRide) {
        throw new AppError(
          httpStatus.CONFLICT,
          "You already have an active ride.",
        );
      }

      const ride = await Ride.findOneAndUpdate(
        {
          _id: rideId,
          status: RideStatus.REQUESTED,
          rejectedBy: { $ne: driverProfile._id },
        },
        {
          $set: {
            driverId: driverProfile._id,
            status: RideStatus.ACCEPTED,
            "timestamps.acceptedAt": new Date(),
          },
        },
        { returnDocument: "after", session },
      );

      if (!ride) {
        await explainAcceptBlock(rideId, driverProfile._id.toString(), session);
        throw new AppError(httpStatus.CONFLICT, "Ride could not be accepted.");
      }

      await session.commitTransaction();
      session.endSession();
      return ride;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  };

  for (let attemptNumber = 0; attemptNumber <= MAX_RETRIES; attemptNumber += 1) {
    try {
      return await attempt();
    } catch (error) {
      const labels = (error as { errorLabels?: string[] })?.errorLabels ?? [];
      const transient = labels.includes("TransientTransactionError");
      if (!transient || attemptNumber === MAX_RETRIES) {
        throw error;
      }
    }
  }

  throw new AppError(httpStatus.CONFLICT, "Ride could not be accepted.");
};

const explainAcceptBlock = async (
  rideId: string,
  driverId: string,
  session: ClientSession,
): Promise<never> => {
  const existing = await Ride.findById(rideId).session(session);

  if (!existing) {
    throw new AppError(httpStatus.NOT_FOUND, "Ride not found");
  }
  if (existing.status !== RideStatus.REQUESTED) {
    throw new AppError(
      httpStatus.CONFLICT,
      existing.status === RideStatus.CANCELLED
        ? "This ride was cancelled and can no longer be accepted."
        : "This ride was already accepted by another driver.",
    );
  }
  if (
    existing.rejectedBy.some((id) => id.toString() === driverId)
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "You rejected this ride earlier and cannot accept it now.",
    );
  }

  throw new AppError(httpStatus.CONFLICT, "Ride could not be accepted.");
};

const rejectRide = async (rideId: string, driverId: string) => {
  await expireStaleRequestedRides();

  const driverProfile = await requireDriverProfile(driverId, {
    approvedAndOnline: true,
  });

  const ride = await Ride.findOneAndUpdate(
    {
      _id: rideId,
      status: RideStatus.REQUESTED,
      rejectedBy: { $ne: driverProfile._id },
    },
    {
      $addToSet: { rejectedBy: driverProfile._id },
    },
    { returnDocument: "after" },
  );

  if (ride) {
    return ride;
  }

  // Idempotent: rejecting an already-rejected ride returns the document as-is.
  const existing = await Ride.findById(rideId);
  if (!existing) {
    throw new AppError(httpStatus.NOT_FOUND, "Ride not found");
  }
  if (existing.status !== RideStatus.REQUESTED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Ride no longer pending",
    );
  }
  return existing;
};

/**
 * Updates the ride status along the state machine. Both the assignment check
 * and the predecessor-state check are part of the atomic update filter, so a
 * stale or duplicated status request (including a cancellation happening at
 * the same moment) resolves into a clear error instead of overriding state.
 */
const updateRideStatus = async (
  rideId: string,
  driverId: string,
  status: RideStatus.PICKED_UP | RideStatus.IN_TRANSIT | RideStatus.ARRIVED | RideStatus.COMPLETED
) => {
  const session = await Ride.startSession();
  session.startTransaction();

  try {
    const driverProfile = await Driver.findOne({ user: driverId }).session(session);
    if (!driverProfile) {
      throw new AppError(httpStatus.FORBIDDEN, "Not assigned to this ride.");
    }

    const sourceStatus = RIDE_TRANSITION_SOURCE[status];
    if (!sourceStatus) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Invalid ride status transition.",
      );
    }

    const timestampField =
      RIDE_TRANSITION_TIMESTAMP_FIELD[status] ?? "timestamps.startedAt";

    const ride = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        driverId: driverProfile._id,
        status: sourceStatus,
      },
      {
        $set: {
          status,
          [timestampField]: new Date(),
        },
      },
      { returnDocument: "after", session },
    );

    if (!ride) {
      await explainStatusBlock(rideId, driverProfile._id, status, session);
      throw new AppError(
        httpStatus.CONFLICT,
        "Ride status could not be updated.",
      );
    }

    await User.findByIdAndUpdate(
      ride.riderId,
      {
        riderStatus:
          status === RideStatus.COMPLETED
            ? RiderStatus.IDLE
            : RiderStatus.ON_RIDE,
      },
      { session }
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

/** Throws the precise error for a failed status-update claim. */
const explainStatusBlock = async (
  rideId: string,
  driverProfileId: Types.ObjectId,
  targetStatus: RideStatus,
  session: ClientSession,
): Promise<never> => {
  const existing = await Ride.findById(rideId).session(session);

  if (!existing) {
    throw new AppError(httpStatus.NOT_FOUND, "Ride not found");
  }
  if (existing.driverId?.toString() !== driverProfileId.toString()) {
    throw new AppError(httpStatus.FORBIDDEN, "Not assigned to this ride.");
  }
  if (existing.status === RideStatus.CANCELLED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "This ride was cancelled and cannot be updated.",
    );
  }
  if (existing.status === targetStatus) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Ride is already in ${existing.status} state.`,
    );
  }

  throw new AppError(
    httpStatus.BAD_REQUEST,
    `Invalid ride status transition from ${existing.status} to ${targetStatus}.`,
  );
};

const driverEarnings = async (driverId: string) => {
  const driverProfile = await requireDriverProfile(driverId);

  const rides = await Ride.find({ driverId: driverProfile._id, status: RideStatus.COMPLETED })
    .select("fare createdAt")
    .sort({ createdAt: -1 });

  return rides;
};

const approveDriver = async (userId: string) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found.");
  }

  user.status =
    user.isBlocked || user.status === AccountStatus.BLOCKED
      ? AccountStatus.BLOCKED
      : AccountStatus.ACTIVE;
  await user.save();

  const profile = await Driver.findOneAndUpdate(
    { user: userId },
    { isApproved: true },
    { returnDocument: "after" }
  );
  if (!profile) {
    throw new AppError(httpStatus.NOT_FOUND, "Driver profile not found.");
  }
  return profile;
};

const suspendDriver = async (userId: string) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found.");
  }

  if (!user.isBlocked && user.status !== AccountStatus.BLOCKED) {
    user.status = AccountStatus.SUSPENDED;
    await user.save();
  }

  const profile = await Driver.findOneAndUpdate(
    { user: userId },
    { isApproved: false, isOnline: false },
    { returnDocument: "after" }
  );
  if (!profile) {
    throw new AppError(httpStatus.NOT_FOUND, "Driver profile not found.");
  }
  return profile;
};

const driverStatus = async (userId: string, isOnline: boolean) => {
  const profile = await Driver.findOneAndUpdate(
    { user: userId, isApproved: true },
    { isOnline },
    { returnDocument: "after" }
  );

  if (profile) {
    return profile;
  }

  const existing = await Driver.findOne({ user: userId });

  if (!existing) {
    throw new AppError(httpStatus.NOT_FOUND, "Driver profile not found.");
  }

  throw new AppError(httpStatus.FORBIDDEN, "Driver is not approved.");
};

const allDrivers = async () => {
  return Driver.find().populate("user", "name email role");
};

export const DriverServices = {
  createDriver,
  updateDriverProfile,
  getIncomingRequests,
  getActiveRide,
  getMyProfile,
  acceptRide,
  rejectRide,
  updateRideStatus,
  driverEarnings,
  allDrivers,
  approveDriver,
  suspendDriver,
  driverStatus,
};
