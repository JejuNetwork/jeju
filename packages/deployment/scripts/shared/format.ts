/**
 * Formatting Utilities - Re-exports from @jejunetwork/shared
 */

export {
  chunk,
  classNames,
  cn,
  delay,
  formatAddress,
  formatBytes,
  formatBytesBinary,
  formatDuration,
  formatDurationVerbose,
  formatEth,
  formatGas,
  formatGasPrice,
  formatMs,
  formatNumber,
  formatPercent,
  formatTimeAgo,
  formatTimestamp,
  formatUsd,
  generateId,
  generatePrefixedId,
  shortenAddress,
} from '@jejunetwork/shared'

// Legacy aliases for backward compatibility
export const formatUSD = formatUsd
export const formatETH = formatEth
