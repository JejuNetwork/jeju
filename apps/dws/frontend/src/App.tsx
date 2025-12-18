import { Routes, Route, Navigate } from 'react-router-dom';
import { useState } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import ContainersPage from './pages/compute/Containers';
import WorkersPage from './pages/compute/Workers';
import JobsPage from './pages/compute/Jobs';
import TrainingPage from './pages/compute/Training';
import BucketsPage from './pages/storage/Buckets';
import CDNPage from './pages/storage/CDN';
import IPFSPage from './pages/storage/IPFS';
import RepositoriesPage from './pages/developer/Repositories';
import PackagesPage from './pages/developer/Packages';
import PipelinesPage from './pages/developer/Pipelines';
import InferencePage from './pages/ai/Inference';
import EmbeddingsPage from './pages/ai/Embeddings';
import MLTrainingPage from './pages/ai/MLTraining';
import KeysPage from './pages/security/Keys';
import SecretsPage from './pages/security/Secrets';
import OAuth3Page from './pages/security/OAuth3';
import RPCGatewayPage from './pages/network/RPCGateway';
import VPNProxyPage from './pages/network/VPNProxy';
import MarketplacePage from './pages/marketplace/Browse';
import ListingsPage from './pages/marketplace/Listings';
import BillingPage from './pages/Billing';
import SettingsPage from './pages/Settings';
import type { ViewMode } from './types';

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('consumer');

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
        <Route path="/marketplace/listings" element={<ListingsPage viewMode={viewMode} />} />
        
        {/* Billing & Settings */}
        <Route path="/billing" element={<BillingPage viewMode={viewMode} />} />
        <Route path="/settings" element={<SettingsPage />} />
        
        {/* Redirect unknown routes */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}


