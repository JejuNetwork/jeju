'use client'

import { clsx } from 'clsx'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Brain,
  CheckCircle,
  Cpu,
  Database,
  Loader2,
  Search,
  Server,
  Settings,
  Shield,
  Upload,
  Users,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { parseEther } from 'viem'
import { useAccount } from 'wagmi'
import {
  GPUTier,
  getDefaultLLMConfig,
  PrivacyMode,
  useCreateRun,
  useOptimalNodes,
} from '@/lib/hooks/useTraining'

type Step = 'model' | 'dataset' | 'config' | 'nodes' | 'review'

interface DatasetOption {
  id: string
  name: string
  source: 'dws' | 'huggingface' | 'upload'
  size: string
  samples: number
  description: string
}

function CreateTrainingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { address, isConnected } = useAccount()
  const [step, setStep] = useState<Step>('model')

  // Form state
  const [selectedModel, setSelectedModel] = useState(
    searchParams.get('model') || '',
  )
  const [selectedDataset, setSelectedDataset] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [datasetSearch, setDatasetSearch] = useState('')
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>(
    PrivacyMode.Public,
  )
  const [stakeAmount, setStakeAmount] = useState('0.01')
  const [rewardPool, setRewardPool] = useState('0.1')
  const [minNodes, setMinNodes] = useState(2)
  const [maxSeqLen, setMaxSeqLen] = useState(2048)
  const [totalSteps, setTotalSteps] = useState(1000)
  const [batchSize, setBatchSize] = useState(256)
  const [learningRate, setLearningRate] = useState('2e-5')
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])

  const { data: optimalNodes } = useOptimalNodes(20, GPUTier.Consumer)
  const { createRun, isPending, isConfirming, isSuccess, error } =
    useCreateRun()

  // Redirect on success
  useEffect(() => {
    if (isSuccess) {
      router.push('/training')
    }
  }, [isSuccess, router])

  const models = [
    {
      id: 'meta/llama-3-8b',
      name: 'LLaMA 3 8B',
      org: 'Meta',
      params: '8B',
      type: 'Base',
    },
    {
      id: 'meta/llama-3-70b',
      name: 'LLaMA 3 70B',
      org: 'Meta',
      params: '70B',
      type: 'Base',
    },
    {
      id: 'mistral/mistral-7b',
      name: 'Mistral 7B',
      org: 'Mistral AI',
      params: '7B',
      type: 'Base',
    },
    {
      id: 'microsoft/phi-3-mini',
      name: 'Phi-3 Mini',
      org: 'Microsoft',
      params: '3.8B',
      type: 'Base',
    },
    {
      id: 'google/gemma-2-9b',
      name: 'Gemma 2 9B',
      org: 'Google',
      params: '9B',
      type: 'Base',
    },
    {
      id: 'qwen/qwen2-7b',
      name: 'Qwen 2 7B',
      org: 'Alibaba',
      params: '7B',
      type: 'Base',
    },
    {
      id: 'jeju/llama-3-jeju-ft',
      name: 'LLaMA 3 Jeju FT',
      org: 'Jeju',
      params: '8B',
      type: 'Fine-tuned',
    },
    {
      id: 'jeju/code-assistant',
      name: 'Code Assistant',
      org: 'Jeju',
      params: '7B',
      type: 'Fine-tuned',
    },
  ]

  const datasets: DatasetOption[] = [
    {
      id: 'dws:jeju-docs',
      name: 'Jeju Documentation',
      source: 'dws',
      size: '2.4GB',
      samples: 150000,
      description: 'Full Jeju documentation, tutorials, and code examples',
    },
    {
      id: 'dws:solidity-corpus',
      name: 'Solidity Corpus',
      source: 'dws',
      size: '8.1GB',
      samples: 500000,
      description: 'Smart contract code from verified contracts',
    },
    {
      id: 'hf:openhermes',
      name: 'OpenHermes 2.5',
      source: 'huggingface',
      size: '4.2GB',
      samples: 1000000,
      description: 'High-quality instruction-following dataset',
    },
    {
      id: 'hf:code-feedback',
      name: 'Code Feedback',
      source: 'huggingface',
      size: '1.8GB',
      samples: 200000,
      description: 'Code review and improvement examples',
    },
    {
      id: 'hf:alpaca-cleaned',
      name: 'Alpaca Cleaned',
      source: 'huggingface',
      size: '500MB',
      samples: 52000,
      description: 'Cleaned Stanford Alpaca dataset',
    },
  ]

  const filteredModels = models.filter(
    (m) =>
      m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.org.toLowerCase().includes(modelSearch.toLowerCase()),
  )

  const filteredDatasets = datasets.filter(
    (d) =>
      d.name.toLowerCase().includes(datasetSearch.toLowerCase()) ||
      d.description.toLowerCase().includes(datasetSearch.toLowerCase()),
  )

  const steps: { id: Step; label: string; icon: typeof Brain }[] = [
    { id: 'model', label: 'Select Model', icon: Brain },
    { id: 'dataset', label: 'Dataset', icon: Database },
    { id: 'config', label: 'Configuration', icon: Settings },
    { id: 'nodes', label: 'Compute Nodes', icon: Server },
    { id: 'review', label: 'Review & Launch', icon: Zap },
  ]

  const currentStepIndex = steps.findIndex((s) => s.id === step)

  const canProceed = () => {
    switch (step) {
      case 'model':
        return !!selectedModel
      case 'dataset':
        return !!selectedDataset
      case 'config':
        return totalSteps > 0 && batchSize > 0
      case 'nodes':
        return minNodes >= 2
      case 'review':
        return true
    }
  }

  const handleSubmit = async () => {
    if (!isConnected || !address) return

    const config = getDefaultLLMConfig(minNodes)
    config.totalSteps = totalSteps
    config.globalBatchSizeStart = batchSize
    config.globalBatchSizeEnd = batchSize * 4

    await createRun({
      modelRepo: selectedModel,
      config,
      privacyMode,
      stake: parseEther(stakeAmount),
    })
  }

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link href="/training" className="btn btn-ghost p-2">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Cpu className="w-7 h-7 text-green-400" />
            Create Training Run
          </h1>
          <p className="text-factory-400 mt-1">
            Configure and launch a distributed training job on Jeju DWS
          </p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="card p-4 mb-8">
        <div className="flex items-center justify-between">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <button
                onClick={() => i <= currentStepIndex && setStep(s.id)}
                disabled={i > currentStepIndex}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
                  step === s.id
                    ? 'bg-accent-600 text-white'
                    : i < currentStepIndex
                      ? 'bg-factory-700 text-factory-200 hover:bg-factory-600 cursor-pointer'
                      : 'bg-factory-800 text-factory-500 cursor-not-allowed',
                )}
              >
                {i < currentStepIndex ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <s.icon className="w-4 h-4" />
                )}
                <span className="font-medium">{s.label}</span>
              </button>
              {i < steps.length - 1 && (
                <div
                  className={clsx(
                    'w-12 h-0.5 mx-2',
                    i < currentStepIndex ? 'bg-green-500' : 'bg-factory-700',
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="card p-6 mb-6">
        {step === 'model' && (
          <div>
            <h2 className="text-lg font-semibold text-factory-100 mb-4">
              Select Base Model
            </h2>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
              <input
                type="text"
                placeholder="Search models..."
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                className="input pl-10"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {filteredModels.map((model) => (
                <button
                  key={model.id}
                  onClick={() => setSelectedModel(model.id)}
                  className={clsx(
                    'p-4 rounded-xl border-2 text-left transition-all',
                    selectedModel === model.id
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-factory-700 hover:border-factory-600',
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-factory-100">
                        {model.name}
                      </p>
                      <p className="text-factory-500 text-sm">{model.org}</p>
                    </div>
                    {selectedModel === model.id && (
                      <CheckCircle className="w-5 h-5 text-accent-400" />
                    )}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <span className="badge bg-purple-500/20 text-purple-400 border-purple-500/30">
                      {model.params}
                    </span>
                    <span className="badge bg-blue-500/20 text-blue-400 border-blue-500/30">
                      {model.type}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'dataset' && (
          <div>
            <h2 className="text-lg font-semibold text-factory-100 mb-4">
              Select Training Dataset
            </h2>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
              <input
                type="text"
                placeholder="Search datasets..."
                value={datasetSearch}
                onChange={(e) => setDatasetSearch(e.target.value)}
                className="input pl-10"
              />
            </div>
            <div className="space-y-3">
              {filteredDatasets.map((dataset) => (
                <button
                  key={dataset.id}
                  onClick={() => setSelectedDataset(dataset.id)}
                  className={clsx(
                    'w-full p-4 rounded-xl border-2 text-left transition-all',
                    selectedDataset === dataset.id
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-factory-700 hover:border-factory-600',
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-factory-100">
                          {dataset.name}
                        </p>
                        <span
                          className={clsx(
                            'badge text-xs',
                            dataset.source === 'dws'
                              ? 'bg-green-500/20 text-green-400 border-green-500/30'
                              : dataset.source === 'huggingface'
                                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                : 'bg-blue-500/20 text-blue-400 border-blue-500/30',
                          )}
                        >
                          {dataset.source.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-factory-400 text-sm mb-2">
                        {dataset.description}
                      </p>
                      <div className="flex gap-4 text-sm text-factory-500">
                        <span>{dataset.size}</span>
                        <span>{dataset.samples.toLocaleString()} samples</span>
                      </div>
                    </div>
                    {selectedDataset === dataset.id && (
                      <CheckCircle className="w-5 h-5 text-accent-400 ml-4" />
                    )}
                  </div>
                </button>
              ))}
              <button className="w-full p-4 rounded-xl border-2 border-dashed border-factory-600 hover:border-factory-500 text-factory-400 hover:text-factory-300 transition-colors">
                <Upload className="w-5 h-5 mx-auto mb-2" />
                Upload Custom Dataset
              </button>
            </div>
          </div>
        )}

        {step === 'config' && (
          <div>
            <h2 className="text-lg font-semibold text-factory-100 mb-4">
              Training Configuration
            </h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-factory-300 text-sm mb-2">
                  Total Steps
                </label>
                <input
                  type="number"
                  value={totalSteps}
                  onChange={(e) =>
                    setTotalSteps(parseInt(e.target.value, 10) || 0)
                  }
                  className="input"
                  min={100}
                  max={100000}
                />
              </div>
              <div>
                <label className="block text-factory-300 text-sm mb-2">
                  Batch Size
                </label>
                <input
                  type="number"
                  value={batchSize}
                  onChange={(e) =>
                    setBatchSize(parseInt(e.target.value, 10) || 0)
                  }
                  className="input"
                  min={8}
                  max={4096}
                />
              </div>
              <div>
                <label className="block text-factory-300 text-sm mb-2">
                  Max Sequence Length
                </label>
                <select
                  value={maxSeqLen}
                  onChange={(e) => setMaxSeqLen(parseInt(e.target.value, 10))}
                  className="input"
                >
                  <option value={512}>512</option>
                  <option value={1024}>1024</option>
                  <option value={2048}>2048</option>
                  <option value={4096}>4096</option>
                  <option value={8192}>8192</option>
                </select>
              </div>
              <div>
                <label className="block text-factory-300 text-sm mb-2">
                  Learning Rate
                </label>
                <input
                  type="text"
                  value={learningRate}
                  onChange={(e) => setLearningRate(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-factory-300 text-sm mb-2">
                  Privacy Mode
                </label>
                <div className="flex gap-4">
                  <button
                    onClick={() => setPrivacyMode(PrivacyMode.Public)}
                    className={clsx(
                      'flex-1 p-3 rounded-lg border-2 transition-all',
                      privacyMode === PrivacyMode.Public
                        ? 'border-accent-500 bg-accent-500/10'
                        : 'border-factory-700',
                    )}
                  >
                    <Users className="w-5 h-5 mx-auto mb-1" />
                    <p className="text-sm font-medium">Public</p>
                  </button>
                  <button
                    onClick={() => setPrivacyMode(PrivacyMode.Private)}
                    className={clsx(
                      'flex-1 p-3 rounded-lg border-2 transition-all',
                      privacyMode === PrivacyMode.Private
                        ? 'border-accent-500 bg-accent-500/10'
                        : 'border-factory-700',
                    )}
                  >
                    <Shield className="w-5 h-5 mx-auto mb-1" />
                    <p className="text-sm font-medium">Private</p>
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-factory-300 text-sm mb-2">
                  Minimum Nodes
                </label>
                <input
                  type="number"
                  value={minNodes}
                  onChange={(e) =>
                    setMinNodes(parseInt(e.target.value, 10) || 2)
                  }
                  className="input"
                  min={2}
                  max={256}
                />
              </div>
            </div>
          </div>
        )}

        {step === 'nodes' && (
          <div>
            <h2 className="text-lg font-semibold text-factory-100 mb-4">
              Select Compute Nodes
            </h2>
            <div className="mb-4 p-4 bg-factory-800 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-factory-300">Available Nodes</p>
                  <p className="text-2xl font-bold text-factory-100">
                    {optimalNodes?.length ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-factory-300">Selected</p>
                  <p className="text-2xl font-bold text-accent-400">
                    {selectedNodes.length || 'Auto'}
                  </p>
                </div>
                <div>
                  <p className="text-factory-300">Min Required</p>
                  <p className="text-2xl font-bold text-factory-100">
                    {minNodes}
                  </p>
                </div>
              </div>
            </div>
            <p className="text-factory-400 text-sm mb-4">
              Leave empty for automatic node selection, or select specific nodes
              below.
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(optimalNodes || []).map((addr, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const addrStr = addr as string
                    setSelectedNodes((prev) =>
                      prev.includes(addrStr)
                        ? prev.filter((n) => n !== addrStr)
                        : [...prev, addrStr],
                    )
                  }}
                  className={clsx(
                    'w-full p-3 rounded-lg border-2 text-left transition-all flex items-center justify-between',
                    selectedNodes.includes(addr as string)
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-factory-700 hover:border-factory-600',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Server className="w-4 h-4 text-factory-400" />
                    <span className="font-mono text-factory-300">
                      {(addr as string).slice(0, 10)}...
                      {(addr as string).slice(-8)}
                    </span>
                  </div>
                  {selectedNodes.includes(addr as string) && (
                    <CheckCircle className="w-4 h-4 text-accent-400" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'review' && (
          <div>
            <h2 className="text-lg font-semibold text-factory-100 mb-4">
              Review & Launch
            </h2>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="p-4 bg-factory-800 rounded-lg">
                  <p className="text-factory-400 text-sm mb-1">Model</p>
                  <p className="text-factory-100 font-semibold">
                    {selectedModel}
                  </p>
                </div>
                <div className="p-4 bg-factory-800 rounded-lg">
                  <p className="text-factory-400 text-sm mb-1">Dataset</p>
                  <p className="text-factory-100 font-semibold">
                    {datasets.find((d) => d.id === selectedDataset)?.name ||
                      selectedDataset}
                  </p>
                </div>
                <div className="p-4 bg-factory-800 rounded-lg">
                  <p className="text-factory-400 text-sm mb-1">
                    Training Steps
                  </p>
                  <p className="text-factory-100 font-semibold">
                    {totalSteps.toLocaleString()}
                  </p>
                </div>
                <div className="p-4 bg-factory-800 rounded-lg">
                  <p className="text-factory-400 text-sm mb-1">Batch Size</p>
                  <p className="text-factory-100 font-semibold">{batchSize}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="p-4 bg-factory-800 rounded-lg">
                  <p className="text-factory-400 text-sm mb-1">Minimum Nodes</p>
                  <p className="text-factory-100 font-semibold">{minNodes}</p>
                </div>
                <div className="p-4 bg-factory-800 rounded-lg">
                  <p className="text-factory-400 text-sm mb-1">Privacy</p>
                  <p className="text-factory-100 font-semibold">
                    {privacyMode === PrivacyMode.Public
                      ? 'Public'
                      : 'Private (MPC)'}
                  </p>
                </div>
                <div className="p-4 bg-factory-800 rounded-lg">
                  <label className="text-factory-400 text-sm mb-1 block">
                    Stake Amount (ETH)
                  </label>
                  <input
                    type="text"
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    className="input mt-1"
                  />
                </div>
                <div className="p-4 bg-factory-800 rounded-lg">
                  <label className="text-factory-400 text-sm mb-1 block">
                    Reward Pool (ETH)
                  </label>
                  <input
                    type="text"
                    value={rewardPool}
                    onChange={(e) => setRewardPool(e.target.value)}
                    className="input mt-1"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400">
                <AlertCircle className="w-5 h-5" />
                <span>{error.message}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={() => setStep(steps[currentStepIndex - 1]?.id || 'model')}
          disabled={currentStepIndex === 0}
          className="btn btn-secondary"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {step === 'review' ? (
          <button
            onClick={handleSubmit}
            disabled={!isConnected || isPending || isConfirming}
            className="btn btn-primary"
          >
            {isPending || isConfirming ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {isPending ? 'Confirming...' : 'Processing...'}
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Launch Training
              </>
            )}
          </button>
        ) : (
          <button
            onClick={() => setStep(steps[currentStepIndex + 1]?.id || 'review')}
            disabled={!canProceed()}
            className="btn btn-primary"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

export default function CreateTrainingPage() {
  return (
    // @ts-expect-error Suspense type mismatch in React 19
    <Suspense
      fallback={
        <div className="min-h-screen p-8 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
        </div>
      }
    >
      <CreateTrainingContent />
    </Suspense>
  )
}
