/**
 * Service Worker for Offline P2P Fallback - Production Implementation
 *
 * Resilient content delivery with:
 * - Cache API with multiple cache buckets
 * - Network fallback with timeout
 * - P2P via WebRTC when network fails
 * - Content hash verification for P2P downloads
 * - Background sync
 * - Proper type safety
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

// ============================================================================
// Configuration
// ============================================================================

const CACHE_VERSION = 'v2';
const CACHE_NAME = `jeju-app-${CACHE_VERSION}`;
const IPFS_CACHE_NAME = `jeju-ipfs-${CACHE_VERSION}`;
const ASSET_CACHE_NAME = `jeju-assets-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
];

const CACHE_PATTERNS = {
  immutable: [
    /\/ipfs\/.+/,
    /\/assets\/.*\.[a-f0-9]{8,}\.(js|css|woff2?|ttf|eot)/,
    /\/_next\/static\/.+/,
  ],
  networkFirst: [
    /\/api\/.*/,
    /\/rpc$/,
  ],
  cacheFirst: [
    /\.(png|jpg|jpeg|gif|webp|svg|ico)$/,
    /\.(woff2?|ttf|eot|otf)$/,
  ],
  staleWhileRevalidate: [
    /\.html$/,
    /\.json$/,
    /\/(en|es|fr|de|zh)\//,
  ],
};

const P2P_CONFIG = {
  signalingServer: 'wss://signal.jejunetwork.org',
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  chunkSize: 16384,
  requestTimeout: 30000,
};

// ============================================================================
// State
// ============================================================================

interface P2PPeer {
  id: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  contentHashes: Set<string>;
  pendingChunks: Map<string, ArrayBuffer[]>;
}

interface PendingRequest {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  expectedHash: string;
  chunks: ArrayBuffer[];
  expectedSize: number;
  contentType: string;
}

const peers = new Map<string, P2PPeer>();
let signalingSocket: WebSocket | null = null;
const pendingRequests = new Map<string, PendingRequest>();

// ============================================================================
// Content Verification
// ============================================================================

async function verifyContentHash(data: ArrayBuffer, expectedHash: string): Promise<boolean> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Support multiple formats
  if (expectedHash.startsWith('0x')) {
    return `0x${hashHex}` === expectedHash;
  }

  if (expectedHash.startsWith('Qm') || expectedHash.startsWith('bafy')) {
    // For IPFS CIDs, verify the hash portion matches
    return expectedHash.includes(hashHex.slice(0, 32));
  }

  return hashHex === expectedHash;
}

// ============================================================================
// Install & Activate
// ============================================================================

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      console.log('[SW] Precaching app shell');

      // Use addAll with error handling for individual URLs
      for (const url of PRECACHE_URLS) {
        try {
          await cache.add(url);
        } catch (error) {
          console.warn(`[SW] Failed to precache ${url}:`, error);
        }
      }

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clean old caches
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('jeju-') && !key.includes(CACHE_VERSION))
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
      connectToSignaling();
    })()
  );
});

// ============================================================================
// Fetch Handler
// ============================================================================

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  // Allow IPFS cross-origin
  if (url.origin !== self.location.origin && !url.pathname.includes('/ipfs/')) {
    return;
  }

  event.respondWith(handleFetch(event.request));
});

async function handleFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const strategy = getStrategy(url.pathname);

  try {
    switch (strategy) {
      case 'immutable':
        return await immutableStrategy(request);
      case 'networkFirst':
        return await networkFirstStrategy(request);
      case 'cacheFirst':
        return await cacheFirstStrategy(request);
      case 'staleWhileRevalidate':
        return await staleWhileRevalidateStrategy(request);
      default:
        return await networkFirstStrategy(request);
    }
  } catch (error) {
    console.error('[SW] Fetch failed:', error);

    // P2P fallback for IPFS
    if (url.pathname.includes('/ipfs/')) {
      const cid = extractCID(url.pathname);
      if (cid) {
        try {
          const p2pResponse = await fetchFromP2P(cid);
          if (p2pResponse) return p2pResponse;
        } catch (p2pError) {
          console.error('[SW] P2P fallback failed:', p2pError);
        }
      }
    }

    const offlinePage = await caches.match('/offline.html');
    return offlinePage || new Response('Offline', { status: 503 });
  }
}

function getStrategy(pathname: string): string {
  for (const [strategy, patterns] of Object.entries(CACHE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(pathname)) return strategy;
    }
  }
  return 'networkFirst';
}

// ============================================================================
// Caching Strategies
// ============================================================================

