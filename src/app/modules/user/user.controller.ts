/* eslint-disable @typescript-eslint/no-unused-vars */

import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status-codes";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { UserServices } from "./user.service";
import { adminUserQueryZodSchema } from "./user.validation";
import { JwtPayload } from "jsonwebtoken";

const registerUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = await UserServices.createUser(req.body);

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.CREATED,
      message: "User Created Successfully",
      data: user,
    });
  }
);
const updateUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.params.id;
    const verifiedToken = req.user;
    const payload = req.body;

    const user = await UserServices.updateUser(
      userId,
      payload,
      verifiedToken as JwtPayload
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "User Updated Successfully",
      data: user,
    });
  }
);
const getAllUsers = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const query = adminUserQueryZodSchema.parse(req.query);
    const normalizedQuery = Object.fromEntries(
      Object.entries(query)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );

    const users = await UserServices.getAllUsers(normalizedQuery);

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "All Users Retrieved Successfully",
      data: users.data,
      meta: users.meta,
    });
  }
);

const getMe = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const decodedToken = req.user as JwtPayload;
    const user = await UserServices.getMe(decodedToken.userId);

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Your profile Retrieved Successfully",
      data: user.data,
    });
  }
);
const getSingleUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id;
    const user = await UserServices.getSingleUser(id);
    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "User Retrieved Successfully",
      data: user.data,
    });
  }
);

const blockUserAccount = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = await UserServices.blockUser(
      req.params.id,
      req.user as JwtPayload,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "User block Successfully",
      data: user,
    });
  }
);
const unblockUserAccount = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = await UserServices.unblockUser(
      req.params.id,
      req.user as JwtPayload,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "User Unblock Successfully",
      data: user,
    });
  }
);

// function => try-catch catch => req-res function

export const UserControllers = {
  registerUser,
  getAllUsers,
  getSingleUser,
  updateUser,
  getMe,
  blockUserAccount,
  unblockUserAccount,
};

// route matching -> controller -> service -> model -> DB
