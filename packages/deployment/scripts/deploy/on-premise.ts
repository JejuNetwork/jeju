#!/usr/bin/env bun
/**
 * On-Premise Deployment Infrastructure
 *
 * Deploys and manages a complete Jeju network on local/on-premise hardware.
 * Supports single large servers or small co-located clusters.
 *
 * Hardware Configurations:
 * - Minimal: Single server (32 cores, 128GB RAM, 4TB NVMe, 1x A100)
 * - Standard: 3-node cluster (each: 16 cores, 64GB RAM, 2TB NVMe)
 * - Full: 5-node cluster with GPU nodes for TEE/ML workloads
 *
 * Usage:
 *   bun run scripts/deploy/on-premise.ts init --config minimal
 *   bun run scripts/deploy/on-premise.ts deploy
 *   bun run scripts/deploy/on-premise.ts status
 *   bun run scripts/deploy/on-premise.ts upgrade
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const ROOT = join(import.meta.dir, '../../../..')
const DEPLOYMENTS_DIR = join(ROOT, 'packages/deployment/on-premise')
const KUBERNETES_DIR = join(ROOT, 'packages/deployment/kubernetes')

// Hardware specification types
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

// Predefined hardware configurations
const HARDWARE_CONFIGS: Record<string, ClusterConfig> = {
  minimal: {
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
          'jeju.network/dws': 'true',
          'jeju.network/gpu': 'true',
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
      archiveEnabled: false, // Archive needs more storage
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
  },

  standard: {
    name: 'jeju-cluster',
    configType: 'standard',
    nodes: [
      {
        id: 'node-1',
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
        labels: {
          'node-role.kubernetes.io/control-plane': 'true',
          'jeju.network/sequencer': 'true',
        },
        taints: ['node-role.kubernetes.io/control-plane:NoSchedule'],
      },
      {
        id: 'node-2',
        hostname: 'jeju-worker-1',
        ip: '192.168.1.102',
        role: 'worker',
        hardware: {
          cpuCores: 16,
          memoryGb: 64,
          storageGb: 2000,
          gpuCount: 0,
          gpuType: 'none',
          networkBandwidthGbps: 10,
        },
        labels: {
          'jeju.network/dws': 'true',
          'jeju.network/rpc': 'true',
        },
        taints: [],
      },
      {
        id: 'node-3',
        hostname: 'jeju-worker-2',
        ip: '192.168.1.103',
        role: 'worker',
        hardware: {
          cpuCores: 16,
          memoryGb: 64,
          storageGb: 2000,
          gpuCount: 0,
          gpuType: 'none',
          networkBandwidthGbps: 10,
        },
        labels: {
          'jeju.network/dws': 'true',
          'jeju.network/ipfs': 'true',
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
      provider: 'longhorn',
      storageClass: 'longhorn',
      reclaimPolicy: 'Retain',
    },
    jeju: {
      chainId: 420690,
      networkName: 'jeju-cluster',
      sequencerEnabled: true,
      rpcEnabled: true,
      archiveEnabled: true,
      dwsEnabled: true,
      ipfsEnabled: true,
      teeEnabled: false, // TEE needs GPU nodes
      externalChainsEnabled: true,
    },
    registry: {
      internal: true,
      address: '192.168.1.101:5000',
      username: 'admin',
      passwordFile: '/etc/jeju/registry-password',
    },
  },

  full: {
    name: 'jeju-full',
    configType: 'full',
    nodes: [
      {
        id: 'node-1',
        hostname: 'jeju-control-1',
        ip: '192.168.1.101',
        role: 'control-plane',
        hardware: {
          cpuCores: 16,
          memoryGb: 64,
          storageGb: 500,
          gpuCount: 0,
          gpuType: 'none',
          networkBandwidthGbps: 25,
        },
        labels: {
          'node-role.kubernetes.io/control-plane': 'true',
        },
        taints: ['node-role.kubernetes.io/control-plane:NoSchedule'],
      },
      {
        id: 'node-2',
        hostname: 'jeju-sequencer-1',
        ip: '192.168.1.102',
        role: 'worker',
        hardware: {
          cpuCores: 32,
          memoryGb: 128,
          storageGb: 4000,
          gpuCount: 0,
          gpuType: 'none',
          networkBandwidthGbps: 25,
        },
        labels: {
          'jeju.network/sequencer': 'true',
          'jeju.network/rpc': 'true',
        },
        taints: [],
      },
      {
        id: 'node-3',
        hostname: 'jeju-dws-1',
        ip: '192.168.1.103',
        role: 'worker',
        hardware: {
          cpuCores: 32,
          memoryGb: 128,
          storageGb: 2000,
          gpuCount: 0,
          gpuType: 'none',
          networkBandwidthGbps: 25,
        },
        labels: {
          'jeju.network/dws': 'true',
        },
        taints: [],
      },
      {
        id: 'node-4',
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
        labels: {
          'jeju.network/gpu': 'true',
          'jeju.network/tee': 'true',
          'nvidia.com/gpu': 'true',
        },
        taints: ['nvidia.com/gpu:NoSchedule'],
      },
      {
        id: 'node-5',
        hostname: 'jeju-storage-1',
        ip: '192.168.1.105',
        role: 'storage',
        hardware: {
          cpuCores: 16,
          memoryGb: 64,
          storageGb: 20000,
          gpuCount: 0,
          gpuType: 'none',
          networkBandwidthGbps: 25,
        },
        labels: {
          'jeju.network/storage': 'true',
          'jeju.network/ipfs': 'true',
          'jeju.network/archive': 'true',
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
      provider: 'ceph',
      storageClass: 'ceph-block',
      reclaimPolicy: 'Retain',
    },
    jeju: {
      chainId: 420690,
      networkName: 'jeju-full',
      sequencerEnabled: true,
      rpcEnabled: true,
      archiveEnabled: true,
      dwsEnabled: true,
      ipfsEnabled: true,
      teeEnabled: true,
      externalChainsEnabled: true,
    },
    registry: {
      internal: true,
      address: '192.168.1.101:5000',
      username: 'admin',
      passwordFile: '/etc/jeju/registry-password',
    },
  },
}

/**
 * Load cluster configuration
 */
