import { z } from "zod";
import { emailSchema, nameSchema } from "../../validation/common";

const sendOtpZodSchema = z.object({
  body: z.object({
    email: emailSchema,
    name: nameSchema.optional(),
  }),
});

const verifyOtpZodSchema = z.object({
  body: z.object({
    email: emailSchema,
    otp: z
      .string()
      .regex(/^\d{6}$/, { message: "OTP must be a 6-digit code." }),
  }),
});

export const OtpValidations = {
  sendOtpZodSchema,
  verifyOtpZodSchema,
};
