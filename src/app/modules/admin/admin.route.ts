import { Router } from "express";
import { AdminControllers } from "./admin.controller";
import { checkAuth } from "../../middlewares/checkAuth";
import { Role } from "../user/user.interface";

const router = Router();

router.get("/stats", checkAuth(Role.ADMIN), AdminControllers.getStats);

export const AdminRoutes = router;
