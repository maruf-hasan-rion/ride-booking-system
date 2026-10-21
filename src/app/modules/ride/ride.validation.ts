import { z } from "zod";
import { geoPointSchema } from "../../validation/common";

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

export const RideValidations = {
  createRideRequestZodSchema,
};
