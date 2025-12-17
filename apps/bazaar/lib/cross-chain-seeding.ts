import { type Address, parseUnits, formatUnits } from 'viem'

export interface TokenConfig {
  symbol: string
  address: Address
  decimals: number
  coingeckoId: string
}

export interface NFTCollection {
  name: string
  address: Address
  standard: 'erc721' | 'erc1155' | 'punk'
}

export interface SeedingQuote {
  sourceChain: number
  destinationChain: number
  token: TokenConfig
  amount: bigint
  estimatedReceive: bigint
  bridgeFee: bigint
  estimatedTime: number
  route: string[]
}

export interface NFTSeedingQuote {
  sourceChain: number
  destinationChain: number
  collection: NFTCollection
  tokenId: string
  bridgeFee: bigint
  estimatedTime: number
}

// Token configs by chain
const addr = (s: string) => s as Address
const token = (symbol: string, address: string, decimals: number, coingeckoId: string): TokenConfig =>
  ({ symbol, address: addr(address), decimals, coingeckoId })

export const SEEDABLE_TOKENS: Record<number, TokenConfig[]> = {
  1: [ // Mainnet
    token('ETH', '0x0000000000000000000000000000000000000000', 18, 'ethereum'),
    token('USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'usd-coin'),
    token('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 'tether'),
    token('WBTC', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 8, 'wrapped-bitcoin'),
    token('LINK', '0x514910771AF9Ca656af840dff83E8264EcF986CA', 18, 'chainlink'),
    token('UNI', '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', 18, 'uniswap'),
  ],
  8453: [ // Base
    token('ETH', '0x0000000000000000000000000000000000000000', 18, 'ethereum'),
    token('USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'usd-coin'),
    token('cbETH', '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', 18, 'coinbase-wrapped-staked-eth'),
    token('DEGEN', '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', 18, 'degen-base'),
  ],
  42161: [ // Arbitrum
    token('ETH', '0x0000000000000000000000000000000000000000', 18, 'ethereum'),
    token('USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6, 'usd-coin'),
    token('ARB', '0x912CE59144191C1204E64559FE8253a0e49E6548', 18, 'arbitrum'),
    token('GMX', '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', 18, 'gmx'),
  ],
  10: [ // Optimism
    token('ETH', '0x0000000000000000000000000000000000000000', 18, 'ethereum'),
    token('USDC', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 6, 'usd-coin'),
    token('OP', '0x4200000000000000000000000000000000000042', 18, 'optimism'),
  ],
  56: [ // BSC
    token('BNB', '0x0000000000000000000000000000000000000000', 18, 'binancecoin'),
    token('USDT', '0x55d398326f99059fF775485246999027B3197955', 18, 'tether'),
    token('CAKE', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', 18, 'pancakeswap-token'),
  ],
}

export const SEEDABLE_NFTS: Record<number, NFTCollection[]> = {
  1: [
    { name: 'CryptoPunks', address: addr('0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB'), standard: 'punk' },
    { name: 'Bored Ape Yacht Club', address: addr('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'), standard: 'erc721' },
    { name: 'Pudgy Penguins', address: addr('0xBd3531dA5CF5857e7CfAA92426877b022e612cf8'), standard: 'erc721' },
  ],
  8453: [
    { name: 'Based Punks', address: addr('0xF2a9BC235cFAFeCd5b5A52Fa726c2F3D0e01eeb7'), standard: 'erc721' },
  ],
}

// Chain-specific timing (seconds)
const BRIDGE_TIME: Record<number, number> = { 1: 900, 56: 180 }
const NFT_BRIDGE_TIME: Record<number, number> = { 1: 1200 }
const GAS_ESTIMATE: Record<number, bigint> = { 1: 200000n, 8453: 100000n, 42161: 150000n, 10: 100000n, 56: 80000n }

export function getAvailableTokens(chainId: number): TokenConfig[] {
  return SEEDABLE_TOKENS[chainId] ?? []
}

export function getAvailableNFTs(chainId: number): NFTCollection[] {
  return SEEDABLE_NFTS[chainId] ?? []
}

export function canSeedToken(chainId: number, tokenSymbol: string): boolean {
  return SEEDABLE_TOKENS[chainId]?.some(t => t.symbol === tokenSymbol) ?? false
}

export function estimateSeedingGas(sourceChain: number): bigint {
  return GAS_ESTIMATE[sourceChain] ?? 150000n
}

export async function getTokenSeedingQuote(
  sourceChain: number,
  destinationChain: number,
  tokenSymbol: string,
  amount: string
): Promise<SeedingQuote> {
  const token = SEEDABLE_TOKENS[sourceChain]?.find(t => t.symbol === tokenSymbol)
  if (!token) throw new Error(`Token ${tokenSymbol} unavailable on chain ${sourceChain}`)

  const amountBigInt = parseUnits(amount, token.decimals)
  const bridgeFee = amountBigInt / 1000n // 0.1%

  return {
    sourceChain, destinationChain, token,
    amount: amountBigInt,
    estimatedReceive: amountBigInt - bridgeFee,
    bridgeFee,
    estimatedTime: BRIDGE_TIME[sourceChain] ?? 300,
    route: [`Chain ${sourceChain}`, 'EIL Bridge', `Chain ${destinationChain}`],
  }
}

export async function getNFTSeedingQuote(
  sourceChain: number,
  destinationChain: number,
  collectionAddress: Address,
  tokenId: string
): Promise<NFTSeedingQuote> {
  const collection = SEEDABLE_NFTS[sourceChain]?.find(
    c => c.address.toLowerCase() === collectionAddress.toLowerCase()
  )
  if (!collection) throw new Error(`Collection ${collectionAddress} unavailable on chain ${sourceChain}`)

  return {
    sourceChain, destinationChain, collection, tokenId,
    bridgeFee: parseUnits('0.01', 18),
    estimatedTime: NFT_BRIDGE_TIME[sourceChain] ?? 600,
  }
}

export function getSeededTokenAddress(originalChain: number, originalAddress: Address, destinationChain: number): Address {
  const hash = `${originalChain}-${originalAddress}-${destinationChain}`
    .split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return `0x${hash.toString(16).padStart(40, '0')}` as Address
}

export function formatSeedingQuote(quote: SeedingQuote) {
  return {
    amount: formatUnits(quote.amount, quote.token.decimals),
    receive: formatUnits(quote.estimatedReceive, quote.token.decimals),
    fee: formatUnits(quote.bridgeFee, quote.token.decimals),
    time: quote.estimatedTime < 60 ? `${quote.estimatedTime}s` : `${Math.ceil(quote.estimatedTime / 60)}m`,
  }
}
