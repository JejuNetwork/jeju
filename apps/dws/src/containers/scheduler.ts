/**
 * Container Scheduler - Intelligent workload distribution across compute nodes
 * Implements best-fit scheduling with affinity, anti-affinity, and geographic awareness
 */

import type { Address } from 'viem';
import type {
  ComputeNode,
  ContainerResources,
  ExecutionRequest,
  ContainerImage,
} from './types';

// ============================================================================
// Node Registry
// ============================================================================

const nodes = new Map<string, ComputeNode>();
const nodesByRegion = new Map<string, Set<string>>();

export function registerNode(node: ComputeNode): void {
  nodes.set(node.nodeId, node);

  // Index by region
  const regionNodes = nodesByRegion.get(node.region) ?? new Set();
  regionNodes.add(node.nodeId);
  nodesByRegion.set(node.region, regionNodes);
}

export function updateNodeResources(
  nodeId: string,
  available: { cpu: number; memoryMb: number; storageMb: number }
): void {
  const node = nodes.get(nodeId);
  if (node) {
    node.resources.availableCpu = available.cpu;
    node.resources.availableMemoryMb = available.memoryMb;
    node.resources.availableStorageMb = available.storageMb;
    node.lastHeartbeat = Date.now();
  }
}

export function updateNodeStatus(nodeId: string, status: ComputeNode['status']): void {
  const node = nodes.get(nodeId);
  if (node) {
    node.status = status;
    node.lastHeartbeat = Date.now();
  }
}

export function removeNode(nodeId: string): void {
  const node = nodes.get(nodeId);
  if (node) {
    const regionNodes = nodesByRegion.get(node.region);
    regionNodes?.delete(nodeId);
    nodes.delete(nodeId);
  }
}

export function getNode(nodeId: string): ComputeNode | null {
  return nodes.get(nodeId) ?? null;
}

export function getAllNodes(): ComputeNode[] {
  return [...nodes.values()];
}

export function getNodesByRegion(region: string): ComputeNode[] {
  const nodeIds = nodesByRegion.get(region);
  if (!nodeIds) return [];
  return [...nodeIds].map((id) => nodes.get(id)).filter((n): n is ComputeNode => !!n);
}

// ============================================================================
// Node Health
// ============================================================================

const HEARTBEAT_TIMEOUT_MS = 30000;

export function checkNodeHealth(): { healthy: string[]; unhealthy: string[] } {
  const now = Date.now();
  const healthy: string[] = [];
  const unhealthy: string[] = [];

  for (const node of nodes.values()) {
    if (node.status === 'offline') {
      unhealthy.push(node.nodeId);
    } else if (now - node.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      node.status = 'offline';
      unhealthy.push(node.nodeId);
    } else {
      healthy.push(node.nodeId);
    }
  }

  return { healthy, unhealthy };
}

// ============================================================================
// Scheduling Strategies
// ============================================================================

export type SchedulingStrategy = 'best-fit' | 'worst-fit' | 'first-fit' | 'round-robin';

interface SchedulingContext {
  request: ExecutionRequest;
  image: ContainerImage;
  userAddress: Address;
  preferredRegion?: string;
  antiAffinity?: string[]; // Node IDs to avoid
  affinity?: string[];     // Preferred node IDs
}

interface ScheduleResult {
  nodeId: string;
  score: number;
  reason: string;
}

let roundRobinIndex = 0;

export function scheduleExecution(
  context: SchedulingContext,
  strategy: SchedulingStrategy = 'best-fit'
): ScheduleResult | null {
  const eligibleNodes = getEligibleNodes(context);
  if (eligibleNodes.length === 0) return null;

  switch (strategy) {
    case 'best-fit':
      return scheduleBestFit(eligibleNodes, context);
    case 'worst-fit':
      return scheduleWorstFit(eligibleNodes, context);
    case 'first-fit':
      return scheduleFirstFit(eligibleNodes, context);
    case 'round-robin':
      return scheduleRoundRobin(eligibleNodes, context);
    default:
      return scheduleBestFit(eligibleNodes, context);
  }
}

