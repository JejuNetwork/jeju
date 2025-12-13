/**
 * Wake Page Service Tests
 * 
 * Tests HTML generation, edge cases, and utility functions
 */

import { describe, test, expect } from 'bun:test';
import { generateWakePage, checkWakePage, type WakePageData } from './wake-page';
import type { Address } from 'viem';

describe('generateWakePage', () => {
  const baseData: WakePageData = {
    jnsName: 'myapp.jeju',
    appName: 'myapp',
    description: 'A decentralized application',
    owner: '0x1234567890123456789012345678901234567890' as Address,
    vaultAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address,
    currentBalance: 50000000000000000n, // 0.05 ETH
    minRequired: 100000000000000000n, // 0.1 ETH
    fundingNeeded: 50000000000000000n, // 0.05 ETH
    lastHealthy: Date.now() - 3600000, // 1 hour ago
  };

  test('should generate valid HTML', () => {
    const html = generateWakePage(baseData);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
  });

  test('should include app name in title', () => {
    const html = generateWakePage(baseData);

    expect(html).toContain('<title>myapp - Needs Funding | Jeju Network</title>');
  });

  test('should include Jeju branding', () => {
    const html = generateWakePage(baseData);

    expect(html).toContain('🍊'); // Jeju orange emoji
    expect(html).toContain('Jeju Network');
    expect(html).toContain('--jeju-orange');
  });

  test('should display funding status', () => {
    const html = generateWakePage(baseData);

    expect(html).toContain('Current Balance');
    expect(html).toContain('0.05'); // 0.05 ETH
    expect(html).toContain('Minimum Required');
    expect(html).toContain('0.1'); // 0.1 ETH
    expect(html).toContain('Funding Needed');
  });

  test('should include vault address', () => {
    const html = generateWakePage(baseData);

    expect(html).toContain(baseData.vaultAddress);
    expect(html).toContain('Vault:');
  });

  test('should include fund button', () => {
    const html = generateWakePage(baseData);

    expect(html).toContain('Fund & Wake Up');
    expect(html).toContain('fund-button');
    expect(html).toContain(`/fund/${baseData.vaultAddress}`);
  });

  test('should include auto-refresh script', () => {
    const html = generateWakePage(baseData);

    expect(html).toContain('checkFunding');
    expect(html).toContain('/api/keepalive/status/');
  });

  test('should escape HTML in app name', () => {
    const dataWithXSS: WakePageData = {
      ...baseData,
      appName: '<script>alert("xss")</script>',
    };

    const html = generateWakePage(dataWithXSS);

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('should escape HTML in description', () => {
    const dataWithXSS: WakePageData = {
      ...baseData,
      description: '<img src=x onerror=alert(1)>',
    };

    const html = generateWakePage(dataWithXSS);

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  test('should handle zero balance', () => {
    const zeroBalanceData: WakePageData = {
      ...baseData,
      currentBalance: 0n,
      fundingNeeded: 100000000000000000n,
    };

    const html = generateWakePage(zeroBalanceData);

    expect(html).toContain('< 0.0001'); // Very small amounts shown as < 0.0001
  });

  test('should handle large balance', () => {
    const largeBalanceData: WakePageData = {
      ...baseData,
      currentBalance: 1000000000000000000000n, // 1000 ETH
      minRequired: 2000000000000000000000n, // 2000 ETH
      fundingNeeded: 1000000000000000000000n,
    };

    const html = generateWakePage(largeBalanceData);

    expect(html).toContain('1000.00');
  });

  test('should show last healthy time if available', () => {
    const html = generateWakePage(baseData);

    expect(html).toContain('Last healthy:');
    expect(html).toContain('hour');
  });

  test('should hide last healthy if zero', () => {
    const noLastHealthyData: WakePageData = {
      ...baseData,
      lastHealthy: 0,
    };

    const html = generateWakePage(noLastHealthyData);

    expect(html).not.toContain('Last healthy:');
  });

  test('should handle progress bar at 0%', () => {
    const zeroProgressData: WakePageData = {
      ...baseData,
      currentBalance: 0n,
      minRequired: 100000000000000000n,
    };

    const html = generateWakePage(zeroProgressData);

    expect(html).toContain('width: 0%');
  });

  test('should handle progress bar at 50%', () => {
    const html = generateWakePage(baseData);

    expect(html).toContain('width: 50%');
  });

  test('should cap progress bar at 100%', () => {
    const overFundedData: WakePageData = {
      ...baseData,
      currentBalance: 200000000000000000n,
      minRequired: 100000000000000000n,
      fundingNeeded: 0n,
    };

    const html = generateWakePage(overFundedData);

    expect(html).toContain('width: 100%');
  });

  test('should handle minRequired of 0', () => {
    const zeroRequiredData: WakePageData = {
      ...baseData,
      minRequired: 0n,
      currentBalance: 100000000000000000n,
      fundingNeeded: 0n,
    };

    const html = generateWakePage(zeroRequiredData);

    // Should show 100% progress when minRequired is 0
    expect(html).toContain('width: 100%');
  });

  test('should include responsive meta viewport', () => {
    const html = generateWakePage(baseData);

    expect(html).toContain('viewport');
    expect(html).toContain('width=device-width');
  });

  test('should include favicon', () => {
    const html = generateWakePage(baseData);

    expect(html).toContain('rel="icon"');
  });
});

describe('checkWakePage', () => {
  test('should return shouldShowWakePage=false when not exists', async () => {
    const mockClient = {
      readContract: async () => [false, false, 0, '0x0'] as const,
    };

    const result = await checkWakePage(
      'unknown.jeju',
      '0x1234567890123456789012345678901234567890' as Address,
      mockClient
    );

    expect(result.shouldShowWakePage).toBe(false);
    expect(result.data).toBeUndefined();
  });

  test('should return shouldShowWakePage=false when funded', async () => {
    const mockClient = {
      readContract: async () => [true, true, 1, '0x1234'] as const,
    };

    const result = await checkWakePage(
      'funded.jeju',
      '0x1234567890123456789012345678901234567890' as Address,
      mockClient
    );

    expect(result.shouldShowWakePage).toBe(false);
  });

  test('should return shouldShowWakePage=true when unfunded', async () => {
    const mockClient = {
      readContract: async () => [true, false, 4, '0x1234'] as const, // exists, not funded
    };

    const result = await checkWakePage(
      'unfunded.jeju',
      '0x1234567890123456789012345678901234567890' as Address,
      mockClient
    );

    expect(result.shouldShowWakePage).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.jnsName).toBe('unfunded.jeju');
    expect(result.data?.appName).toBe('unfunded');
  });

  test('should handle contract call failure gracefully', async () => {
    const mockClient = {
      readContract: async () => {
        throw new Error('Contract call failed');
      },
    };

    const result = await checkWakePage(
      'error.jeju',
      '0x1234567890123456789012345678901234567890' as Address,
      mockClient
    );

    expect(result.shouldShowWakePage).toBe(false);
  });
});

describe('formatWei edge cases', () => {
  // Test via generateWakePage since formatWei is internal
  
  test('should format tiny amounts as < 0.0001', () => {
    const data: WakePageData = {
      jnsName: 'test.jeju',
      appName: 'test',
      description: 'Test',
      owner: '0x0000000000000000000000000000000000000000' as Address,
      vaultAddress: '0x0000000000000000000000000000000000000000' as Address,
      currentBalance: 1000n, // 0.000000000000001 ETH
      minRequired: 100000000000000000n,
      fundingNeeded: 100000000000000000n,
      lastHealthy: 0,
    };

    const html = generateWakePage(data);
    expect(html).toContain('< 0.0001');
  });

  test('should format sub-cent amounts with 4 decimals', () => {
    const data: WakePageData = {
      jnsName: 'test.jeju',
      appName: 'test',
      description: 'Test',
      owner: '0x0000000000000000000000000000000000000000' as Address,
      vaultAddress: '0x0000000000000000000000000000000000000000' as Address,
      currentBalance: 5000000000000000n, // 0.005 ETH
      minRequired: 100000000000000000n,
      fundingNeeded: 95000000000000000n,
      lastHealthy: 0,
    };

    const html = generateWakePage(data);
    expect(html).toContain('0.005');
  });
});

describe('formatTimeAgo edge cases', () => {
  test('should show "just now" for recent timestamps', () => {
    const data: WakePageData = {
      jnsName: 'test.jeju',
      appName: 'test',
      description: 'Test',
      owner: '0x0000000000000000000000000000000000000000' as Address,
      vaultAddress: '0x0000000000000000000000000000000000000000' as Address,
      currentBalance: 0n,
      minRequired: 100000000000000000n,
      fundingNeeded: 100000000000000000n,
      lastHealthy: Date.now() - 30000, // 30 seconds ago
    };

    const html = generateWakePage(data);
    expect(html).toContain('just now');
  });

  test('should show minutes for recent timestamps', () => {
    const data: WakePageData = {
      jnsName: 'test.jeju',
      appName: 'test',
      description: 'Test',
      owner: '0x0000000000000000000000000000000000000000' as Address,
      vaultAddress: '0x0000000000000000000000000000000000000000' as Address,
      currentBalance: 0n,
      minRequired: 100000000000000000n,
      fundingNeeded: 100000000000000000n,
      lastHealthy: Date.now() - 600000, // 10 minutes ago
    };

    const html = generateWakePage(data);
    expect(html).toContain('10 minutes ago');
  });

  test('should show days for old timestamps', () => {
    const data: WakePageData = {
      jnsName: 'test.jeju',
      appName: 'test',
      description: 'Test',
      owner: '0x0000000000000000000000000000000000000000' as Address,
      vaultAddress: '0x0000000000000000000000000000000000000000' as Address,
      currentBalance: 0n,
      minRequired: 100000000000000000n,
      fundingNeeded: 100000000000000000n,
      lastHealthy: Date.now() - 172800000, // 2 days ago
    };

    const html = generateWakePage(data);
    expect(html).toContain('2 days ago');
  });
});
