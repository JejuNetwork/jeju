import { describe, expect, test, mock, beforeEach } from 'bun:test';
import {
  PeerDiscovery,
  GossipNetwork,
  BlobStore,
  P2PTrainingNetwork,
  createP2PNetwork,
} from '../p2p';
import type { Address, Hex, PublicClient } from 'viem';

// Mock public client
const mockReadContract = mock(() => Promise.resolve());
const mockPublicClient = {
  readContract: mockReadContract,
} as unknown as PublicClient;

const testConfig = {
  rpcUrl: 'http://localhost:8545',
  identityRegistryAddress: '0x1234567890123456789012345678901234567890' as Address,
  selfEndpoint: 'http://localhost:3000',
};

describe('PeerDiscovery', () => {
  let discovery: PeerDiscovery;

  beforeEach(() => {
    mockReadContract.mockReset();
    discovery = new PeerDiscovery(mockPublicClient, testConfig.identityRegistryAddress);
  });

  describe('constructor', () => {
    test('creates instance with valid config', () => {
      expect(discovery).toBeDefined();
    });
  });

  describe('discoverPeers', () => {
    test('returns empty array when no peers registered', async () => {
      // Mock getAgentsByTag returning empty
      mockReadContract.mockResolvedValueOnce([]);

      const peers = await discovery.discoverPeers();
      expect(peers).toEqual([]);
    });

    test('returns peers with endpoints', async () => {
      // Mock getAgentsByTag returning agent IDs
      mockReadContract.mockResolvedValueOnce([BigInt(1), BigInt(2)]);
      // Mock getAgentMetadata for first agent
      mockReadContract.mockResolvedValueOnce({
        endpoint: 'http://peer1.example.com',
        owner: '0x1111111111111111111111111111111111111111',
      });
      // Mock getAgentMetadata for second agent
      mockReadContract.mockResolvedValueOnce({
        endpoint: 'http://peer2.example.com',
        owner: '0x2222222222222222222222222222222222222222',
      });

      const peers = await discovery.discoverPeers();
      expect(peers.length).toBe(2);
      expect(peers[0].endpoint).toBe('http://peer1.example.com');
      expect(peers[1].endpoint).toBe('http://peer2.example.com');
    });

    test('filters out peers without endpoints', async () => {
      mockReadContract.mockResolvedValueOnce([BigInt(1)]);
      mockReadContract.mockResolvedValueOnce({
        endpoint: '',
        owner: '0x1111111111111111111111111111111111111111',
      });

      const peers = await discovery.discoverPeers();
      expect(peers.length).toBe(0);
    });
  });
});

