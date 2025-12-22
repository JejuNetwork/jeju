export const FederationChainType = {
  EVM: 'EVM',
  SOLANA: 'SOLANA',
  COSMOS: 'COSMOS',
  OTHER: 'OTHER',
} as const
export type FederationChainType =
  (typeof FederationChainType)[keyof typeof FederationChainType]
