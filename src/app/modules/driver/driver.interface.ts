import { Types } from "mongoose";

export interface IDriver {
  user: Types.ObjectId;
  vehicleInfo?: string;
  isApproved?: boolean;
  isOnline?: boolean;
  activeRideId?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}
