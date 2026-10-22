/* eslint-disable no-console */
/**
 * Seeds the platform with REAL records through the same service functions the
 * API uses (no hand-fabricated documents): users get hashed credentials, the
 * driver gets a real profile that is approved through driver services, and
 * ride data is produced by the ride lifecycle (including real
 * OpenRouteService road distances when ORS_API_KEY works).
 *
 * Idempotent: re-running det existing seed users and skips them.
 *
 * Run with:  npm run seed
 */
import mongoose from "mongoose";
import bcryptjs from "bcryptjs";
import dotenv from "dotenv";
import { envVars } from "../app/config/env";
import { Role, RiderStatus, AccountStatus } from "../app/modules/user/user.interface";
import { User } from "../app/modules/user/user.model";
import { Driver } from "../app/modules/driver/driver.model";
import { Ride } from "../app/modules/ride/ride.model";
import { RideServices } from "../app/modules/ride/ride.service";
import { DriverServices } from "../app/modules/driver/driver.service";

dotenv.config({ override: false });

const requireSeedPassword = (
  value: string | undefined,
  name: string,
): string => {
  if (!value || value.length < 12) {
    throw new Error(`${name} (at least 12 characters) is required.`);
  }
  return value;
};

const SEED_ACCOUNT_PASSWORD = requireSeedPassword(
  process.env.SEED_PASSWORD,
  "SEED_PASSWORD",
);
const SEED_ADMIN_PASSWORD = requireSeedPassword(
  process.env.SEED_ADMIN_PASSWORD,
  "SEED_ADMIN_PASSWORD",
);

if (
  envVars.NODE_ENV === "production" &&
  process.env.ALLOW_DEMO_SEED !== "true"
) {
  throw new Error(
    "Refusing to seed demo accounts in production. Set ALLOW_DEMO_SEED=true only for a dedicated demo database.",
  );
}

const passwordForRole = (role: Role): string =>
  role === Role.ADMIN ? SEED_ADMIN_PASSWORD : SEED_ACCOUNT_PASSWORD;

const DHAKA = [90.4051, 23.7509] as [number, number];   // [lng, lat]
const MIRPUR = [90.3665, 23.805] as [number, number];
const UTTARA = [90.4244, 23.7806] as [number, number];

interface SeedAccountSpec {
  name: string;
  email: string;
  role: Role;
}

const SEED_ACCOUNTS: SeedAccountSpec[] = [
  { name: "Seed Admin", email: "admin@seed.gomove.app", role: Role.ADMIN },
  { name: "Seed Rider", email: "rider@seed.gomove.app", role: Role.RIDER },
  { name: "Seed Driver", email: "driver@seed.gomove.app", role: Role.DRIVER },
];

const ensureAccount = async (spec: SeedAccountSpec) => {
  const hashedPassword = await bcryptjs.hash(
    passwordForRole(spec.role),
    Number(envVars.BCRYPT_SALT_ROUND),
  );
  const credentials = [
    { provider: "credentials", providerId: spec.email },
  ];
  const existing = await User.findOne({ email: spec.email });

  if (existing) {
    existing.name = spec.name;
    existing.role = spec.role;
    existing.password = hashedPassword;
    existing.isVerified = true;
    existing.auths = credentials;
    if (existing.status !== AccountStatus.BLOCKED) {
      existing.status = AccountStatus.ACTIVE;
    }
    await existing.save();
    return existing;
  }

  return User.create({
    name: spec.name,
    email: spec.email,
    role: spec.role,
    password: hashedPassword,
    isVerified: true,
    contactNo: "+8801700000000",
    status: AccountStatus.ACTIVE,
    auths: credentials,
  });
};

const finishRide = async (
  rideId: string,
  driverUserId: string,
  riderUserId: string,
) => {
  await DriverServices.acceptRide(rideId, driverUserId);
  await DriverServices.updateRideStatus(rideId, driverUserId, "PICKED_UP" as never);
  await DriverServices.updateRideStatus(rideId, driverUserId, "IN_TRANSIT" as never);
  await DriverServices.updateRideStatus(rideId, driverUserId, "ARRIVED" as never);
  await DriverServices.updateRideStatus(rideId, driverUserId, "COMPLETED" as never);

  // reset rider availability so the next seed run can book again
  await User.updateOne({ _id: riderUserId }, { riderStatus: RiderStatus.IDLE });
};

const seed = async () => {
  await mongoose.connect(envVars.DB_URL);
  console.log("connected:", mongoose.connection.name);

  const accounts: Record<string, Awaited<ReturnType<typeof ensureAccount>>> = {};

  for (const spec of SEED_ACCOUNTS) {
    accounts[spec.role] = await ensureAccount(spec);
  }

  const admin = accounts[Role.ADMIN];
  const rider = accounts[Role.RIDER];
  const driver = accounts[Role.DRIVER];

  // Driver profile + approval through the same service gates the API uses.
  await DriverServices.createDriver(driver._id.toString(), "Toyota Axio, silver, Dhaka Metro D-2233")
    .catch(() => undefined); // profile may already exist
  await DriverServices.approveDriver(driver._id.toString());
  await DriverServices.driverStatus(driver._id.toString(), true);
  // A previous interrupted seed may have left a lock behind.
  await Driver.updateOne(
    { user: driver._id },
    { $set: { activeRideId: null } },
  );

  // One completed ride with a REAL propagated fare.
  const completedRideExists = await Ride.exists({
    riderId: rider._id,
    status: "COMPLETED",
  });

  if (!completedRideExists) {
    const { data: booked } = await RideServices.requestRide({
      riderId: rider._id,
      pickupLocation: { type: "Point", coordinates: DHAKA },
      destination: { type: "Point", coordinates: MIRPUR },
      currentLocation: { type: "Point", coordinates: DHAKA },
      rejectedBy: [],
      timestamps: { requestedAt: new Date() },
    } as never);

    await finishRide(booked._id.toString(), driver._id.toString(), rider._id.toString());
  }

  // One cancelled ride (rider cancel flow incl. reason BY_RIDER).
  const cancelledRideExists = await Ride.exists({
    riderId: rider._id,
    status: "CANCELLED",
  });

  if (!cancelledRideExists) {
    const { data: booked } = await RideServices.requestRide({
      riderId: rider._id,
      pickupLocation: { type: "Point", coordinates: DHAKA },
      destination: { type: "Point", coordinates: UTTARA },
      currentLocation: { type: "Point", coordinates: DHAKA },
      rejectedBy: [],
      timestamps: { requestedAt: new Date() },
    } as never);

    await RideServices.cancelRide(booked._id.toString(), rider._id.toString());
  }

  console.log("\nSeed complete. Sign in with the configured seed passwords:");
  console.log("  admin  :", admin.email);
  console.log("  rider  :", rider.email);
  console.log("  driver :", driver.email);

  await mongoose.disconnect();
};

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
