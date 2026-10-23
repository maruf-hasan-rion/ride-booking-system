import z from "zod";
import { AccountStatus, Role } from "./user.interface";
import { nameSchema, passwordSchema } from "../../validation/common";

const userListStatuses = [
  AccountStatus.ACTIVE,
  AccountStatus.BLOCKED,
  AccountStatus.SUSPENDED,
  "PENDING",
] as const;

export const adminUserQueryZodSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  searchTerm: z.string().trim().max(100).optional(),
  dateSearch: z.string().trim().max(32).optional(),
  role: z.enum(Object.values(Role) as [string, ...string[]]).optional(),
  status: z.enum(userListStatuses).optional(),
  sort: z.string().trim().max(100).optional(),
});

export const createUserZodSchema = z.object({
  body: z.object({
    name: nameSchema,
    email: z
      .email({ message: "Invalid email address format." })
      .min(5, { message: "Email must be at least 5 characters long." })
      .max(100, { message: "Email cannot exceed 100 characters." }),
    password: passwordSchema,
    role: z.enum([Role.RIDER, Role.DRIVER]),
  }),
});

export const updateUserZodSchema = z.object({
  body: z.object({
    name: nameSchema.optional(),
    password: passwordSchema.optional(),
    contactNo: z.string().optional(),
    role: z.enum(Object.values(Role) as [string]).optional(),
    isVerified: z
      .boolean({ error: "isVerified must be true or false" })
      .optional(),
  }),
});