function getEligibleNodes(context: SchedulingContext): ComputeNode[] {
  const resources = context.request.resources;

  return [...nodes.values()].filter((node) => {
    // Must be online
    if (node.status !== 'online') return false;

    // Must have enough resources
    if (node.resources.availableCpu < resources.cpuCores) return false;
    if (node.resources.availableMemoryMb < resources.memoryMb) return false;
    if (node.resources.availableStorageMb < resources.storageMb) return false;

    // GPU requirements
    if (resources.gpuType && !node.resources.gpuTypes.includes(resources.gpuType)) return false;

    // Anti-affinity check
    if (context.antiAffinity?.includes(node.nodeId)) return false;

    return true;
  });
}

// Best-fit: Choose node with least wasted resources
function scheduleBestFit(nodes: ComputeNode[], context: SchedulingContext): ScheduleResult {
  const resources = context.request.resources;

  const scored = nodes.map((node) => {
    let score = 0;

    // Resource efficiency (higher is better - less waste)
    const cpuUtilization = resources.cpuCores / node.resources.availableCpu;
    const memUtilization = resources.memoryMb / node.resources.availableMemoryMb;
    score += cpuUtilization * 30 + memUtilization * 30;

    // Cache affinity (bonus for having image cached)
    if (node.cachedImages.has(context.image.digest)) {
      score += 25;
    }

    // Region preference
    if (context.preferredRegion && node.region === context.preferredRegion) {
      score += 10;
    }

    // Affinity bonus
    if (context.affinity?.includes(node.nodeId)) {
      score += 5;
    }

    // Reputation
    score += node.reputation / 10;

    return { node, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;

  return {
    nodeId: best.node.nodeId,
    score: best.score,
    reason: `Best fit with score ${best.score.toFixed(1)}`,
  };
}

// Worst-fit: Choose node with most available resources (spread load)
function scheduleWorstFit(nodes: ComputeNode[], context: SchedulingContext): ScheduleResult {
  const scored = nodes.map((node) => {
    const availableScore =
      node.resources.availableCpu * 10 +
      node.resources.availableMemoryMb / 100;

    let bonus = 0;
    if (node.cachedImages.has(context.image.digest)) bonus += 50;
    if (context.preferredRegion && node.region === context.preferredRegion) bonus += 20;

    return { node, score: availableScore + bonus };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;

  return {
    nodeId: best.node.nodeId,
    score: best.score,
    reason: `Worst fit (most resources available)`,
  };
}

// First-fit: Choose first eligible node
function scheduleFirstFit(nodes: ComputeNode[], context: SchedulingContext): ScheduleResult {
  // Prefer nodes with cached image
  const withCache = nodes.find((n) => n.cachedImages.has(context.image.digest));
  if (withCache) {
    return { nodeId: withCache.nodeId, score: 100, reason: 'First fit with cache hit' };
  }

  return { nodeId: nodes[0]!.nodeId, score: 50, reason: 'First eligible node' };
}

// Round-robin: Distribute evenly
function scheduleRoundRobin(nodes: ComputeNode[], _context: SchedulingContext): ScheduleResult {
  roundRobinIndex = (roundRobinIndex + 1) % nodes.length;
  const node = nodes[roundRobinIndex]!;
  return { nodeId: node.nodeId, score: 50, reason: `Round robin selection` };
}

// ============================================================================
// Resource Reservation
// ============================================================================

interface ResourceReservation {
  reservationId: string;
  nodeId: string;
  resources: ContainerResources;
  reservedAt: number;
  expiresAt: number;
  userAddress: Address;
}

const reservations = new Map<string, ResourceReservation>();

export function reserveResources(
  nodeId: string,
  resources: ContainerResources,
  userAddress: Address,
  ttlMs: number = 60000
): ResourceReservation | null {
  const node = nodes.get(nodeId);
  if (!node) return null;

  // Check availability
  if (
    node.resources.availableCpu < resources.cpuCores ||
    node.resources.availableMemoryMb < resources.memoryMb ||
    node.resources.availableStorageMb < resources.storageMb
  ) {
    return null;
  }

  // Reserve
  node.resources.availableCpu -= resources.cpuCores;
  node.resources.availableMemoryMb -= resources.memoryMb;
  node.resources.availableStorageMb -= resources.storageMb;

  const reservation: ResourceReservation = {
    reservationId: crypto.randomUUID(),
    nodeId,
    resources,
    reservedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    userAddress,
  };

  reservations.set(reservation.reservationId, reservation);
  return reservation;
}

export function releaseReservation(reservationId: string): boolean {
  const reservation = reservations.get(reservationId);
  if (!reservation) return false;

  const node = nodes.get(reservation.nodeId);
  if (node) {
    node.resources.availableCpu += reservation.resources.cpuCores;
    node.resources.availableMemoryMb += reservation.resources.memoryMb;
    node.resources.availableStorageMb += reservation.resources.storageMb;
  }

  reservations.delete(reservationId);
  return true;
}

export function cleanupExpiredReservations(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, reservation] of reservations) {
    if (reservation.expiresAt < now) {
      releaseReservation(id);
      cleaned++;
    }
  }

  return cleaned;
}

// ============================================================================
// Geographic Routing
// ============================================================================

interface GeoLocation {
  latitude: number;
  longitude: number;
}

const regionLocations: Record<string, GeoLocation> = {
  'us-east-1': { latitude: 39.0438, longitude: -77.4874 },
  'us-west-1': { latitude: 37.7749, longitude: -122.4194 },
  'us-west-2': { latitude: 45.5155, longitude: -122.6789 },
  'eu-west-1': { latitude: 53.3498, longitude: -6.2603 },
  'eu-central-1': { latitude: 50.1109, longitude: 8.6821 },
  'ap-northeast-1': { latitude: 35.6762, longitude: 139.6503 },
  'ap-southeast-1': { latitude: 1.3521, longitude: 103.8198 },
};

function haversineDistance(loc1: GeoLocation, loc2: GeoLocation): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((loc2.latitude - loc1.latitude) * Math.PI) / 180;
  const dLon = ((loc2.longitude - loc1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((loc1.latitude * Math.PI) / 180) *
      Math.cos((loc2.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function findNearestRegion(userLocation: GeoLocation): string {
  let nearest = 'us-east-1';
  let minDistance = Infinity;

  for (const [region, location] of Object.entries(regionLocations)) {
    const distance = haversineDistance(userLocation, location);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = region;
    }
  }

  return nearest;
}

export function getRegionsOrderedByDistance(userLocation: GeoLocation): string[] {
  return Object.entries(regionLocations)
    .map(([region, location]) => ({
      region,
      distance: haversineDistance(userLocation, location),
    }))
    .sort((a, b) => a.distance - b.distance)
    .map((r) => r.region);
}

// ============================================================================
// Statistics
// ============================================================================

export interface SchedulerStats {
  totalNodes: number;
  onlineNodes: number;
  drainingNodes: number;
  offlineNodes: number;
  totalCpu: number;
  availableCpu: number;
  totalMemoryMb: number;
  availableMemoryMb: number;
  activeReservations: number;
  nodesByRegion: Record<string, number>;
}

export function getSchedulerStats(): SchedulerStats {
  const allNodes = [...nodes.values()];

  const stats: SchedulerStats = {
    totalNodes: allNodes.length,
    onlineNodes: allNodes.filter((n) => n.status === 'online').length,
    drainingNodes: allNodes.filter((n) => n.status === 'draining').length,
    offlineNodes: allNodes.filter((n) => n.status === 'offline').length,
    totalCpu: allNodes.reduce((sum, n) => sum + n.resources.totalCpu, 0),
    availableCpu: allNodes.reduce((sum, n) => sum + n.resources.availableCpu, 0),
    totalMemoryMb: allNodes.reduce((sum, n) => sum + n.resources.totalMemoryMb, 0),
    availableMemoryMb: allNodes.reduce((sum, n) => sum + n.resources.availableMemoryMb, 0),
    activeReservations: reservations.size,
    nodesByRegion: {},
  };

  for (const [region, nodeIds] of nodesByRegion) {
    stats.nodesByRegion[region] = nodeIds.size;
  }

  return stats;
}

// ============================================================================
// Initialization
// ============================================================================

// Start reservation cleanup
setInterval(() => {
  cleanupExpiredReservations();
}, 30000);

// Start health check
setInterval(() => {
  checkNodeHealth();
}, 15000);

