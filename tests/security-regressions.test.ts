import request from "supertest";
import bcryptjs from "bcryptjs";
import { sign } from "jsonwebtoken";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import app from "../src/app";
import { envVars } from "../src/app/config/env";
import { Driver } from "../src/app/modules/driver/driver.model";
import { Ride } from "../src/app/modules/ride/ride.model";
import { RideStatus } from "../src/app/modules/ride/ride.interface";
import { Role, RiderStatus } from "../src/app/modules/user/user.interface";
import { User } from "../src/app/modules/user/user.model";
import { canLinkGoogleAccount } from "../src/app/utils/accountLinking";
import { createUserTokens } from "../src/app/utils/userTokens";
import {
  PASSWORD,
  VEHICLE_INFO,
  createVerifiedUser,
  tokenFor,
} from "./helpers";

let replSet: MongoMemoryReplSet;

const bearer = (token: string) => `Bearer ${token}`;

const ridePoint = (coordinates: [number, number]) => ({
  type: "Point" as const,
  coordinates,
});

const createRide = async (options: {
  riderId: mongoose.Types.ObjectId;
  driverId?: mongoose.Types.ObjectId;
  status: RideStatus;
  requestedAt?: Date;
  completedAt?: Date;
  fare?: number;
}) =>
  Ride.create({
    riderId: options.riderId,
    driverId: options.driverId,
    pickupLocation: ridePoint([90.4051, 23.7509]),
    destination: ridePoint([90.4244, 23.7806]),
    currentLocation: ridePoint([90.4051, 23.7509]),
    distance: 5.2,
    fare: options.fare ?? 520,
    status: options.status,
    timestamps: {
      requestedAt: options.requestedAt ?? new Date(),
      ...(options.status !== RideStatus.REQUESTED
        ? { acceptedAt: new Date() }
        : {}),
      ...(options.completedAt ? { completedAt: options.completedAt } : {}),
    },
  });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri("gomove-security-test"));
  await Promise.all(
    ["users", "rides", "drivers"].map(async (name) => {
      try {
        await mongoose.connection.db?.createCollection(name);
      } catch {
        // exists is fine
      }
    }),
  );
}, 180000);

