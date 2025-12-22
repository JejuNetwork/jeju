export const ComputeRentalStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const
export type ComputeRentalStatus =
  (typeof ComputeRentalStatus)[keyof typeof ComputeRentalStatus]
