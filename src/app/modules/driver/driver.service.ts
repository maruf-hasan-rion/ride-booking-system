import { Driver } from "./driver.model";
import { User } from "../user/user.model";
import { Ride } from "../ride/ride.model";
import { RideCancelReason, RideStatus } from "../ride/ride.interface";
import { AccountStatus, RiderStatus } from "../user/user.interface";
import AppError from "../../errorHelpers/AppError";
import httpStatus from "http-status-codes";
import { Types, ClientSession, PipelineStage } from "mongoose";
import {
  DRIVER_ACTIVE_RIDE_STATUSES,
  RIDE_TRANSITION_SOURCE,
  RIDE_TRANSITION_TIMESTAMP_FIELD,
} from "../ride/ride.constants";
import { withTransaction } from "../../utils/withTransaction";
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

  try {
    return await Driver.create({ user: userId, vehicleInfo });
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      throw new AppError(
        httpStatus.CONFLICT,
        "Driver profile already exists.",
      );
    }
    throw error;
  }
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
  const driverProfile = await requireDriverProfile(userId, {
    approvedAndOnline: true,
  });

  await expireStaleRequestedRides();

  const page = Math.max(1, Number(query.page) || 1);
  const requestedLimit = Number(query.limit) || 10;
  const limit = Math.min(Math.max(requestedLimit, 1), 50);
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
          { $project: { _id: 1, name: 1 } },
        ],
      },
    },
    { $unwind: { path: "$rider", preserveNullAndEmptyArrays: true } },
    {
      // Before acceptance the driver only needs an approximate pickup area.
      // Exact coordinates remain available from /driver/active-ride after the
      // claim, and are never rounded in storage.
      $addFields: {
        "pickupLocation.coordinates": {
          $map: {
            input: "$pickupLocation.coordinates",
            as: "coordinate",
            in: { $round: ["$$coordinate", 3] },
          },
        },
        "destination.coordinates": {
          $map: {
            input: "$destination.coordinates",
            as: "coordinate",
            in: { $round: ["$$coordinate", 3] },
          },
        },
      },
    } as PipelineStage,
  ];

  if (searchTerm) {
    const escapeRegExp = (text: string) =>
      text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escapeRegExp(searchTerm), "i");
    pipeline.push({
      $match: {
        $or: [
          { "rider.name": re },
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
  await expireStaleRequestedRides();

  return withTransaction(async (session) => {
    // Claim the driver document as well as the ride. Two different rides
    // cannot both move to ACCEPTED for the same driver because this is a
    // write to one shared document, so MongoDB serializes the claim.
    const driverProfile = await Driver.findOneAndUpdate(
      {
        user: driverId,
        isApproved: true,
        isOnline: true,
        activeRideId: null,
      },
      { $set: { activeRideId: rideId } },
      { returnDocument: "after", session },
    );

    if (!driverProfile) {
      const existing = await Driver.findOne({ user: driverId }).session(session);

      if (!existing) {
        throw new AppError(httpStatus.NOT_FOUND, "Driver profile not found.");
      }
      if (!existing.isApproved || !existing.isOnline) {
        throw new AppError(
          httpStatus.FORBIDDEN,
          "Driver is not approved or online.",
        );
      }

      throw new AppError(
        httpStatus.CONFLICT,
        "You already have an active ride.",
      );
    }

    // Legacy active rides created before activeRideId existed still block the
    // driver, even though the lock above could be acquired.
    const legacyActiveRide = await Ride.exists({
      driverId: driverProfile._id,
      status: { $in: DRIVER_ACTIVE_RIDE_STATUSES },
      _id: { $ne: rideId },
    }).session(session);

    if (legacyActiveRide) {
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

    return ride;
  });
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
    existing.rejectedBy.some(
      (id: Types.ObjectId) => id.toString() === driverId,
    )
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
  return withTransaction(async (session) => {
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

    if (status === RideStatus.COMPLETED) {
      await Driver.updateOne(
        { _id: driverProfile._id, activeRideId: ride._id },
        { $set: { activeRideId: null } },
        { session },
      );
    }

    return ride;
  });
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

const cancelAssignedRide = async (
  rideId: string,
  driverUserId: string,
  reason?: string,
) => {
  return withTransaction(async (session) => {
    const driverProfile = await Driver.findOne({
      user: driverUserId,
    }).session(session);

    if (!driverProfile) {
      throw new AppError(httpStatus.NOT_FOUND, "Driver profile not found.");
    }

    const ride = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        driverId: driverProfile._id,
        status: RideStatus.ACCEPTED,
      },
      {
        $set: {
          status: RideStatus.CANCELLED,
          cancelReason: RideCancelReason.BY_DRIVER,
          cancelNote: reason,
          cancelledBy: driverUserId,
          "timestamps.cancelledAt": new Date(),
        },
      },
      { returnDocument: "after", session },
    );

    if (!ride) {
      await explainDriverCancelBlock(rideId, driverProfile._id, session);
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Ride cannot be cancelled.",
      );
    }

    await Driver.updateOne(
      { _id: driverProfile._id, activeRideId: ride._id },
      { $set: { activeRideId: null } },
      { session },
    );

    await User.findByIdAndUpdate(
      ride.riderId,
      { riderStatus: RiderStatus.IDLE },
      { session },
    );

    return ride;
  });
};

const explainDriverCancelBlock = async (
  rideId: string,
  driverProfileId: Types.ObjectId,
  session: ClientSession,
): Promise<never> => {
  const existing = await Ride.findById(rideId).session(session);

  if (!existing) {
    throw new AppError(httpStatus.NOT_FOUND, "Ride not found");
  }
  if (existing.driverId?.toString() !== driverProfileId.toString()) {
    throw new AppError(httpStatus.FORBIDDEN, "Not assigned to this ride.");
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
  if (existing.status === RideStatus.REQUESTED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "The ride has not been accepted yet. Use reject instead.",
    );
  }

  throw new AppError(
    httpStatus.BAD_REQUEST,
    `Ride cannot be cancelled in ${existing.status} state.`,
  );
};

const driverEarnings = async (driverId: string) => {
  const driverProfile = await requireDriverProfile(driverId);

  const rides = await Ride.find({ driverId: driverProfile._id, status: RideStatus.COMPLETED })
    .select("fare createdAt timestamps.completedAt")
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

export const DriverServices = {
  createDriver,
  updateDriverProfile,
  getIncomingRequests,
  getActiveRide,
  getMyProfile,
  acceptRide,
  rejectRide,
  cancelAssignedRide,
  updateRideStatus,
  driverEarnings,
  approveDriver,
  suspendDriver,
  driverStatus,
};