async function immutableStrategy(request: Request): Promise<Response> {
  const cacheName = request.url.includes('/ipfs/') ? IPFS_CACHE_NAME : ASSET_CACHE_NAME;
  const cache = await caches.open(cacheName);

  const cached = await cache.match(request);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      const responseClone = response.clone();
      cache.put(request, responseClone);

      if (request.url.includes('/ipfs/')) {
        const cid = extractCID(request.url);
        if (cid) announceContent(cid);
      }
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function networkFirstStrategy(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    clearTimeout(timeout);
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirstStrategy(request: Request): Promise<Response> {
  const cache = await caches.open(ASSET_CACHE_NAME);

  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }

  return response;
}

async function staleWhileRevalidateStrategy(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || new Response('Offline', { status: 503 });
}

// ============================================================================
// P2P Network
// ============================================================================

function connectToSignaling(): void {
  if (signalingSocket?.readyState === WebSocket.OPEN) return;

  try {
    signalingSocket = new WebSocket(P2P_CONFIG.signalingServer);

    signalingSocket.onopen = () => {
      console.log('[SW] Connected to signaling server');
      signalingSocket?.send(JSON.stringify({
        type: 'announce',
        peerId: generatePeerId(),
      }));
    };

    signalingSocket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        await handleSignalingMessage(message);
      } catch (error) {
        console.error('[SW] Invalid signaling message:', error);
      }
    };

    signalingSocket.onclose = () => {
      console.log('[SW] Signaling disconnected');
      setTimeout(connectToSignaling, 5000);
    };

    signalingSocket.onerror = (error) => {
      console.error('[SW] Signaling error:', error);
    };
  } catch (error) {
    console.error('[SW] Failed to connect:', error);
    setTimeout(connectToSignaling, 10000);
  }
}

async function handleSignalingMessage(message: {
  type: string;
  from?: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  contentHash?: string;
}): Promise<void> {
  switch (message.type) {
    case 'offer':
      if (message.from && message.offer) {
        await handleOffer(message.from, message.offer);
      }
      break;
    case 'answer':
      if (message.from && message.answer) {
        await handleAnswer(message.from, message.answer);
      }
      break;
    case 'ice-candidate':
      if (message.from && message.candidate) {
        await handleIceCandidate(message.from, message.candidate);
      }
      break;
    case 'content-announce':
      if (message.from && message.contentHash) {
        handleContentAnnounce(message.from, message.contentHash);
      }
      break;
  }
}

async function handleOffer(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
  const peer = await createPeer(peerId);
  await peer.connection.setRemoteDescription(offer);

  const answer = await peer.connection.createAnswer();
  await peer.connection.setLocalDescription(answer);

  signalingSocket?.send(JSON.stringify({
    type: 'answer',
    to: peerId,
    answer,
  }));
}

async function handleAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
  const peer = peers.get(peerId);
  if (peer) {
    await peer.connection.setRemoteDescription(answer);
  }
}

async function handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
  const peer = peers.get(peerId);
  if (peer) {
    await peer.connection.addIceCandidate(candidate);
  }
}

function handleContentAnnounce(peerId: string, contentHash: string): void {
  const peer = peers.get(peerId);
  if (peer) {
    peer.contentHashes.add(contentHash);
  }
}

async function createPeer(peerId: string): Promise<P2PPeer> {
  const connection = new RTCPeerConnection({
    iceServers: P2P_CONFIG.iceServers,
  });

  const peer: P2PPeer = {
    id: peerId,
    connection,
    dataChannel: null,
    contentHashes: new Set(),
    pendingChunks: new Map(),
  };

  connection.ondatachannel = (event) => {
    peer.dataChannel = event.channel;
    setupDataChannel(peer);
  };

  connection.onicecandidate = (event) => {
    if (event.candidate) {
      signalingSocket?.send(JSON.stringify({
        type: 'ice-candidate',
        to: peerId,
        candidate: event.candidate,
      }));
    }
  };

  connection.onconnectionstatechange = () => {
    if (connection.connectionState === 'disconnected' ||
        connection.connectionState === 'failed') {
      peers.delete(peerId);
    }
  };

  peers.set(peerId, peer);
  return peer;
}

function setupDataChannel(peer: P2PPeer): void {
  const channel = peer.dataChannel;
  if (!channel) return;

  channel.binaryType = 'arraybuffer';

  channel.onmessage = async (event) => {
    await handleP2PMessage(peer, event.data);
  };
}

async function handleP2PMessage(peer: P2PPeer, data: ArrayBuffer | string): Promise<void> {
  if (typeof data === 'string') {
    const message = JSON.parse(data);

    switch (message.type) {
      case 'request':
        await handleContentRequest(peer, message.contentHash);
        break;

      case 'response-header': {
        const pending = pendingRequests.get(message.contentHash);
        if (pending) {
          pending.expectedSize = message.size;
          pending.contentType = message.contentType;
          pending.chunks = [];
        }
        break;
      }

      case 'response-complete':
        await handleResponseComplete(message.contentHash);
        break;
    }
  } else {
    // Binary chunk
    handleContentChunk(peer.id, data);
  }
}

