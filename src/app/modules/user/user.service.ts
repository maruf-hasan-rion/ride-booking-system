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
import { Driver } from "../driver/driver.model";

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
  const statusFilter = query.status?.trim().toUpperCase();
  const roleFilter = query.role?.trim().toUpperCase();

  const builderQuery = { ...query };
  delete builderQuery.status;
  delete builderQuery.role;

  const baseFilter: Record<string, unknown> = {};
  if (roleFilter) {
    baseFilter.role = roleFilter;
  }

  // Driver approval is a separate document. Resolve the user ids once so the
  // status filter and the paginated total stay consistent with the UI's
  // PENDING/ACTIVE labels.
  let unapprovedDriverUserIds: string[] = [];
  if (statusFilter === "PENDING" || statusFilter === "ACTIVE") {
    const ids = await Driver.distinct("user", { isApproved: { $ne: true } });
    unapprovedDriverUserIds = ids.map(String);
  }

  if (statusFilter === "PENDING") {
    if (roleFilter && roleFilter !== Role.DRIVER) {
      baseFilter._id = { $in: [] };
    } else {
      baseFilter.role = Role.DRIVER;
      baseFilter.status = AccountStatus.ACTIVE;
      baseFilter.isBlocked = { $ne: true };
      baseFilter._id = { $in: unapprovedDriverUserIds };
    }
  } else if (statusFilter === "ACTIVE") {
    baseFilter.status = AccountStatus.ACTIVE;
    baseFilter.isBlocked = { $ne: true };
    if (unapprovedDriverUserIds.length > 0) {
      baseFilter._id = { $nin: unapprovedDriverUserIds };
    }
  } else if (statusFilter === "BLOCKED") {
    baseFilter.$or = [
      { status: AccountStatus.BLOCKED },
      { isBlocked: true },
    ];
  } else if (statusFilter === "SUSPENDED") {
    baseFilter.status = AccountStatus.SUSPENDED;
  }

  const queryBuilder = new QueryBuilder(
    User.find(baseFilter).select("-password"),
    builderQuery,
  );

  const users = queryBuilder
    .filter()
    .search(userSearchableFields)
    .sort()
    .paginate();

  const [rawData, meta] = await Promise.all([
    users.build().lean(),
    queryBuilder.getMeta(),
  ]);

  const data = rawData as (Record<string, unknown> & { _id: unknown })[];

  const driverProfiles = await Driver.find({
    user: { $in: data.map((user) => user._id) },
  })
    .select("_id user isApproved")
    .lean();

  const profileByUser = new Map(
    driverProfiles.map((profile) => [
      String(profile.user),
      { _id: String(profile._id), isApproved: Boolean(profile.isApproved) },
    ]),
  );

  return {
    data: data.map((user) => ({
      ...user,
      driverProfile: profileByUser.get(String(user._id)) ?? null,
    })),
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
