export const FederationTrustTier = {
  UNSTAKED: 'UNSTAKED',
  STAKED: 'STAKED',
  VERIFIED: 'VERIFIED',
} as const
export type FederationTrustTier =
  (typeof FederationTrustTier)[keyof typeof FederationTrustTier]
