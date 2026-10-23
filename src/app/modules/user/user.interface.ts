import { Types } from "mongoose";

export enum Role {
  SUPER_ADMIN = "SUPER_ADMIN",
  ADMIN = "ADMIN",
  RIDER = "RIDER",
  DRIVER = "DRIVER",
}

export interface IAuthProvider {
  provider: string;
  providerId: string;
}

export enum RiderStatus {
  IDLE = "IDLE",
  REQUESTED = "REQUESTED",
  ON_RIDE = "ON_RIDE",
}

export enum AccountStatus {
  ACTIVE = "ACTIVE",
  BLOCKED = "BLOCKED",
  SUSPENDED = "SUSPENDED",
}

export interface IUser {
  _id?: Types.ObjectId;
  name: string;
  email: string;
  password?: string;
  contactNo?: string;
  image?: string;
  role?: Role;
  isVerified?: boolean;
  isBlocked?: boolean;
  status?: AccountStatus;
  /** Incremented when sessions must be invalidated (for example, password change). */
  tokenVersion?: number;
  auths: IAuthProvider[];
  riderStatus: RiderStatus;
  createdAt?: Date;
  updatedAt?: Date;
}
