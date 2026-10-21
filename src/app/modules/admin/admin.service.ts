import { Ride } from "../ride/ride.model";
import { User } from "../user/user.model";

import { RideStatus } from "../ride/ride.interface";
import { Role } from "../user/user.interface";

const systemStats = async () => {
  const totalUsers = await User.countDocuments();
  const totalDrivers = await User.countDocuments({ role: Role.DRIVER });
  const totalRides = await Ride.countDocuments();
  const completedRides = await Ride.countDocuments({ status: RideStatus.COMPLETED });
  const cancelledRides = await Ride.countDocuments({ status: RideStatus.CANCELLED });

  return {
    totalUsers,
    totalDrivers,
    totalRides,
    completedRides,
    cancelledRides,
  };
};

export const AdminServices = {
  systemStats,
};