afterEach(async () => {
  const collections = (await mongoose.connection.db?.collections()) ?? [];
  await Promise.all(
    collections.map((collection) => collection.deleteMany({})),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
}, 60000);

describe("driver queue authorization", () => {
  it("refuses unapproved and offline drivers", async () => {
    const rider = await createVerifiedUser({ role: Role.RIDER });
    const driverUser = await createVerifiedUser({ role: Role.DRIVER });
    await Driver.create({ user: driverUser._id, vehicleInfo: VEHICLE_INFO });
    await createRide({
      riderId: rider._id as mongoose.Types.ObjectId,
      status: RideStatus.REQUESTED,
    });

    const res = await request(app)
      .get("/api/v1/driver/incoming-requests")
      .set("Authorization", bearer(tokenFor(driverUser)));

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not approved or online/i);
  });

  it("returns a minimized queue to an approved online driver", async () => {
    const rider = await createVerifiedUser({
      name: "Rider Name",
      role: Role.RIDER,
    });
    const driverUser = await createVerifiedUser({ role: Role.DRIVER });
    const profile = await Driver.create({
      user: driverUser._id,
      vehicleInfo: VEHICLE_INFO,
      isApproved: true,
      isOnline: true,
    });
    await createRide({
      riderId: rider._id as mongoose.Types.ObjectId,
      status: RideStatus.REQUESTED,
    });

    const res = await request(app)
      .get("/api/v1/driver/incoming-requests")
      .set("Authorization", bearer(tokenFor(driverUser)))
      .query({ limit: 10 });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data.data as Array<{
      riderId: { name?: string; email?: string; contactNo?: string };
      pickupLocation: { coordinates: number[] };
      destination: { coordinates: number[] };
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].riderId.name).toBe("Rider Name");
    expect(rows[0].riderId.email).toBeUndefined();
    expect(rows[0].riderId.contactNo).toBeUndefined();
    expect(rows[0].pickupLocation.coordinates).toEqual([90.405, 23.751]);
    expect(rows[0].destination.coordinates).toEqual([90.424, 23.781]);
    expect(profile.isApproved).toBe(true);
  });

  it("caps an oversized queue limit at 50", async () => {
    const rider = await createVerifiedUser({ role: Role.RIDER });
    const driverUser = await createVerifiedUser({ role: Role.DRIVER });
    await Driver.create({
      user: driverUser._id,
      vehicleInfo: VEHICLE_INFO,
      isApproved: true,
      isOnline: true,
    });

    await Promise.all(
      Array.from({ length: 55 }, () =>
        createRide({
          riderId: rider._id as mongoose.Types.ObjectId,
          status: RideStatus.REQUESTED,
        }),
      ),
    );

    const res = await request(app)
      .get("/api/v1/driver/incoming-requests")
      .set("Authorization", bearer(tokenFor(driverUser)))
      .query({ limit: 1000 });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.meta.limit).toBe(50);
    expect(res.body.data.data).toHaveLength(50);
  });

  it("expires a stale request and releases the rider in one flow", async () => {
    const rider = await createVerifiedUser({ role: Role.RIDER });
    await User.updateOne(
      { _id: rider._id },
      { riderStatus: RiderStatus.REQUESTED },
    );

    const driverUser = await createVerifiedUser({ role: Role.DRIVER });
    await Driver.create({
      user: driverUser._id,
      vehicleInfo: VEHICLE_INFO,
      isApproved: true,
      isOnline: true,
    });

    const stale = await createRide({
      riderId: rider._id as mongoose.Types.ObjectId,
      status: RideStatus.REQUESTED,
      requestedAt: new Date(Date.now() - 20 * 60 * 1000),
    });

    const res = await request(app)
      .get("/api/v1/driver/incoming-requests")
      .set("Authorization", bearer(tokenFor(driverUser)));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stored = await Ride.findById(stale._id);
    expect(stored?.status).toBe(RideStatus.CANCELLED);
    expect(stored?.cancelReason).toBe("NO_DRIVER");

    const storedRider = await User.findById(rider._id);
    expect(storedRider?.riderStatus).toBe(RiderStatus.IDLE);
  });
});

