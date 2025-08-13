import { Driver } from "./driver.model";
import { User } from "../user/user.model";
import { Ride } from "../ride/ride.model";
import mongoose from "mongoose";
import { calculateFare } from "../../utils/fareCalculator";

const createDriver = async (userId: string, vehicleInfo?: string) => {
  const user = await User.findById(userId);

  if (!user || user.role !== "DRIVER") {
    throw new Error("Invalid driver user.");
  }

  const exists = await Driver.findOne({ user: userId });
  if (exists) {
    throw new Error("Driver profile already exists.");
  }

  return Driver.create({ user: userId, vehicleInfo });
};

const acceptRide = async (rideId: string, driverId: string) => {
  const ride = await Ride.findById(rideId);

  if (!ride || ride.status !== "requested")
    throw new Error("Ride not available for acceptance");

  const driverObjectId = new mongoose.Types.ObjectId(driverId);

  ride.driver = driverObjectId;
  ride.status = "accepted";
  ride.timestamps.acceptedAt = new Date();
  await ride.save();
  return ride;
};

const rejectRide = async (rideId: string, driverId: string) => {
  const ride = await Ride.findById(rideId);

  if (!ride || ride.status !== "requested")
    throw new Error("Ride not available for acceptance");

  const driverObjectId = new mongoose.Types.ObjectId(driverId);

  ride.driver = driverObjectId;
  ride.status = "rejected";
  ride.timestamps.acceptedAt = new Date();
  await ride.save();
  return ride;
};

const updateRideStatus = async (
  rideId: string,
  status: "picked_up" | "in_transit" | "completed"
) => {
  const ride = await Ride.findById(rideId);
  if (!ride) throw new Error("Ride not found");

  if (ride.status === "rejected")
    throw new Error("Rejected Ride not available for Update");

  ride.status = status;
  if (status === "picked_up") ride.timestamps.pickedUpAt = new Date();
  if (status === "in_transit") ride.timestamps.pickedUpAt ||= new Date();
  if (status === "completed") {
    ride.fare = calculateFare(ride);
    ride.timestamps.completedAt = new Date();
  }

  await ride.save();
  return ride;
};

const driverEarnings = async (driverId: string) => {
  const rides = await Ride.find({ driver: driverId, status: "completed" })
    .select("fare createdAt")
    .sort({ createdAt: -1 });

  return rides;
};

const approveDriver = async (userId: string) => {
  const profile = await Driver.findOneAndUpdate(
    { user: userId },
    { isApproved: true },
    { new: true }
  );
  if (!profile) throw new Error("Driver profile not found.");
  return profile;
};

const suspendDriver = async (userId: string) => {
  const profile = await Driver.findOneAndUpdate(
    { user: userId },
    { isApproved: false, isOnline: false },
    { new: true }
  );
  if (!profile) throw new Error("Driver profile not found.");
  return profile;
};

const driverStatus = async (userId: string, status: boolean) => {
  const profile = await Driver.findOne({ user: userId });

  if (!profile) throw new Error("Driver profile not found.");

  if (!profile.isApproved) throw new Error("Driver is not approved.");

  profile.isOnline = status;
  await profile.save();
  return profile;
};

const allDrivers = async () => {
  return Driver.find().populate("user", "name email role");
};

export const DriverServices = {
  createDriver,
  acceptRide,
  rejectRide,
  updateRideStatus,
  driverEarnings,
  allDrivers,
  approveDriver,
  suspendDriver,
  driverStatus,
};