async function handleContentRequest(peer: P2PPeer, contentHash: string): Promise<void> {
  const cache = await caches.open(IPFS_CACHE_NAME);
  const cached = await cache.match(`/ipfs/${contentHash}`);

  if (cached) {
    const buffer = await cached.arrayBuffer();

    peer.dataChannel?.send(JSON.stringify({
      type: 'response-header',
      contentHash,
      size: buffer.byteLength,
      contentType: cached.headers.get('content-type') || 'application/octet-stream',
    }));

    // Send in chunks
    for (let offset = 0; offset < buffer.byteLength; offset += P2P_CONFIG.chunkSize) {
      const chunk = buffer.slice(offset, offset + P2P_CONFIG.chunkSize);
      peer.dataChannel?.send(chunk);
    }

    peer.dataChannel?.send(JSON.stringify({
      type: 'response-complete',
      contentHash,
    }));
  }
}

function handleContentChunk(_peerId: string, data: ArrayBuffer): void {
  // Find active request for this peer
  for (const [_hash, pending] of pendingRequests) {
    if (pending.chunks.length * P2P_CONFIG.chunkSize < pending.expectedSize) {
      pending.chunks.push(data);
      break;
    }
  }
}

async function handleResponseComplete(contentHash: string): Promise<void> {
  const pending = pendingRequests.get(contentHash);
  if (!pending) return;

  try {
    // Combine chunks
    const totalSize = pending.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;

    for (const chunk of pending.chunks) {
      combined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    // Verify content hash
    const isValid = await verifyContentHash(combined.buffer, pending.expectedHash);

    if (!isValid) {
      pending.reject(new Error('Content hash verification failed'));
      pendingRequests.delete(contentHash);
      return;
    }

    // Cache the content
    const cache = await caches.open(IPFS_CACHE_NAME);
    const response = new Response(combined, {
      headers: {
        'Content-Type': pending.contentType,
        'Content-Length': totalSize.toString(),
        'X-Verified': 'true',
      },
    });

    await cache.put(`/ipfs/${contentHash}`, response.clone());
    pending.resolve(response);
  } catch (error) {
    pending.reject(error as Error);
  } finally {
    pendingRequests.delete(contentHash);
  }
}

async function fetchFromP2P(cid: string): Promise<Response | null> {
  const availablePeers = Array.from(peers.values()).filter(
    (peer) => peer.contentHashes.has(cid) && peer.dataChannel?.readyState === 'open'
  );

  if (availablePeers.length === 0) return null;

  const peer = availablePeers[0];

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(cid);
      reject(new Error('P2P request timeout'));
    }, P2P_CONFIG.requestTimeout);

    pendingRequests.set(cid, {
      resolve: (response) => {
        clearTimeout(timeout);
        resolve(response);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      expectedHash: cid,
      chunks: [],
      expectedSize: 0,
      contentType: 'application/octet-stream',
    });

    peer.dataChannel?.send(JSON.stringify({
      type: 'request',
      contentHash: cid,
    }));
  });
}

function announceContent(cid: string): void {
  signalingSocket?.send(JSON.stringify({
    type: 'content-announce',
    contentHash: cid,
  }));
}

// ============================================================================
// Utilities
// ============================================================================

function extractCID(pathname: string): string | null {
  const match = pathname.match(/\/ipfs\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

function generatePeerId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Message Handler
// ============================================================================

self.addEventListener('message', async (event) => {
  const { type, payload } = event.data;
  const port = event.ports[0];

  switch (type) {
    case 'CACHE_URLS':
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(payload.urls);
        port?.postMessage({ success: true });
      } catch (error) {
        port?.postMessage({ success: false, error: (error as Error).message });
      }
      break;

    case 'CLEAR_CACHE':
      await Promise.all([
        caches.delete(CACHE_NAME),
        caches.delete(IPFS_CACHE_NAME),
        caches.delete(ASSET_CACHE_NAME),
      ]);
      port?.postMessage({ success: true });
      break;

    case 'GET_CACHE_STATS': {
      const stats = await getCacheStats();
      port?.postMessage(stats);
      break;
    }

    case 'ANNOUNCE_CONTENT':
      announceContent(payload.cid);
      port?.postMessage({ success: true });
      break;

    case 'GET_PEER_COUNT':
      port?.postMessage({ peers: peers.size });
      break;
  }
});

async function getCacheStats(): Promise<{
  totalSize: number;
  entries: number;
  caches: Record<string, { size: number; entries: number }>;
}> {
  const cacheNames = [CACHE_NAME, IPFS_CACHE_NAME, ASSET_CACHE_NAME];
  const stats: Record<string, { size: number; entries: number }> = {};
  let totalSize = 0;
  let totalEntries = 0;

  for (const name of cacheNames) {
    try {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      let size = 0;

      for (const request of keys) {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          size += blob.size;
        }
      }

      stats[name] = { size, entries: keys.length };
      totalSize += size;
      totalEntries += keys.length;
    } catch (_error) {
      stats[name] = { size: 0, entries: 0 };
    }
  }

  return { totalSize, entries: totalEntries, caches: stats };
}

export {};
