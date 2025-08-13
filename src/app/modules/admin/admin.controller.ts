import { Request, Response } from "express";
import { sendResponse } from "../../utils/sendResponse";
import { AdminServices } from "./admin.service";
import httpStatus from "http-status-codes";

const getStats = async (req: Request, res: Response) => {
  const stats = await AdminServices.systemStats();

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: `Stats`,
    data: stats,
  });
};

export const AdminControllers = { getStats };
