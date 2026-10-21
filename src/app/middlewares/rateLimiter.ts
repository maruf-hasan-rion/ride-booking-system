import rateLimit from "express-rate-limit";

const buildLimiter = (
  max: number,
  windowMs: number,
  message: string,
): ReturnType<typeof rateLimit> =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        message,
      });
    },
  });

/** Not a security boundary by itself — on Vercel each instance counts its own
 * window, so limits are approximate. They still blunt the obvious
 * credential-stuffing / mail-bombing bursts. */
export const loginRateLimiter = buildLimiter(
  10,
  10 * 60 * 1000,
  "Too many login attempts. Please try again in a while.",
);

export const otpRateLimiter = buildLimiter(
  5,
  10 * 60 * 1000,
  "Too many OTP requests. Please wait before requesting another code.",
);

export const rideRequestRateLimiter = buildLimiter(
  30,
  10 * 60 * 1000,
  "Too many ride requests in a short period. Please slow down.",
);
