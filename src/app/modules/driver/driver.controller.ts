import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { DriverServices } from "./driver.service";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status-codes";
import { JwtPayload } from "jsonwebtoken";

const createProfile = catchAsync(async (req: Request, res: Response) => {
  const decodeToken = req.user as JwtPayload;
  const driverId = decodeToken.userId;

  const profile = await DriverServices.createDriver(
    driverId,
    req.body.vehicleInfo
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "User Created Successfully",
    data: profile,
  });
});

const changeDriverStatus = async (req: Request, res: Response) => {
  const decodeToken = req.user as JwtPayload;
  const driverId = decodeToken.userId;

  const profile = await DriverServices.driverStatus(
    driverId,
    req.body.isOnline
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Driver Status Changed",
    data: profile,
  });
};
const acceptRideRequest = catchAsync(async (req: Request, res: Response) => {
  const decodeToken = req.user as JwtPayload;
  const driverId = decodeToken.userId;
  const rideId = req.params.id;

  const ride = await DriverServices.acceptRide(rideId, driverId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Ride Request Accepted",
    data: ride,
  });
});

const rejectRideRequest = catchAsync(async (req: Request, res: Response) => {
  const decodeToken = req.user as JwtPayload;
  const driverId = decodeToken.userId;
  const rideId = req.params.id;

  const ride = await DriverServices.rejectRide(rideId, driverId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Ride Request Accepted",
    data: ride,
  });
});

const updateRideStatus = catchAsync(async (req: Request, res: Response) => {
  const rideId = req.params.id;
  const { status } = req.body;

  const ride = await DriverServices.updateRideStatus(rideId, status);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Driver Status Changed",
    data: ride,
  });
});

const myEarnings = async (req: Request, res: Response) => {
  const decodeToken = req.user as JwtPayload;
  const driverId = decodeToken.userId;
  const rides = await DriverServices.driverEarnings(driverId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: `My Earning History`,
    data: rides,
  });
};

const allDrivers = async (req: Request, res: Response) => {
  const drivers = await DriverServices.allDrivers();

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "All Drivers Retrieved Successfully",
    data: drivers,
  });
};

const approveDriver = catchAsync(async (req: Request, res: Response) => {
  const profile = await DriverServices.approveDriver(req.params.id);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Driver Profile Approved",
    data: profile,
  });
});

const suspendDriver = async (req: Request, res: Response) => {
  const profile = await DriverServices.suspendDriver(req.params.id);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Driver Profile Suspended",
    data: profile,
  });
};

export const driverController = {
  createProfile,
  acceptRideRequest,
  rejectRideRequest,
  updateRideStatus,
  myEarnings,
  allDrivers,
  approveDriver,
  suspendDriver,
  changeDriverStatus,
};
