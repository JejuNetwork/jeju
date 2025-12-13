/**
 * Human-readable formatters for blockchain data, timestamps, and currency amounts.
 */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  if (bytes < 1024 * 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2) + ' TB';
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toString();
}

export function formatTimestamp(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

/**
 * Format duration in seconds to human-readable time span
 * 
 * @param seconds - Duration in seconds
 * @returns Formatted duration (e.g., "30s", "5m 30s", "2h 15m", "3d 4h")
 * 
 * @example
 * ```ts
 * formatDuration(30);     // "30s"
 * formatDuration(330);    // "5m 30s"
 * formatDuration(7200);   // "2h"
 * formatDuration(90000);  // "1d 1h"
 * ```
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export function formatPercent(value: number, decimals: number = 2): string {
  return (value * 100).toFixed(decimals) + '%';
}

export function formatAddress(address: string, start: number = 6, end: number = 4): string {
  if (address.length < start + end + 2) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

export function formatUSD(amount: number, decimals: number = 2): string {
  return '$' + amount.toFixed(decimals);
}

export function formatETH(wei: bigint | string, decimals: number = 4): string {
  const ethValue = typeof wei === 'string' ? BigInt(wei) : wei;
  const eth = Number(ethValue) / 1e18;
  return eth.toFixed(decimals) + ' ETH';
}

export function formatGas(gas: number): string {
  return formatNumber(gas) + ' gas';
}

export function formatGasPrice(gwei: number): string {
  return gwei.toFixed(2) + ' gwei';
}

