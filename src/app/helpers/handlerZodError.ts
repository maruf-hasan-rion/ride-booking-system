/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  TErrorSources,
  TGenericErrorResponse,
} from "../interfaces/error.types";

export const handlerZodError = (err: any): TGenericErrorResponse => {
  const errorSources: TErrorSources[] = [];

  err.issues.forEach((issue: any) => {
    errorSources.push({
      path: issue.path[issue.path.length - 1],
      message: issue.message,
    });
  });

  return {
    statusCode: 400,
    // Surface the actual validation message instead of a generic "Zod Error"
    // so clients (and users) see what is wrong directly.
    message: errorSources[0]?.message ?? "Invalid request data",
    errorSources,
  };
};