function loadConfig(): ClusterConfig | null {
  const configFile = join(DEPLOYMENTS_DIR, 'cluster-config.json')
  if (existsSync(configFile)) {
    return JSON.parse(readFileSync(configFile, 'utf-8'))
  }
  return null
}

/**
 * Save cluster configuration
 */
function saveConfig(config: ClusterConfig): void {
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true })
  }
  const configFile = join(DEPLOYMENTS_DIR, 'cluster-config.json')
  writeFileSync(configFile, JSON.stringify(config, null, 2))
}

/**
 * Generate kubeadm configuration
 */
function generateKubeadmConfig(config: ClusterConfig): string {
  const controlPlaneNode = config.nodes.find((n) => n.role === 'control-plane')
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
controlPlaneEndpoint: "${controlPlaneNode.ip}:6443"
apiServer:
  certSANs:
    - "${controlPlaneNode.ip}"
    - "${controlPlaneNode.hostname}"
    - "localhost"
    - "127.0.0.1"
  extraArgs:
    authorization-mode: Node,RBAC
    enable-admission-plugins: NodeRestriction
controllerManager:
  extraArgs:
    bind-address: "0.0.0.0"
scheduler:
  extraArgs:
    bind-address: "0.0.0.0"
---
apiVersion: kubeadm.k8s.io/v1beta3
kind: InitConfiguration
nodeRegistration:
  criSocket: unix:///var/run/containerd/containerd.sock
  imagePullPolicy: IfNotPresent
  kubeletExtraArgs:
    node-labels: ${Object.entries(controlPlaneNode.labels)
      .map(([k, v]) => `${k}=${v}`)
      .join(',')}
${
  controlPlaneNode.taints.length > 0
    ? `  taints:
${controlPlaneNode.taints.map((t) => `    - "${t}"`).join('\n')}`
    : ''
}
---
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
cgroupDriver: systemd
containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock
`
}

/**
 * Generate worker join configuration
 */
function generateWorkerConfig(
  node: NodeSpec,
  joinToken: string,
  caCertHash: string,
  controlPlaneIp: string,
): string {
  return `apiVersion: kubeadm.k8s.io/v1beta3
kind: JoinConfiguration
discovery:
  bootstrapToken:
    apiServerEndpoint: "${controlPlaneIp}:6443"
    token: "${joinToken}"
    caCertHashes:
      - "${caCertHash}"
nodeRegistration:
  criSocket: unix:///var/run/containerd/containerd.sock
  imagePullPolicy: IfNotPresent
  name: ${node.hostname}
  kubeletExtraArgs:
    node-labels: ${Object.entries(node.labels)
      .map(([k, v]) => `${k}=${v}`)
      .join(',')}
${
  node.taints.length > 0
    ? `  taints:
${node.taints.map((t) => `    - "${t}"`).join('\n')}`
    : ''
}
`
}

/**
 * Generate MetalLB configuration for bare-metal load balancing
 */
function generateMetalLBConfig(config: ClusterConfig): string {
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
  namespace: metallb-system
spec:
  ipAddressPools:
    - default-pool
`
}

