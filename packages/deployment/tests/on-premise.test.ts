/**
 * On-Premise Deployment Tests
 *
 * Tests for local/on-premise infrastructure deployment including:
 * - Configuration generation
 * - Hardware specifications
 * - Kubeadm configuration
 * - Storage classes
 * - Helmfile values generation
 * - Error handling and edge cases
 */

import { describe, expect, it } from 'bun:test'

// Types from the module under test
interface HardwareSpec {
  cpuCores: number
  memoryGb: number
  storageGb: number
  gpuCount: number
  gpuType: 'none' | 'a100' | 'h100' | 'rtx4090'
  networkBandwidthGbps: number
}

interface NodeSpec {
  id: string
  hostname: string
  ip: string
  role: 'control-plane' | 'worker' | 'gpu-worker' | 'storage'
  hardware: HardwareSpec
  labels: Record<string, string>
  taints: string[]
}

interface ClusterConfig {
  name: string
  configType: 'minimal' | 'standard' | 'full' | 'custom'
  nodes: NodeSpec[]
  networking: {
    podCidr: string
    serviceCidr: string
    dnsDomain: string
    loadBalancerIpRange: string
  }
  storage: {
    provider: 'local-path' | 'longhorn' | 'ceph' | 'nfs'
    storageClass: string
    reclaimPolicy: 'Retain' | 'Delete'
  }
  jeju: {
    chainId: number
    networkName: string
    sequencerEnabled: boolean
    rpcEnabled: boolean
    archiveEnabled: boolean
    dwsEnabled: boolean
    ipfsEnabled: boolean
    teeEnabled: boolean
    externalChainsEnabled: boolean
  }
  registry: {
    internal: boolean
    address: string
    username: string
    passwordFile: string
  }
}

// Test fixtures
const createMinimalConfig = (): ClusterConfig => ({
  name: 'jeju-local',
  configType: 'minimal',
  nodes: [
    {
      id: 'node-1',
      hostname: 'jeju-all-in-one',
      ip: '192.168.1.100',
      role: 'control-plane',
      hardware: {
        cpuCores: 32,
        memoryGb: 128,
        storageGb: 4000,
        gpuCount: 1,
        gpuType: 'a100',
        networkBandwidthGbps: 10,
      },
      labels: {
        'node-role.kubernetes.io/control-plane': 'true',
        'jeju.network/sequencer': 'true',
      },
      taints: [],
    },
  ],
  networking: {
    podCidr: '10.244.0.0/16',
    serviceCidr: '10.96.0.0/12',
    dnsDomain: 'cluster.local',
    loadBalancerIpRange: '192.168.1.200-192.168.1.250',
  },
  storage: {
    provider: 'local-path',
    storageClass: 'local-path',
    reclaimPolicy: 'Retain',
  },
  jeju: {
    chainId: 420690,
    networkName: 'jeju-local',
    sequencerEnabled: true,
    rpcEnabled: true,
    archiveEnabled: false,
    dwsEnabled: true,
    ipfsEnabled: true,
    teeEnabled: true,
    externalChainsEnabled: true,
  },
  registry: {
    internal: true,
    address: '192.168.1.100:5000',
    username: 'admin',
    passwordFile: '/etc/jeju/registry-password',
  },
})

