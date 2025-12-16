/**
 * DWS Status Component
 * 
 * Shows the decentralization status of the DWS connection
 */

'use client';

import { useDWS } from '@/lib/hooks';
import { 
  Server, 
  Database, 
  GitBranch, 
  Package, 
  Box, 
  Cpu, 
  Globe, 
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Cloud,
  Shield
} from 'lucide-react';
import { clsx } from 'clsx';

interface DWSStatusProps {
  compact?: boolean;
}

export function DWSStatus({ compact = false }: DWSStatusProps) {
  const { 
    isInitialized, 
    isConnected, 
    isLoading, 
    error, 
    nodes, 
    nodeCount,
    health, 
    refresh 
  } = useDWS();

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className={clsx(
          'w-2 h-2 rounded-full',
          isConnected ? 'bg-green-500' : isLoading ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
        )} />
        <span className="text-sm text-factory-400">
          {isLoading ? 'Connecting...' : isConnected ? `${nodeCount} DWS nodes` : 'Disconnected'}
        </span>
      </div>
    );
  }

  const services = health?.services || {
    git: false,
    pkg: false,
    container: false,
    compute: false,
    ipfs: false,
    cdn: false,
    ci: false,
  };

  const serviceItems = [
    { name: 'Git', key: 'git' as const, icon: GitBranch },
    { name: 'Packages', key: 'pkg' as const, icon: Package },
    { name: 'Containers', key: 'container' as const, icon: Box },
    { name: 'Compute', key: 'compute' as const, icon: Cpu },
    { name: 'IPFS', key: 'ipfs' as const, icon: Database },
    { name: 'CDN', key: 'cdn' as const, icon: Globe },
    { name: 'CI/CD', key: 'ci' as const, icon: Cloud },
  ];

  return (
    <div className="card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-accent-500" />
          <h3 className="font-semibold text-factory-100">Decentralized Web Services</h3>
        </div>
        <button 
          onClick={refresh} 
          disabled={isLoading}
          className="p-1.5 rounded-lg hover:bg-factory-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={clsx('w-4 h-4 text-factory-400', isLoading && 'animate-spin')} />
        </button>
      </div>

      {/* Status */}
      <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-factory-900/50">
        {isLoading ? (
          <>
            <Loader2 className="w-5 h-5 text-yellow-500 animate-spin" />
            <span className="text-factory-300">Discovering nodes...</span>
          </>
        ) : isConnected ? (
          <>
            <CheckCircle className="w-5 h-5 text-green-500" />
            <div>
              <span className="text-factory-100 font-medium">Connected</span>
              <span className="text-factory-400 text-sm ml-2">
                {nodeCount} node{nodeCount !== 1 ? 's' : ''} discovered
              </span>
            </div>
          </>
        ) : error ? (
          <>
            <XCircle className="w-5 h-5 text-red-500" />
            <div>
              <span className="text-factory-100 font-medium">Error</span>
              <span className="text-factory-400 text-sm ml-2">{error}</span>
            </div>
          </>
        ) : (
          <>
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            <span className="text-factory-300">No nodes available (using fallback)</span>
          </>
        )}
      </div>

      {/* Decentralization Info */}
      {health?.decentralized && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="p-2 rounded-lg bg-factory-900/50 text-center">
            <p className="text-xl font-bold text-factory-100">
              {health.decentralized.registeredNodes}
            </p>
            <p className="text-xs text-factory-500">Registered Nodes</p>
          </div>
          <div className="p-2 rounded-lg bg-factory-900/50 text-center">
            <p className="text-xl font-bold text-factory-100">
              {health.decentralized.connectedPeers}
            </p>
            <p className="text-xs text-factory-500">Connected Peers</p>
          </div>
          <div className="p-2 rounded-lg bg-factory-900/50 text-center">
            <p className="text-xl font-bold text-factory-100">
              {health.decentralized.frontendCid ? '✓' : '—'}
            </p>
            <p className="text-xs text-factory-500">IPFS Frontend</p>
          </div>
        </div>
      )}

      {/* Services */}
      <div className="grid grid-cols-2 gap-2">
        {serviceItems.map(({ name, key, icon: Icon }) => (
          <div 
            key={key}
            className={clsx(
              'flex items-center gap-2 p-2 rounded-lg text-sm',
              services[key] ? 'bg-green-500/10 text-green-400' : 'bg-factory-900/50 text-factory-500'
            )}
          >
            <Icon className="w-4 h-4" />
            <span>{name}</span>
            {services[key] ? (
              <CheckCircle className="w-3 h-3 ml-auto" />
            ) : (
              <XCircle className="w-3 h-3 ml-auto" />
            )}
          </div>
        ))}
      </div>

      {/* Node List */}
      {nodes.length > 0 && (
        <div className="mt-4 pt-4 border-t border-factory-800">
          <h4 className="text-sm font-medium text-factory-400 mb-2">Active Nodes</h4>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {nodes.map((node) => (
              <div 
                key={node.agentId.toString()}
                className="flex items-center justify-between text-xs p-2 rounded bg-factory-900/50"
              >
                <div className="flex items-center gap-2">
                  <Shield className="w-3 h-3 text-factory-500" />
                  <span className="text-factory-300 font-mono truncate max-w-[120px]">
                    {node.endpoint}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-factory-500">
                    {node.latency ? `${node.latency}ms` : '—'}
                  </span>
                  <div className={clsx(
                    'w-1.5 h-1.5 rounded-full',
                    node.isBanned ? 'bg-red-500' : 'bg-green-500'
                  )} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Minimal inline status indicator
 */
export function DWSStatusBadge() {
  const { isConnected, isLoading, nodeCount } = useDWS();
  
  return (
    <div className={clsx(
      'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs',
      isConnected ? 'bg-green-500/10 text-green-400' : 
      isLoading ? 'bg-yellow-500/10 text-yellow-400' : 
      'bg-red-500/10 text-red-400'
    )}>
      <div className={clsx(
        'w-1.5 h-1.5 rounded-full',
        isConnected ? 'bg-green-500' : 
        isLoading ? 'bg-yellow-500 animate-pulse' : 
        'bg-red-500'
      )} />
      {isLoading ? 'Connecting' : isConnected ? `${nodeCount} nodes` : 'Offline'}
    </div>
  );
}

