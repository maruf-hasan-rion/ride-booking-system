import { Router } from "express";
import { rideControllers } from "./ride.controller";
import { Role } from "../user/user.interface";
import { checkAuth } from "../../middlewares/checkAuth";
const router = Router();

router.post(
  "/request",
  checkAuth(Role.RIDER),
  rideControllers.createRideRequest
);
router.patch(
  "/:id/cancel",
  checkAuth(Role.RIDER),
  rideControllers.cancelRideRequest
);
router.get("/me", checkAuth(Role.RIDER), rideControllers.myRideHistory);

// ADMIN
router.get("/", checkAuth(Role.ADMIN), rideControllers.allRides);

export const RideRoutes = router;
