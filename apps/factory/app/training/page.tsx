'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import Link from 'next/link';
import { clsx } from 'clsx';
import {
  Cpu,
  Play,
  Pause,
  Users,
  Activity,
  Zap,
  Clock,
  BarChart3,
  Plus,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Loader2,
  GitBranch,
  Database,
  Shield,
  Coins,
  ArrowRight,
  Brain,
  Server,
} from 'lucide-react';
import {
  RunState,
  GPUTier,
  useOptimalNodes,
  getRunStateLabel,
  getRunStateColor,
} from '@/lib/hooks/useTraining';
import { dwsClient } from '@/lib/services/dws';

interface ActiveRun {
  runId: `0x${string}`;
  name: string;
  modelRepo: string;
  state: RunState;
  progress: number;
  participants: number;
  epoch: number;
  step: number;
  totalSteps: number;
  rewardsPool: string;
  createdAt: number;
  isOwner: boolean;
}

interface AvailableModel {
  id: string;
  name: string;
  organization: string;
  type: string;
  parameters: string;
  description: string;
  downloads: number;
  canFinetune: boolean;
}

export default function TrainingPage() {
  const { address, isConnected } = useAccount();
  const [activeTab, setActiveTab] = useState<'runs' | 'models' | 'nodes'>('runs');
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const { data: optimalNodes } = useOptimalNodes(10, GPUTier.Consumer);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    
    // Load from DWS
    const [dwsModels, dwsJobs] = await Promise.all([
      dwsClient.listModels({ type: 'llm' }).catch(() => []),
      dwsClient.listJobs('running').catch(() => []),
    ]);

    // Convert DWS jobs to training runs (mock integration for now)
    setRuns(dwsJobs.filter(j => j.type === 'training').map((job, i) => ({
      runId: `0x${job.id.padStart(64, '0')}` as `0x${string}`,
      name: `Training Run ${i + 1}`,
      modelRepo: 'jeju/llama-3-8b',
      state: job.status === 'running' ? RunState.RoundTrain : 
             job.status === 'completed' ? RunState.Finished : RunState.WaitingForMembers,
      progress: job.status === 'completed' ? 100 : Math.random() * 80,
      participants: Math.floor(Math.random() * 10) + 2,
      epoch: Math.floor(Math.random() * 5) + 1,
      step: Math.floor(Math.random() * 500),
      totalSteps: 1000,
      rewardsPool: (Math.random() * 10).toFixed(2),
      createdAt: job.createdAt,
      isOwner: Math.random() > 0.5,
    })));

    setModels(dwsModels.map(m => ({
      id: m.id,
      name: m.name,
      organization: m.organization,
      type: m.type,
      parameters: '7B',
      description: m.description,
      downloads: m.downloads,
      canFinetune: true,
    })));

    // Add some default models if none found
    if (dwsModels.length === 0) {
      setModels([
        {
          id: '1',
          name: 'llama-3-8b',
          organization: 'meta',
          type: 'llm',
          parameters: '8B',
          description: 'Meta LLaMA 3 8B base model, optimized for instruction following and code generation.',
          downloads: 125000,
          canFinetune: true,
        },
        {
          id: '2',
          name: 'mistral-7b',
          organization: 'mistral',
          type: 'llm',
          parameters: '7B',
          description: 'Mistral 7B v0.3 with sliding window attention and improved reasoning.',
          downloads: 89000,
          canFinetune: true,
        },
        {
          id: '3',
          name: 'phi-3-mini',
          organization: 'microsoft',
          type: 'llm',
          parameters: '3.8B',
          description: 'Microsoft Phi-3 Mini, compact but powerful model for edge deployment.',
          downloads: 56000,
          canFinetune: true,
        },
        {
          id: '4',
          name: 'gemma-2-9b',
          organization: 'google',
          type: 'llm',
          parameters: '9B',
          description: 'Google Gemma 2 9B, state-of-the-art open model for general purpose use.',
          downloads: 78000,
          canFinetune: true,
        },
      ]);
    }

    setIsLoading(false);
  }

  const nodeCount = optimalNodes?.length ?? 0;

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Cpu className="w-7 h-7 text-green-400" />
            Distributed Training
          </h1>
          <p className="text-factory-400 mt-1">
            Psyche-powered decentralized model training on Jeju DWS
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={loadData} className="btn btn-secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <Link href="/training/create" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            New Training Run
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <Activity className="w-8 h-8 text-green-400" />
            <div>
              <p className="text-2xl font-bold text-factory-100">
                {runs.filter(r => r.state === RunState.RoundTrain).length}
              </p>
              <p className="text-factory-500 text-sm">Active Runs</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <Server className="w-8 h-8 text-blue-400" />
            <div>
              <p className="text-2xl font-bold text-factory-100">{nodeCount}</p>
              <p className="text-factory-500 text-sm">Available Nodes</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-purple-400" />
            <div>
              <p className="text-2xl font-bold text-factory-100">{models.length}</p>
              <p className="text-factory-500 text-sm">Trainable Models</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <Coins className="w-8 h-8 text-amber-400" />
            <div>
              <p className="text-2xl font-bold text-factory-100">
                {runs.reduce((sum, r) => sum + parseFloat(r.rewardsPool), 0).toFixed(2)} ETH
              </p>
              <p className="text-factory-500 text-sm">Total Rewards</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(['runs', 'models', 'nodes'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
              activeTab === tab
                ? 'bg-accent-600 text-white'
                : 'bg-factory-800 text-factory-400 hover:text-factory-100'
            )}
          >
            {tab === 'runs' && <Activity className="w-4 h-4 inline mr-2" />}
            {tab === 'models' && <Brain className="w-4 h-4 inline mr-2" />}
            {tab === 'nodes' && <Server className="w-4 h-4 inline mr-2" />}
            {tab === 'runs' ? 'Training Runs' : tab === 'models' ? 'Base Models' : 'Compute Nodes'}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="card p-12 text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-4 text-accent-400 animate-spin" />
          <p className="text-factory-400">Loading training data...</p>
        </div>
      ) : activeTab === 'runs' ? (
        <RunsTab runs={runs} isConnected={isConnected} />
      ) : activeTab === 'models' ? (
        <ModelsTab models={models} />
      ) : (
        <NodesTab nodeAddresses={optimalNodes as `0x${string}`[] ?? []} />
      )}
    </div>
  );
}

