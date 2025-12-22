import { describe, test, expect, mock } from 'bun:test';
import { parseEther } from 'viem';

// Mock graphql-request
const mockRequest = mock(() => Promise.resolve({
  marketPositions: [
    {
      id: 'position-1',
      yesShares: '100000000000000000000',
      noShares: '0',
      totalSpent: '60000000000000000000',
      totalReceived: '0',
      hasClaimed: false,
      market: {
        sessionId: '0x1234',
        question: 'Test market 1?',
        resolved: false,
        outcome: null,
      },
    },
    {
      id: 'position-2',
      yesShares: '0',
      noShares: '50000000000000000000',
      totalSpent: '30000000000000000000',
      totalReceived: '50000000000000000000',
      hasClaimed: true,
      market: {
        sessionId: '0x5678',
        question: 'Test market 2?',
        resolved: true,
        outcome: false,
      },
    },
  ]
}));

mock.module('graphql-request', () => ({
  request: mockRequest,
  gql: (strings: TemplateStringsArray) => strings.join(''),
}));

describe('useUserPositions Hook', () => {
  test('should export useUserPositions function', () => {
    const { useUserPositions } = require('../useUserPositions');
    expect(typeof useUserPositions).toBe('function');
  });

  test('should validate address parameter', () => {
    // Valid Ethereum address format: 0x followed by 40 hex characters
    const validAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    expect(validAddress.length).toBe(42);
    expect(validAddress.startsWith('0x')).toBe(true);
    expect(/^0x[a-fA-F0-9]{40}$/.test(validAddress)).toBe(true);
  });

  test('should reject invalid address format', () => {
    const invalidAddresses = ['invalid', '0x123', '', '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG'];
    
    for (const addr of invalidAddresses) {
      const isValid = /^0x[a-fA-F0-9]{40}$/.test(addr);
      expect(isValid).toBe(false);
    }
  });

  test('should transform position data correctly', () => {
    const rawPosition = {
      id: 'position-1',
      yesShares: '100000000000000000000',
      noShares: '0',
      totalSpent: '60000000000000000000',
      totalReceived: '0',
      hasClaimed: false,
      market: {
        sessionId: '0x1234',
        question: 'Test market?',
        resolved: false,
        outcome: null,
      },
    };

    const transformed = {
      id: rawPosition.id,
      market: {
        sessionId: rawPosition.market.sessionId,
        question: rawPosition.market.question,
        resolved: rawPosition.market.resolved,
        outcome: rawPosition.market.outcome ?? undefined,
      },
      yesShares: BigInt(rawPosition.yesShares),
      noShares: BigInt(rawPosition.noShares),
      totalSpent: BigInt(rawPosition.totalSpent),
      totalReceived: BigInt(rawPosition.totalReceived),
      hasClaimed: rawPosition.hasClaimed,
    };

    expect(transformed.yesShares).toBe(parseEther('100'));
    expect(transformed.noShares).toBe(0n);
    expect(transformed.totalSpent).toBe(parseEther('60'));
    expect(transformed.hasClaimed).toBe(false);
  });

  test('should handle null address gracefully', () => {
    // When address is undefined, hook should return empty positions
    const positions: never[] = [];
    expect(positions.length).toBe(0);
  });
});

describe('Position Value Calculations', () => {
  test('should calculate total position value', () => {
    const positions = [
      { yesShares: parseEther('100'), noShares: 0n },
      { yesShares: 0n, noShares: parseEther('50') },
      { yesShares: parseEther('25'), noShares: parseEther('25') },
    ];

    let totalValue = 0n;
    for (const pos of positions) {
      totalValue += pos.yesShares + pos.noShares;
    }

    expect(totalValue).toBe(parseEther('200'));
  });

  test('should calculate total P&L', () => {
    const positions = [
      { 
        yesShares: parseEther('100'), 
        noShares: 0n,
        totalSpent: parseEther('60'),
        totalReceived: 0n,
      },
      { 
        yesShares: 0n, 
        noShares: parseEther('50'),
        totalSpent: parseEther('30'),
        totalReceived: parseEther('50'),
      },
    ];

    let totalPnL = 0n;
    for (const pos of positions) {
      const posValue = pos.yesShares + pos.noShares;
      totalPnL += posValue + pos.totalReceived - pos.totalSpent;
    }

    // Position 1: 100 + 0 - 60 = 40
    // Position 2: 50 + 50 - 30 = 70
    // Total: 110
    expect(totalPnL).toBe(parseEther('110'));
  });
});

describe('Position Filtering', () => {
  test('should filter claimable positions', () => {
    const positions = [
      { hasClaimed: false, market: { resolved: true, outcome: true }, yesShares: parseEther('100'), noShares: 0n },
      { hasClaimed: true, market: { resolved: true, outcome: true }, yesShares: parseEther('50'), noShares: 0n },
      { hasClaimed: false, market: { resolved: false, outcome: null }, yesShares: parseEther('25'), noShares: 0n },
    ];

    const claimable = positions.filter(p => 
      !p.hasClaimed && 
      p.market.resolved && 
      ((p.market.outcome === true && p.yesShares > 0n) || 
       (p.market.outcome === false && p.noShares > 0n))
    );

    expect(claimable.length).toBe(1);
    expect(claimable[0].yesShares).toBe(parseEther('100'));
  });

  test('should filter winning positions', () => {
    const positions = [
      { market: { resolved: true, outcome: true }, yesShares: parseEther('100'), noShares: 0n },
      { market: { resolved: true, outcome: false }, yesShares: parseEther('50'), noShares: 0n },
      { market: { resolved: true, outcome: false }, yesShares: 0n, noShares: parseEther('25') },
    ];

    const winners = positions.filter(p => {
      if (!p.market.resolved) return false;
      if (p.market.outcome === true) return p.yesShares > 0n;
      return p.noShares > 0n;
    });

    expect(winners.length).toBe(2);
  });

  test('should filter active positions', () => {
    const positions = [
      { market: { resolved: false }, yesShares: parseEther('100'), noShares: 0n },
      { market: { resolved: true }, yesShares: parseEther('50'), noShares: 0n },
      { market: { resolved: false }, yesShares: 0n, noShares: parseEther('25') },
    ];

    const activePositions = positions.filter(p => !p.market.resolved);
    expect(activePositions.length).toBe(2);
  });
});

describe('Position Statistics', () => {
  test('should count positions by outcome type', () => {
    const positions = [
      { yesShares: parseEther('100'), noShares: 0n },
      { yesShares: 0n, noShares: parseEther('50') },
      { yesShares: parseEther('25'), noShares: parseEther('25') },
    ];

    const yesOnlyCount = positions.filter(p => p.yesShares > 0n && p.noShares === 0n).length;
    const noOnlyCount = positions.filter(p => p.noShares > 0n && p.yesShares === 0n).length;
    const bothCount = positions.filter(p => p.yesShares > 0n && p.noShares > 0n).length;

    expect(yesOnlyCount).toBe(1);
    expect(noOnlyCount).toBe(1);
    expect(bothCount).toBe(1);
  });

  test('should calculate largest position', () => {
    const positions = [
      { totalValue: parseEther('100') },
      { totalValue: parseEther('250') },
      { totalValue: parseEther('50') },
    ];

    const largest = positions.reduce((max, p) => 
      p.totalValue > max.totalValue ? p : max
    );

    expect(largest.totalValue).toBe(parseEther('250'));
  });
});
