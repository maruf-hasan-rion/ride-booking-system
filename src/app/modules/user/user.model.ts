import { model, models, Schema } from "mongoose";
import {
  AccountStatus,
  IAuthProvider,
  IUser,
  RiderStatus,
  Role,
} from "./user.interface";

const authProviderSchema = new Schema<IAuthProvider>(
  {
    provider: { type: String, required: true },
    providerId: { type: String, required: true },
  },
  {
    versionKey: false,
    _id: false,
  },
);

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    role: {
      type: String,
      enum: Object.values(Role),
    },
    contactNo: { type: String },
    isVerified: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(AccountStatus),
      default: AccountStatus.ACTIVE,
    },
    riderStatus: {
      type: String,
      enum: Object.values(RiderStatus),
      default: RiderStatus.IDLE,
    },
    auths: [authProviderSchema],
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

/** Guarded so module re-imports never recompile a registered model. */
export const User = models.User ?? model<IUser>("User", userSchema);


