// Stub for @babylon/shared/contracts/bbln until babylon integration is ready
import type { Abi, Address } from 'viem'

export const BBLN_TOKEN = {
  address: '0x0000000000000000000000000000000000000000' as Address,
  symbol: 'BBLN',
  decimals: 18,
}

export const BBLN_ADDRESSES = {
  mainnet: {
    presale: '0x0000000000000000000000000000000000000000' as Address,
    staking: '0x0000000000000000000000000000000000000000' as Address,
  },
  sepolia: {
    presale: '0x0000000000000000000000000000000000000000' as Address,
    staking: '0x0000000000000000000000000000000000000000' as Address,
  },
}

export const BBLN_PRESALE_ABI: Abi = []
