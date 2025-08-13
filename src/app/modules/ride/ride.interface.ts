import { Types } from "mongoose";

export type RideStatus =
  | "requested"
  | "accepted"
  | "rejected"
  | "picked_up"
  | "in_transit"
  | "completed"
  | "cancelled";

export interface IRide {
  _id?: string;
  rider: Types.ObjectId;
  driver?: Types.ObjectId;
  pickupLocation: { lat: number; lng: number; address?: string };
  destination: { lat: number; lng: number; address?: string };
  status: RideStatus;
  timestamps: {
    requestedAt: Date;
    acceptedAt?: Date;
    pickedUpAt?: Date;
    completedAt?: Date;
    cancelledAt?: Date;
  };
  fare?: number;
  feedback?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
