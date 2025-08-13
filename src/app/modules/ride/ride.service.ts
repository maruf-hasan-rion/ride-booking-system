import { Ride } from "./ride.model";
import { User } from "../user/user.model";
import mongoose from "mongoose";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const requestRide = async (riderId: string, pickup: any, destination: any) => {
  if (!mongoose.Types.ObjectId.isValid(riderId))
    throw new Error("Invalid rider ID");

  const rider = await User.findById(riderId);

  if (!rider || rider.role !== "RIDER" || rider.isBlocked) {
    throw new Error("Invalid or blocked rider");
  }

  const activeRide = await Ride.findOne({
    rider: riderId,
    status: { $in: ["requested", "accepted", "picked_up", "in_transit"] },
  });

  if (activeRide) throw new Error("You already have an active ride.");

  return Ride.create({
    rider: riderId,
    pickupLocation: pickup,
    destination: destination,
    status: "requested",
    timestamps: { requestedAt: new Date() },
  });
};

const cancelRide = async (rideId: string, riderId: string) => {
  const ride = await Ride.findById(rideId);

  if (!ride) throw new Error("Ride not found");

  if (ride.rider.toString() !== riderId)
    throw new Error("Not authorized to cancel this ride");

  if (ride.status !== "requested")
    throw new Error("Ride can only be cancelled before acceptance");

  ride.status = "cancelled";
  ride.timestamps.cancelledAt = new Date();
  await ride.save();
  return ride;
};

const riderHistory = async (riderId: string) => {
  return Ride.find({ rider: riderId }).sort({ createdAt: -1 });
};

const allRides = async () => {
  return Ride.find()
    .populate("rider", "name email")
    .populate("driver", "name email");
};

export const RideServices = {
  requestRide,
  cancelRide,
  riderHistory,
  allRides,
};
