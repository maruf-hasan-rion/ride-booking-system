import { z } from "zod";

/** Shared field/norm schemas used by multiple module validations. */

export const emailSchema = z
  .email({ message: "A valid email address is required." })
  .min(5)
  .max(100, "Email cannot exceed 100 characters.");

export const passwordSchema = z
  .string()
  .min(8, { message: "Password must be at least 8 characters long." })
  .regex(/^(?=.*[A-Z])/, {
    message: "Password must contain at least 1 uppercase letter.",
  })
  .regex(/^(?=.*\d)/, {
    message: "Password must contain at least 1 number.",
  })
  .regex(/^(?=.*[!@#$%^&*])/, {
    message: "Password must contain at least 1 special character.",
  });

export const nameSchema = z
  .string({ error: "Name must be a string" })
  .trim()
  .min(2, { message: "Name must be at least 2 characters long." })
  .max(50, { message: "Name cannot exceed 50 characters." });

/** [longitude, latitude] GeoJSON coordinate pair with range validation. */
export const coordinateSchema = z.tuple([
  z
    .number()
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180."),
  z
    .number()
    .min(-90, "Latitude must be between -90 and 90.")
    .max(90, "Latitude must be between -90 and 90."),
]);

export const geoPointSchema = z.object({
  type: z.literal("Point").optional().default("Point"),
  coordinates: coordinateSchema,
});
