import { Types } from "mongoose";

export interface ILocation {
  type: "Point";
  coordinates: [number, number];
}
export enum RideStatus {
  REQUESTED = "REQUESTED",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  PICKED_UP = "PICKED_UP",
  IN_TRANSIT = "IN_TRANSIT",
  ARRIVED = "ARRIVED",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export enum RideCancelReason {
  BY_RIDER = "BY_RIDER",
  BY_DRIVER = "BY_DRIVER",
  BY_ADMIN = "BY_ADMIN",
  NO_DRIVER = "NO_DRIVER",
}

export interface IRide {
  _id?: string;
  riderId: Types.ObjectId;
  driverId?: Types.ObjectId;
  pickupLocation: ILocation;
  currentLocation: ILocation;
  destination: ILocation;
  distance?: number;
  status: RideStatus;
  cancelReason?: RideCancelReason;
  cancelNote?: string;
  cancelledBy?: Types.ObjectId;
  idempotencyKey?: string;
  timestamps: {
    requestedAt: Date;
    acceptedAt?: Date;
    pickedUpAt?: Date;
    startedAt?: Date;
    arrivedAt?: Date;
    completedAt?: Date;
    cancelledAt?: Date;
  };
  fare?: number;
  rejectedBy: Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
}