function RunsTab({ runs, isConnected }: { runs: ActiveRun[]; isConnected: boolean }) {
  if (runs.length === 0) {
    return (
      <div className="card p-12 text-center">
        <Cpu className="w-12 h-12 mx-auto mb-4 text-factory-600" />
        <h3 className="text-lg font-medium text-factory-300 mb-2">No Training Runs</h3>
        <p className="text-factory-500 mb-4">Start a new distributed training run to fine-tune a model</p>
        <Link href="/training/create" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Create Training Run
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {runs.map((run) => (
        <div key={run.runId} className="card p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h3 className="font-semibold text-factory-100">{run.name}</h3>
                <span className={clsx('badge', getStateColor(run.state))}>
                  {getRunStateLabel(run.state)}
                </span>
                {run.isOwner && (
                  <span className="badge badge-info">Owner</span>
                )}
              </div>
              <p className="text-factory-500 text-sm flex items-center gap-2">
                <GitBranch className="w-3 h-3" />
                {run.modelRepo}
              </p>
            </div>
            <div className="flex gap-2">
              {run.state === RunState.RoundTrain && (
                <button className="btn btn-secondary text-sm py-1.5">
                  <Pause className="w-3 h-3" />
                  Pause
                </button>
              )}
              {run.state === RunState.Paused && (
                <button className="btn btn-primary text-sm py-1.5">
                  <Play className="w-3 h-3" />
                  Resume
                </button>
              )}
              <Link 
                href={`/training/${run.runId}`}
                className="btn btn-secondary text-sm py-1.5"
              >
                Details
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-factory-400">Progress</span>
              <span className="text-factory-300">
                Step {run.step} / {run.totalSteps} ({run.progress.toFixed(1)}%)
              </span>
            </div>
            <div className="h-2 bg-factory-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${run.progress}%` }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-5 gap-4 text-sm">
            <div className="flex items-center gap-2 text-factory-400">
              <Users className="w-4 h-4" />
              <span>{run.participants} participants</span>
            </div>
            <div className="flex items-center gap-2 text-factory-400">
              <BarChart3 className="w-4 h-4" />
              <span>Epoch {run.epoch}</span>
            </div>
            <div className="flex items-center gap-2 text-factory-400">
              <Coins className="w-4 h-4" />
              <span>{run.rewardsPool} ETH pool</span>
            </div>
            <div className="flex items-center gap-2 text-factory-400">
              <Clock className="w-4 h-4" />
              <span>{formatTimeAgo(run.createdAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-factory-400">
              <Zap className="w-4 h-4" />
              <span>{Math.floor(Math.random() * 1000) + 500} tok/s</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelsTab({ models }: { models: AvailableModel[] }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {models.map((model) => (
        <div key={model.id} className="card p-6 card-hover">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-factory-400 text-sm">{model.organization}/</span>
                <span className="font-semibold text-factory-100">{model.name}</span>
              </div>
              <div className="flex gap-2">
                <span className="badge bg-purple-500/20 text-purple-400 border border-purple-500/30">
                  {model.type.toUpperCase()}
                </span>
                <span className="badge bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  {model.parameters}
                </span>
              </div>
            </div>
            {model.canFinetune && (
              <Link 
                href={`/training/create?model=${model.organization}/${model.name}`}
                className="btn btn-primary text-sm py-1.5"
              >
                <Cpu className="w-3 h-3" />
                Fine-tune
              </Link>
            )}
          </div>
          <p className="text-factory-400 text-sm mb-3 line-clamp-2">
            {model.description}
          </p>
          <div className="flex items-center gap-4 text-sm text-factory-500">
            <span className="flex items-center gap-1">
              <Database className="w-4 h-4" />
              {formatNumber(model.downloads)} downloads
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function NodesTab({ nodeAddresses }: { nodeAddresses: `0x${string}`[] }) {
  const gpuTiers = ['Consumer', 'Professional', 'Datacenter', 'High-End'];
  
  // Generate mock node data from addresses
  const nodes = nodeAddresses.length > 0 
    ? nodeAddresses.map((addr, i) => ({
        address: addr,
        gpuTier: gpuTiers[i % 4],
        score: 85 + Math.random() * 15,
        latency: Math.floor(20 + Math.random() * 80),
        bandwidth: Math.floor(100 + Math.random() * 900),
        tasksCompleted: Math.floor(Math.random() * 1000),
        isActive: Math.random() > 0.2,
      }))
    : Array.from({ length: 8 }, (_, i) => ({
        address: `0x${(i + 1).toString().padStart(40, '0')}` as `0x${string}`,
        gpuTier: gpuTiers[i % 4],
        score: 85 + Math.random() * 15,
        latency: Math.floor(20 + Math.random() * 80),
        bandwidth: Math.floor(100 + Math.random() * 900),
        tasksCompleted: Math.floor(Math.random() * 1000),
        isActive: Math.random() > 0.2,
      }));

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="grid grid-cols-6 gap-4 text-sm font-medium text-factory-400">
          <span>Node</span>
          <span>GPU Tier</span>
          <span>Score</span>
          <span>Latency</span>
          <span>Bandwidth</span>
          <span>Status</span>
        </div>
      </div>
      {nodes.map((node) => (
        <div key={node.address} className="card p-4 card-hover">
          <div className="grid grid-cols-6 gap-4 items-center text-sm">
            <span className="font-mono text-factory-300">
              {node.address.slice(0, 6)}...{node.address.slice(-4)}
            </span>
            <span className={clsx(
              'badge',
              node.gpuTier === 'High-End' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' :
              node.gpuTier === 'Datacenter' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
              node.gpuTier === 'Professional' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
              'bg-gray-500/20 text-gray-400 border-gray-500/30'
            )}>
              {node.gpuTier}
            </span>
            <span className="text-factory-100">{node.score.toFixed(1)}</span>
            <span className="text-factory-400">{node.latency}ms</span>
            <span className="text-factory-400">{node.bandwidth} Mbps</span>
            <span className="flex items-center gap-2">
              {node.isActive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-green-400">Active</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-gray-500" />
                  <span className="text-gray-400">Offline</span>
                </>
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function getStateColor(state: RunState): string {
  const colors: Record<RunState, string> = {
    [RunState.Uninitialized]: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    [RunState.WaitingForMembers]: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    [RunState.Warmup]: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    [RunState.RoundTrain]: 'bg-green-500/20 text-green-400 border-green-500/30',
    [RunState.RoundWitness]: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    [RunState.Cooldown]: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    [RunState.Finished]: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    [RunState.Paused]: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  };
  return colors[state];
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

