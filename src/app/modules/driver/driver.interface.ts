import { Types } from "mongoose";

export interface IDriver {
  user: Types.ObjectId;
  vehicleInfo?: string;
  totalEarnings: number;
  isApproved?: boolean;
  isOnline?: boolean;
  activeRideId?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}
