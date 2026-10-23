import { z } from "zod";
import { RideStatus } from "../ride/ride.interface";

const vehicleInfoSchema = z
  .string()
  .trim()
  .min(10, { message: "Vehicle details should be at least 10 characters." })
  .max(200, { message: "Vehicle details cannot exceed 200 characters." });

const createDriverProfileZodSchema = z.object({
  body: z.object({
    vehicleInfo: vehicleInfoSchema,
  }),
});

const updateDriverProfileZodSchema = z.object({
  body: z.object({
    vehicleInfo: vehicleInfoSchema,
  }),
});

const updateDriverStatusZodSchema = z.object({
  body: z.object({
    isOnline: z.boolean(),
  }),
});

const updateRideStatusZodSchema = z.object({
  body: z.object({
    status: z.enum([
      RideStatus.PICKED_UP,
      RideStatus.IN_TRANSIT,
      RideStatus.ARRIVED,
      RideStatus.COMPLETED,
    ]),
  }),
});

const cancelAssignedRideZodSchema = z.object({
  body: z.object({
    reason: z.string().trim().min(3).max(200).optional(),
  }),
});

const driverQueueQueryZodSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  searchTerm: z.string().trim().max(100).optional(),
});

export const DriverValidations = {
  createDriverProfileZodSchema,
  updateDriverProfileZodSchema,
  updateDriverStatusZodSchema,
  updateRideStatusZodSchema,
  cancelAssignedRideZodSchema,
  driverQueueQueryZodSchema,
};
