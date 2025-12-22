export const OIFOracleType = {
  HYPERLANE: 'HYPERLANE',
  OPTIMISM_NATIVE: 'OPTIMISM_NATIVE',
  SUPERCHAIN: 'SUPERCHAIN',
  LAYERZERO: 'LAYERZERO',
  SIMPLE: 'SIMPLE',
  CUSTOM: 'CUSTOM',
} as const
export type OIFOracleType = (typeof OIFOracleType)[keyof typeof OIFOracleType]
