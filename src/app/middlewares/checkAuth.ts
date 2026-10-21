import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status-codes";
import { JwtPayload } from "jsonwebtoken";
import { envVars } from "../config/env";
import AppError from "../errorHelpers/AppError";
import { AccountStatus } from "../modules/user/user.interface";
import { User } from "../modules/user/user.model";
import { verifyToken } from "../utils/jwt";

export const checkAuth =
  (...authRoles: string[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      const accessToken =
        authHeader?.startsWith("Bearer ")
          ? authHeader.split(" ")[1]
          : authHeader || req.cookies.accessToken;

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

      const isUserExist = await User.findOne({ email: verifiedToken.email });

      if (!isUserExist) {
        throw new AppError(httpStatus.UNAUTHORIZED, "User does not exist");
      }

      const isSocialAuthUser = isUserExist.auths?.some(
        (providerObject) => providerObject.provider === "google"
      );
      const canReadRestrictedAccountState =
        authRoles.length === 0 &&
        req.method === "GET" &&
        req.path === "/me";

      if (!isUserExist.isVerified && !isSocialAuthUser) {
        throw new AppError(httpStatus.FORBIDDEN, "User is not verified");
      }

      // Backfill legacy Google users that were created before verification was auto-set.
      if (!isUserExist.isVerified && isSocialAuthUser) {
        isUserExist.isVerified = true;
        await isUserExist.save();
      }

      const normalizedStatus = isUserExist.status || AccountStatus.ACTIVE;

      if (
        (isUserExist.isBlocked ||
          normalizedStatus === AccountStatus.BLOCKED) &&
        !canReadRestrictedAccountState
      ) {
        throw new AppError(httpStatus.FORBIDDEN, "User is blocked");
      }

      if (
        normalizedStatus === AccountStatus.SUSPENDED &&
        !canReadRestrictedAccountState
      ) {
        throw new AppError(httpStatus.FORBIDDEN, "User is suspended");
      }

      const effectiveRole = (verifiedToken.role || isUserExist.role) as
        | string
        | undefined;

      if (authRoles.length > 0) {
        if (!effectiveRole) {
          throw new AppError(
            httpStatus.FORBIDDEN,
            "Account role is not set. Complete role setup to continue"
          );
        }

        if (!authRoles.includes(effectiveRole)) {
          throw new AppError(
            httpStatus.FORBIDDEN,
            "You are not permitted to access this route"
          );
        }
      }

      req.user = {
        ...verifiedToken,
        role: effectiveRole,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
