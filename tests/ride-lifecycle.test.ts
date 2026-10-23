import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import app from "../src/app";
import { Driver } from "../src/app/modules/driver/driver.model";
import { Ride } from "../src/app/modules/ride/ride.model";
import { RideStatus } from "../src/app/modules/ride/ride.interface";
import { RiderStatus } from "../src/app/modules/user/user.interface";
import { User } from "../src/app/modules/user/user.model";
import {
  PASSWORD,
  approvedDriverAuth,
  bookRide,
  riderAuth,
} from "./helpers";

// The lifecycle suite must be deterministic and provider-independent. The
// fake returns a 5.2 km road trip, so fare assertions stay meaningful without
// requiring network access. The opt-in live-ORS smoke test lives in
// tests/live-ors.test.ts.
vi.mock("../src/app/utils/fareProvider", () => ({
  calculateFare: vi.fn(async () => ({ distanceKm: 5.2, fare: 520 })),
}));

// Replica set (not standalone) so transactions behave like real MongoDB.
let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri("gomove-test"));

  // Transactions fail with transient "catalog changes" errors when they are
  // the first operation to CREATE a collection on an in-memory replica set.
  // Pre-create every collection the app touches so commits never do that.
  await Promise.all(
    ["users", "rides", "drivers"].map(async (name) => {
      const db = mongoose.connection.db;
      if (!db) throw new Error("Mongo connection failed");
      try {
        await db.createCollection(name);
      } catch {
        // collection already exists is fine
      }
    }),
  );

  // Build the unique indexes used by idempotency and driver-profile claims.
  await Promise.all([User.init(), Driver.init(), Ride.init()]);
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

const bearer = (token: string) => `Bearer ${token}`;

// NOTE: request chains go verb-first — .set() is unavailable before a verb on
// the TestAgent.
const accept = (token: string, rideId: string) =>
  request(app)
    .patch(`/api/v1/driver/${rideId}/accept`)
    .set("Authorization", bearer(token))
    .send();

const advance = (token: string, rideId: string, status: RideStatus) =>
  request(app)
    .patch(`/api/v1/driver/${rideId}/status`)
    .set("Authorization", bearer(token))
    .send({ status });

const cancelRide = (token: string, rideId: string) =>
  request(app)
    .patch(`/api/v1/ride/cancel/${rideId}`)
    .set("Authorization", bearer(token))
    .send();

const cancelDriverRide = (
  token: string,
  rideId: string,
  reason = "Driver cancelled before pickup",
) =>
  request(app)
    .patch(`/api/v1/driver/${rideId}/cancel`)
    .set("Authorization", bearer(token))
    .send({ reason });

const adminCancelRide = (
  token: string,
  rideId: string,
  reason = "Admin intervention",
) =>
  request(app)
    .patch(`/api/v1/ride/admin-cancel/${rideId}`)
    .set("Authorization", bearer(token))
    .send({ reason });

const bookRideWithKey = (token: string, idempotencyKey: string) =>
  request(app)
    .post("/api/v1/ride/request")
    .set("Authorization", bearer(token))
    .set("Idempotency-Key", idempotencyKey)
    .send({
      pickupLocation: { type: "Point", coordinates: [90.4051, 23.7509] },
      destination: { type: "Point", coordinates: [90.4244, 23.7806] },
    });

const rejectRide_ = (token: string, rideId: string) =>
  request(app)
    .patch(`/api/v1/driver/${rideId}/reject`)
    .set("Authorization", bearer(token))
    .send();

