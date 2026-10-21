import { Ride } from "../ride/ride.model";
import { RideStatus } from "../ride/ride.interface";
import { User } from "../user/user.model";
import { Driver } from "../driver/driver.model";
import AppError from "../../errorHelpers/AppError";
import httpStatus from "http-status-codes";
import { PipelineStage } from "mongoose";
import { Role } from "../user/user.interface";

const STATS_TIMEZONE = "Asia/Dhaka";

interface StatsPeriodRow {
  _id: string | { year?: number; week?: number };
  totalRides: number;
  [key: string]: unknown;
}

/**
 * Builds the daily/weekly/monthly COMPLETED-ride aggregation trio for one
 * scope. Previously this shape was copy-pasted nine times across admin,
 * driver, and rider stats; now every metric derives from the `sums` map
 * (field name -> source expression), so adding a metric is an argument
 * change rather than a new pipeline.
 */
const periodAggregations = (
  match: PipelineStage.Match["$match"],
  sums: Record<string, string>,
) => {
  const build = (
    groupId: Record<string, unknown> | string,
    sort: Record<string, 1 | -1>,
  ) =>
    Ride.aggregate<StatsPeriodRow>([
      { $match: match } as PipelineStage,
      {
        $group: {
          _id: groupId as never,
          totalRides: { $sum: 1 },
          ...Object.fromEntries(
            Object.entries(sums).map(([field, source]) => [
              field,
              { $sum: source },
            ]),
          ),
        },
      } as PipelineStage,
      { $sort: sort } as PipelineStage,
    ]);

  return {
    daily: build(
      {
        $dateToString: {
          format: "%Y-%m-%d",
          date: "$timestamps.completedAt",
          timezone: STATS_TIMEZONE,
        },
      },
      { _id: 1 },
    ),
    weekly: build(
      {
        year: { $year: { date: "$timestamps.completedAt", timezone: STATS_TIMEZONE } },
        week: { $isoWeek: { date: "$timestamps.completedAt", timezone: STATS_TIMEZONE } },
      },
      { "_id.year": 1, "_id.week": 1 },
    ),
    monthly: build(
      {
        $dateToString: {
          format: "%Y-%m",
          date: "$timestamps.completedAt",
          timezone: STATS_TIMEZONE,
        },
      },
      { _id: 1 },
    ),
  };
};

export const getAdminStats = async () => {
  const period = periodAggregations(
    { status: RideStatus.COMPLETED },
    // With no payments module, platform earnings equal collected fares.
    { totalEarnings: "$fare", totalFareMoney: "$fare" },
  );

  const [
    totalRiders,
    totalDrivers,
    totalCompletedRides,
    totalCancelledRides,
    totalFareMoneyAgg,
    ridesDaily,
    ridesWeekly,
    ridesMonthly,
  ] = await Promise.all([
    User.countDocuments({ role: Role.RIDER }),
    Driver.countDocuments(),
    Ride.countDocuments({ status: RideStatus.COMPLETED }),
    Ride.countDocuments({ status: RideStatus.CANCELLED }),
    Ride.aggregate<{ totalFareMoney: number }>([
      { $match: { status: RideStatus.COMPLETED } } as PipelineStage,
      {
        $group: { _id: null, totalFareMoney: { $sum: "$fare" } },
      } as PipelineStage,
    ]),
    period.daily,
    period.weekly,
    period.monthly,
  ]);

  return {
    totalRiders,
    totalDrivers,
    totalCompletedRides,
    totalCancelledRides,
    totalFareMoney: totalFareMoneyAgg?.[0]?.totalFareMoney || 0,
    totalEarnings: totalFareMoneyAgg?.[0]?.totalFareMoney || 0,
    ridesDaily,
    ridesWeekly,
    ridesMonthly,
  };
};

const getDriverStats = async (userId: string) => {
  const driver = await Driver.findOne({ user: userId });
  if (!driver) throw new AppError(httpStatus.NOT_FOUND, "Driver Not Found");

  const period = periodAggregations(
    { driverId: driver._id, status: RideStatus.COMPLETED },
    // Driver income = collected fare until a payments module decides a split.
    { totalIncome: "$fare", totalEarnings: "$fare" },
  );

  const [
    totalCompletedRides,
    totalCancelledRides,
    totalEarningsAgg,
    ridesDaily,
    ridesWeekly,
    ridesMonthly,
  ] = await Promise.all([
    Ride.countDocuments({
      driverId: driver._id,
      status: RideStatus.COMPLETED,
    }),
    Ride.countDocuments({
      driverId: driver._id,
      status: RideStatus.CANCELLED,
    }),
    Ride.aggregate<{ totalEarnings: number }>([
      {
        $match: {
          driverId: driver._id,
          status: RideStatus.COMPLETED,
        },
      } as PipelineStage,
      { $group: { _id: null, totalEarnings: { $sum: "$fare" } } } as PipelineStage,
    ]),
    period.daily,
    period.weekly,
    period.monthly,
  ]);

  return {
    totalCompletedRides,
    totalCancelledRides,
    totalEarnings: totalEarningsAgg?.[0]?.totalEarnings || 0,
    ridesDaily,
    ridesWeekly,
    ridesMonthly,
  };
};

const getRiderReport = async (userId: string) => {
  const rider = await User.findById(userId);
  if (!rider) throw new AppError(httpStatus.NOT_FOUND, "Rider Not Found");

  const period = periodAggregations(
    { riderId: rider._id, status: RideStatus.COMPLETED },
    { totalFare: "$fare" },
  );

  const [
    totalCompletedRides,
    totalCancelledRides,
    totalSpentAgg,
    ridesDaily,
    ridesWeekly,
    ridesMonthly,
  ] = await Promise.all([
    Ride.countDocuments({
      riderId: rider._id,
      status: RideStatus.COMPLETED,
    }),
    Ride.countDocuments({
      riderId: rider._id,
      status: RideStatus.CANCELLED,
    }),
    Ride.aggregate<{ totalSpent: number; avgFare: number }>([
      {
        $match: {
          riderId: rider._id,
          status: RideStatus.COMPLETED,
        },
      } as PipelineStage,
      {
        $group: {
          _id: null,
          totalSpent: { $sum: "$fare" },
          avgFare: { $avg: "$fare" },
        },
      } as PipelineStage,
    ]),
    period.daily,
    period.weekly,
    period.monthly,
  ]);

  return {
    totalCompletedRides,
    totalCancelledRides,
    totalSpent: totalSpentAgg?.[0]?.totalSpent || 0,
    avgFare: totalSpentAgg?.[0]?.avgFare || 0,
    ridesDaily,
    ridesWeekly,
    ridesMonthly,
  };
};

export const StatsService = {
  getAdminStats,
  getDriverStats,
  getRiderReport,
};
