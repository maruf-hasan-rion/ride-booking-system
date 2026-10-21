import { NextFunction, Request, Response } from "express";
import { ZodObject, ZodRawShape } from "zod";

type AnyZodObject = ZodObject<ZodRawShape>;

export const validateRequest =
  (zodSchema: AnyZodObject) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedData = await zodSchema.parseAsync({
        body: req.body,
        params: req.params,
        query: req.query,
        cookies: req.cookies,
      });

      // Express exposes req.query/req.params via getters in some setups,
      // so we only normalize request body and keep query/params read-only.
      if (parsedData?.body !== undefined) {
        req.body = parsedData.body;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