/**
 * Generate storage class configuration
 */
function generateStorageConfig(config: ClusterConfig): string {
  switch (config.storage.provider) {
    case 'local-path':
      return `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${config.storage.storageClass}
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: rancher.io/local-path
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: ${config.storage.reclaimPolicy}
`

    case 'longhorn':
      return `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${config.storage.storageClass}
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: driver.longhorn.io
allowVolumeExpansion: true
reclaimPolicy: ${config.storage.reclaimPolicy}
volumeBindingMode: Immediate
parameters:
  numberOfReplicas: "2"
  staleReplicaTimeout: "2880"
  fromBackup: ""
  fsType: "ext4"
`

    case 'ceph':
      return `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${config.storage.storageClass}
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: rook-ceph.rbd.csi.ceph.com
parameters:
  clusterID: rook-ceph
  pool: replicapool
  imageFormat: "2"
  imageFeatures: layering
  csi.storage.k8s.io/provisioner-secret-name: rook-csi-rbd-provisioner
  csi.storage.k8s.io/provisioner-secret-namespace: rook-ceph
  csi.storage.k8s.io/controller-expand-secret-name: rook-csi-rbd-provisioner
  csi.storage.k8s.io/controller-expand-secret-namespace: rook-ceph
  csi.storage.k8s.io/node-stage-secret-name: rook-csi-rbd-node
  csi.storage.k8s.io/node-stage-secret-namespace: rook-ceph
  csi.storage.k8s.io/fstype: ext4
allowVolumeExpansion: true
reclaimPolicy: ${config.storage.reclaimPolicy}
`

    case 'nfs':
      return `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${config.storage.storageClass}
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: cluster.local/nfs-subdir-external-provisioner
parameters:
  archiveOnDelete: "false"
allowVolumeExpansion: true
reclaimPolicy: ${config.storage.reclaimPolicy}
`

    default:
      throw new Error(`Unknown storage provider: ${config.storage.provider}`)
  }
}

/**
 * Generate Jeju helmfile values for on-premise
 */
