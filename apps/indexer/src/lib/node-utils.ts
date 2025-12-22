/**
 * Node utilities
 * Shared business logic for node-related operations
 */

import { NodeStake } from '../model';

export interface NodeResponse {
  nodeId: string;
  operator: string;
  stakedToken: string;
  stakedAmount: string;
  stakedValueUSD: string;
  rpcUrl: string;
  geographicRegion: number;
  isActive: boolean;
  isSlashed: boolean;
  uptimeScore: string | null;
}

export function mapNodeResponse(node: NodeStake): NodeResponse {
  if (!node) {
    throw new Error('NodeStake is required');
  }
  return {
    nodeId: node.nodeId,
    operator: node.operator,
    stakedToken: node.stakedToken,
    stakedAmount: node.stakedAmount.toString(),
    stakedValueUSD: node.stakedValueUSD.toString(),
    rpcUrl: node.rpcUrl,
    geographicRegion: node.geographicRegion,
    isActive: node.isActive,
    isSlashed: node.isSlashed,
    uptimeScore: node.currentUptimeScore ? node.currentUptimeScore.toString() : null,
  };
}
