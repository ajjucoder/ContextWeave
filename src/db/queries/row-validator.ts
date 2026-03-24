/**
 * Lightweight runtime validation for SQLite rows used in hot-path query mappers.
 * Keeps query modules type-safe without pulling in heavier schema libraries.
 */

export type RowFieldValidator<T> = (value: unknown, row: Record<string, unknown>) => value is T;

export type RowSchema<T extends object> = {
  [K in keyof T]: RowFieldValidator<T[K]>;
};

export function validateRow<T extends object>(
  row: unknown,
  schema: RowSchema<T>
): T | undefined {
  if (!row || typeof row !== "object") return undefined;

  const candidate = row as Record<string, unknown>;
  for (const [key, validator] of Object.entries(schema) as Array<
    [keyof T, RowFieldValidator<T[keyof T]>]
  >) {
    if (!validator(candidate[key as string], candidate)) {
      return undefined;
    }
  }

  return candidate as T;
}
