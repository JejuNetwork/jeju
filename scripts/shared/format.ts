/**
 * @fileoverview Formatting utilities for consistent data display across Jeju scripts
 * @module scripts/shared/format
 * 
 * Provides human-readable formatters for blockchain data, timestamps, currency amounts,
 * and other common values. Used in deployment scripts, monitoring tools, test output, and logs.
 * 
 * @example Import and use
 * ```ts
 * import { formatETH, formatUSD, formatAddress, formatDuration } from './format';
 * 
 * console.log(formatETH('1500000000000000000')); // "1.5000 ETH"
 * console.log(formatUSD(3245.67)); // "$3,245.67"
 * console.log(formatAddress('0x1234...7890')); // "0x123456...567890"
 * console.log(formatDuration(3665)); // "1h 1m 5s"
 * ```
 */

/**
 * Format byte size to human-readable string with appropriate unit
 * 
 * @param bytes - Number of bytes to format
 * @returns Formatted string (e.g., "1.50 MB", "3.25 GB")
 * 
 * @example
 * ```ts
 * formatBytes(1024);           // "1.00 KB"
 * formatBytes(1024 * 1024 * 5); // "5.00 MB"
 * formatBytes(1500000000);     // "1.40 GB"
 * ```
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  if (bytes < 1024 * 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2) + ' TB';
}

/**
 * Format number with thousands separator or K/M/B suffix
 * 
 * @param num - Number to format
 * @returns Formatted string (e.g., "1.5K", "2.3M", "1.1B")
 * 
 * @example
 * ```ts
 * formatNumber(1500);        // "1.5K"
 * formatNumber(2500000);     // "2.5M"
 * formatNumber(1100000000);  // "1.1B"
 * formatNumber(542);         // "542"
 * ```
 */
export function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toString();
}

/**
 * Format Unix timestamp to relative time string
 * 
 * @param timestamp - Unix timestamp in seconds
 * @returns Relative time string (e.g., "5m ago", "2h ago", "3d ago")
 * 
 * @example
 * ```ts
 * const fiveMinutesAgo = (Date.now() / 1000) - 300;
 * formatTimestamp(fiveMinutesAgo); // "5m ago"
 * 
 * const yesterday = (Date.now() / 1000) - 86400;
 * formatTimestamp(yesterday); // "1d ago"
 * ```
 */
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

/**
 * Format decimal value as percentage
 * 
 * @param value - Decimal value (e.g., 0.75 for 75%)
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted percentage string (e.g., "75.00%")
 * 
 * @example
 * ```ts
 * formatPercent(0.5);         // "50.00%"
 * formatPercent(0.9954, 2);   // "99.54%"
 * formatPercent(0.12345, 4);  // "12.3450%"
 * ```
 */
export function formatPercent(value: number, decimals: number = 2): string {
  return (value * 100).toFixed(decimals) + '%';
}

/**
 * Format Ethereum address with ellipsis in the middle
 * 
 * @param address - Full Ethereum address
 * @param start - Number of characters to show at start (default: 6, includes '0x')
 * @param end - Number of characters to show at end (default: 4)
 * @returns Shortened address (e.g., "0x1234...5678")
 * 
 * @example
 * ```ts
 * formatAddress('0x1234567890123456789012345678901234567890');
 * // "0x123456...567890"
 * 
 * formatAddress('0x1234567890123456789012345678901234567890', 10, 6);
 * // "0x1234567890...567890"
 * ```
 */
export function formatAddress(address: string, start: number = 6, end: number = 4): string {
  if (address.length < start + end + 2) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

/**
 * Format USD amount with dollar sign and thousands separators
 * 
 * @param amount - Dollar amount
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted USD string (e.g., "$1,234.56")
 * 
 * @example
 * ```ts
 * formatUSD(1234.56);      // "$1,234.56"
 * formatUSD(1000000);      // "$1,000,000.00"
 * formatUSD(99.999, 2);    // "$100.00"
 * ```
 */
export function formatUSD(amount: number, decimals: number = 2): string {
  return '$' + amount.toFixed(decimals);
}

/**
 * Format wei amount to ETH with specified decimals
 * 
 * @param wei - Amount in wei (can be string or bigint)
 * @param decimals - Number of decimal places (default: 4)
 * @returns Formatted ETH string (e.g., "1.5000 ETH")
 * 
 * @example
 * ```ts
 * formatETH('1000000000000000000');    // "1.0000 ETH"
 * formatETH('500000000000000000');     // "0.5000 ETH"
 * formatETH(BigInt('1500000000000000000'), 2); // "1.50 ETH"
 * ```
 */
export function formatETH(wei: bigint | string, decimals: number = 4): string {
  const ethValue = typeof wei === 'string' ? BigInt(wei) : wei;
  const eth = Number(ethValue) / 1e18;
  return eth.toFixed(decimals) + ' ETH';
}

/**
 * Format gas amount with number suffix
 * 
 * @param gas - Gas amount in gas units
 * @returns Formatted gas string (e.g., "21.0K gas", "150.0K gas")
 * 
 * @example
 * ```ts
 * formatGas(21000);    // "21.0K gas"
 * formatGas(150000);   // "150.0K gas"
 * formatGas(3456789);  // "3.5M gas"
 * ```
 */
export function formatGas(gas: number): string {
  return formatNumber(gas) + ' gas';
}

/**
 * Format gas price in gwei
 * 
 * @param gwei - Gas price in gwei
 * @returns Formatted gas price string (e.g., "25.50 gwei")
 * 
 * @example
 * ```ts
 * formatGasPrice(1);      // "1.00 gwei"
 * formatGasPrice(25.5);   // "25.50 gwei"
 * formatGasPrice(100);    // "100.00 gwei"
 * ```
 */
export function formatGasPrice(gwei: number): string {
  return gwei.toFixed(2) + ' gwei';
}

