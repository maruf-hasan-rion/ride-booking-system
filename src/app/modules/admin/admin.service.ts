import { Ride } from "../ride/ride.model";
import { User } from "../user/user.model";

const systemStats = async () => {
  const totalUsers = await User.countDocuments();
  const totalDrivers = await User.countDocuments({ role: "DRIVER" });
  const totalRides = await Ride.countDocuments();
  const completedRides = await Ride.countDocuments({ status: "completed" });
  const cancelledRides = await Ride.countDocuments({ status: "cancelled" });

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
