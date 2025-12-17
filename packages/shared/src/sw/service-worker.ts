/**
 * Service Worker for Offline P2P Fallback
 * 
 * Provides resilient content delivery by:
 * 1. Serving from Cache API first (fastest)
 * 2. Falling back to network (CDN)
 * 3. Using P2P via WebRTC when network fails
 * 4. Syncing content in background
 * 
 * Installation: Register this service worker in your app
 * navigator.serviceWorker.register('/sw.js')
 */

// Type definitions for service worker
// Using 'any' here because ServiceWorkerGlobalScope is only available in service worker context
declare const self: {
  skipWaiting: () => Promise<void>;
  clients: { claim: () => Promise<void> };
  addEventListener: (type: string, handler: (event: ExtendableEvent | FetchEvent) => void) => void;
  location: { origin: string };
};

// ============================================================================
// Configuration
// ============================================================================

const CACHE_NAME = 'jeju-v1';
const IPFS_CACHE_NAME = 'jeju-ipfs-v1';
const ASSET_CACHE_NAME = 'jeju-assets-v1';

// URLs to cache immediately on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
];

// Patterns for caching strategies
const CACHE_PATTERNS = {
  // Immutable content - cache forever
  immutable: [
    /\/ipfs\/.+/,
    /\/assets\/.*\.[a-f0-9]{8,}\.(js|css|woff2?|ttf|eot)/,
    /\/_next\/static\/.+/,
  ],
  // Network first with cache fallback
  networkFirst: [
    /\/api\/.*/,
    /\/rpc$/,
  ],
  // Cache first with network update
  cacheFirst: [
    /\.(png|jpg|jpeg|gif|webp|svg|ico)$/,
    /\.(woff2?|ttf|eot|otf)$/,
  ],
  // Stale while revalidate
  staleWhileRevalidate: [
    /\.html$/,
    /\.json$/,
    /\/(en|es|fr|de|zh)\//,
  ],
};

// P2P configuration
const P2P_CONFIG = {
  signalingServer: 'wss://signal.jejunetwork.org',
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  chunkSize: 16384, // 16KB chunks
};

// ============================================================================
// State
// ============================================================================

interface P2PPeer {
  id: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  contentHashes: Set<string>;
}

const peers = new Map<string, P2PPeer>();
let signalingSocket: WebSocket | null = null;
const pendingRequests = new Map<string, {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timeout: number;
}>();

// ============================================================================
// Install & Activate
// ============================================================================

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching app shell');
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      // Activate immediately
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Clean old caches
      caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((key) => {
            return key !== CACHE_NAME && 
                   key !== IPFS_CACHE_NAME && 
                   key !== ASSET_CACHE_NAME;
          }).map((key) => caches.delete(key))
        );
      }),
      // Take control of all pages
      self.clients.claim(),
      // Connect to P2P network
      connectToSignaling(),
    ])
  );
});

// ============================================================================
// Fetch Handler
// ============================================================================

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Skip cross-origin requests except IPFS
  if (url.origin !== self.location.origin && !url.pathname.includes('/ipfs/')) {
    return;
  }
  
  event.respondWith(handleFetch(event.request));
});

async function handleFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  
  // Determine caching strategy based on URL pattern
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
    
    // Try P2P fallback for IPFS content
    if (url.pathname.includes('/ipfs/')) {
      const cid = extractCID(url.pathname);
      if (cid) {
        const p2pResponse = await fetchFromP2P(cid);
        if (p2pResponse) {
          return p2pResponse;
        }
      }
    }
    
    // Return offline page
    const offlinePage = await caches.match('/offline.html');
    return offlinePage || new Response('Offline', { status: 503 });
  }
}

function getStrategy(pathname: string): string {
  for (const [strategy, patterns] of Object.entries(CACHE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(pathname)) {
        return strategy;
      }
    }
  }
  return 'networkFirst';
}

// ============================================================================
// Caching Strategies
// ============================================================================

/**
 * Immutable content - cache forever, never revalidate
 */
async function immutableStrategy(request: Request): Promise<Response> {
  const cacheName = request.url.includes('/ipfs/') ? IPFS_CACHE_NAME : ASSET_CACHE_NAME;
  const cache = await caches.open(cacheName);
  
  // Check cache first
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  
  // Fetch from network
  const response = await fetch(request);
  
  if (response.ok) {
    // Clone and cache
    const responseClone = response.clone();
    cache.put(request, responseClone);
    
    // Announce to P2P network
    if (request.url.includes('/ipfs/')) {
      const cid = extractCID(request.url);
      if (cid) {
        announceContent(cid);
      }
    }
  }
  
  return response;
}

/**
 * Network first with cache fallback
 */
