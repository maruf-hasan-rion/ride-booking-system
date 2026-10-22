import httpStatus from "http-status-codes";
import { JwtPayload } from "jsonwebtoken";
import { envVars } from "../config/env";
import AppError from "../errorHelpers/AppError";
import { AccountStatus, IUser } from "../modules/user/user.interface";
import { User } from "../modules/user/user.model";
import { generateToken, verifyToken } from "./jwt";

export const createUserTokens = (user: Partial<IUser>) => {
  const jwtPayload = {
    userId: user._id,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion ?? 0,
  };
  const accessToken = generateToken(
    jwtPayload,
    envVars.JWT_ACCESS_SECRET,
    envVars.JWT_ACCESS_EXPIRES
  );

  const refreshToken = generateToken(
    jwtPayload,
    envVars.JWT_REFRESH_SECRET,
    envVars.JWT_REFRESH_EXPIRES
  );

  return {
    accessToken,
    refreshToken,
  };
};

export const createNewAccessTokenWithRefreshToken = async (
  refreshToken: string
) => {
  const verifiedRefreshToken = verifyToken(
    refreshToken,
    envVars.JWT_REFRESH_SECRET
  ) as JwtPayload;

  const isUserExist = await User.findOne({ email: verifiedRefreshToken.email });

  if (!isUserExist) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User does not exist");
  }

  if (!isUserExist.isVerified) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User is not verified");
  }

  if (isUserExist.isBlocked || isUserExist.status === AccountStatus.BLOCKED) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User is blocked");
  }

  if (isUserExist.status === AccountStatus.SUSPENDED) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User is suspended");
  }

  const currentTokenVersion = isUserExist.tokenVersion ?? 0;
  const presentedTokenVersion =
    typeof verifiedRefreshToken.tokenVersion === "number"
      ? verifiedRefreshToken.tokenVersion
      : 0;

  if (presentedTokenVersion !== currentTokenVersion) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Session expired. Please log in again.",
    );
  }

  const jwtPayload = {
    userId: isUserExist._id,
    email: isUserExist.email,
    role: isUserExist.role,
    tokenVersion: currentTokenVersion,
  };
  const accessToken = generateToken(
    jwtPayload,
    envVars.JWT_ACCESS_SECRET,
    envVars.JWT_ACCESS_EXPIRES
  );
  const newRefreshToken = generateToken(
    jwtPayload,
    envVars.JWT_REFRESH_SECRET,
    envVars.JWT_REFRESH_EXPIRES
  );

  return { accessToken, refreshToken: newRefreshToken };
};
