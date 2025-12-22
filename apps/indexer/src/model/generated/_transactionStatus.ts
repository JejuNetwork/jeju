export const TransactionStatus = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  PENDING: 'PENDING',
} as const
export type TransactionStatus =
  (typeof TransactionStatus)[keyof typeof TransactionStatus]