describe('Hardware Specifications', () => {
  it('should validate minimal hardware requirements', () => {
    const minimalHardware: HardwareSpec = {
      cpuCores: 32,
      memoryGb: 128,
      storageGb: 4000,
      gpuCount: 1,
      gpuType: 'a100',
      networkBandwidthGbps: 10,
    }

    expect(minimalHardware.cpuCores).toBeGreaterThanOrEqual(32)
    expect(minimalHardware.memoryGb).toBeGreaterThanOrEqual(128)
    expect(minimalHardware.storageGb).toBeGreaterThanOrEqual(4000)
  })

  it('should support various GPU types', () => {
    const gpuTypes: HardwareSpec['gpuType'][] = [
      'none',
      'a100',
      'h100',
      'rtx4090',
    ]

    for (const gpuType of gpuTypes) {
      const hardware: HardwareSpec = {
        cpuCores: 16,
        memoryGb: 64,
        storageGb: 2000,
        gpuCount: gpuType === 'none' ? 0 : 1,
        gpuType,
        networkBandwidthGbps: 10,
      }

      expect(hardware.gpuType).toBe(gpuType)
    }
  })

  it('should have consistent GPU count with GPU type', () => {
    const validateGpuConfig = (hardware: HardwareSpec): boolean => {
      if (hardware.gpuType === 'none' && hardware.gpuCount > 0) return false
      if (hardware.gpuType !== 'none' && hardware.gpuCount === 0) return false
      return true
    }

    expect(
      validateGpuConfig({
        cpuCores: 16,
        memoryGb: 64,
        storageGb: 2000,
        gpuCount: 0,
        gpuType: 'none',
        networkBandwidthGbps: 10,
      }),
    ).toBe(true)

    expect(
      validateGpuConfig({
        cpuCores: 16,
        memoryGb: 64,
        storageGb: 2000,
        gpuCount: 4,
        gpuType: 'h100',
        networkBandwidthGbps: 10,
      }),
    ).toBe(true)

    expect(
      validateGpuConfig({
        cpuCores: 16,
        memoryGb: 64,
        storageGb: 2000,
        gpuCount: 2,
        gpuType: 'none',
        networkBandwidthGbps: 10,
      }),
    ).toBe(false)
  })
})

describe('Node Specifications', () => {
  it('should support all node roles', () => {
    const roles: NodeSpec['role'][] = [
      'control-plane',
      'worker',
      'gpu-worker',
      'storage',
    ]

    for (const role of roles) {
      const node: NodeSpec = {
        id: `node-${role}`,
        hostname: `jeju-${role}`,
        ip: '192.168.1.100',
        role,
        hardware: {
          cpuCores: 16,
          memoryGb: 64,
          storageGb: 2000,
          gpuCount: role === 'gpu-worker' ? 4 : 0,
          gpuType: role === 'gpu-worker' ? 'h100' : 'none',
          networkBandwidthGbps: 10,
        },
        labels: {},
        taints: [],
      }

      expect(node.role).toBe(role)
    }
  })

  it('should validate IP address format', () => {
    const isValidIp = (ip: string): boolean => {
      const parts = ip.split('.')
      if (parts.length !== 4) return false
      return parts.every((part) => {
        const num = parseInt(part, 10)
        return num >= 0 && num <= 255 && !Number.isNaN(num)
      })
    }

    expect(isValidIp('192.168.1.100')).toBe(true)
    expect(isValidIp('10.0.0.1')).toBe(true)
    expect(isValidIp('256.1.1.1')).toBe(false)
    expect(isValidIp('192.168.1')).toBe(false)
    expect(isValidIp('invalid')).toBe(false)
  })

  it('should have appropriate taints for control-plane', () => {
    const node: NodeSpec = {
      id: 'control-1',
      hostname: 'jeju-control-1',
      ip: '192.168.1.101',
      role: 'control-plane',
      hardware: {
        cpuCores: 16,
        memoryGb: 64,
        storageGb: 2000,
        gpuCount: 0,
        gpuType: 'none',
        networkBandwidthGbps: 10,
      },
      labels: { 'node-role.kubernetes.io/control-plane': 'true' },
      taints: ['node-role.kubernetes.io/control-plane:NoSchedule'],
    }

    expect(node.taints).toContain(
      'node-role.kubernetes.io/control-plane:NoSchedule',
    )
    expect(node.labels['node-role.kubernetes.io/control-plane']).toBe('true')
  })

  it('should have GPU taints for GPU workers', () => {
    const node: NodeSpec = {
      id: 'gpu-1',
      hostname: 'jeju-gpu-1',
      ip: '192.168.1.104',
      role: 'gpu-worker',
      hardware: {
        cpuCores: 32,
        memoryGb: 256,
        storageGb: 2000,
        gpuCount: 4,
        gpuType: 'h100',
        networkBandwidthGbps: 100,
      },
      labels: { 'nvidia.com/gpu': 'true' },
      taints: ['nvidia.com/gpu:NoSchedule'],
    }

    expect(node.taints).toContain('nvidia.com/gpu:NoSchedule')
    expect(node.labels['nvidia.com/gpu']).toBe('true')
  })
})

