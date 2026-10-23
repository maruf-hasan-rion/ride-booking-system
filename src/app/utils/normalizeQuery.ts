/** Zod turns query strings into numbers/booleans; QueryBuilder consumes strings. */
export const toQueryRecord = (
  query: Record<string, unknown>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