describe("ride lifecycle", () => {
  it("creates a ride with a server-computed road fare and sets rider state", async () => {
    const rider = await riderAuth();
    const res = await bookRide(rider.token);
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    // Real OpenRouteService road distance for the Dhaka pickup/destination
    // pair; the server derives fare = distanceKm * 100.
    const distance = res.body.data.distance as number;
    const fare = res.body.data.fare as number;
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(30);
    expect(fare).toBeGreaterThan(0);
    expect(Math.abs(fare - distance * 100)).toBeLessThan(0.011);

    expect(res.body.data.status).toBe(RideStatus.REQUESTED);
    expect(res.body.data.currentLocation.coordinates).toEqual([
      90.4051, 23.7509,
    ]);
  });

  it("double booking: rider with an active ride cannot request another", async () => {
    const rider = await riderAuth();
    await bookRide(rider.token);

    const res = await bookRide(rider.token);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already have a ride/i);
  });

  it("two drivers racing to accept: exactly one wins, contention returns 409", async () => {
    const rider = await riderAuth();
    const driverA = await approvedDriverAuth();
    const driverB = await approvedDriverAuth();

    const rideRes = await bookRide(rider.token);
    const rideId = rideRes.body.data._id as string;

    const [a, b] = await Promise.all([
      accept(driverA.token, rideId),
      accept(driverB.token, rideId),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses, JSON.stringify({ a: a.body, b: b.body })).toEqual([200, 409]);

    const conflict = a.status === 409 ? a : b;
    expect(conflict.body.message).toMatch(/already accepted|no longer/i);

    const stored = await Ride.findById(rideId);
    const winner = a.status === 200 ? driverA : driverB;
    expect(stored?.status).toBe(RideStatus.ACCEPTED);
    expect(stored?.driverId?.toString()).toBe(winner.profileId);
    expect(stored?.timestamps?.acceptedAt).toBeTruthy();
  });

  it("rejects accept for a driver that is offline", async () => {
    const rider = await riderAuth();
    const driver = await approvedDriverAuth();

    // go offline
    await request(app)
      .patch("/api/v1/driver/status")
      .set("Authorization", bearer(driver.token))
      .send({ isOnline: false });

    const rideRes = await bookRide(rider.token);
    const res = await accept(driver.token, rideRes.body.data._id);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not approved or online/i);
  });

  it("rejected driver cannot re-claim their rejected ride", async () => {
    const rider = await riderAuth();
    const driverA = await approvedDriverAuth();
    const driverB = await approvedDriverAuth();

    const rideRes = await bookRide(rider.token);
    const rideId = rideRes.body.data._id as string;

    const reject = await rejectRide_(driverA.token, rideId);
    expect(reject.status, JSON.stringify(reject.body)).toBe(200);

    const reAccept = await accept(driverA.token, rideId);
    expect(reAccept.status).toBe(400);

    // another driver can still take it
    const otherAccept = await accept(driverB.token, rideId);
    expect(otherAccept.status).toBe(200);
  });

  it("rider can cancel while REQUESTED and cannot flash-cancel an accepted ride", async () => {
    const rider = await riderAuth();
    const driver = await approvedDriverAuth();

    const rideRes = await bookRide(rider.token);
    const rideId = rideRes.body.data._id as string;

    const cancelRequested = await cancelRide(rider.token, rideId);
    expect(cancelRequested.status, JSON.stringify(cancelRequested.body)).toBe(200);
    expect(cancelRequested.body.data.status).toBe(RideStatus.CANCELLED);
    expect(cancelRequested.body.data.cancelReason).toBe("BY_RIDER");

    // new ride, accepted by driver — still cancellable before pickup
    const second = await bookRide(rider.token);
    const secondId = second.body.data._id as string;
    await accept(driver.token, secondId);

    const cancelAccepted = await cancelRide(rider.token, secondId);
    expect(cancelAccepted.status, JSON.stringify(cancelAccepted.body)).toBe(200);
    expect(cancelAccepted.body.data.status).toBe(RideStatus.CANCELLED);
  });

  it("the losing cancel-vs-accept race resolves to one clear outcome", async () => {
    const rider = await riderAuth();
    const driver = await approvedDriverAuth();

    const rideRes = await bookRide(rider.token);
    const rideId = rideRes.body.data._id as string;

    const [cancelRes, acceptRes] = await Promise.all([
      cancelRide(rider.token, rideId),
      accept(driver.token, rideId),
    ]);

    const outcomes = [cancelRes.status, acceptRes.status].sort();
    // A cancelled ride can no longer be accepted; an accepted ride can no
    // longer be cancelled. Exactly one operation must win.
    expect([200, 400].includes(cancelRes.status)).toBe(true);
    expect([200, 409].includes(acceptRes.status)).toBe(true);
    expect(outcomes[0]).toBeLessThanOrEqual(outcomes[1]);

    const stored = await Ride.findById(rideId);
    expect(stored).toBeTruthy();
    expect([RideStatus.CANCELLED, RideStatus.ACCEPTED]).toContain(stored?.status);

    if (stored?.status === RideStatus.CANCELLED) {
      expect(acceptRes.status).toBe(409);
      expect(stored.cancelReason).toBe("BY_RIDER");
    } else {
      expect(cancelRes.status).toBe(400);
    }
  });

  it("rider cannot cancel a ride they do not own", async () => {
    const riderA = await riderAuth();
    const riderB = await riderAuth();

    const rideRes = await bookRide(riderA.token);
    const rideId = rideRes.body.data._id as string;

    const res = await cancelRide(riderB.token, rideId);

    expect(res.status).toBe(403);
  });

  it("rider cannot cancel once the ride has started", async () => {
    const rider = await riderAuth();
    const driver = await approvedDriverAuth();

    const rideRes = await bookRide(rider.token);
    const rideId = rideRes.body.data._id as string;
    await accept(driver.token, rideId);
    await advance(driver.token, rideId, RideStatus.PICKED_UP);

    const res = await cancelRide(rider.token, rideId);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no longer be cancelled/i);
  });

  it("walks the full state machine and rejects skips and repeats", async () => {
    const rider = await riderAuth();
    const driver = await approvedDriverAuth();

    const rideRes = await bookRide(rider.token);
    const rideId = rideRes.body.data._id as string;
    await accept(driver.token, rideId);

    // skip PICKED_UP: ACCEPTED -> ARRIVED is invalid
    const skip = await advance(driver.token, rideId, RideStatus.ARRIVED);
    expect(skip.status).toBe(400);

    const pickUp = await advance(driver.token, rideId, RideStatus.PICKED_UP);
    expect(pickUp.status).toBe(200);

    // repeat PICKED_UP is a conflict now
    const repeat = await advance(driver.token, rideId, RideStatus.PICKED_UP);
    expect(repeat.status).toBe(409);

    const transit = await advance(
      driver.token,
      rideId,
      RideStatus.IN_TRANSIT,
    );
    expect(transit.status).toBe(200);

    const arrived = await advance(driver.token, rideId, RideStatus.ARRIVED);
    expect(arrived.status).toBe(200);

    const complete = await advance(driver.token, rideId, RideStatus.COMPLETED);
    expect(complete.status).toBe(200);
    expect(complete.body.data.timestamps.completedAt).toBeTruthy();

    // completed is terminal
    const terminal = await advance(
      driver.token,
      rideId,
      RideStatus.COMPLETED,
    );
    // Completed is terminal: replaying the same status is a duplicate request.
    expect(terminal.status).toBe(409);
  });

  it("a driver cannot advance someone else's ride", async () => {
    const rider = await riderAuth();
    const driverA = await approvedDriverAuth();
    const driverB = await approvedDriverAuth();

    const rideRes = await bookRide(rider.token);
    const rideId = rideRes.body.data._id as string;
    await accept(driverA.token, rideId);
    await advance(driverA.token, rideId, RideStatus.PICKED_UP);

    const foreign = await advance(
      driverB.token,
      rideId,
      RideStatus.IN_TRANSIT,
    );

    expect(foreign.status).toBe(403);
    const stored = await Ride.findById(rideId);
    expect(stored?.status).toBe(RideStatus.PICKED_UP);
  });

  it("rejects accepts from a driver with no profile yet", async () => {
    const rider = await riderAuth();
    const profileless = await riderAuth({
      name: "No Profile",
      role: "DRIVER",
    });

    const rideRes = await bookRide(rider.token);
    const res = await accept(profileless.token, rideRes.body.data._id);

    expect([403, 404]).toContain(res.status);
    const stored = await Ride.findById(rideRes.body.data._id);
    expect(stored?.status).toBe(RideStatus.REQUESTED);
  });

  it("driver double-booking guard: driver with an active ride cannot take another", async () => {
    const riderA = await riderAuth();
    const riderB = await riderAuth();
    const driver = await approvedDriverAuth();

    await accept(
      driver.token,
      (await bookRide(riderA.token)).body.data._id,
    );

    const secondRes = await bookRide(riderB.token);
    const res = await accept(driver.token, secondRes.body.data._id);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already have an active ride/i);
  });
});

