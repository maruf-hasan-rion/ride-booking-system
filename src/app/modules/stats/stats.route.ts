import express from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { Role } from "../user/user.interface";
import { StatsController } from "./stats.controller";

const router = express.Router();

router.get("/earning-history", checkAuth(Role.ADMIN, Role.SUPER_ADMIN), StatsController.getAdminStats);
router.get("/my-earning-history", checkAuth(Role.DRIVER), StatsController.driverReport);
router.get("/my-all-ride-history", checkAuth(Role.RIDER), StatsController.riderReport)


export const StatsRoutes = router;