async function networkFirstStrategy(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    const response = await fetch(request, { 
      signal: AbortSignal.timeout(10000) 
    });
    
    if (response.ok) {
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

/**
 * Cache first with network fallback
 */
async function cacheFirstStrategy(request: Request): Promise<Response> {
  const cache = await caches.open(ASSET_CACHE_NAME);
  
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  
  return response;
}

/**
 * Stale while revalidate - serve from cache, update in background
 */
async function staleWhileRevalidateStrategy(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  // Fetch in background
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  });
  
  // Return cached or wait for network
  return cached || fetchPromise;
}

// ============================================================================
// P2P Network
// ============================================================================

async function connectToSignaling(): Promise<void> {
  if (signalingSocket?.readyState === WebSocket.OPEN) {
    return;
  }
  
  try {
    signalingSocket = new WebSocket(P2P_CONFIG.signalingServer);
    
    signalingSocket.onopen = () => {
      console.log('[SW] Connected to signaling server');
      
      // Announce our presence
      signalingSocket?.send(JSON.stringify({
        type: 'announce',
        peerId: generatePeerId(),
      }));
    };
    
    signalingSocket.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      await handleSignalingMessage(message);
    };
    
    signalingSocket.onclose = () => {
      console.log('[SW] Signaling connection closed');
      // Reconnect after delay
      setTimeout(connectToSignaling, 5000);
    };
    
    signalingSocket.onerror = (error) => {
      console.error('[SW] Signaling error:', error);
    };
  } catch (error) {
    console.error('[SW] Failed to connect to signaling:', error);
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
      await handleOffer(message.from!, message.offer!);
      break;
    case 'answer':
      await handleAnswer(message.from!, message.answer!);
      break;
    case 'ice-candidate':
      await handleIceCandidate(message.from!, message.candidate!);
      break;
    case 'content-announce':
      handleContentAnnounce(message.from!, message.contentHash!);
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
  const message = typeof data === 'string' ? JSON.parse(data) : null;
  
  if (message) {
    switch (message.type) {
      case 'request':
        // Peer is requesting content
        await handleContentRequest(peer, message.contentHash);
        break;
      case 'response-header':
        // Response header with metadata
        break;
    }
  } else {
    // Binary data - content chunk
    handleContentChunk(data as ArrayBuffer);
  }
}

async function handleContentRequest(peer: P2PPeer, contentHash: string): Promise<void> {
  // Check if we have the content in cache
  const cid = contentHash;
  const cache = await caches.open(IPFS_CACHE_NAME);
  const cached = await cache.match(`/ipfs/${cid}`);
  
  if (cached) {
    const buffer = await cached.arrayBuffer();
    
    // Send header
    peer.dataChannel?.send(JSON.stringify({
      type: 'response-header',
      contentHash,
      size: buffer.byteLength,
      contentType: cached.headers.get('content-type') || 'application/octet-stream',
    }));
    
    // Send chunks
    for (let offset = 0; offset < buffer.byteLength; offset += P2P_CONFIG.chunkSize) {
      const chunk = buffer.slice(offset, offset + P2P_CONFIG.chunkSize);
      peer.dataChannel?.send(chunk);
    }
  }
}

function handleContentChunk(data: ArrayBuffer): void {
  // Accumulate chunks and resolve pending request when complete
  // Implementation depends on content assembly logic
}

async function fetchFromP2P(cid: string): Promise<Response | null> {
  // Find peers that have this content
  const availablePeers = Array.from(peers.values()).filter(
    (peer) => peer.contentHashes.has(cid) && peer.dataChannel?.readyState === 'open'
  );
  
  if (availablePeers.length === 0) {
    return null;
  }
  
  // Request from first available peer
  const peer = availablePeers[0];
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(cid);
      reject(new Error('P2P request timeout'));
    }, 30000) as unknown as number;
    
    pendingRequests.set(cid, { resolve, reject, timeout });
    
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
// Message Handler (from main thread)
// ============================================================================

self.addEventListener('message', async (event) => {
  const { type, payload } = event.data;
  
  switch (type) {
    case 'CACHE_URLS':
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(payload.urls);
      event.ports[0]?.postMessage({ success: true });
      break;
      
    case 'CLEAR_CACHE':
      await caches.delete(CACHE_NAME);
      await caches.delete(IPFS_CACHE_NAME);
      await caches.delete(ASSET_CACHE_NAME);
      event.ports[0]?.postMessage({ success: true });
      break;
      
    case 'GET_CACHE_STATS':
      const stats = await getCacheStats();
      event.ports[0]?.postMessage(stats);
      break;
      
    case 'ANNOUNCE_CONTENT':
      announceContent(payload.cid);
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
  }
  
  return { totalSize, entries: totalEntries, caches: stats };
}

export {};