describe("sensitive response fields", () => {
  it("does not expose the driver password hash to the rider", async () => {
    const rider = await createVerifiedUser({ role: Role.RIDER });
    const driverUser = await createVerifiedUser({ role: Role.DRIVER });
    const profile = await Driver.create({
      user: driverUser._id,
      vehicleInfo: VEHICLE_INFO,
      isApproved: true,
      isOnline: true,
    });
    const ride = await createRide({
      riderId: rider._id as mongoose.Types.ObjectId,
      driverId: profile._id as mongoose.Types.ObjectId,
      status: RideStatus.ACCEPTED,
    });

    const res = await request(app)
      .get(`/api/v1/ride/my-ride/${ride._id}`)
      .set("Authorization", bearer(tokenFor(rider)));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const driver = res.body.data.driverId.user as Record<string, unknown>;
    expect(driver.password).toBeUndefined();
    expect(driver.auths).toBeUndefined();
    expect(driver.name).toBe(driverUser.name);
  });

  it("does not include the password hash in the registration response", async () => {
    const res = await request(app).post("/api/v1/user/register").send({
      name: "New Rider",
      email: "new-rider@example.com",
      password: PASSWORD,
      role: Role.RIDER,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.password).toBeUndefined();
  });

  it("does not include the password hash in a profile update response", async () => {
    const user = await createVerifiedUser({ role: Role.RIDER });

    const res = await request(app)
      .patch(`/api/v1/user/${user._id}`)
      .set("Authorization", bearer(tokenFor(user)))
      .send({ name: "Updated Name", contactNo: "+8801700000001" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.name).toBe("Updated Name");
    expect(res.body.data.password).toBeUndefined();
  });
});

describe("role hierarchy", () => {
  it("lets SUPER_ADMIN use admin-only ride and driver endpoints", async () => {
    const superAdmin = await createVerifiedUser({
      role: Role.SUPER_ADMIN,
    });
    const token = tokenFor(superAdmin);

    const rides = await request(app)
      .get("/api/v1/ride/all-rides-admin")
      .set("Authorization", bearer(token));
    const drivers = await request(app)
      .get("/api/v1/driver")
      .set("Authorization", bearer(token));

    expect(rides.status).toBe(200);
    expect(drivers.status).toBe(200);
  });
});

describe("account linking", () => {
  it("refuses to silently link an unverified credentials account", () => {
    expect(
      canLinkGoogleAccount({
        isVerified: false,
        auths: [{ provider: "credentials", providerId: "victim@example.com" }],
      }),
    ).toBe(false);
  });

  it("allows verified accounts and already-linked Google accounts", () => {
    expect(
      canLinkGoogleAccount({
        isVerified: true,
        auths: [{ provider: "credentials", providerId: "owner@example.com" }],
      }),
    ).toBe(true);
    expect(
      canLinkGoogleAccount({
        isVerified: false,
        auths: [{ provider: "google", providerId: "google-id" }],
      }),
    ).toBe(true);
  });
});

describe("password change contract", () => {
  it("accepts POST, persists the new hash, and invalidates old tokens", async () => {
    const user = await createVerifiedUser({ role: Role.RIDER });
    const oldAccessToken = tokenFor(user);
    const oldRefreshToken = createUserTokens(user).refreshToken;
    const newPassword = "NewStr0ng!Pass";

    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", bearer(oldAccessToken))
      .send({ oldPassword: PASSWORD, newPassword });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stored = await User.findById(user._id).select("+password");
    expect(stored?.password).toBeTruthy();
    expect(await bcryptjs.compare(newPassword, stored?.password as string)).toBe(
      true,
    );

    const oldAccess = await request(app)
      .get("/api/v1/user/me")
      .set("Authorization", bearer(oldAccessToken));
    expect(oldAccess.status).toBe(401);

    const oldRefresh = await request(app)
      .post("/api/v1/auth/refresh-token")
      .set("Cookie", `refreshToken=${oldRefreshToken}`)
      .set("X-Requested-With", "XMLHttpRequest")
      .send();
    expect(oldRefresh.status).toBe(401);
  });
});

describe("error contract", () => {
  it("maps expired tokens to 401 without exposing the JWT error", async () => {
    const expired = sign(
      {
        email: "expired@example.com",
        role: Role.RIDER,
        tokenVersion: 0,
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      envVars.JWT_ACCESS_SECRET,
    );

    const res = await request(app)
      .get("/api/v1/user/me")
      .set("Authorization", bearer(expired));

    expect(res.status).toBe(401);
    expect(res.body.statusCode).toBe(401);
    expect(res.body.message).toMatch(/session expired/i);
    expect(res.body.message).not.toMatch(/jwt expired/i);
  });

  it("maps malformed JSON to 400", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/malformed json/i);
  });
});

describe("role freshness", () => {
  it("uses the database role instead of the token role", async () => {
    const user = await createVerifiedUser({ role: Role.RIDER });
    const token = tokenFor(user);

    await User.updateOne({ _id: user._id }, { role: Role.DRIVER });

    const res = await request(app)
      .get("/api/v1/driver/profile/me")
      .set("Authorization", bearer(token));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

describe("CSRF protection", () => {
  it("requires the custom header on cookie-authenticated mutations", async () => {
    const user = await createVerifiedUser({ role: Role.RIDER });
    const agent = request.agent(app);

    const login = await agent.post("/api/v1/auth/login").send({
      email: user.email,
      password: PASSWORD,
    });
    expect(login.status, JSON.stringify(login.body)).toBe(200);

    const blocked = await agent.post("/api/v1/auth/logout").send();
    expect(blocked.status).toBe(403);

    const allowed = await agent
      .post("/api/v1/auth/logout")
      .set("X-Requested-With", "XMLHttpRequest")
      .send();
    expect(allowed.status).toBe(200);
  });
});

describe("query hardening", () => {
  it("caps page size and escapes hostile sort/date input", async () => {
    const rider = await createVerifiedUser({ role: Role.RIDER });

    const res = await request(app)
      .get("/api/v1/ride/all-my-rides")
      .set("Authorization", bearer(tokenFor(rider)))
      .query({
        limit: 1000,
        page: -1,
        dateSearch: "(a+)+$",
        sort: "$natural",
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.meta.limit).toBe(50);
    expect(res.body.data.meta.page).toBe(1);
  });

  it("does not allow a rider to override the ownership scope", async () => {
    const riderA = await createVerifiedUser({ role: Role.RIDER });
    const riderB = await createVerifiedUser({ role: Role.RIDER });
    const rideB = await createRide({
      riderId: riderB._id as mongoose.Types.ObjectId,
      status: RideStatus.COMPLETED,
    });

    const res = await request(app)
      .get("/api/v1/ride/all-my-rides")
      .set("Authorization", bearer(tokenFor(riderA)))
      .query({ riderId: String(riderB._id) });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data.data as Array<{ _id: string }>;
    expect(rows.some((ride) => ride._id === String(rideB._id))).toBe(false);
  });

  it("filters rider history by server-side fare range", async () => {
    const rider = await createVerifiedUser({ role: Role.RIDER });

    await createRide({
      riderId: rider._id as mongoose.Types.ObjectId,
      status: RideStatus.COMPLETED,
      fare: 100,
    });
    await createRide({
      riderId: rider._id as mongoose.Types.ObjectId,
      status: RideStatus.COMPLETED,
      fare: 1000,
    });

    const res = await request(app)
      .get("/api/v1/ride/all-my-rides")
      .set("Authorization", bearer(tokenFor(rider)))
      .query({ minFare: 500, limit: 10 });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data.data as Array<{ fare: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].fare).toBe(1000);
    expect(res.body.data.meta.total).toBe(1);
  });
});

describe("admin account management", () => {
  it("prevents lower-privileged admins from blocking higher roles or themselves", async () => {
    const admin = await createVerifiedUser({ role: Role.ADMIN });
    const superAdmin = await createVerifiedUser({ role: Role.SUPER_ADMIN });
    const rider = await createVerifiedUser({ role: Role.RIDER });
    const adminToken = tokenFor(admin);

    const block = (id: unknown, token: string) =>
      request(app)
        .patch(`/api/v1/user/block/${String(id)}`)
        .set("Authorization", bearer(token))
        .send();

    const superBlocked = await block(superAdmin._id, adminToken);
    expect(superBlocked.status).toBe(403);

    const selfBlocked = await block(admin._id, adminToken);
    expect(selfBlocked.status).toBe(400);

    const riderBlocked = await block(rider._id, adminToken);
    expect(riderBlocked.status).toBe(200);

    const adminBlockedBySuper = await block(admin._id, tokenFor(superAdmin));
    expect(adminBlockedBySuper.status).toBe(200);
  });
});

describe("driver earnings timing", () => {
  it("returns the actual completion timestamp", async () => {
    const rider = await createVerifiedUser({ role: Role.RIDER });
    const driverUser = await createVerifiedUser({ role: Role.DRIVER });
    const profile = await Driver.create({
      user: driverUser._id,
      vehicleInfo: VEHICLE_INFO,
      isApproved: true,
      isOnline: true,
    });
    const completedAt = new Date("2026-10-22T10:45:00.000Z");

    await createRide({
      riderId: rider._id as mongoose.Types.ObjectId,
      driverId: profile._id as mongoose.Types.ObjectId,
      status: RideStatus.COMPLETED,
      completedAt,
    });

    const res = await request(app)
      .get("/api/v1/driver/earnings/me")
      .set("Authorization", bearer(tokenFor(driverUser)));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data[0].timestamps.completedAt).toBe(
      completedAt.toISOString(),
    );
  });
});
