export const InferenceStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  DISPUTED: 'DISPUTED',
  SETTLED: 'SETTLED',
} as const
export type InferenceStatus =
  (typeof InferenceStatus)[keyof typeof InferenceStatus]
