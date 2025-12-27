import {
  Box,
  Cloud,
  Container,
  Globe,
  Layers,
  Network,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import {
  useApplyHelmManifests,
  useCreateK3sCluster,
  useDeployWorkerdWorker,
  useHelmDeployments,
  useK3sClusters,
  useMeshHealth,
  useWorkerdWorkers,
} from '../../hooks'
import type {
  HelmDeployment,
  K3sCluster,
  MeshService,
  WorkerdWorker,
} from '../../types'

type TabType = 'clusters' | 'helm' | 'workerd' | 'mesh'

export default function InfrastructurePage() {
  const { isConnected } = useAccount()
  const [activeTab, setActiveTab] = useState<TabType>('clusters')
  const [showCreateModal, setShowCreateModal] = useState(false)

  // API hooks
  const clustersQuery = useK3sClusters()
  const helmQuery = useHelmDeployments()
  const workerdQuery = useWorkerdWorkers()
  const meshQuery = useMeshHealth()

  const clusters = clustersQuery.data?.clusters ?? ([] as K3sCluster[])
  const deployments = helmQuery.data?.deployments ?? ([] as HelmDeployment[])
  const workers = workerdQuery.data?.workers ?? ([] as WorkerdWorker[])
  const meshServices = meshQuery.data?.services ?? ([] as MeshService[])

  const refetchAll = () => {
    clustersQuery.refetch()
    helmQuery.refetch()
    workerdQuery.refetch()
    meshQuery.refetch()
  }

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'clusters', label: 'K8s Clusters', icon: <Cloud size={16} /> },
    { id: 'helm', label: 'Helm Deployments', icon: <Layers size={16} /> },
    { id: 'workerd', label: 'Workerd Workers', icon: <Box size={16} /> },
    { id: 'mesh', label: 'Service Mesh', icon: <Network size={16} /> },
  ]

  return (
    <div>
      <div
        className="page-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 className="page-title">Infrastructure</h1>
          <p className="page-subtitle">
            Manage Kubernetes clusters, Helm deployments, and V8 isolate workers
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={refetchAll}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
            disabled={!isConnected}
          >
            <Plus size={16} /> Create
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Cloud size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">K8s Clusters</div>
            <div className="stat-value">{clusters.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Layers size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Helm Deployments</div>
            <div className="stat-value">{deployments.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Box size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Workerd Workers</div>
            <div className="stat-value">{workers.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div
            className="stat-icon"
            style={{
              background: 'var(--success-soft)',
              color: 'var(--success)',
            }}
          >
            <Network size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Mesh Services</div>
            <div className="stat-value">{meshServices.length}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="tabs"
        style={{
          display: 'flex',
          gap: '0.25rem',
          borderBottom: '1px solid var(--border)',
          marginBottom: '1rem',
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`btn btn-ghost ${activeTab === tab.id ? 'active' : ''}`}
            style={{
              borderBottom:
                activeTab === tab.id ? '2px solid var(--primary)' : 'none',
              borderRadius: 0,
              paddingBottom: '0.75rem',
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="card">
        {activeTab === 'clusters' && (
          <ClustersTab
            clusters={clusters}
            isLoading={clustersQuery.isLoading}
          />
        )}
        {activeTab === 'helm' && (
          <HelmTab deployments={deployments} isLoading={helmQuery.isLoading} />
        )}
        {activeTab === 'workerd' && (
          <WorkerdTab workers={workers} isLoading={workerdQuery.isLoading} />
        )}
        {activeTab === 'mesh' && (
          <MeshTab
            services={meshServices}
            isLoading={meshQuery.isLoading}
            status={meshQuery.data?.status ?? 'unknown'}
          />
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateResourceModal
          activeTab={activeTab}
          onClose={() => setShowCreateModal(false)}
          onCreated={refetchAll}
        />
      )}
    </div>
  )
}

function ClustersTab({
  clusters,
  isLoading,
}: {
  clusters: K3sCluster[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div
        style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}
      >
        <div className="spinner" />
      </div>
    )
  }

  if (clusters.length === 0) {
    return (
      <div className="empty-state">
        <Cloud size={48} />
        <h3>No clusters</h3>
        <p>Create a K3s/K3d cluster to get started</p>
      </div>
    )
  }

  return (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Provider</th>
            <th>Status</th>
            <th>Nodes</th>
            <th>API Endpoint</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {clusters.map((cluster) => (
            <tr key={cluster.name}>
              <td style={{ fontWeight: 500 }}>{cluster.name}</td>
              <td>
                <span className="badge badge-neutral">{cluster.provider}</span>
              </td>
              <td>
                <span
                  className={`badge ${cluster.status === 'running' ? 'badge-success' : cluster.status === 'error' ? 'badge-error' : 'badge-warning'}`}
                >
                  {cluster.status}
                </span>
              </td>
              <td>{cluster.nodes}</td>
              <td
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
              >
                {cluster.apiEndpoint ?? '—'}
              </td>
              <td style={{ display: 'flex', gap: '0.25rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Settings"
                >
                  <Settings size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HelmTab({
  deployments,
  isLoading,
}: {
  deployments: HelmDeployment[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div
        style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}
      >
        <div className="spinner" />
      </div>
    )
  }

  if (deployments.length === 0) {
    return (
      <div className="empty-state">
        <Layers size={48} />
        <h3>No Helm deployments</h3>
        <p>Deploy Kubernetes manifests via the Helm provider</p>
      </div>
    )
  }

  return (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            <th>Release</th>
            <th>Namespace</th>
            <th>Status</th>
            <th>Workers</th>
            <th>Services</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((dep) => (
            <tr key={dep.id}>
              <td style={{ fontWeight: 500 }}>{dep.name}</td>
              <td>
                <span className="badge badge-neutral">{dep.namespace}</span>
              </td>
              <td>
                <span
                  className={`badge ${dep.status === 'running' ? 'badge-success' : dep.status === 'failed' ? 'badge-error' : 'badge-warning'}`}
                >
                  {dep.status}
                </span>
              </td>
              <td>{dep.workers}</td>
              <td>{dep.services}</td>
              <td style={{ display: 'flex', gap: '0.25rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="View"
                >
                  <Container size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WorkerdTab({
  workers,
  isLoading,
}: {
  workers: WorkerdWorker[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div
        style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}
      >
        <div className="spinner" />
      </div>
    )
  }

  if (workers.length === 0) {
    return (
      <div className="empty-state">
        <Box size={48} />
        <h3>No workerd workers</h3>
        <p>Deploy V8 isolate workers (Cloudflare Workers compatible)</p>
      </div>
    )
  }

  return (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Runtime</th>
            <th>Memory</th>
            <th>Invocations</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((worker) => (
            <tr key={worker.id}>
              <td style={{ fontWeight: 500 }}>{worker.name}</td>
              <td>
                <span
                  className={`badge ${worker.status === 'active' ? 'badge-success' : worker.status === 'error' ? 'badge-error' : 'badge-warning'}`}
                >
                  {worker.status}
                </span>
              </td>
              <td>
                <span className="badge badge-neutral">{worker.runtime}</span>
              </td>
              <td>{worker.memoryMb}MB</td>
              <td style={{ fontFamily: 'var(--font-mono)' }}>
                {worker.invocations.toLocaleString() ?? 0}
              </td>
              <td style={{ display: 'flex', gap: '0.25rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Invoke"
                >
                  <Play size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MeshTab({
  services,
  isLoading,
  status,
}: {
  services: MeshService[]
  isLoading: boolean
  status: string
}) {
  if (isLoading) {
    return (
      <div
        style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}
      >
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div>
      <div
        style={{
          padding: '1rem',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <Globe size={16} />
        <span>Mesh Status:</span>
        <span
          className={`badge ${status === 'healthy' ? 'badge-success' : 'badge-warning'}`}
        >
          {status}
        </span>
      </div>

      {services.length === 0 ? (
        <div className="empty-state">
          <Network size={48} />
          <h3>No mesh services</h3>
          <p>Register services to enable mesh routing</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Namespace</th>
                <th>Endpoints</th>
                <th>Health</th>
              </tr>
            </thead>
            <tbody>
              {services.map((svc) => (
                <tr key={`${svc.namespace}/${svc.name}`}>
                  <td style={{ fontWeight: 500 }}>{svc.name}</td>
                  <td>
                    <span className="badge badge-neutral">{svc.namespace}</span>
                  </td>
                  <td>{svc.endpoints}</td>
                  <td>
                    <span
                      className={`badge ${svc.healthy ? 'badge-success' : 'badge-error'}`}
                    >
                      {svc.healthy ? 'healthy' : 'unhealthy'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CreateResourceModal({
  activeTab,
  onClose,
  onCreated,
}: {
  activeTab: TabType
  onClose: () => void
  onCreated: () => void
}) {
  const [formData, setFormData] = useState({
    name: '',
    provider: 'k3d',
    nodes: '1',
    namespace: 'default',
    code: `export default {
  async fetch(request) {
    return new Response('Hello from workerd.');
  }
};`,
  })

  const createCluster = useCreateK3sCluster()
  const applyHelm = useApplyHelmManifests()
  const deployWorkerd = useDeployWorkerdWorker()

  const isSubmitting =
    createCluster.isPending || applyHelm.isPending || deployWorkerd.isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const handleSuccess = () => {
      onCreated()
      onClose()
    }

    if (activeTab === 'clusters') {
      createCluster.mutate(
        {
          name: formData.name,
          provider: formData.provider,
          nodes: parseInt(formData.nodes, 10),
        },
        { onSuccess: handleSuccess },
      )
    } else if (activeTab === 'helm') {
      applyHelm.mutate(
        {
          release: formData.name,
          namespace: formData.namespace,
          manifests: [],
        },
        { onSuccess: handleSuccess },
      )
    } else if (activeTab === 'workerd') {
      deployWorkerd.mutate(
        { name: formData.name, code: formData.code },
        { onSuccess: handleSuccess },
      )
    }
  }

  const titles: Record<TabType, string> = {
    clusters: 'Create K8s Cluster',
    helm: 'New Helm Deployment',
    workerd: 'Deploy Workerd Worker',
    mesh: 'Register Service',
  }

  return (
    <div className="modal-overlay">
      <div
        className="modal"
        style={{ maxWidth: '600px' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <h3 className="modal-title">{titles[activeTab]}</h3>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label htmlFor="res-name" className="form-label">
                Name *
              </label>
              <input
                id="res-name"
                className="input"
                placeholder={
                  activeTab === 'clusters'
                    ? 'my-cluster'
                    : activeTab === 'helm'
                      ? 'my-release'
                      : 'my-worker'
                }
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                required
                pattern="[a-zA-Z0-9_-]+"
              />
            </div>

            {activeTab === 'clusters' && (
              <>
                <div className="form-group">
                  <label htmlFor="res-provider" className="form-label">
                    Provider
                  </label>
                  <select
                    id="res-provider"
                    className="input"
                    value={formData.provider}
                    onChange={(e) =>
                      setFormData({ ...formData, provider: e.target.value })
                    }
                  >
                    <option value="k3d">k3d (Docker)</option>
                    <option value="k3s">k3s (Native)</option>
                    <option value="minikube">Minikube</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="res-nodes" className="form-label">
                    Nodes
                  </label>
                  <input
                    id="res-nodes"
                    type="number"
                    className="input"
                    min="1"
                    max="10"
                    value={formData.nodes}
                    onChange={(e) =>
                      setFormData({ ...formData, nodes: e.target.value })
                    }
                  />
                </div>
              </>
            )}

            {activeTab === 'helm' && (
              <div className="form-group">
                <label htmlFor="res-namespace" className="form-label">
                  Namespace
                </label>
                <input
                  id="res-namespace"
                  className="input"
                  value={formData.namespace}
                  onChange={(e) =>
                    setFormData({ ...formData, namespace: e.target.value })
                  }
                />
              </div>
            )}

            {activeTab === 'workerd' && (
              <div className="form-group">
                <label htmlFor="res-code" className="form-label">
                  Worker Code *
                </label>
                <textarea
                  id="res-code"
                  className="input"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    minHeight: '180px',
                  }}
                  value={formData.code}
                  onChange={(e) =>
                    setFormData({ ...formData, code: e.target.value })
                  }
                  required
                />
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
