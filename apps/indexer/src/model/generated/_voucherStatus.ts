export const VoucherStatus = {
  ISSUED: 'ISSUED',
  FULFILLED: 'FULFILLED',
  EXPIRED: 'EXPIRED',
  SLASHED: 'SLASHED',
} as const
export type VoucherStatus = (typeof VoucherStatus)[keyof typeof VoucherStatus]
