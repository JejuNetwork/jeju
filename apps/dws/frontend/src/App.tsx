import { useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import EmbeddingsPage from './pages/ai/Embeddings'
import InferencePage from './pages/ai/Inference'
import MLTrainingPage from './pages/ai/MLTraining'
import BillingPage from './pages/Billing'
import ContainersPage from './pages/compute/Containers'
import JobsPage from './pages/compute/Jobs'
import TrainingPage from './pages/compute/Training'
import WorkersPage from './pages/compute/Workers'
import Dashboard from './pages/Dashboard'
import PackagesPage from './pages/developer/Packages'
import PipelinesPage from './pages/developer/Pipelines'
import RepositoriesPage from './pages/developer/Repositories'
import MarketplacePage from './pages/marketplace/Browse'
import ListingsPage from './pages/marketplace/Listings'
import RPCGatewayPage from './pages/network/RPCGateway'
import VPNProxyPage from './pages/network/VPNProxy'
import SettingsPage from './pages/Settings'
import KeysPage from './pages/security/Keys'
import OAuth3Page from './pages/security/OAuth3'
import SecretsPage from './pages/security/Secrets'
import BucketsPage from './pages/storage/Buckets'
import CDNPage from './pages/storage/CDN'
import IPFSPage from './pages/storage/IPFS'
import type { ViewMode } from './types'

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('consumer')

  return (
    <Layout viewMode={viewMode} setViewMode={setViewMode}>
      <Routes>
        <Route path="/" element={<Dashboard viewMode={viewMode} />} />

        {/* Compute */}
        <Route path="/compute/containers" element={<ContainersPage />} />
        <Route path="/compute/workers" element={<WorkersPage />} />
        <Route path="/compute/jobs" element={<JobsPage />} />
        <Route path="/compute/training" element={<TrainingPage />} />

        {/* Storage */}
        <Route path="/storage/buckets" element={<BucketsPage />} />
        <Route path="/storage/cdn" element={<CDNPage />} />
        <Route path="/storage/ipfs" element={<IPFSPage />} />

        {/* Developer */}
        <Route path="/developer/repositories" element={<RepositoriesPage />} />
        <Route path="/developer/packages" element={<PackagesPage />} />
        <Route path="/developer/pipelines" element={<PipelinesPage />} />

        {/* AI/ML */}
        <Route path="/ai/inference" element={<InferencePage />} />
        <Route path="/ai/embeddings" element={<EmbeddingsPage />} />
        <Route path="/ai/training" element={<MLTrainingPage />} />

        {/* Security */}
        <Route path="/security/keys" element={<KeysPage />} />
        <Route path="/security/secrets" element={<SecretsPage />} />
        <Route path="/security/oauth3" element={<OAuth3Page />} />

        {/* Network */}
        <Route path="/network/rpc" element={<RPCGatewayPage />} />
        <Route path="/network/vpn" element={<VPNProxyPage />} />

        {/* Marketplace */}
        <Route path="/marketplace/browse" element={<MarketplacePage />} />
        <Route
          path="/marketplace/listings"
          element={<ListingsPage viewMode={viewMode} />}
        />

        {/* Billing & Settings */}
        <Route path="/billing" element={<BillingPage viewMode={viewMode} />} />
        <Route path="/settings" element={<SettingsPage />} />

        {/* Redirect unknown routes */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
