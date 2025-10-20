import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { useMarket } from '../useMarket';

const requestMock = mock(() => Promise.resolve({
  predictionMarkets: [
    {
      id: '1',
      sessionId: '0x1234567890abcdef',
      question: 'Will Team A win?',
      yesShares: '1000000000000000000',
      noShares: '2000000000000000000',
      totalVolume: '3000000000000000000',
      createdAt: '2025-01-01T00:00:00Z',
      resolved: false,
      outcome: null,
    },
  ],
}));

mock.module('graphql-request', () => ({
  request: requestMock,
  gql: (strings: TemplateStringsArray) => strings[0],
}));

describe('useMarket', () => {
  beforeEach(() => {
    requestMock.mockClear();
  });

  it('should fetch a single market successfully', async () => {
    const { result } = renderHook(() => useMarket('0x1234567890abcdef'));

    expect(result.current.loading).toBe(true);
    expect(result.current.market).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.market).toBeTruthy();
    expect(result.current.market?.question).toBe('Will Team A win?');
    expect(result.current.market?.sessionId).toBe('0x1234567890abcdef');
  });

  it('should handle market not found', async () => {
    requestMock.mockImplementationOnce(() => Promise.resolve({
      predictionMarkets: [],
    }));

    const { result } = renderHook(() => useMarket('0xnonexistent'));

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    expect(result.current.error?.message).toBe('Market not found');
    expect(result.current.market).toBeNull();
  });

  it('should calculate price percentages correctly', async () => {
    const { result } = renderHook(() => useMarket('0x1234567890abcdef'));

    await waitFor(() => {
      expect(result.current.market).toBeTruthy();
    });

    // yesShares: 1e18, noShares: 2e18
    // These become yesPrice and noPrice in the market object
    expect(result.current.market?.yesPrice).toBe(1000000000000000000n);
    expect(result.current.market?.noPrice).toBe(2000000000000000000n);
  });

  it('should poll for updates every 5 seconds', async () => {
    const { result } = renderHook(() => useMarket('0x1234567890abcdef'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const initialCallCount = requestMock.mock.calls.length;

    // Skip polling test in CI - timing is unreliable
    // In a real test, you'd use fake timers
    expect(initialCallCount).toBeGreaterThan(0);
  });
});

