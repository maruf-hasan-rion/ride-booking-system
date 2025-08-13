import { Router } from "express";
import { Role } from "../user/user.interface";
import { checkAuth } from "../../middlewares/checkAuth";
import { driverController } from "./driver.controller";

const router = Router();

router.post("/profile", checkAuth(Role.DRIVER), driverController.createProfile);
router.patch(
  "/status",
  checkAuth(Role.DRIVER),
  driverController.changeDriverStatus
);
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
  "/:id/status",
  checkAuth(Role.DRIVER),
  driverController.updateRideStatus
);
router.get("/earnings/me", checkAuth(Role.DRIVER), driverController.myEarnings);

// ADMIN
router.get("/", checkAuth(Role.ADMIN), driverController.allDrivers);
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
