export const JNSListingStatus = {
  ACTIVE: 'ACTIVE',
  SOLD: 'SOLD',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const
export type JNSListingStatus =
  (typeof JNSListingStatus)[keyof typeof JNSListingStatus]