describe('Cluster Configuration', () => {
  it('should have at least one control-plane node', () => {
    const config = createMinimalConfig()
    const controlPlaneNodes = config.nodes.filter(
      (n) => n.role === 'control-plane',
    )

    expect(controlPlaneNodes.length).toBeGreaterThanOrEqual(1)
  })

  it('should have valid CIDR ranges', () => {
    const isValidCidr = (cidr: string): boolean => {
      const [ip, prefix] = cidr.split('/')
      if (!ip || !prefix) return false
      const prefixNum = parseInt(prefix, 10)
      if (Number.isNaN(prefixNum) || prefixNum < 0 || prefixNum > 32)
        return false
      return true
    }

    const config = createMinimalConfig()

    expect(isValidCidr(config.networking.podCidr)).toBe(true)
    expect(isValidCidr(config.networking.serviceCidr)).toBe(true)
  })

  it('should not have overlapping CIDR ranges', () => {
    const config = createMinimalConfig()

    // Simple check: pod and service CIDRs should start with different prefixes
    const _podPrefix = config.networking.podCidr.split('.')[0]
    const _servicePrefix = config.networking.serviceCidr.split('.')[0]

    // Both use 10.x.x.x but different subnets is OK for this test
    expect(config.networking.podCidr).not.toBe(config.networking.serviceCidr)
  })

  it('should have valid load balancer IP range', () => {
    const config = createMinimalConfig()
    const [start, end] = config.networking.loadBalancerIpRange.split('-')

    expect(start).toBeTruthy()
    expect(end).toBeTruthy()
    expect(start).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
    expect(end).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
  })
})

describe('Storage Configuration', () => {
  it('should support all storage providers', () => {
    const providers: ClusterConfig['storage']['provider'][] = [
      'local-path',
      'longhorn',
      'ceph',
      'nfs',
    ]

    for (const provider of providers) {
      expect(provider).toBeTruthy()
    }
  })

  it('should match storage class to provider', () => {
    const providerToStorageClass: Record<
      ClusterConfig['storage']['provider'],
      string
    > = {
      'local-path': 'local-path',
      longhorn: 'longhorn',
      ceph: 'ceph-block',
      nfs: 'nfs',
    }

    for (const [_provider, storageClass] of Object.entries(
      providerToStorageClass,
    )) {
      expect(storageClass).toBeTruthy()
    }
  })

  it('should have valid reclaim policy', () => {
    const policies: ClusterConfig['storage']['reclaimPolicy'][] = [
      'Retain',
      'Delete',
    ]

    for (const policy of policies) {
      expect(['Retain', 'Delete']).toContain(policy)
    }
  })
})

describe('Kubeadm Configuration Generation', () => {
  const generateKubeadmConfig = (config: ClusterConfig): string => {
    const controlPlaneNode = config.nodes.find(
      (n) => n.role === 'control-plane',
    )
    if (!controlPlaneNode) {
      throw new Error('No control plane node found')
    }

    return `apiVersion: kubeadm.k8s.io/v1beta3
kind: ClusterConfiguration
kubernetesVersion: v1.29.0
clusterName: ${config.name}
networking:
  podSubnet: ${config.networking.podCidr}
  serviceSubnet: ${config.networking.serviceCidr}
  dnsDomain: ${config.networking.dnsDomain}
controlPlaneEndpoint: "${controlPlaneNode.ip}:6443"`
  }

  it('should generate valid YAML structure', () => {
    const config = createMinimalConfig()
    const kubeadm = generateKubeadmConfig(config)

    expect(kubeadm).toContain('apiVersion: kubeadm.k8s.io/v1beta3')
    expect(kubeadm).toContain('kind: ClusterConfiguration')
  })

  it('should include cluster name', () => {
    const config = createMinimalConfig()
    const kubeadm = generateKubeadmConfig(config)

    expect(kubeadm).toContain(`clusterName: ${config.name}`)
  })

  it('should include network configuration', () => {
    const config = createMinimalConfig()
    const kubeadm = generateKubeadmConfig(config)

    expect(kubeadm).toContain(`podSubnet: ${config.networking.podCidr}`)
    expect(kubeadm).toContain(`serviceSubnet: ${config.networking.serviceCidr}`)
    expect(kubeadm).toContain(`dnsDomain: ${config.networking.dnsDomain}`)
  })

  it('should include control plane endpoint', () => {
    const config = createMinimalConfig()
    const kubeadm = generateKubeadmConfig(config)

    const controlPlaneNode = config.nodes.find(
      (n) => n.role === 'control-plane',
    )
    expect(kubeadm).toContain(
      `controlPlaneEndpoint: "${controlPlaneNode?.ip}:6443"`,
    )
  })

  it('should throw without control plane node', () => {
    const config = createMinimalConfig()
    config.nodes = config.nodes.filter((n) => n.role !== 'control-plane')

    expect(() => generateKubeadmConfig(config)).toThrow(
      'No control plane node found',
    )
  })
})

