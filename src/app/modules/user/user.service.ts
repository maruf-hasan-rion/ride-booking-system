import bcryptjs from "bcryptjs";
import httpStatus from "http-status-codes";
import { JwtPayload } from "jsonwebtoken";
import { envVars } from "../../config/env";
import AppError from "../../errorHelpers/AppError";
import {
  AccountStatus,
  IAuthProvider,
  IUser,
  RiderStatus,
  Role,
} from "./user.interface";
import { User } from "./user.model";
import { QueryBuilder } from "../../utils/QueryBuilder";

const createUser = async (payload: Partial<IUser>) => {
  const { email, password, ...rest } = payload;

  const isUserExist = await User.findOne({ email });

  if (isUserExist) {
    throw new AppError(httpStatus.BAD_REQUEST, "User Already Registered");
  }

  const hashedPassword = await bcryptjs.hash(
    password as string,
    Number(envVars.BCRYPT_SALT_ROUND)
  );

  const authProvider: IAuthProvider = {
    provider: "credentials",
    providerId: email as string,
  };

  const user = await User.create({
    email,
    password: hashedPassword,
    auths: [authProvider],
    riderStatus: RiderStatus.IDLE,
    ...rest,
  });

  const safeUser = user.toObject();
  delete safeUser.password;
  return safeUser;
};

const updateUser = async (
  id: string,
  payload: Partial<IUser>,
  decodedToken: JwtPayload
) => {
  if (id !== decodedToken.userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "You are not authorized");
  }

  const ifUserExist = await User.findById(id);

  if (!ifUserExist) {
    throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
  }

  const requesterRole = (decodedToken.role || ifUserExist.role) as
    | Role
    | undefined;

  const isPrivilegedUser =
    requesterRole === Role.ADMIN || requesterRole === Role.SUPER_ADMIN;

  const requestedRole = payload.role as Role | undefined;
  const isRoleSelectionPayload = typeof requestedRole !== "undefined";

  if (isRoleSelectionPayload && !isPrivilegedUser) {
    const isValidFirstTimeRoleSelection =
      !requesterRole &&
      !ifUserExist.role &&
      (requestedRole === Role.RIDER || requestedRole === Role.DRIVER);

    if (!isValidFirstTimeRoleSelection) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You are not authorized to update role"
      );
    }

    const payloadKeys = Object.keys(payload);
    const hasInvalidFieldsForRoleSetup = payloadKeys.some(
      (key) => key !== "role"
    );

    if (hasInvalidFieldsForRoleSetup) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Role setup request can only contain the role field"
      );
    }
  }

  if ("isBlocked" in payload && !isPrivilegedUser) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You are not authorized to edit block status"
    );
  }

  if ("status" in payload && !isPrivilegedUser) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You are not authorized to edit account status"
    );
  }

  if ("isVerified" in payload && !isPrivilegedUser) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You are not authorized to edit verification status"
    );
  }

  if ("auths" in payload && !isPrivilegedUser) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You are not authorized to edit auth providers"
    );
  }

  if (payload.password) {
    payload.password = await bcryptjs.hash(
      payload.password as string,
      Number(envVars.BCRYPT_SALT_ROUND)
    );
  }

  const newUpdatedUser = await User.findByIdAndUpdate(id, payload, {
    returnDocument: "after",
    runValidators: true,
  });

  return newUpdatedUser;
};

const userSearchableFields = ["name", "email", "contactNo"];

const getAllUsers = async (query: Record<string, string> = {}) => {
  const queryBuilder = new QueryBuilder(
    User.find({}).select("-password"),
    query,
  );

  const users = queryBuilder
    .filter()
    .search(userSearchableFields)
    .sort()
    .paginate();

  const [data, meta] = await Promise.all([users.build(), queryBuilder.getMeta()]);

  return {
    data,
    meta,
  };
};

const getSingleUser = async (id: string) => {
  const user = await User.findById(id).select("-password");
  return {
    data: user,
  };
};

const getMe = async (id: string) => {
  const user = await User.findById(id).select("-password");
  return {
    data: user,
  };
};

const assertCanManageAccountStatus = async (
  id: string,
  requester: JwtPayload,
) => {
  if (String(requester.userId) === id) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "You cannot change your own block status.",
    );
  }

  const target = await User.findById(id).select("role");
  if (!target) {
    throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
  }

  const requesterRole = requester.role as Role | undefined;

  if (
    target.role === Role.SUPER_ADMIN &&
    requesterRole !== Role.SUPER_ADMIN
  ) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only a super admin can change a super admin account.",
    );
  }

  if (target.role === Role.ADMIN && requesterRole !== Role.SUPER_ADMIN) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only a super admin can change an admin account.",
    );
  }

  return target;
};

export const blockUser = async (id: string, requester: JwtPayload) => {
  await assertCanManageAccountStatus(id, requester);

  const user = await User.findByIdAndUpdate(
    id,
    { isBlocked: true, status: AccountStatus.BLOCKED },
    { returnDocument: "after" }
  ).select("-password");
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
  }
  return user;
};

export const unblockUser = async (id: string, requester: JwtPayload) => {
  await assertCanManageAccountStatus(id, requester);

  const user = await User.findByIdAndUpdate(
    id,
    { isBlocked: false, status: AccountStatus.ACTIVE },
    { returnDocument: "after" }
  ).select("-password");
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
  }
  return user;
};

export const UserServices = {
  createUser,
  getAllUsers,
  getSingleUser,
  updateUser,
  getMe,
  blockUser,
  unblockUser,
};
