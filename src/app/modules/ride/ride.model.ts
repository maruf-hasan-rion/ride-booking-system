import { Schema, model, models } from "mongoose";
import { IRide, RideCancelReason, RideStatus } from "./ride.interface";

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
      enum: Object.values(RideCancelReason),
    },
    cancelNote: {
      type: String,
      maxlength: 300,
    },
    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    idempotencyKey: {
      type: String,
      maxlength: 100,
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

// Idempotent booking: a client retry with the same key returns the same ride.
rideSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

// Geo support for pickup/destination coordinates.
rideSchema.index({ pickupLocation: "2dsphere" });
rideSchema.index({ destination: "2dsphere" });

/** Guarded so module re-imports never recompile a registered model. */
export const Ride = models.Ride ?? model<IRide>("Ride", rideSchema);