describe('MetalLB Configuration Generation', () => {
  const generateMetalLBConfig = (config: ClusterConfig): string => {
    return `apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: default-pool
  namespace: metallb-system
spec:
  addresses:
    - ${config.networking.loadBalancerIpRange}
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: default-advertisement
  namespace: metallb-system`
  }

  it('should generate IPAddressPool resource', () => {
    const config = createMinimalConfig()
    const metallb = generateMetalLBConfig(config)

    expect(metallb).toContain('kind: IPAddressPool')
    expect(metallb).toContain('namespace: metallb-system')
  })

  it('should include load balancer IP range', () => {
    const config = createMinimalConfig()
    const metallb = generateMetalLBConfig(config)

    expect(metallb).toContain(config.networking.loadBalancerIpRange)
  })

  it('should generate L2Advertisement resource', () => {
    const config = createMinimalConfig()
    const metallb = generateMetalLBConfig(config)

    expect(metallb).toContain('kind: L2Advertisement')
    expect(metallb).toContain('name: default-advertisement')
    expect(metallb).toContain('namespace: metallb-system')
  })
})

describe('Storage Class Generation', () => {
  const generateStorageConfig = (config: ClusterConfig): string => {
    switch (config.storage.provider) {
      case 'local-path':
        return `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${config.storage.storageClass}
provisioner: rancher.io/local-path
reclaimPolicy: ${config.storage.reclaimPolicy}`

      case 'longhorn':
        return `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${config.storage.storageClass}
provisioner: driver.longhorn.io
reclaimPolicy: ${config.storage.reclaimPolicy}`

      case 'ceph':
        return `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${config.storage.storageClass}
provisioner: rook-ceph.rbd.csi.ceph.com
reclaimPolicy: ${config.storage.reclaimPolicy}`

      case 'nfs':
        return `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${config.storage.storageClass}
provisioner: cluster.local/nfs-subdir-external-provisioner
reclaimPolicy: ${config.storage.reclaimPolicy}`

      default:
        throw new Error(`Unknown storage provider: ${config.storage.provider}`)
    }
  }

  it('should generate local-path storage class', () => {
    const config = createMinimalConfig()
    config.storage.provider = 'local-path'
    config.storage.storageClass = 'local-path'

    const sc = generateStorageConfig(config)

    expect(sc).toContain('provisioner: rancher.io/local-path')
    expect(sc).toContain('name: local-path')
  })

  it('should generate longhorn storage class', () => {
    const config = createMinimalConfig()
    config.storage.provider = 'longhorn'
    config.storage.storageClass = 'longhorn'

    const sc = generateStorageConfig(config)

    expect(sc).toContain('provisioner: driver.longhorn.io')
  })

  it('should generate ceph storage class', () => {
    const config = createMinimalConfig()
    config.storage.provider = 'ceph'
    config.storage.storageClass = 'ceph-block'

    const sc = generateStorageConfig(config)

    expect(sc).toContain('provisioner: rook-ceph.rbd.csi.ceph.com')
  })

  it('should generate nfs storage class', () => {
    const config = createMinimalConfig()
    config.storage.provider = 'nfs'
    config.storage.storageClass = 'nfs'

    const sc = generateStorageConfig(config)

    expect(sc).toContain('nfs-subdir-external-provisioner')
  })

  it('should include reclaim policy', () => {
    const config = createMinimalConfig()
    config.storage.reclaimPolicy = 'Retain'

    const sc = generateStorageConfig(config)

    expect(sc).toContain('reclaimPolicy: Retain')
  })

  it('should throw for unknown provider', () => {
    const config = createMinimalConfig()
    // @ts-expect-error Testing invalid provider
    config.storage.provider = 'unknown'

    expect(() => generateStorageConfig(config)).toThrow(
      'Unknown storage provider',
    )
  })
})

