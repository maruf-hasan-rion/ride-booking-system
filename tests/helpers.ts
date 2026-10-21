import request from "supertest";
import bcryptjs from "bcryptjs";
import app from "../src/app";
import { Role } from "../src/app/modules/user/user.interface";
import { User } from "../src/app/modules/user/user.model";
import { createUserTokens } from "../src/app/utils/userTokens";

export const PASSWORD = "Str0ng!Pass";
export const VEHICLE_INFO = "Toyota Axio, silver, Dhaka Metro D-2233";

/** Creates a verified user directly in the (test) database with a real hash. */
export const createVerifiedUser = async (
  overrides: Partial<{
    name: string;
    email: string;
    role: Role;
    password: string;
  }> = {},
) => {
  const email =
    overrides.email ?? `user-${Math.random().toString(36).slice(2)}@example.com`;

  const user = await User.create({
    name: overrides.name ?? "Test User",
    email,
    role: overrides.role ?? Role.RIDER,
    password: await bcryptjs.hash(overrides.password ?? PASSWORD, 10),
    isVerified: true,
    contactNo: "+8801700000000",
  });

  return user;
};

/** Issues the same access token shape the login endpoint would return,
 * so the test suite does not trip the login rate limiter repeatedly. */
export const tokenFor = (
  user: { _id?: unknown; email?: string; role?: Role | string },
) => createUserTokens(user as never).accessToken as string;

export const riderAuth = async (
  overrides: Partial<{ name: string; email: string; role: Role }> = {},
) => {
  const user = await createVerifiedUser({ role: Role.RIDER, ...overrides });
  return { user, token: tokenFor(user) };
};

/** Creates a driver user+profile, is approved by an admin, and goes online.
 * Returns the DRIVER PROFILE id separately (rides reference profiles, not users). */
export const approvedDriverAuth = async (
  overrides: Partial<{ name: string; email: string }> = {},
) => {
  const driver = await createVerifiedUser({ role: Role.DRIVER, ...overrides });
  const driverToken = tokenFor(driver);

  const profile = await request(app)
    .post("/api/v1/driver/profile")
    .set("Authorization", `Bearer ${driverToken}`)
    .send({ vehicleInfo: VEHICLE_INFO });

  if (profile.status !== 201) {
    throw new Error(
      `driver profile creation failed: ${JSON.stringify(profile.body)}`,
    );
  }

  const admin = await createVerifiedUser({ role: Role.ADMIN });
  const adminToken = tokenFor(admin);

  const approve = await request(app)
    .patch(`/api/v1/driver/approve/${driver._id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send();

  if (approve.status !== 200) {
    throw new Error(
      `driver approval failed: ${JSON.stringify(approve.body)}`,
    );
  }

  const online = await request(app)
    .patch("/api/v1/driver/status")
    .set("Authorization", `Bearer ${driverToken}`)
    .send({ isOnline: true });

  if (online.status !== 200) {
    throw new Error(
      `driver online failed: ${JSON.stringify(online.body)}`,
    );
  }

  return { driver, profileId: String(profile.body.data._id), token: driverToken };
};

/** Creates a ride through the real API (fare mocked by the test file). */
export const bookRide = async (
  token: string,
  body?: Record<string, unknown>,
) => {
  const bookingBody = body ?? {
    pickupLocation: { type: "Point", coordinates: [90.4051, 23.7509] },
    destination: { type: "Point", coordinates: [90.4244, 23.7806] },
  };

  const res = await request(app)
    .post("/api/v1/ride/request")
    .set("Authorization", `Bearer ${token}`)
    .send(bookingBody);

  return res;
};
