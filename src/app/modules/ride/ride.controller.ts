import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { JwtPayload } from "jsonwebtoken";
import httpStatus from "http-status-codes";
import { sendResponse } from "../../utils/sendResponse";
import { RideServices } from "./ride.service";
import { RideStatus } from "./ride.interface";

export const createRideRequest = catchAsync(
  async (req: Request, res: Response) => {
    const decodeToken = req.user as JwtPayload;
    const riderId = decodeToken.userId;
    const payload = {
      ...req.body,
      riderId,
      // The rider is at the pickup point when requesting; schema requires
      // currentLocation, so default it there unless provided.
      currentLocation: req.body.currentLocation ?? req.body.pickupLocation,
      status: RideStatus.REQUESTED,
      timestamps: {
        requestedAt: new Date(),
      },
    };

    const ride = await RideServices.requestRide(
      payload,
      req.get("Idempotency-Key"),
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.CREATED,
      message: "Ride Request Created Successfully",
      data: ride.data,
    });
  }
);

const getRequestedRide = catchAsync(async (req: Request, res: Response) => {
  const rider = req.user as JwtPayload;
  const riderId = rider.userId;

  const rideInfo = await RideServices.requestedRide(riderId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Rides Made By You are Retrieved!",
    data: rideInfo,
  });
});
export const cancelRideRequest = catchAsync(
  async (req: Request, res: Response) => {
    const decodeToken = req.user as JwtPayload;
    const riderId = decodeToken.userId;
    const rideId = req.params.id;

    const ride = await RideServices.cancelRide(rideId, riderId);

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Ride Request Cancelled Successfully",
      data: ride,
    });
  }
);
const getSingleRide = catchAsync(async (req: Request, res: Response) => {
  const rideId = req.params.rideId;
  const riderInfo = req.user as JwtPayload;
  const riderId = riderInfo.userId;
  const result = await RideServices.singleRide(rideId, riderId);
  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Your Ride Information Retrieved!",
    data: result.data,
  });
});
const getAllRides = catchAsync(async (req: Request, res: Response) => {
  const rider = req.user as JwtPayload;
  const riderId = rider.userId;
  const query = req.query;

  const rideInfo = await RideServices.allRides(
    riderId,
    query as Record<string, string>
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Rides Made By You are Retrieved!",
    data: rideInfo,
  });
});

export const myRideHistory = catchAsync(async (req: Request, res: Response) => {
  const decodeToken = req.user as JwtPayload;
  const riderId = decodeToken.userId;

  const rides = await RideServices.riderHistory(riderId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "My Ride History Retrieved Successfully",
    data: rides,
  });
});

// const allRides = catchAsync(async (req: Request, res: Response) => {
//   const rides = await RideServices.allRides();

//   sendResponse(res, {
//     success: true,
//     statusCode: httpStatus.OK,
//     message: "All Ride History Retrieved Successfully",
//     data: rides,
//   });
// });

// ADMIN
const getSingleRideForAdmin = catchAsync(
  async (req: Request, res: Response) => {
    const rideId = req.params.id;

    const result = await RideServices.getSingleRideForAdmin(rideId);

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Single Ride Information Retrieved!",
      data: result.data,
    });
  }
);

const getAllRidesForAdmin = catchAsync(async (req: Request, res: Response) => {
  const query = req.query;
  const rideInfo = await RideServices.getAllRidesForAdmin(
    query as Record<string, string>
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "All Rides Retrieved For Admin !",
    data: rideInfo,
  });
});

const adminCancelRide = catchAsync(async (req: Request, res: Response) => {
  const rideId = req.params.id;
  const admin = req.user as JwtPayload;
  const reason = req.body.reason as string;

  const ride = await RideServices.adminCancelRide(
    rideId,
    admin.userId,
    reason,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Ride Cancelled By Admin",
    data: ride,
  });
});

export const rideControllers = {
  createRideRequest,
  cancelRideRequest,
  getRequestedRide,
  getSingleRide,
  getAllRides,
  myRideHistory,
  getSingleRideForAdmin,
  getAllRidesForAdmin,
  adminCancelRide,
};
