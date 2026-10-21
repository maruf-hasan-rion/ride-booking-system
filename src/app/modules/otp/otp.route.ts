import express from "express";
import { OTPController } from "./otp.controller";
import { validateRequest } from "../../middlewares/validateRequest";
import { otpRateLimiter } from "../../middlewares/rateLimiter";
import { OtpValidations } from "./otp.validation";

const router = express.Router();

router.post(
  "/send",
  otpRateLimiter,
  validateRequest(OtpValidations.sendOtpZodSchema),
  OTPController.sendOTP
);
router.post(
  "/verify",
  otpRateLimiter,
  validateRequest(OtpValidations.verifyOtpZodSchema),
  OTPController.verifyOTP
);

export const OtpRoutes = router;