describe('GossipNetwork', () => {
  let gossip: GossipNetwork;

  beforeEach(() => {
    gossip = new GossipNetwork(testConfig.selfEndpoint);
  });

  describe('constructor', () => {
    test('creates instance with valid endpoint', () => {
      expect(gossip).toBeDefined();
    });
  });

  describe('broadcast', () => {
    test('broadcasts message to all peers', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response(null, { status: 200 })));
      global.fetch = mockFetch;

      const peers = [
        { agentId: BigInt(1), endpoint: 'http://peer1.example.com', owner: '0x1111' as Address },
        { agentId: BigInt(2), endpoint: 'http://peer2.example.com', owner: '0x2222' as Address },
      ];

      await gossip.broadcast(peers, 'test-type', {
        runId: '0x1234' as Hex,
        data: 'test',
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('handles failed broadcasts gracefully', async () => {
      const mockFetch = mock(() => Promise.reject(new Error('Network error')));
      global.fetch = mockFetch;

      const peers = [
        { agentId: BigInt(1), endpoint: 'http://peer1.example.com', owner: '0x1111' as Address },
      ];

      // Should not throw
      await gossip.broadcast(peers, 'test-type', { runId: '0x1234' as Hex });
    });
  });

  describe('handleMessage', () => {
    test('calls registered handler for message type', async () => {
      const handler = mock(() => Promise.resolve());
      gossip.onMessage('test-type', handler);

      const message = {
        type: 'test-type',
        runId: '0x1234' as Hex,
        sender: '0xSender' as Address,
        timestamp: Date.now(),
        payload: '{}',
        signature: '0xsig' as Hex,
      };

      await gossip.handleMessage(message);

      expect(handler).toHaveBeenCalledWith(message);
    });

    test('ignores duplicate messages', async () => {
      const handler = mock(() => Promise.resolve());
      gossip.onMessage('test-type', handler);

      const message = {
        type: 'test-type',
        runId: '0x1234' as Hex,
        sender: '0xSender' as Address,
        timestamp: Date.now(),
        payload: '{}',
        signature: '0xsig' as Hex,
      };

      await gossip.handleMessage(message);
      await gossip.handleMessage(message); // Same message again

      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('ignores unknown message types', async () => {
      const handler = mock(() => Promise.resolve());
      gossip.onMessage('known-type', handler);

      await gossip.handleMessage({
        type: 'unknown-type',
        runId: '0x1234' as Hex,
        sender: '0xSender' as Address,
        timestamp: Date.now(),
        payload: '{}',
        signature: '0xsig' as Hex,
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe('BlobStore', () => {
  let store: BlobStore;

  beforeEach(() => {
    store = new BlobStore([{ agentId: BigInt(1), endpoint: 'http://peer1.example.com', owner: '0x1111' as Address }]);
  });

  describe('constructor', () => {
    test('creates instance with peers', () => {
      expect(store).toBeDefined();
    });
  });

  describe('put', () => {
    test('stores data and returns hash', async () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const hash = await store.put(data);

      expect(hash).toMatch(/^0x[a-f0-9]+$/);
    });

    test('returns consistent hash for same data', async () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const hash1 = await store.put(data);
      const hash2 = await store.put(data);

      expect(hash1).toBe(hash2);
    });
  });

  describe('get', () => {
    test('retrieves stored data by hash', async () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const hash = await store.put(data);

      const retrieved = await store.get(hash);
      expect(retrieved).toEqual(data);
    });

    test('fetches from peers if not local', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response(new Uint8Array([5, 6, 7, 8]), { status: 200 }))
      );
      global.fetch = mockFetch;

      const retrieved = await store.get('0xnonexistent' as Hex);
      expect(retrieved).toBeDefined();
    });

    test('returns null if not found anywhere', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response(null, { status: 404 })));
      global.fetch = mockFetch;

      // Empty store with no peers
      const emptyStore = new BlobStore([]);
      const retrieved = await emptyStore.get('0xnonexistent' as Hex);
      expect(retrieved).toBeNull();
    });
  });
});

describe('P2PTrainingNetwork', () => {
  let network: P2PTrainingNetwork;

  beforeEach(() => {
    mockReadContract.mockReset();
    mockReadContract.mockResolvedValue([]); // Empty peers by default
  });

  describe('createP2PNetwork', () => {
    test('creates network with valid config', () => {
      const network = createP2PNetwork(testConfig);
      expect(network).toBeDefined();
    });
  });

  describe('connect', () => {
    test('discovers peers and initializes components', async () => {
      const network = createP2PNetwork(testConfig);
      await network.connect();
      expect(network.isConnected).toBe(true);
    });
  });

  describe('disconnect', () => {
    test('disconnects and clears state', async () => {
      const network = createP2PNetwork(testConfig);
      await network.connect();
      network.disconnect();
      expect(network.isConnected).toBe(false);
    });
  });

  describe('broadcastGradient', () => {
    test('broadcasts gradient hash to peers', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response(null, { status: 200 })));
      global.fetch = mockFetch;

      mockReadContract.mockResolvedValueOnce([BigInt(1)]);
      mockReadContract.mockResolvedValueOnce({
        endpoint: 'http://peer1.example.com',
        owner: '0x1111111111111111111111111111111111111111',
      });

      const network = createP2PNetwork(testConfig);
      await network.connect();

      await network.broadcastGradient('0xrunid' as Hex, '0xgradhash' as Hex);
      // Should have called fetch to broadcast
    });
  });

  describe('handleGossip', () => {
    test('handles incoming gossip message', async () => {
      const network = createP2PNetwork(testConfig);
      await network.connect();

      const message = {
        type: 'gradient',
        runId: '0x1234' as Hex,
        sender: '0xSender' as Address,
        timestamp: Date.now(),
        payload: JSON.stringify({ hash: '0xhash' }),
        signature: '0xsig' as Hex,
      };

      // Should not throw
      await network.handleGossip(message);
    });
  });
});

describe('Integration', () => {
  test('full P2P workflow', async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    global.fetch = mockFetch;

    // Mock peer discovery
    mockReadContract.mockResolvedValueOnce([BigInt(1)]);
    mockReadContract.mockResolvedValueOnce({
      endpoint: 'http://peer1.example.com',
      owner: '0x1111111111111111111111111111111111111111',
    });

    const network = createP2PNetwork(testConfig);

    // Connect
    await network.connect();
    expect(network.isConnected).toBe(true);

    // Store blob
    const data = new Uint8Array([1, 2, 3, 4]);
    const hash = await network.storeBlob(data);
    expect(hash).toMatch(/^0x[a-f0-9]+$/);

    // Retrieve blob
    const retrieved = await network.getBlob(hash);
    expect(retrieved).toEqual(data);

    // Broadcast gradient
    await network.broadcastGradient('0xrunid' as Hex, hash);

    // Disconnect
    network.disconnect();
    expect(network.isConnected).toBe(false);
  });
});

