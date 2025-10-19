/**
 * Token utility functions for paymaster dashboard
 */

export function formatTokenAmount(
  amount: bigint | string | number,
  decimals: number | string,
  displayDecimals: number = 4
): string {
  const dec = typeof decimals === 'number' ? decimals : parseInt(decimals);
  const amountBigInt = typeof amount === 'bigint' ? amount : BigInt(amount);
  
  const divisor = 10n ** BigInt(dec);
  const whole = amountBigInt / divisor;
  const remainder = amountBigInt % divisor;
  
  if (remainder === 0n) {
    return whole.toString();
  }
  
  const fractional = remainder.toString().padStart(dec, '0');
  const trimmed = fractional.slice(0, displayDecimals).replace(/0+$/, '');
  
  if (trimmed.length === 0) {
    return whole.toString();
  }
  
  return `${whole}.${trimmed}`;
}

export function parseTokenAmount(
  amount: string,
  decimals: number
): bigint {
  const [whole, fractional = ''] = amount.split('.');
  const paddedFractional = fractional.padEnd(decimals, '0').slice(0, decimals);
  
  const wholeBigInt = BigInt(whole || '0');
  const fractionalBigInt = BigInt(paddedFractional);
  
  return wholeBigInt * (10n ** BigInt(decimals)) + fractionalBigInt;
}

export function formatUSD(value: number, decimals: number = 2): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function calculateUSDValue(
  amount: bigint,
  decimals: number,
  priceUSD: number
): number {
  const amountNumber = Number(amount) / (10 ** decimals);
  return amountNumber * priceUSD;
}

