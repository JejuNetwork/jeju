/**
 * DWS React Hook
 * 
 * Provides decentralized DWS access with wallet authentication
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { privateKeyToAccount } from 'viem/accounts';
import { dwsClient, type DWSHealth, type DWSNode } from '../services/dws';

export interface UseDWSReturn {
  // Status
  isInitialized: boolean;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Node info
  nodes: DWSNode[];
  nodeCount: number;
  
  // Health
  health: DWSHealth | null;
  
  // Actions
  refresh: () => Promise<void>;
  checkHealth: () => Promise<DWSHealth>;
}

export function useDWS(): UseDWSReturn {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<DWSNode[]>([]);
  const [health, setHealth] = useState<DWSHealth | null>(null);

  // Initialize DWS client when wallet connects
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        await dwsClient.initialize({
          rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
          identityRegistryAddress: process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS as `0x${string}`,
        });
        
        setIsInitialized(true);
        setNodes(dwsClient.getConnectedNodes());
        
        // Check health
        const healthStatus = await dwsClient.healthCheck();
        setHealth(healthStatus);
      } catch (err) {
        console.error('[useDWS] Initialization error:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize DWS');
      } finally {
        setIsLoading(false);
      }
    };

    if (!dwsClient.isInitialized()) {
      init();
    } else {
      setIsInitialized(true);
      setNodes(dwsClient.getConnectedNodes());
      setIsLoading(false);
    }
  }, []);

  // Update account when wallet changes
  useEffect(() => {
    if (walletClient && isConnected) {
      // Create an account from the wallet client
      // Note: In production, you'd use the wallet client directly for signing
      // This is a simplified version
      dwsClient.setAccount({
        address: walletClient.account.address,
        signMessage: async ({ message }) => {
          return walletClient.signMessage({ message, account: walletClient.account });
        },
        signTransaction: async (tx) => {
          return walletClient.signTransaction(tx as Parameters<typeof walletClient.signTransaction>[0]);
        },
        signTypedData: async (typedData) => {
          return walletClient.signTypedData(typedData as Parameters<typeof walletClient.signTypedData>[0]);
        },
        type: 'local',
        publicKey: '0x', // Not needed for our use case
        source: 'custom',
      });
    }
  }, [walletClient, isConnected]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await dwsClient.refreshNodes();
      setNodes(dwsClient.getConnectedNodes());
      
      const healthStatus = await dwsClient.healthCheck();
      setHealth(healthStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const checkHealth = useCallback(async () => {
    const healthStatus = await dwsClient.healthCheck();
    setHealth(healthStatus);
    return healthStatus;
  }, []);

  return {
    isInitialized,
    isConnected: isInitialized && nodes.length > 0,
    isLoading,
    error,
    nodes,
    nodeCount: nodes.length,
    health,
    refresh,
    checkHealth,
  };
}

/**
 * Hook for Git operations via DWS
 */
export function useDWSGit() {
  const { isInitialized } = useDWS();
  
  return {
    listRepositories: dwsClient.listRepositories.bind(dwsClient),
    getRepository: dwsClient.getRepository.bind(dwsClient),
    createRepository: dwsClient.createRepository.bind(dwsClient),
    getRepoFiles: dwsClient.getRepoFiles.bind(dwsClient),
    getFileContent: dwsClient.getFileContent.bind(dwsClient),
    cloneFromGitHub: dwsClient.cloneFromGitHub.bind(dwsClient),
    isReady: isInitialized,
  };
}

/**
 * Hook for Package operations via DWS
 */
export function useDWSPackages() {
  const { isInitialized } = useDWS();
  
  return {
    searchPackages: dwsClient.searchPackages.bind(dwsClient),
    getPackage: dwsClient.getPackage.bind(dwsClient),
    publishPackage: dwsClient.publishPackage.bind(dwsClient),
    mirrorFromNpm: dwsClient.mirrorFromNpm.bind(dwsClient),
    isReady: isInitialized,
  };
}

/**
 * Hook for Compute operations via DWS
 */
export function useDWSCompute() {
  const { isInitialized } = useDWS();
  
  return {
    createTrainingJob: dwsClient.createTrainingJob.bind(dwsClient),
    createInferenceJob: dwsClient.createInferenceJob.bind(dwsClient),
    getJob: dwsClient.getJob.bind(dwsClient),
    listJobs: dwsClient.listJobs.bind(dwsClient),
    isReady: isInitialized,
  };
}

/**
 * Hook for Model Hub operations via DWS
 */
export function useDWSModels() {
  const { isInitialized } = useDWS();
  
  return {
    listModels: dwsClient.listModels.bind(dwsClient),
    getModel: dwsClient.getModel.bind(dwsClient),
    uploadModel: dwsClient.uploadModel.bind(dwsClient),
    runInference: dwsClient.runInference.bind(dwsClient),
    isReady: isInitialized,
  };
}

/**
 * Hook for Storage/IPFS operations via DWS
 */
export function useDWSStorage() {
  const { isInitialized } = useDWS();
  
  return {
    uploadToIpfs: dwsClient.uploadToIpfs.bind(dwsClient),
    downloadFromIpfs: dwsClient.downloadFromIpfs.bind(dwsClient),
    uploadPermanent: dwsClient.uploadPermanent.bind(dwsClient),
    isReady: isInitialized,
  };
}

/**
 * Hook for CDN operations via DWS
 */
export function useDWSCDN() {
  const { isInitialized } = useDWS();
  
  return {
    deploy: dwsClient.deployCDN.bind(dwsClient),
    invalidate: dwsClient.invalidateCDN.bind(dwsClient),
    resolveJNS: dwsClient.resolveJNS.bind(dwsClient),
    isReady: isInitialized,
  };
}

/**
 * Hook for CI/CD operations via DWS
 */
export function useDWSCI() {
  const { isInitialized } = useDWS();
  
  return {
    triggerWorkflow: dwsClient.triggerWorkflow.bind(dwsClient),
    getWorkflow: dwsClient.getWorkflow.bind(dwsClient),
    listWorkflows: dwsClient.listWorkflows.bind(dwsClient),
    getWorkflowLogs: dwsClient.getWorkflowLogs.bind(dwsClient),
    isReady: isInitialized,
  };
}