function generateJejuValues(config: ClusterConfig): string {
  const controlPlaneNode = config.nodes.find((n) => n.role === 'control-plane')
  if (!controlPlaneNode) {
    throw new Error('No control plane node found')
  }

  return `# On-Premise Jeju Configuration
# Generated for: ${config.name}

environment: on-premise
cluster_name: ${config.name}

# Ingress via MetalLB
ingress_enabled: true
cert_manager_enabled: true
ingress_class: nginx

# Node selectors for component placement
node_selectors:
  sequencer:
    jeju.network/sequencer: "true"
  rpc:
    jeju.network/rpc: "true"
  dws:
    jeju.network/dws: "true"
  ipfs:
    jeju.network/ipfs: "true"
  gpu:
    jeju.network/gpu: "true"
  storage:
    jeju.network/storage: "true"

# Replicas based on available nodes
replicas:
  op_node: ${config.jeju.sequencerEnabled ? 1 : 0}
  sequencer: ${config.jeju.sequencerEnabled ? 1 : 0}
  rpc: ${config.jeju.rpcEnabled ? Math.min(config.nodes.filter((n) => n.role === 'worker').length, 2) : 0}
  archive: ${config.jeju.archiveEnabled ? 1 : 0}
  batcher: 1
  proposer: 1
  challenger: 1
  jeju_da: 1
  bundler: 1
  crucible: 1
  gateway: 1

# Resource allocations (scaled to available hardware)
resources:
  op_node:
    limits:
      cpu: 2000m
      memory: 4Gi
    requests:
      cpu: 1000m
      memory: 2Gi
  sequencer:
    limits:
      cpu: 4000m
      memory: 16Gi
    requests:
      cpu: 2000m
      memory: 8Gi
  rpc:
    limits:
      cpu: 2000m
      memory: 8Gi
    requests:
      cpu: 1000m
      memory: 4Gi
  archive:
    limits:
      cpu: 4000m
      memory: 32Gi
    requests:
      cpu: 2000m
      memory: 16Gi

# Persistence configuration
persistence:
  enabled: true
  storage_class: ${config.storage.storageClass}
  sizes:
    op_node: 100Gi
    sequencer: 500Gi
    rpc: 500Gi
    archive: 2Ti
    challenger: 50Gi

# No auto-scaling for on-premise
autoscaling:
  enabled: false

# Local L1 (Anvil fork for testing, or external for production)
l1_rpc_url: http://anvil.jeju-system:8545
l1_chain_id: "11155111"
l2_chain_id: "${config.jeju.chainId}"

# Internal domains
domain_name: ${config.name}.local
rpc_domain: rpc.${config.name}.local
ws_domain: ws.${config.name}.local
dws_domain: dws.${config.name}.local
jeju_rpc_url: http://rpc.${config.name}.local

# Rate limiting (relaxed for local)
rate_limit:
  enabled: false

# DWS Configuration
dws:
  enabled: ${config.jeju.dwsEnabled}
  replicas: ${Math.min(config.nodes.filter((n) => n.labels['jeju.network/dws'] === 'true').length, 3)}
  resources:
    limits:
      cpu: 2000m
      memory: 4Gi
    requests:
      cpu: 500m
      memory: 1Gi
  persistence:
    size: 100Gi
  
  # TEE Configuration
  tee:
    enabled: ${config.jeju.teeEnabled}
    provider: ${config.nodes.some((n) => n.hardware.gpuType !== 'none') ? 'intel_tdx' : 'none'}
    attestation_required: false
  
  # External chain nodes
  external_chains:
    ethereum:
      enabled: ${config.jeju.externalChainsEnabled}
      mode: anvil_fork
      tee_required: false
    arbitrum:
      enabled: ${config.jeju.externalChainsEnabled}
      mode: anvil_fork
      tee_required: false
    optimism:
      enabled: ${config.jeju.externalChainsEnabled}
      mode: anvil_fork
      tee_required: false
    base:
      enabled: ${config.jeju.externalChainsEnabled}
      mode: anvil_fork
      tee_required: false
    solana:
      enabled: ${config.jeju.externalChainsEnabled}
      mode: solana_test_validator
      tee_required: false

# IPFS Configuration
ipfs:
  enabled: ${config.jeju.ipfsEnabled}
  replicas: ${Math.min(config.nodes.filter((n) => n.labels['jeju.network/ipfs'] === 'true').length, 2)}
  storage:
    size: 500Gi

# Container Registry
registry:
  internal: ${config.registry.internal}
  address: ${config.registry.address}
`
}

/**
 * Initialize on-premise cluster configuration
 */
