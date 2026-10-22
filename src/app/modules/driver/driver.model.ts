import { Schema, model, models } from "mongoose";
import { IDriver } from "./driver.interface";

const driverSchema = new Schema<IDriver>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isApproved: { type: Boolean, default: false },
    isOnline: { type: Boolean, default: false },
    vehicleInfo: { type: String },
    totalEarnings: { type: Number, default: 0 },
  },
  {
    versionKey: false,
    timestamps: true,
  }
);

/** Guarded so module re-imports (single-fork test runners, hot reloads)
 * never try to recompile an already-registered model. */
export const Driver = models.Driver ?? model<IDriver>("Driver", driverSchema);
