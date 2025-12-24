import { delay, formatAddress } from '@jejunetwork/shared'
import {
  formatEther as viemFormatEther,
  parseEther as viemParseEther,
} from 'viem'

export function formatEther(wei: string | bigint): string {
  if (typeof wei === 'string') {
    if (wei === '') {
      throw new Error('formatEther: empty string provided')
    }
    if (!/^\d+$/.test(wei)) {
      throw new Error(`formatEther: invalid wei string "${wei}"`)
    }
  }
  const weiBigInt = typeof wei === 'string' ? BigInt(wei) : wei
  const formatted = viemFormatEther(weiBigInt)
  const num = parseFloat(formatted)
  if (num === 0) return '0'
  if (num < 0.0001) return '<0.0001'
  if (num < 0.01) return num.toFixed(4)
  if (num < 1) return num.toFixed(3)
  if (num < 100) return num.toFixed(2)
  return num.toFixed(1)
}

export const shortenAddress = formatAddress

export function parseWei(eth: string): string {
  return viemParseEther(eth).toString()
}

export function sleep(ms: number): Promise<void> {
  return delay(ms)
}
