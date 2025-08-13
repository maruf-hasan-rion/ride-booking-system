/* eslint-disable @typescript-eslint/no-unused-vars */

import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status-codes";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { blockUser, unblockUser, UserServices } from "./user.service";
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
      statusCode: httpStatus.CREATED,
      message: "User Updated Successfully",
      data: user,
    });
  }
);
const getAllUsers = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const users = await UserServices.getAllUsers();

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.CREATED,
      message: "All Users Retrieved Successfully",
      data: users.data,
      meta: users.meta,
    });
  }
);

const getMe = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const decodedToken = req.user as JwtPayload;
    const user = await UserServices.getMe(decodedToken.id);

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.CREATED,
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
      statusCode: httpStatus.CREATED,
      message: "User Retrieved Successfully",
      data: user.data,
    });
  }
);

const blockUserAccount = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = await UserServices.blockUser(req.params.id);

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.CREATED,
      message: "User block Successfully",
      data: user,
    });
  }
);
const unblockUserAccount = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = await UserServices.unblockUser(req.params.id);

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.CREATED,
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
