import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { invoke } from '../../lib'
import { type VPNNode, VPNNodeSchema } from '../../lib/schemas'
import { findBestClientNode } from '../../lib/utils'

export function useVPNNodes() {
  const [nodes, setNodes] = useState<VPNNode[]>([])
  const [selectedNode, setSelectedNode] = useState<VPNNode | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const hasInitialized = useRef(false)

  useEffect(() => {
    const fetchNodes = async () => {
      const nodeList = await invoke(
        'get_nodes',
        { countryCode: null },
        z.array(VPNNodeSchema),
      )
      setNodes(nodeList)
      setError(null)

      if (nodeList.length > 0 && !hasInitialized.current) {
        hasInitialized.current = true
        const best = findBestClientNode(nodeList)
        setSelectedNode(best)
      }
    }

    fetchNodes()
  }, [])

  const selectNode = useCallback(async (node: VPNNode) => {
    const validatedNode = VPNNodeSchema.parse(node)
    setSelectedNode(validatedNode)
    await invoke('select_node', { nodeId: validatedNode.node_id })
  }, [])

  return { nodes, selectedNode, selectNode, error }
}
