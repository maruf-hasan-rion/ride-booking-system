import { Router } from "express";
import { rideControllers } from "./ride.controller";
import { Role } from "../user/user.interface";
import { checkAuth } from "../../middlewares/checkAuth";
import { validateRequest } from "../../middlewares/validateRequest";
import { rideRequestRateLimiter } from "../../middlewares/rateLimiter";
import { RideValidations } from "./ride.validation";
const router = Router();

router.post(
  "/request",
  checkAuth(Role.RIDER),
  rideRequestRateLimiter,
  validateRequest(RideValidations.createRideRequestZodSchema),
  rideControllers.createRideRequest
);
router.get(
  "/latest-ride",
  checkAuth(Role.RIDER),
  rideControllers.getRequestedRide
);
router.get(
  "/my-ride/:rideId",
  checkAuth(Role.RIDER),
  rideControllers.getSingleRide
);
router.get("/all-my-rides", checkAuth(Role.RIDER), rideControllers.getAllRides);
router.patch(
  "/cancel/:id",
  checkAuth(Role.RIDER),
  rideControllers.cancelRideRequest
);
router.get("/me", checkAuth(Role.RIDER), rideControllers.myRideHistory);

// ADMIN
// router.get("/", checkAuth(Role.ADMIN), rideControllers.allRides);

router.get(
  "/single-ride/:id",
  checkAuth(Role.ADMIN),
  rideControllers.getSingleRideForAdmin
);
router.get(
  "/all-rides-admin",
  checkAuth(Role.ADMIN),
  rideControllers.getAllRidesForAdmin
);

export const RideRoutes = router;
