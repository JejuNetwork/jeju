/**
 * Hook for VPN nodes management
 * 
 * Handles fetching and selecting VPN nodes
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '../api';
import { VPNNodeSchema, type VPNNode } from '../api/schemas';
import { z } from 'zod';
import { findBestClientNode } from '../shared/utils';

export function useVPNNodes() {
  const [nodes, setNodes] = useState<VPNNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<VPNNode | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const hasInitialized = useRef(false);

  useEffect(() => {
    const fetchNodes = async () => {
      const nodeList = await invoke('get_nodes', { countryCode: null }, z.array(VPNNodeSchema));
      setNodes(nodeList);
      setError(null);
      
      // Select best node by default only on first load
      if (nodeList.length > 0 && !hasInitialized.current) {
        hasInitialized.current = true;
        const best = findBestClientNode(nodeList);
        setSelectedNode(best);
      }
    };

    fetchNodes();
  }, []);

  const selectNode = useCallback(async (node: VPNNode) => {
    const validatedNode = VPNNodeSchema.parse(node);
    setSelectedNode(validatedNode);
    await invoke('select_node', { nodeId: validatedNode.node_id });
  }, []);

  return { nodes, selectedNode, selectNode, error };
}
