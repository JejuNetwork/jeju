export const isNotNullOrUndefined = <T>(value: T): value is NonNullable<T> =>
  value !== null && value !== undefined;

export const isNotNullOrUndefinedArray = <T>(
  value: T[],
): value is NonNullable<T>[] => value.every((v) => isNotNullOrUndefined(v));

export const isNotNullOrUndefinedField =
  <T, K extends keyof T>(field: K) =>
  (value: T): value is NonNullable<T> =>
    isNotNullOrUndefined(value[field]);
