import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import app from "../src/app";
import { Ride } from "../src/app/modules/ride/ride.model";
import AppError from "../src/app/errorHelpers/AppError";
import { riderAuth } from "./helpers";

/**
 * Fault injection cannot be done against the live OpenRouteService, so this
 * file is the one place where the route provider is mocked: it verifies the
 * booking flow refuses to persist a ride when fare calculation fails.
 */
vi.mock("../src/app/utils/fareCalculator", () => ({
  fareCalulator: vi.fn(async () => {
    throw new AppError(
      503,
      "Route distance service is unavailable. Please try again shortly.",
    );
  }),
}));

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri("gomove-test"));
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

describe("booking resilience", () => {
  it("does not persist a ride when the routing service fails", async () => {
    const rider = await riderAuth();

    const res = await request(app)
      .post("/api/v1/ride/request")
      .set("Authorization", `Bearer ${rider.token}`)
      .send({
        pickupLocation: { type: "Point", coordinates: [90.4051, 23.7509] },
        destination: { type: "Point", coordinates: [90.4244, 23.7806] },
      });

    // fareCalculator maps non-AppError provider failures to 503
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/route distance service|unavailable/i);

    const count = await Ride.countDocuments({ riderId: rider.user._id });
    expect(count).toBe(0);
  });
});