async function initCluster(configType: string): Promise<ClusterConfig> {
  console.log(`\nInitializing ${configType} cluster configuration...`)

  const baseConfig = HARDWARE_CONFIGS[configType]
  if (!baseConfig) {
    throw new Error(
      `Unknown config type: ${configType}. Available: ${Object.keys(HARDWARE_CONFIGS).join(', ')}`,
    )
  }

  // Create deployment directories
  const dirs = [
    DEPLOYMENTS_DIR,
    join(DEPLOYMENTS_DIR, 'kubeadm'),
    join(DEPLOYMENTS_DIR, 'manifests'),
    join(DEPLOYMENTS_DIR, 'values'),
    join(DEPLOYMENTS_DIR, 'scripts'),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  // Generate configuration files
  console.log('  Generating kubeadm configuration...')
  const kubeadmConfig = generateKubeadmConfig(baseConfig)
  writeFileSync(
    join(DEPLOYMENTS_DIR, 'kubeadm', 'cluster-config.yaml'),
    kubeadmConfig,
  )

  console.log('  Generating MetalLB configuration...')
  const metallbConfig = generateMetalLBConfig(baseConfig)
  writeFileSync(
    join(DEPLOYMENTS_DIR, 'manifests', 'metallb-config.yaml'),
    metallbConfig,
  )

  console.log('  Generating storage configuration...')
  const storageConfig = generateStorageConfig(baseConfig)
  writeFileSync(
    join(DEPLOYMENTS_DIR, 'manifests', 'storage-class.yaml'),
    storageConfig,
  )

  console.log('  Generating Jeju values...')
  const jejuValues = generateJejuValues(baseConfig)
  writeFileSync(join(DEPLOYMENTS_DIR, 'values', 'on-premise.yaml'), jejuValues)

  // Generate bootstrap script
  console.log('  Generating bootstrap scripts...')
  generateBootstrapScripts(baseConfig)

  saveConfig(baseConfig)

  console.log(`\n  Configuration saved to: ${DEPLOYMENTS_DIR}`)
  console.log(`
  Next steps:
  1. Review and customize the configuration in ${DEPLOYMENTS_DIR}/cluster-config.json
  2. Ensure all nodes have SSH access and required packages installed
  3. Run 'bun run scripts/deploy/on-premise.ts deploy' to deploy the cluster
`)

  return baseConfig
}

/**
 * Generate bootstrap scripts for nodes
 */
function generateBootstrapScripts(config: ClusterConfig): void {
  // Pre-requisites script
  const prereqScript = `#!/bin/bash
set -e

echo "Installing Jeju node prerequisites..."

# Update system
apt-get update
apt-get upgrade -y

# Install required packages
apt-get install -y \\
  apt-transport-https \\
  ca-certificates \\
  curl \\
  gnupg \\
  lsb-release \\
  ntp \\
  jq \\
  git

# Install containerd
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y containerd.io

# Configure containerd
mkdir -p /etc/containerd
containerd config default | tee /etc/containerd/config.toml > /dev/null
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/g' /etc/containerd/config.toml
systemctl restart containerd
systemctl enable containerd

# Install kubeadm, kubelet, kubectl
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.29/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /' | tee /etc/apt/sources.list.d/kubernetes.list > /dev/null
apt-get update
apt-get install -y kubelet kubeadm kubectl
apt-mark hold kubelet kubeadm kubectl

# Enable kernel modules
modprobe overlay
modprobe br_netfilter

cat <<EOF | tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF

cat <<EOF | tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF

sysctl --system

# Disable swap
swapoff -a
sed -i '/ swap / s/^\\(.*\\)$/#\\1/g' /etc/fstab

echo "Prerequisites installed successfully."
`

  writeFileSync(
    join(DEPLOYMENTS_DIR, 'scripts', 'install-prerequisites.sh'),
    prereqScript,
  )

  // Control plane init script
  const controlPlaneNode = config.nodes.find((n) => n.role === 'control-plane')
  if (controlPlaneNode) {
    const initScript = `#!/bin/bash
set -e

echo "Initializing Kubernetes control plane..."

# Initialize cluster
kubeadm init --config /etc/jeju/kubeadm/cluster-config.yaml

# Configure kubectl for root
mkdir -p $HOME/.kube
cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
chown $(id -u):$(id -g) $HOME/.kube/config

# Install Calico CNI
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.26.1/manifests/calico.yaml

# Install MetalLB
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.13.12/config/manifests/metallb-native.yaml
sleep 30  # Wait for MetalLB pods
kubectl apply -f /etc/jeju/manifests/metallb-config.yaml

# Install storage provisioner
${
  config.storage.provider === 'local-path'
    ? 'kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.26/deploy/local-path-storage.yaml'
    : config.storage.provider === 'longhorn'
      ? 'kubectl apply -f https://raw.githubusercontent.com/longhorn/longhorn/v1.5.3/deploy/longhorn.yaml'
      : '# Ceph/NFS requires manual setup'
}

# Apply storage class
kubectl apply -f /etc/jeju/manifests/storage-class.yaml

# Generate join command for workers
kubeadm token create --print-join-command > /etc/jeju/join-command.sh
chmod 600 /etc/jeju/join-command.sh

echo "Control plane initialized."
echo "Worker join command saved to /etc/jeju/join-command.sh"
`

    writeFileSync(
      join(DEPLOYMENTS_DIR, 'scripts', 'init-control-plane.sh'),
      initScript,
    )
  }

  // Worker join script
  const workerScript = `#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <control-plane-ip>"
  exit 1
fi

CONTROL_PLANE_IP=$1

echo "Joining cluster as worker node..."

# Fetch join command from control plane
scp root@$CONTROL_PLANE_IP:/etc/jeju/join-command.sh /tmp/join-command.sh

# Join cluster
bash /tmp/join-command.sh

echo "Worker node joined cluster."
`

  writeFileSync(
    join(DEPLOYMENTS_DIR, 'scripts', 'join-worker.sh'),
    workerScript,
  )

  // GPU node setup script
  const gpuNodes = config.nodes.filter((n) => n.hardware.gpuCount > 0)
  if (gpuNodes.length > 0) {
    const gpuScript = `#!/bin/bash
set -e

echo "Setting up GPU node..."

# Install NVIDIA drivers
apt-get install -y linux-headers-$(uname -r)
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \\
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \\
  tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

apt-get update
apt-get install -y nvidia-driver-535 nvidia-container-toolkit

# Configure containerd for NVIDIA
nvidia-ctk runtime configure --runtime=containerd
systemctl restart containerd

# Install NVIDIA device plugin
kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.3/nvidia-device-plugin.yml

echo "GPU node setup complete."
`

    writeFileSync(
      join(DEPLOYMENTS_DIR, 'scripts', 'setup-gpu-node.sh'),
      gpuScript,
    )
  }

  // Make scripts executable using find to handle glob expansion
  const scriptsDir = join(DEPLOYMENTS_DIR, 'scripts')
  execSync(`find "${scriptsDir}" -name "*.sh" -exec chmod +x {} \\;`, {
    encoding: 'utf-8',
    shell: '/bin/sh',
  })
}

/**
 * Deploy Jeju to on-premise cluster
 */
async function deployJeju(config: ClusterConfig): Promise<void> {
  console.log('\nDeploying Jeju to on-premise cluster...')

  // Verify cluster is ready
  console.log('  Verifying cluster status...')
  execSync('kubectl cluster-info', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  console.log('    Cluster is ready')

  // Deploy cert-manager first
  console.log('  Deploying cert-manager...')
  execSync(
    'kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.3/cert-manager.yaml',
    { encoding: 'utf-8' },
  )
  execSync(
    'kubectl wait --for=condition=available --timeout=300s deployment/cert-manager -n cert-manager',
    {
      encoding: 'utf-8',
    },
  )

  // Deploy ingress-nginx
  console.log('  Deploying ingress-nginx...')
  execSync(
    'kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.9.5/deploy/static/provider/baremetal/deploy.yaml',
    { encoding: 'utf-8' },
  )
  execSync(
    'kubectl wait --for=condition=available --timeout=300s deployment/ingress-nginx-controller -n ingress-nginx',
    {
      encoding: 'utf-8',
    },
  )

  // Deploy Jeju via helmfile
  console.log('  Deploying Jeju via helmfile...')
  const helmfileDir = join(KUBERNETES_DIR, 'helmfile')
  const valuesFile = join(DEPLOYMENTS_DIR, 'values', 'on-premise.yaml')

  // Copy on-premise values to helmfile environments
  writeFileSync(
    join(helmfileDir, 'environments', 'on-premise.yaml'),
    readFileSync(valuesFile, 'utf-8'),
  )

  // Run helmfile
  execSync(`cd ${helmfileDir} && helmfile -e on-premise apply`, {
    encoding: 'utf-8',
    stdio: 'inherit',
  })

  console.log(`
  Jeju deployment complete.

  Access the cluster:
    RPC:      http://rpc.${config.name}.local
    WS:       ws://ws.${config.name}.local
    DWS:      http://dws.${config.name}.local
    Gateway:  http://gateway.${config.name}.local
`)
}

/**
 * Get cluster status
 */
async function getClusterStatus(_config: ClusterConfig): Promise<void> {
  console.log('\nCluster Status:')

  // Node status
  console.log('\n  Nodes:')
  const nodes = execSync('kubectl get nodes -o wide', { encoding: 'utf-8' })
  console.log(nodes)

  // Pod status
  console.log('\n  Jeju Pods:')
  const pods = execSync('kubectl get pods -n jeju-system -o wide', {
    encoding: 'utf-8',
  })
  console.log(pods)

  // Service status
  console.log('\n  Services:')
  const services = execSync('kubectl get svc -n jeju-system', {
    encoding: 'utf-8',
  })
  console.log(services)

  // PVC status
  console.log('\n  Persistent Volumes:')
  const pvcs = execSync('kubectl get pvc -n jeju-system', { encoding: 'utf-8' })
  console.log(pvcs)
}

/**
 * Main entry point
 */
async function main() {
  const { positionals, values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      config: { type: 'string', short: 'c' },
    },
    allowPositionals: true,
  })

  const command = positionals[0]

  if (values.help || !command) {
    console.log(`
On-Premise Deployment Infrastructure

Usage:
  bun run scripts/deploy/on-premise.ts <command> [options]

Commands:
  init      Initialize cluster configuration
  deploy    Deploy Jeju to cluster
  status    Get cluster status
  upgrade   Upgrade Jeju components

Options:
  --config, -c    Configuration type (minimal, standard, full)
  --help, -h      Show help

Hardware Configurations:
  minimal   Single server (32C, 128GB, 4TB, 1xA100)
  standard  3-node cluster (16C, 64GB, 2TB each)
  full      5-node cluster with GPU and storage nodes
`)
    process.exit(0)
  }

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           JEJU ON-PREMISE DEPLOYMENT                         ║
╠══════════════════════════════════════════════════════════════╣
║  Command: ${command.padEnd(50)}║
╚══════════════════════════════════════════════════════════════╝
`)

  switch (command) {
    case 'init': {
      const configType = values.config || 'minimal'
      await initCluster(configType)
      break
    }

    case 'deploy': {
      const config = loadConfig()
      if (!config) {
        throw new Error('No cluster configuration found. Run "init" first.')
      }
      await deployJeju(config)
      break
    }

    case 'status': {
      const config = loadConfig()
      if (!config) {
        throw new Error('No cluster configuration found. Run "init" first.')
      }
      await getClusterStatus(config)
      break
    }

    case 'upgrade': {
      console.log('Upgrade command not yet implemented.')
      break
    }

    default:
      console.error(`Unknown command: ${command}`)
      process.exit(1)
  }
}

main().catch((error) => {
  console.error('On-premise deployment failed:', error)
  process.exit(1)
})

export {
  initCluster,
  deployJeju,
  getClusterStatus,
  loadConfig,
  saveConfig,
  generateKubeadmConfig,
  generateWorkerConfig,
  generateMetalLBConfig,
  generateStorageConfig,
  generateJejuValues,
  type ClusterConfig,
  type NodeSpec,
  type HardwareSpec,
  HARDWARE_CONFIGS,
}
