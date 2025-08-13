import { Schema, model } from "mongoose";
import { IRide } from "./ride.interface";

const rideSchema = new Schema<IRide>(
  {
    rider: { type: Schema.Types.ObjectId, ref: "User", required: true },
    driver: { type: Schema.Types.ObjectId, ref: "User" },
    pickupLocation: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      address: String,
    },
    destination: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      address: String,
    },
    status: {
      type: String,
      enum: [
        "requested",
        "accepted",
        "rejected",
        "picked_up",
        "in_transit",
        "completed",
        "cancelled",
      ],
      default: "requested",
    },
    timestamps: {
      requestedAt: { type: Date, default: Date.now },
      acceptedAt: Date,
      pickedUpAt: Date,
      completedAt: Date,
      cancelledAt: Date,
    },
    fare: { type: Number, default: 0 },
    feedback: String,
  },
  { timestamps: true, versionKey: false }
);

export const Ride = model<IRide>("Ride", rideSchema);