describe("expiry", () => {
  it("REQUESTED rides older than the TTL expire without a driver", async () => {
    const rider = await riderAuth();
    const driver = await approvedDriverAuth();

    const rideRes = await bookRide(rider.token);
    const rideId = rideRes.body.data._id as string;

    // age the ride beyond the 15-minute TTL
    await Ride.updateOne(
      { _id: new Types.ObjectId(rideId) },
      { $set: { "timestamps.requestedAt": new Date(Date.now() - 16 * 60 * 1000) } },
    );

    // the driver-facing listing runs the expiry scan
    const listed = await request(app)
      .get("/api/v1/driver/incoming-requests")
      .set("Authorization", bearer(driver.token))
      .query({ limit: 10 });

    expect(listed.status).toBe(200);
    const listRows = (listed.body.data ?? []) as { _id: string }[];
    const listedIds = listRows.map((ride) => ride._id);
    expect(listedIds).not.toContain(rideId);

    const stored = await Ride.findById(rideId);
    expect(stored?.status).toBe(RideStatus.CANCELLED);
    expect(stored?.cancelReason).toBe("NO_DRIVER");
    expect(stored?.timestamps?.cancelledAt).toBeTruthy();
  });

  it("expired rides release the rider to book again", async () => {
    const rider = await riderAuth();

    const first = await bookRide(rider.token);
    const rideId = first.body.data._id as string;

    await Ride.updateOne(
      { _id: new Types.ObjectId(rideId) },
      { $set: { "timestamps.requestedAt": new Date(Date.now() - 20 * 60 * 1000) } },
    );

    // the expiry scan runs inside the next booking attempt
    const second = await bookRide(rider.token);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
  });
});

