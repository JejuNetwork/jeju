/**
 * Unit tests for shared utility functions
 */

import { describe, test, expect } from 'bun:test';
import type { VPNNode } from '../api/schemas';
import { calculateNodeScore, findBestClientNode } from './utils';

// Helper to create test VPN node (client-side format)
function createTestVPNNode(overrides: Partial<VPNNode> = {}): VPNNode {
  return {
    node_id: 'node-1',
    operator: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    country_code: 'US',
    region: 'us-east-1',
    endpoint: 'vpn1.jeju.network:51820',
    wireguard_pubkey: 'abc123pubkey',
    latency_ms: 25,
    load: 50,
    reputation: 95,
    capabilities: {
      supports_wireguard: true,
      supports_socks5: true,
      supports_http: true,
      serves_cdn: true,
      is_vpn_exit: true,
    },
    ...overrides,
  };
}

describe('calculateNodeScore', () => {
  test('calculates score from latency and load', () => {
    const node = createTestVPNNode({ latency_ms: 25, load: 50 });
    const score = calculateNodeScore(node);
    // score = latency + (load * 10) = 25 + 500 = 525
    expect(score).toBe(525);
  });

  test('lower latency results in lower score', () => {
    const fastNode = createTestVPNNode({ latency_ms: 10, load: 50 });
    const slowNode = createTestVPNNode({ latency_ms: 100, load: 50 });
    expect(calculateNodeScore(fastNode)).toBeLessThan(calculateNodeScore(slowNode));
  });

  test('lower load results in lower score', () => {
    const lowLoadNode = createTestVPNNode({ latency_ms: 25, load: 10 });
    const highLoadNode = createTestVPNNode({ latency_ms: 25, load: 90 });
    expect(calculateNodeScore(lowLoadNode)).toBeLessThan(calculateNodeScore(highLoadNode));
  });

  test('handles zero latency and load', () => {
    const node = createTestVPNNode({ latency_ms: 0, load: 0 });
    expect(calculateNodeScore(node)).toBe(0);
  });

  test('handles maximum values', () => {
    const node = createTestVPNNode({ latency_ms: 1000, load: 100 });
    expect(calculateNodeScore(node)).toBe(2000); // 1000 + 100*10
  });

  test('load weighted 10x more than latency', () => {
    // A node with 10ms more latency but 1% less load should score the same
    const node1 = createTestVPNNode({ latency_ms: 20, load: 51 });
    const node2 = createTestVPNNode({ latency_ms: 30, load: 50 });
    expect(calculateNodeScore(node1)).toBe(calculateNodeScore(node2));
  });
});

describe('findBestClientNode', () => {
  test('returns node with lowest score', () => {
    const nodes: VPNNode[] = [
      createTestVPNNode({ node_id: 'slow-loaded', latency_ms: 100, load: 90 }),
      createTestVPNNode({ node_id: 'fast-empty', latency_ms: 10, load: 5 }),
      createTestVPNNode({ node_id: 'mid', latency_ms: 50, load: 50 }),
    ];
    const best = findBestClientNode(nodes);
    expect(best.node_id).toBe('fast-empty');
  });

  test('throws when no nodes available', () => {
    expect(() => findBestClientNode([])).toThrow('No nodes available');
  });

  test('returns single node when only one available', () => {
    const node = createTestVPNNode({ node_id: 'only-one' });
    const best = findBestClientNode([node]);
    expect(best.node_id).toBe('only-one');
  });

  test('handles identical scores', () => {
    const nodes: VPNNode[] = [
      createTestVPNNode({ node_id: 'first', latency_ms: 25, load: 50 }),
      createTestVPNNode({ node_id: 'second', latency_ms: 25, load: 50 }),
    ];
    // When scores are equal, returns the first one (reduce behavior)
    const best = findBestClientNode(nodes);
    expect(best.node_id).toBe('first');
  });

  test('prefers low latency over low load when similar total', () => {
    // Node with 5ms latency and 10% load: 5 + 100 = 105
    // Node with 100ms latency and 0% load: 100 + 0 = 100
    const nodes: VPNNode[] = [
      createTestVPNNode({ node_id: 'fast-loaded', latency_ms: 5, load: 10 }),
      createTestVPNNode({ node_id: 'slow-empty', latency_ms: 100, load: 0 }),
    ];
    const best = findBestClientNode(nodes);
    // The slow-empty node wins because its score is lower
    expect(best.node_id).toBe('slow-empty');
  });

  test('handles edge case with zero values', () => {
    const nodes: VPNNode[] = [
      createTestVPNNode({ node_id: 'perfect', latency_ms: 0, load: 0 }),
      createTestVPNNode({ node_id: 'normal', latency_ms: 25, load: 50 }),
    ];
    const best = findBestClientNode(nodes);
    expect(best.node_id).toBe('perfect');
  });
});
