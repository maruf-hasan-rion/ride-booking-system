import bcryptjs from "bcryptjs";
import httpStatus from "http-status-codes";
import { JwtPayload } from "jsonwebtoken";
import { envVars } from "../../config/env";
import AppError from "../../errorHelpers/AppError";
import { createNewAccessTokenWithRefreshToken } from "../../utils/userTokens";
import { verifyToken } from "../../utils/jwt";
import { User } from "../user/user.model";

const getNewAccessToken = async (refreshToken: string) => {
  return createNewAccessTokenWithRefreshToken(refreshToken);
};

/**
 * Logout is intentionally idempotent: expired/invalid tokens are ignored, but
 * any valid token bumps the user's tokenVersion so the refresh token (and all
 * other sessions) cannot be replayed.
 */
const revokeSessions = async (
  tokens: { token?: string; secret: string }[],
) => {
  for (const { token, secret } of tokens) {
    if (!token) continue;

    try {
      const payload = verifyToken(token, secret) as JwtPayload;
      if (!payload?.email) continue;

      await User.updateOne(
        { email: payload.email },
        { $inc: { tokenVersion: 1 } },
      );
      return;
    } catch {
      // Expired or malformed token: clearing the cookies is sufficient.
    }
  }
};

const changePassword = async (
  oldPassword: string,
  newPassword: string,
  decodedToken: JwtPayload
) => {
  const user = await User.findById(decodedToken.userId).select("+password");

  if (!user || !user.password) {
    throw new AppError(httpStatus.NOT_FOUND, "User password not found");
  }

  const isOldPasswordMatch = await bcryptjs.compare(oldPassword, user.password);

  if (!isOldPasswordMatch) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Old Password does not match");
  }

  user.password = await bcryptjs.hash(
    newPassword,
    Number(envVars.BCRYPT_SALT_ROUND)
  );
  // Invalidate every access/refresh token issued before this password change.
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;

  await user.save();
};

export const AuthServices = {
  getNewAccessToken,
  changePassword,
  revokeSessions,
};