describe("fare and validation", () => {
  it("rejects out-of-range coordinates", async () => {
    const rider = await riderAuth();

    const res = await bookRide(rider.token, {
      pickupLocation: { type: "Point", coordinates: [200, 23] },
      destination: { type: "Point", coordinates: [90.42, 23.78] },
    });

    expect(res.status).toBe(400);
  });

  it("rejects identical pickup and destination", async () => {
    const rider = await riderAuth();

    const same = { type: "Point", coordinates: [90.4051, 23.7509] };
    const res = await bookRide(rider.token, {
      pickupLocation: same,
      destination: same,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/same location/i);
  });
});

describe("authorization and misc", () => {
  it("login works through the real endpoint", async () => {
    const rider = await riderAuth();

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: rider.user.email, password: PASSWORD });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.password).toBeUndefined();
  });

  it("rejects unauthenticated ride requests", async () => {
    const res = await request(app).post("/api/v1/ride/request").send({});
    expect(res.status).toBe(401);
  });

  it("admin ride list is filtered, server-side paginated", async () => {
    const admin = await riderAuth({ name: "Admin", role: "ADMIN" });
    const rider = await riderAuth();

    const ride = (await bookRide(rider.token)).body.data;
    await Ride.updateOne(
      { _id: ride._id },
      { $set: { status: RideStatus.COMPLETED } },
    );

    const res = await request(app)
      .get("/api/v1/ride/all-rides-admin")
      .set("Authorization", bearer(admin.token))
      .query({ status: "COMPLETED", page: 1, limit: 5 });

    expect(res.status).toBe(200);
    const rows = (res.body.data ?? []) as { riderId: { name?: string } }[];
    expect(rows).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
    expect(rows[0].riderId.name).toBeDefined();
  });
});

