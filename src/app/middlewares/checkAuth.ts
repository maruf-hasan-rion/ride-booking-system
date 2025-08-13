import { NextFunction, Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import { envVars } from "../config/env";
import AppError from "../errorHelpers/AppError";
import { verifyToken } from "../utils/jwt";
import httpStatus from "http-status-codes";
import { User } from "../modules/user/user.model";

export const checkAuth =
  (...authRoles: string[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const accessToken = req.headers.authorization;

      if (!accessToken) {
        throw new AppError(
          httpStatus.UNAUTHORIZED,
          "Unauthorized: No Token Received"
        );
      }

      const verifiedToken = verifyToken(
        accessToken,
        envVars.JWT_ACCESS_SECRET
      ) as JwtPayload;

      const isUserExist = await User.findOne({
        email: verifiedToken.email,
      });

      if (!isUserExist) {
        throw new AppError(httpStatus.BAD_REQUEST, "User does not exist");
      }

      if (isUserExist?.isBlocked) {
        throw new AppError(httpStatus.BAD_REQUEST, `User is Blocked`);
      }

      if (!authRoles.includes(verifiedToken.role)) {
        throw new AppError(
          httpStatus.UNAUTHORIZED,
          "You are not permitted to view this route!!!"
        );
      }

      req.user = verifiedToken;
      // req.id = isUserExist._id;
      next();
    } catch (error) {
      // console.log("jwt error", error);
      next(error);
    }
  };
