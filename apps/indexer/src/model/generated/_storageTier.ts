export const StorageTier = {
  HOT: 'HOT',
  WARM: 'WARM',
  COLD: 'COLD',
  PERMANENT: 'PERMANENT',
} as const
export type StorageTier = (typeof StorageTier)[keyof typeof StorageTier]
