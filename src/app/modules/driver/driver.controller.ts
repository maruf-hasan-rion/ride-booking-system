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
    message: "Driver Profile Created Successfully",
    data: profile,
  });
});

const updateProfile = catchAsync(async (req: Request, res: Response) => {
  const decodeToken = req.user as JwtPayload;
  const driverId = decodeToken.userId;

  const profile = await DriverServices.updateDriverProfile(
    driverId,
    req.body.vehicleInfo
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Driver Profile Updated Successfully",
    data: profile,
  });
});

const myProfile = catchAsync(async (req: Request, res: Response) => {
  const decodeToken = req.user as JwtPayload;
  const driverId = decodeToken.userId;

  const profile = await DriverServices.getMyProfile(driverId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Driver Profile Retrieved",
    data: profile,
  });
});

const changeDriverStatus = catchAsync(async (req: Request, res: Response) => {
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
});

const getIncomingRequests = catchAsync(async (req: Request, res: Response) => {
  const decodeToken = req.user as JwtPayload;
  const driverId = decodeToken.userId;

  const rides = await DriverServices.getIncomingRequests(
    driverId,
    req.query as Record<string, string>
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Incoming ride requests retrieved",
    data: rides,
  });
});

const getActiveRide = catchAsync(async (req: Request, res: Response) => {
  const decodeToken = req.user as JwtPayload;
  const driverId = decodeToken.userId;

  const ride = await DriverServices.getActiveRide(driverId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Active ride retrieved",
    data: ride,
  });
});

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
    message: "Ride Request Rejected",
    data: ride,
  });
});

const updateRideStatus = catchAsync(async (req: Request, res: Response) => {
  const rideId = req.params.id;
  const { status } = req.body;
  const decodeToken = req.user as JwtPayload;
  const driverId = decodeToken.userId;

  const ride = await DriverServices.updateRideStatus(rideId, driverId, status);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Ride Status Updated",
    data: ride,
  });
});

const myEarnings = catchAsync(async (req: Request, res: Response) => {
  const decodeToken = req.user as JwtPayload;
  const driverId = decodeToken.userId;
  const rides = await DriverServices.driverEarnings(driverId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: `My Earning History`,
    data: rides,
  });
});

const allDrivers = catchAsync(async (req: Request, res: Response) => {
  const drivers = await DriverServices.allDrivers();

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "All Drivers Retrieved Successfully",
    data: drivers,
  });
});

const approveDriver = catchAsync(async (req: Request, res: Response) => {
  const profile = await DriverServices.approveDriver(req.params.id);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Driver Profile Approved",
    data: profile,
  });
});

const suspendDriver = catchAsync(async (req: Request, res: Response) => {
  const profile = await DriverServices.suspendDriver(req.params.id);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Driver Profile Suspended",
    data: profile,
  });
});

export const driverController = {
  createProfile,
  updateProfile,
  myProfile,
  changeDriverStatus,
  getIncomingRequests,
  getActiveRide,
  acceptRideRequest,
  rejectRideRequest,
  updateRideStatus,
  myEarnings,
  allDrivers,
  approveDriver,
  suspendDriver,
};
