/**
 * Type definitions for Base tokens supported on Jeju
 */

export interface BaseTokenMarketData {
  priceUSD: number;
  marketCapUSD: number;
  volumeUSD24h: number;
  holders?: number;
  maxSupply?: number;
  circulatingSupply?: number;
}

export interface BaseTokenDexPools {
  uniswapV3: {
    feeTiers: number[];
    primaryPair: string;
  };
}

export interface BaseTokenConfig {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  description: string;
  website: string;
  marketData: BaseTokenMarketData;
  dexPools: BaseTokenDexPools;
  tags: string[];
  logoUrl: string;
}

export interface BaseBridgeConfig {
  standardBridge: string;
  crossDomainMessenger: string;
  estimatedConfirmationTime: number;
  minBridgeAmount: Record<string, string>;
}

export interface BaseOracleConfig {
  chainlinkETHUSD: string;
  uniswapV3Factory: string;
  weth: string;
  updateFrequency: number;
  priceDeviationThreshold: number;
}

export interface BaseTokensManifest {
  version: string;
  network: string;
  chainId: number;
  lastUpdated: string;
  tokens: Record<string, BaseTokenConfig>;
  bridge: BaseBridgeConfig;
  oracle: BaseOracleConfig;
}

export type SupportedToken = 'elizaOS' | 'CLANKER' | 'VIRTUAL' | 'CLANKERMON';
export type SupportedBaseToken = 'CLANKER' | 'VIRTUAL' | 'CLANKERMON';

export const TOKEN_ADDRESSES: Record<SupportedToken, string> = {
  elizaOS: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  CLANKER: '0x1bc0c42215582d5a085795f4badbac3ff36d1bcb',
  VIRTUAL: '0x44ff8620b8cA30902395A7bD3F2407e1A091BF73',
  CLANKERMON: '0x1cDbB57b12f732cFb4DC06f690ACeF476485B2a5',
} as const;

export const BASE_TOKEN_ADDRESSES: Record<SupportedBaseToken, string> = {
  CLANKER: '0x1bc0c42215582d5a085795f4badbac3ff36d1bcb',
  VIRTUAL: '0x44ff8620b8cA30902395A7bD3F2407e1A091BF73',
  CLANKERMON: '0x1cDbB57b12f732cFb4DC06f690ACeF476485B2a5',
} as const;

