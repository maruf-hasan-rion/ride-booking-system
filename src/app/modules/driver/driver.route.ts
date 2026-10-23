import { Router } from "express";
import { Role } from "../user/user.interface";
import { checkAuth } from "../../middlewares/checkAuth";
import { validateRequest } from "../../middlewares/validateRequest";
import { driverQueueRateLimiter } from "../../middlewares/rateLimiter";
import { driverController } from "./driver.controller";
import { DriverValidations } from "./driver.validation";

const router = Router();

router.post(
  "/profile",
  checkAuth(Role.DRIVER),
  validateRequest(DriverValidations.createDriverProfileZodSchema),
  driverController.createProfile
);
router.patch(
  "/profile",
  checkAuth(Role.DRIVER),
  validateRequest(DriverValidations.updateDriverProfileZodSchema),
  driverController.updateProfile
);
router.get("/profile/me", checkAuth(Role.DRIVER), driverController.myProfile);
router.patch(
  "/status",
  checkAuth(Role.DRIVER),
  validateRequest(DriverValidations.updateDriverStatusZodSchema),
  driverController.changeDriverStatus
);
router.get(
  "/incoming-requests",
  checkAuth(Role.DRIVER),
  driverQueueRateLimiter,
  driverController.getIncomingRequests
);
router.get("/active-ride", checkAuth(Role.DRIVER), driverController.getActiveRide);
router.patch(
  "/:id/accept",
  checkAuth(Role.DRIVER),
  driverController.acceptRideRequest
);
router.patch(
  "/:id/reject",
  checkAuth(Role.DRIVER),
  driverController.rejectRideRequest
);
router.patch(
  "/:id/cancel",
  checkAuth(Role.DRIVER),
  validateRequest(DriverValidations.cancelAssignedRideZodSchema),
  driverController.cancelAssignedRide
);
router.patch(
  "/:id/status",
  checkAuth(Role.DRIVER),
  validateRequest(DriverValidations.updateRideStatusZodSchema),
  driverController.updateRideStatus
);
router.get("/earnings/me", checkAuth(Role.DRIVER), driverController.myEarnings);

// ADMIN
router.patch(
  "/approve/:id",
  checkAuth(Role.ADMIN),
  driverController.approveDriver
);
router.patch(
  "/suspend/:id",
  checkAuth(Role.ADMIN),
  driverController.suspendDriver
);

export const DriverRoutes = router;
