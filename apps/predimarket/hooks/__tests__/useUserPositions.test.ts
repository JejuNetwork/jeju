import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { useUserPositions } from '../useUserPositions';

const requestMock = mock(() => Promise.resolve({
  marketPositions: [
    {
      id: 'pos1',
      yesShares: '1000000000000000000',
      noShares: '0',
      totalSpent: '1000000000000000000',
      totalReceived: '0',
      hasClaimed: false,
      market: {
        sessionId: '0x1234',
        question: 'Will it rain?',
        resolved: false,
        outcome: null,
      },
    },
    {
      id: 'pos2',
      yesShares: '0',
      noShares: '500000000000000000',
      totalSpent: '500000000000000000',
      totalReceived: '0',
      hasClaimed: false,
      market: {
        sessionId: '0x5678',
        question: 'Will it snow?',
        resolved: true,
        outcome: true,
      },
    },
  ],
}));

mock.module('graphql-request', () => ({
  request: requestMock,
  gql: (strings: TemplateStringsArray) => strings[0],
}));

describe('useUserPositions', () => {
  beforeEach(() => {
    requestMock.mockClear();
  });

  it('should return empty positions when no address provided', async () => {
    const { result } = renderHook(() => useUserPositions(undefined));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.positions).toEqual([]);
    expect(result.current.totalValue).toBe(0n);
    expect(result.current.totalPnL).toBe(0n);
  });

  it('should fetch user positions when address provided', async () => {
    const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`;
    const { result } = renderHook(() => useUserPositions(address));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.positions).toHaveLength(2);
    expect(result.current.positions[0].yesShares).toBe(1000000000000000000n);
  });

  it('should calculate total value correctly', async () => {
    const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`;
    const { result } = renderHook(() => useUserPositions(address));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // totalValue = sum of (yesShares + noShares)
    // 1e18 + 0 + 0 + 0.5e18 = 1.5e18
    expect(result.current.totalValue).toBe(1500000000000000000n);
  });

  it('should calculate P&L correctly', async () => {
    const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`;
    const { result } = renderHook(() => useUserPositions(address));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // totalPnL = sum of (yesShares + noShares + totalReceived - totalSpent)
    // (1e18 + 0 + 0 - 1e18) + (0 + 0.5e18 + 0 - 0.5e18) = 0
    expect(result.current.totalPnL).toBe(0n);
  });

  it('should lowercase address for GraphQL query', async () => {
    const address = '0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266' as `0x${string}`;
    renderHook(() => useUserPositions(address));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalled();
    });

    const callArgs = requestMock.mock.calls[0];
    expect(callArgs[2].user).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
  });
});

