import httpStatus from "http-status-codes";
import { ClientSession, startSession } from "mongoose";
import AppError from "../errorHelpers/AppError";

const MAX_ATTEMPTS = 3;

const isTransientTransactionError = (error: unknown): boolean => {
  const labels = (error as { errorLabels?: string[] })?.errorLabels ?? [];
  return labels.includes("TransientTransactionError");
};

/**
 * Runs `work` in a transaction and retries only on MongoDB transient
 * write-conflicts. Application errors (AppError) are never retried.
 */
export const withTransaction = async <T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const session = await startSession();

    try {
      session.startTransaction();
      const result = await work(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      if (session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch {
          // Preserve the original error; the session is discarded below.
        }
      }

      if (!isTransientTransactionError(error) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
    } finally {
      await session.endSession();
    }
  }

  throw new AppError(
    httpStatus.CONFLICT,
    "The ride changed concurrently. Please retry.",
  );
};
