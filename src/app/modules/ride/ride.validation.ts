import { z } from "zod";
import { geoPointSchema } from "../../validation/common";
import { RideStatus } from "./ride.interface";

const listQueryBase = {
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  searchTerm: z.string().trim().max(100).optional(),
  dateSearch: z.string().trim().max(32).optional(),
  status: z.enum(Object.values(RideStatus) as [string, ...string[]]).optional(),
  sort: z.string().trim().max(100).optional(),
  fields: z.string().trim().max(200).optional(),
};

export const riderRideQueryZodSchema = z.object({
  ...listQueryBase,
  minFare: z.coerce.number().min(0).optional(),
  maxFare: z.coerce.number().min(0).optional(),
});

export const adminRideQueryZodSchema = z.object({
  ...listQueryBase,
  riderSearch: z.string().trim().max(100).optional(),
  driverSearch: z.string().trim().max(100).optional(),
});

const createRideRequestZodSchema = z
  .object({
    body: z.object({
      pickupLocation: geoPointSchema,
      destination: geoPointSchema,
    }),
  })
  .refine(
    (input) =>
      input.body.pickupLocation.coordinates.join() !==
      input.body.destination.coordinates.join(),
    {
      message: "Pickup and destination cannot be the same location.",
      path: ["destination", "coordinates"],
    },
  );

const adminCancelRideZodSchema = z.object({
  body: z.object({
    reason: z
      .string()
      .trim()
      .min(3, "A cancellation reason is required.")
      .max(200, "Cancellation reason is too long."),
  }),
});

export const RideValidations = {
  createRideRequestZodSchema,
  adminCancelRideZodSchema,
  riderRideQueryZodSchema,
  adminRideQueryZodSchema,
};
