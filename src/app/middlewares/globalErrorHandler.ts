/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { envVars } from "../config/env";
import AppError from "../errorHelpers/AppError";
import { handleCastError } from "../helpers/handleCastError";
import { handlerDuplicateError } from "../helpers/handleDuplicateError";
import { handlerValidationError } from "../helpers/handlerValidationError";
import { handlerZodError } from "../helpers/handlerZodError";
import { TErrorSources } from "../interfaces/error.types";

export const globalErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  let errorSources: TErrorSources[] = [];
  let statusCode = 500;
  let message = "Something Went Wrong!!";
  //Duplicate error
  if (err.code === 11000) {
    const simplifiedError = handlerDuplicateError(err);
    statusCode = simplifiedError.statusCode;
    message = simplifiedError.message;
  }

  // Object ID error / Cast Error
  else if (err.name === "CastError") {
    const simplifiedError = handleCastError(err);
    statusCode = simplifiedError.statusCode;
    message = simplifiedError.message;
  }

  // Zod error
  else if (err.name === "ZodError") {
    const simplifiedError = handlerZodError(err);
    statusCode = simplifiedError.statusCode;
    message = simplifiedError.message;
    errorSources = simplifiedError.errorSources as TErrorSources[];
  }

  //Mongoose Validation Error
  else if (err.name === "ValidationError") {
    const simplifiedError = handlerValidationError(err);
    statusCode = simplifiedError.statusCode;
    errorSources = simplifiedError.errorSources as TErrorSources[];
    message = simplifiedError.message;
  }

  // App error
  else if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  }

  // Expired/invalid access or refresh token
  else if (err instanceof TokenExpiredError || err instanceof JsonWebTokenError) {
    statusCode = 401;
    message = "Session expired or invalid. Please log in again.";
  }

  // Malformed JSON body (body-parser)
  else if (err?.type === "entity.parse.failed" && err instanceof SyntaxError) {
    statusCode = 400;
    message = "Malformed JSON request body.";
  }

  // Global error: never expose the internal message to the client.
  else if (err instanceof Error) {
    statusCode = 500;
    message = "Something went wrong. Please try again.";
  }

  if (statusCode >= 500) {
    console.error(
      `[error] ${req.method} ${req.originalUrl} -> ${statusCode}`,
      err,
    );
  } else if (envVars.NODE_ENV === "development") {
    console.error(err);
  }

  res.status(statusCode).json({
    statusCode,
    success: false,
    message,
    errorSources,
    err: envVars.NODE_ENV === "development" ? err : null,
    stack: envVars.NODE_ENV === "development" ? err.stack : null,
  });
};