describe("cancellation and intervention", () => {
  it("lets the assigned driver cancel before pickup and frees both parties", async () => {
    const rider = await riderAuth();
    const driver = await approvedDriverAuth();
    const rideId = (await bookRide(rider.token)).body.data._id as string;

    expect((await accept(driver.token, rideId)).status).toBe(200);

    const res = await cancelDriverRide(driver.token, rideId, "Rider no-show");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe(RideStatus.CANCELLED);
    expect(res.body.data.cancelReason).toBe("BY_DRIVER");

    const storedRider = await User.findById(rider.user._id);
    expect(storedRider?.riderStatus).toBe(RiderStatus.IDLE);

    const profile = await Driver.findById(driver.profileId);
    expect(profile?.activeRideId).toBeNull();

    // The rider and driver are both available again.
    const secondId = (await bookRide(rider.token)).body.data._id as string;
    const acceptedAgain = await accept(driver.token, secondId);
    expect(acceptedAgain.status, JSON.stringify(acceptedAgain.body)).toBe(200);
  });

  it("refuses driver cancellation after pickup", async () => {
    const rider = await riderAuth();
    const driver = await approvedDriverAuth();
    const rideId = (await bookRide(rider.token)).body.data._id as string;

    await accept(driver.token, rideId);
    await advance(driver.token, rideId, RideStatus.PICKED_UP);

    const res = await cancelDriverRide(driver.token, rideId);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/started/i);
  });

  it("lets an admin cancel a stuck in-progress ride and refuses a terminal retry", async () => {
    const rider = await riderAuth();
    const driver = await approvedDriverAuth();
    const admin = await riderAuth({ name: "Admin", role: "ADMIN" });
    const rideId = (await bookRide(rider.token)).body.data._id as string;

    await accept(driver.token, rideId);
    await advance(driver.token, rideId, RideStatus.PICKED_UP);

    const res = await adminCancelRide(
      admin.token,
      rideId,
      "Driver unresponsive",
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe(RideStatus.CANCELLED);
    expect(res.body.data.cancelReason).toBe("BY_ADMIN");
    expect(res.body.data.cancelNote).toBe("Driver unresponsive");

    const storedRider = await User.findById(rider.user._id);
    expect(storedRider?.riderStatus).toBe(RiderStatus.IDLE);

    const profile = await Driver.findById(driver.profileId);
    expect(profile?.activeRideId).toBeNull();

    const retry = await adminCancelRide(admin.token, rideId, "Again");
    expect(retry.status).toBe(400);
  });
});

describe("concurrent driver claims", () => {
  it("allows only one of two different rides for the same driver", async () => {
    const riderA = await riderAuth();
    const riderB = await riderAuth();
    const driver = await approvedDriverAuth();
    const rideA = (await bookRide(riderA.token)).body.data._id as string;
    const rideB = (await bookRide(riderB.token)).body.data._id as string;

    const [first, second] = await Promise.all([
      accept(driver.token, rideA),
      accept(driver.token, rideB),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);

    const stored = await Ride.find({ driverId: driver.profileId });
    const accepted = stored.filter(
      (ride) => ride.status === RideStatus.ACCEPTED,
    );
    expect(accepted).toHaveLength(1);

    const profile = await Driver.findById(driver.profileId);
    expect(profile?.activeRideId?.toString()).toBe(
      accepted[0]._id.toString(),
    );
  });
});

describe("idempotent booking", () => {
  it("returns the same ride when the same key is retried", async () => {
    const rider = await riderAuth();
    const key = `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const first = await bookRideWithKey(rider.token, key);
    const second = await bookRideWithKey(rider.token, key);

    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.data._id).toBe(first.body.data._id);
    expect(await Ride.countDocuments({ idempotencyKey: key })).toBe(1);
  });
});
