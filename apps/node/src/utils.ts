// Utility functions
import { formatEther as viemFormatEther, parseEther as viemParseEther } from 'viem';

export function formatEther(wei: string | bigint): string {
  if (typeof wei === 'string') {
    if (wei === '') {
      throw new Error('formatEther: empty string provided');
    }
    if (!/^\d+$/.test(wei)) {
      throw new Error(`formatEther: invalid wei string "${wei}"`);
    }
  }
  const weiBigInt = typeof wei === 'string' ? BigInt(wei) : wei;
  const formatted = viemFormatEther(weiBigInt);
  // Optional: custom formatting logic if needed on top of viem
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  if (num < 0.0001) return '<0.0001';
  if (num < 0.01) return num.toFixed(4);
  if (num < 1) return num.toFixed(3);
  if (num < 100) return num.toFixed(2);
  return num.toFixed(1);
}

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return '<$0.01';
  if (amount < 1) return `$${amount.toFixed(2)}`;
  if (amount < 1000) return `$${amount.toFixed(2)}`;
  if (amount < 1000000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${(amount / 1000000).toFixed(2)}M`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function parseWei(eth: string): string {
  return viemParseEther(eth).toString();
}

export function classNames(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
