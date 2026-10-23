import { Schema, model, models } from "mongoose";
import { IDriver } from "./driver.interface";

const driverSchema = new Schema<IDriver>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    isApproved: { type: Boolean, default: false },
    isOnline: { type: Boolean, default: false },
    vehicleInfo: { type: String },
    activeRideId: {
      type: Schema.Types.ObjectId,
      ref: "Ride",
      default: null,
    },
  },
  {
    versionKey: false,
    timestamps: true,
  }
);

/** Guarded so module re-imports (single-fork test runners, hot reloads)
 * never try to recompile an already-registered model. */
export const Driver = models.Driver ?? model<IDriver>("Driver", driverSchema);
