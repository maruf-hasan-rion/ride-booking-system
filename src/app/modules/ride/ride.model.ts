import { Schema, model } from "mongoose";
import { IRide, RideStatus } from "./ride.interface";

const geoPointSchema = {
  type: {
    type: String,
    enum: ["Point"],
    default: "Point",
  },
  coordinates: {
    type: [Number, Number],
    required: true,
  },
};

const rideSchema = new Schema<IRide>(
  {
    riderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver" },
    pickupLocation: geoPointSchema,
    destination: geoPointSchema,
    distance: {
      type: Number,
      required: true,
      min: 0,
    },
    fare: {
      type: Number,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(RideStatus),
      default: RideStatus.REQUESTED,
    },
    cancelReason: {
      type: String,
      enum: ["BY_RIDER", "NO_DRIVER"],
    },
    timestamps: {
      requestedAt: { type: Date, default: Date.now },
      acceptedAt: Date,
      pickedUpAt: Date,
      startedAt: Date,
      arrivedAt: Date,
      completedAt: Date,
      cancelledAt: Date,
    },
    rejectedBy: [
      {
        type: Schema.Types.ObjectId,
        ref: "Driver",
        default: [],
      },
    ],
    currentLocation: geoPointSchema,
  },
  { timestamps: true, versionKey: false },
);

// Expiry scan: which REQUESTED rides are past their TTL.
rideSchema.index({ status: 1, "timestamps.requestedAt": 1 });

// Rider lookups: latest active ride + paginated history.
rideSchema.index({ riderId: 1, status: 1, createdAt: -1 });

// Driver lookups: active ride + paginated earnings/history.
rideSchema.index({ driverId: 1, status: 1, createdAt: -1 });

// Geo support for pickup/destination coordinates.
rideSchema.index({ pickupLocation: "2dsphere" });
rideSchema.index({ destination: "2dsphere" });

export const Ride = model<IRide>("Ride", rideSchema);