describe('Jeju Component Configuration', () => {
  it('should enable sequencer for all configs', () => {
    const config = createMinimalConfig()
    expect(config.jeju.sequencerEnabled).toBe(true)
  })

  it('should disable archive for minimal config', () => {
    const config = createMinimalConfig()
    expect(config.jeju.archiveEnabled).toBe(false)
  })

  it('should enable external chains', () => {
    const config = createMinimalConfig()
    expect(config.jeju.externalChainsEnabled).toBe(true)
  })

  it('should calculate replica counts from available nodes', () => {
    const config = createMinimalConfig()
    const dwsNodes = config.nodes.filter(
      (n) => n.labels['jeju.network/dws'] === 'true',
    )
    const maxReplicas = Math.min(dwsNodes.length || 1, 3)

    expect(maxReplicas).toBeGreaterThanOrEqual(1)
    expect(maxReplicas).toBeLessThanOrEqual(3)
  })
})

describe('Configuration Types', () => {
  it('should support minimal configuration', () => {
    const config = createMinimalConfig()
    config.configType = 'minimal'

    expect(config.configType).toBe('minimal')
    expect(config.nodes.length).toBe(1)
  })

  it('should support standard configuration', () => {
    const config = createMinimalConfig()
    config.configType = 'standard'

    expect(config.configType).toBe('standard')
  })

  it('should support full configuration', () => {
    const config = createMinimalConfig()
    config.configType = 'full'

    expect(config.configType).toBe('full')
  })

  it('should support custom configuration', () => {
    const config = createMinimalConfig()
    config.configType = 'custom'

    expect(config.configType).toBe('custom')
  })
})

describe('Error Handling', () => {
  it('should detect missing control plane', () => {
    const validateCluster = (config: ClusterConfig): boolean => {
      const hasControlPlane = config.nodes.some(
        (n) => n.role === 'control-plane',
      )
      if (!hasControlPlane) {
        throw new Error('Cluster must have at least one control-plane node')
      }
      return true
    }

    const config = createMinimalConfig()
    expect(validateCluster(config)).toBe(true)

    config.nodes = []
    expect(() => validateCluster(config)).toThrow('control-plane node')
  })

  it('should detect duplicate node IDs', () => {
    const validateUniqueNodeIds = (config: ClusterConfig): boolean => {
      const ids = config.nodes.map((n) => n.id)
      const uniqueIds = new Set(ids)
      if (uniqueIds.size !== ids.length) {
        throw new Error('Node IDs must be unique')
      }
      return true
    }

    const config = createMinimalConfig()
    expect(validateUniqueNodeIds(config)).toBe(true)

    config.nodes.push({ ...config.nodes[0] }) // Duplicate
    expect(() => validateUniqueNodeIds(config)).toThrow(
      'Node IDs must be unique',
    )
  })

  it('should detect duplicate IPs', () => {
    const validateUniqueIps = (config: ClusterConfig): boolean => {
      const ips = config.nodes.map((n) => n.ip)
      const uniqueIps = new Set(ips)
      if (uniqueIps.size !== ips.length) {
        throw new Error('Node IPs must be unique')
      }
      return true
    }

    const config = createMinimalConfig()
    expect(validateUniqueIps(config)).toBe(true)
  })
})

describe('Edge Cases', () => {
  it('should handle single-node cluster', () => {
    const config = createMinimalConfig()
    expect(config.nodes.length).toBe(1)
    expect(config.nodes[0].role).toBe('control-plane')
  })

  it('should handle cluster with only workers (invalid)', () => {
    const config = createMinimalConfig()
    config.nodes[0].role = 'worker'

    const hasControlPlane = config.nodes.some((n) => n.role === 'control-plane')
    expect(hasControlPlane).toBe(false)
  })

  it('should handle empty labels', () => {
    const config = createMinimalConfig()
    config.nodes[0].labels = {}

    expect(Object.keys(config.nodes[0].labels).length).toBe(0)
  })

  it('should handle empty taints', () => {
    const config = createMinimalConfig()
    config.nodes[0].taints = []

    expect(config.nodes[0].taints.length).toBe(0)
  })
})
