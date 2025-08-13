import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { JwtPayload } from "jsonwebtoken";
import httpStatus from "http-status-codes";
import { sendResponse } from "../../utils/sendResponse";
import { RideServices } from "./ride.service";

export const createRideRequest = catchAsync(
  async (req: Request, res: Response) => {
    const decodeToken = req.user as JwtPayload;
    const riderId = decodeToken.userId;
    const { pickupLocation, destination } = req.body;

    const ride = await RideServices.requestRide(
      riderId,
      pickupLocation,
      destination
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.CREATED,
      message: "Ride Request Created Successfully",
      data: ride,
    });
  }
);

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

const allRides = catchAsync(async (req: Request, res: Response) => {
  const rides = await RideServices.allRides();

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "All Ride History Retrieved Successfully",
    data: rides,
  });
});

export const rideControllers = {
  createRideRequest,
  cancelRideRequest,
  myRideHistory,
  allRides,
};
