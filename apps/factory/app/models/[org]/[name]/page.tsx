/**
 * Model Detail Page
 * HuggingFace-like model view with inference playground
 */

'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import {
  Brain,
  Download,
  Star,
  GitFork,
  Clock,
  FileText,
  Code,
  Play,
  Copy,
  Check,
  Shield,
  Cpu,
  HardDrive,
  History,
  Zap,
  Settings,
  Terminal,
  Send,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import { useModel, useModelReadme, useModelVersions, useInference, useStarModel, type ModelData } from '../../../../hooks/useModels';

type ModelTab = 'model-card' | 'files' | 'inference' | 'training' | 'versions';

const typeColors = {
  llm: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  vision: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  audio: 'bg-green-500/20 text-green-400 border-green-500/30',
  embedding: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  multimodal: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
};

export default function ModelDetailPage() {
  const params = useParams();
  const org = params.org as string;
  const name = params.name as string;
  const { isConnected: _isConnected } = useAccount();
  
  const [tab, setTab] = useState<ModelTab>('model-card');
  const [copied, setCopied] = useState(false);
  const [isStarred, setIsStarred] = useState(false);
  
  // Inference state
  const [prompt, setPrompt] = useState('');
  const [inferenceConfig, setInferenceConfig] = useState({
    maxTokens: 256,
    temperature: 0.7,
    topP: 0.9,
  });

  // Fetch real data
  const { model, isLoading, error } = useModel(org, name);
  const { readme, isLoading: readmeLoading } = useModelReadme(org, name);
  const { versions, isLoading: versionsLoading } = useModelVersions(org, name);
  const { runInference, isLoading: inferenceLoading, data: inferenceResult, reset: resetInference } = useInference(org, name);
  const starMutation = useStarModel();

  const fullName = `${org}/${name}`;
  const installCommand = `from transformers import AutoModelForCausalLM\nmodel = AutoModelForCausalLM.from_pretrained("${fullName}")`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return `${Math.floor(days / 30)} months ago`;
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  const handleRunInference = () => {
    if (!prompt.trim()) return;
    resetInference();
    runInference({
      prompt,
      maxTokens: inferenceConfig.maxTokens,
      temperature: inferenceConfig.temperature,
      topP: inferenceConfig.topP,
    });
  };

  const handleStar = () => {
    setIsStarred(!isStarred);
    starMutation.mutate({ org, name });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Brain className="w-16 h-16 mx-auto mb-4 text-factory-600" />
          <h2 className="text-xl font-semibold text-factory-300 mb-2">Model not found</h2>
          <p className="text-factory-500">{fullName} does not exist in the model hub.</p>
        </div>
      </div>
    );
  }

  // Use fetched versions or model versions
  const displayVersions = versions.length > 0 ? versions : model.versions;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-factory-800 bg-factory-900/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Brain className="w-8 h-8 text-amber-400" />
                <div>
                  <h1 className="text-2xl font-bold text-factory-100">
                    <span className="text-factory-400">{model.organization}/</span>
                    {model.name}
                  </h1>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={clsx('badge border', typeColors[model.type])}>
                      {model.type.toUpperCase()}
                    </span>
                    <span className="badge bg-factory-800 text-factory-300 border border-factory-700">
                      {model.parameters}
                    </span>
                    {model.isVerified && (
                      <span className="badge bg-green-500/20 text-green-400 border border-green-500/30">
                        <Shield className="w-3 h-3 mr-1" />
                        Verified
                      </span>
                    )}
                    {model.hasInference && (
                      <span className="badge bg-blue-500/20 text-blue-400 border border-blue-500/30">
                        <Zap className="w-3 h-3 mr-1" />
                        Inference API
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-factory-400 max-w-2xl">{model.description}</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleStar}
                className={clsx('btn text-sm', isStarred ? 'btn-primary' : 'btn-secondary')}
              >
                <Star className={clsx('w-4 h-4', isStarred && 'fill-current')} />
                {formatNumber(model.stars)}
              </button>
              <button className="btn btn-secondary text-sm">
                <GitFork className="w-4 h-4" />
                {model.forks}
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="flex items-center gap-3">
              <Download className="w-5 h-5 text-factory-500" />
              <div>
                <p className="font-semibold text-factory-100">{formatNumber(model.downloads)}</p>
                <p className="text-factory-500 text-sm">Downloads</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Cpu className="w-5 h-5 text-factory-500" />
              <div>
                <p className="font-semibold text-factory-100">{model.parameters}</p>
                <p className="text-factory-500 text-sm">Parameters</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <HardDrive className="w-5 h-5 text-factory-500" />
              <div>
                <p className="font-semibold text-factory-100">{model.computeRequirements.minVram}</p>
                <p className="text-factory-500 text-sm">Min VRAM</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-factory-500" />
              <div>
                <p className="font-semibold text-factory-100">{formatDate(model.lastUpdated)}</p>
                <p className="text-factory-500 text-sm">Updated</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto -mb-px">
            {([
              { id: 'model-card' as const, label: 'Model Card', icon: FileText },
              { id: 'files' as const, label: 'Files', icon: Code, count: model.files.length },
              { id: 'inference' as const, label: 'Inference', icon: Play },
              { id: 'training' as const, label: 'Training', icon: Zap },
              { id: 'versions' as const, label: 'Versions', icon: History, count: displayVersions.length },
            ]).map(({ id, label, icon: Icon, count }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  tab === id
                    ? 'border-accent-500 text-accent-400'
                    : 'border-transparent text-factory-400 hover:text-factory-100 hover:border-factory-600'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
                {count !== undefined && (
                  <span className="px-1.5 py-0.5 text-xs rounded-full bg-factory-800">{count}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
        {tab === 'model-card' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            <div className="lg:col-span-2">
              <div className="card p-6 lg:p-8">
                {readmeLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-accent-400" />
                  </div>
                ) : (
                  <div className="prose prose-invert max-w-none prose-pre:bg-factory-950 prose-pre:border prose-pre:border-factory-800">
                    <ReactMarkdown>{readme || model.readme}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              {/* Tags */}
              <div className="card p-6">
                <h3 className="font-semibold text-factory-100 mb-4">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {model.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={`/models?tag=${tag}`}
                      className="badge badge-info hover:bg-blue-500/30 transition-colors"
                    >
                      {tag}
                    </Link>
                  ))}
                </div>
              </div>

              {/* Model Info */}
              <div className="card p-6">
                <h3 className="font-semibold text-factory-100 mb-4">Model Info</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-factory-500">Task</span>
                    <span className="text-factory-300">{model.task}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-factory-500">Framework</span>
                    <span className="text-factory-300">{model.framework}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-factory-500">Precision</span>
                    <span className="text-factory-300">{model.precision}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-factory-500">License</span>
                    <span className="text-factory-300">{model.license}</span>
                  </div>
                </div>
              </div>

              {/* Compute Requirements */}
              <div className="card p-6">
                <h3 className="font-semibold text-factory-100 mb-4">Compute Requirements</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-factory-500">Min VRAM</span>
                    <span className="text-factory-300">{model.computeRequirements.minVram}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-factory-500">Recommended</span>
                    <span className="text-factory-300">{model.computeRequirements.recommendedVram}</span>
                  </div>
                  <div className="mt-3">
                    <span className="text-factory-500 block mb-2">Supported Hardware</span>
                    <div className="space-y-1">
                      {model.computeRequirements.architecture.map((arch) => (
                        <span key={arch} className="badge bg-factory-800 text-factory-300 border border-factory-700 mr-1">
                          {arch}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Download / CLI Setup */}
              <div className="card p-6">
                <h3 className="font-semibold text-factory-100 mb-4 flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-accent-400" />
                  Download Model
                </h3>
                <p className="text-factory-500 text-sm mb-4">
                  Use the Jeju Model Hub CLI (HuggingFace compatible):
                </p>
                
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-factory-500 mb-1 block">Install CLI</label>
                    <div className="bg-factory-900 rounded-lg p-3 font-mono text-xs relative">
                      <pre className="text-factory-400">pip install jeju-hub</pre>
                      <button
                        onClick={() => copyToClipboard('pip install jeju-hub')}
                        className="absolute top-2 right-2 p-1 hover:bg-factory-800 rounded"
                      >
                        {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-factory-500" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-factory-500 mb-1 block">Download Model</label>
                    <div className="bg-factory-900 rounded-lg p-3 font-mono text-xs relative">
                      <pre className="text-factory-400">{`jeju-hub download ${fullName}`}</pre>
                      <button
                        onClick={() => copyToClipboard(`jeju-hub download ${fullName}`)}
                        className="absolute top-2 right-2 p-1 hover:bg-factory-800 rounded"
                      >
                        {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-factory-500" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'files' && (
          <div className="card divide-y divide-factory-800">
            {model.files.map((file) => (
              <div
                key={file.name}
                className="flex items-center justify-between p-4 hover:bg-factory-800/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Code className="w-5 h-5 text-factory-400" />
                  <span className="font-mono text-factory-100">{file.name}</span>
                  <span className="badge bg-factory-800 text-factory-400 text-xs">{file.type}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-factory-500 text-sm">{file.size}</span>
                  <button className="btn btn-ghost text-sm">
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'inference' && model.hasInference && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              {/* Input */}
              <div className="card p-6">
                <h3 className="font-semibold text-factory-100 mb-4 flex items-center gap-2">
                  <Terminal className="w-5 h-5" />
                  Input
                </h3>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Enter your prompt here..."
                  className="input min-h-[120px] resize-none font-mono text-sm"
                />
                <div className="flex justify-end mt-4">
                  <button
                    onClick={handleRunInference}
                    disabled={!prompt.trim() || inferenceLoading}
                    className="btn btn-primary"
                  >
                    {inferenceLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Generate
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Output */}
              <div className="card p-6">
                <h3 className="font-semibold text-factory-100 mb-4 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-400" />
                  Output
                </h3>
                {inferenceResult ? (
                  <div className="prose prose-invert max-w-none prose-pre:bg-factory-950 prose-pre:border prose-pre:border-factory-800">
                    <ReactMarkdown>{inferenceResult.output}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="text-center py-8 text-factory-500">
                    <Play className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Enter a prompt and click Generate to see the output</p>
                  </div>
                )}
              </div>
            </div>

            {/* Config Sidebar */}
            <div className="card p-6 h-fit">
              <h3 className="font-semibold text-factory-100 mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Configuration
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-factory-400 mb-2">
                    Max Tokens: {inferenceConfig.maxTokens}
                  </label>
                  <input
                    type="range"
                    min="64"
                    max="1024"
                    value={inferenceConfig.maxTokens}
                    onChange={(e) => setInferenceConfig(c => ({ ...c, maxTokens: parseInt(e.target.value) }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-factory-400 mb-2">
                    Temperature: {inferenceConfig.temperature}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={inferenceConfig.temperature}
                    onChange={(e) => setInferenceConfig(c => ({ ...c, temperature: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-factory-400 mb-2">
                    Top P: {inferenceConfig.topP}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={inferenceConfig.topP}
                    onChange={(e) => setInferenceConfig(c => ({ ...c, topP: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                </div>
              </div>

              {model.inferenceEndpoint && (
                <div className="mt-6 pt-6 border-t border-factory-800">
                  <h4 className="text-sm font-medium text-factory-300 mb-2">API Endpoint</h4>
                  <code className="text-xs text-factory-500 block bg-factory-950 p-2 rounded break-all">
                    {model.inferenceEndpoint}
                  </code>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'training' && (
          <div className="card p-6 lg:p-8">
            <h2 className="text-xl font-semibold text-factory-100 mb-6">Train on Jeju Compute</h2>
            <p className="text-factory-400 mb-6">
              Fine-tune this model on your own data using the Jeju Compute Marketplace.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {[
                { name: 'QLoRA Fine-tuning', price: '0.5 ETH', duration: '~4 hours', vram: '24 GB' },
                { name: 'Full Fine-tuning', price: '2.5 ETH', duration: '~12 hours', vram: '80 GB' },
                { name: 'DPO Training', price: '1.2 ETH', duration: '~6 hours', vram: '48 GB' },
              ].map((plan) => (
                <div key={plan.name} className="card p-6 border-2 border-factory-700 hover:border-accent-500 transition-colors">
                  <h3 className="font-semibold text-factory-100 mb-2">{plan.name}</h3>
                  <p className="text-2xl font-bold text-accent-400 mb-4">{plan.price}</p>
                  <div className="space-y-2 text-sm text-factory-500">
                    <div className="flex justify-between">
                      <span>Duration</span>
                      <span className="text-factory-300">{plan.duration}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>VRAM Required</span>
                      <span className="text-factory-300">{plan.vram}</span>
                    </div>
                  </div>
                  <button className="btn btn-primary w-full mt-4">
                    Start Training
                  </button>
                </div>
              ))}
            </div>

            <div className="text-center">
              <Link href="/training" className="btn btn-secondary">
                View All Training Options
              </Link>
            </div>
          </div>
        )}

        {tab === 'versions' && (
          <div className="card divide-y divide-factory-800">
            {versionsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-accent-400" />
              </div>
            ) : displayVersions.length > 0 ? (
              displayVersions.map((version, i) => (
                <div key={version.version} className="p-4 hover:bg-factory-800/50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold text-factory-100">
                        {version.version}
                      </span>
                      {i === 0 && <span className="badge badge-success">Latest</span>}
                    </div>
                    <button className="btn btn-ghost text-sm">
                      <Download className="w-4 h-4" />
                      Download
                    </button>
                  </div>
                  <p className="text-factory-400 text-sm mb-2">{version.notes}</p>
                  <span className="text-factory-500 text-sm flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDate(version.date)}
                  </span>
                </div>
              ))
            ) : (
              <p className="p-4 text-factory-500">No versions available</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
