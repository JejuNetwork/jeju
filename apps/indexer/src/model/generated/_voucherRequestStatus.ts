export const VoucherRequestStatus = {
  PENDING: 'PENDING',
  CLAIMED: 'CLAIMED',
  FULFILLED: 'FULFILLED',
  EXPIRED: 'EXPIRED',
  REFUNDED: 'REFUNDED',
} as const
export type VoucherRequestStatus =
  (typeof VoucherRequestStatus)[keyof typeof VoucherRequestStatus]
