import { z } from "zod";
import { emailSchema, passwordSchema } from "../../validation/common";

const loginZodSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string().min(1, "Password is required."),
  }),
});

const changePasswordZodSchema = z.object({
  body: z.object({
    oldPassword: z.string().min(1, "Old password is required."),
    newPassword: passwordSchema,
  }),
});

export const AuthValidations = {
  loginZodSchema,
  changePasswordZodSchema,
};
