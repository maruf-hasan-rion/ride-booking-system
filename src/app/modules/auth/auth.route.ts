import { NextFunction, Request, Response, Router } from "express";
import passport from "passport";
import { envVars } from "../../config/env";
import { checkAuth } from "../../middlewares/checkAuth";
import { validateRequest } from "../../middlewares/validateRequest";
import { loginRateLimiter } from "../../middlewares/rateLimiter";
import { Role } from "../user/user.interface";
import { AuthControllers } from "./auth.controller";
import { AuthValidations } from "./auth.validation";

const router = Router();

const getGoogleCallbackUrl = (req: Request) => {
  const forwardedProto = req
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim();
  const forwardedHost = req
    .get("x-forwarded-host")
    ?.split(",")[0]
    .trim();

  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get("host") || `localhost:${envVars.PORT}`;

  return `${protocol}://${host}/api/v1/auth/google/callback`;
};

router.post(
  "/login",
  loginRateLimiter,
  validateRequest(AuthValidations.loginZodSchema),
  AuthControllers.credentialsLogin
);
router.post(
  "/refresh-token",
  loginRateLimiter,
  AuthControllers.getNewAccessToken
);
router.post("/logout", AuthControllers.logout);
router.post(
  "/change-password",
  checkAuth(...Object.values(Role)),
  validateRequest(AuthValidations.changePasswordZodSchema),
  AuthControllers.changePassword
);

router.get(
  "/google",
  async (req: Request, res: Response, next: NextFunction) => {
    const redirect = req.query.redirect || "/";
    const callbackURL = getGoogleCallbackUrl(req);

    passport.authenticate(
      "google",
      {
        scope: ["profile", "email"],
        state: redirect as string,
        callbackURL,
      } as unknown as passport.AuthenticateOptions
    )(req, res, next);
  }
);

router.get(
  "/google/callback",
  (req: Request, res: Response, next: NextFunction) => {
    const callbackURL = getGoogleCallbackUrl(req);

    passport.authenticate(
      "google",
      {
        failureRedirect: "/login",
        callbackURL,
      } as unknown as passport.AuthenticateOptions
    )(req, res, next);
  },
  AuthControllers.googleCallbackController
);

export const AuthRoutes = router;
