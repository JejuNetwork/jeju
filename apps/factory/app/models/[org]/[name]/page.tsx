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
  ExternalLink,
  Shield,
  Tag,
  Cpu,
  HardDrive,
  Users,
  History,
  Zap,
  Settings,
  Terminal,
  Send,
  Loader2,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';

type ModelTab = 'model-card' | 'files' | 'inference' | 'training' | 'versions';

interface ModelData {
  id: string;
  name: string;
  organization: string;
  description: string;
  type: 'llm' | 'vision' | 'audio' | 'embedding' | 'multimodal';
  task: string;
  framework: string;
  parameters: string;
  precision: string;
  license: string;
  downloads: number;
  stars: number;
  forks: number;
  lastUpdated: number;
  createdAt: number;
  isVerified: boolean;
  tags: string[];
  hasInference: boolean;
  inferenceEndpoint?: string;
  files: { name: string; size: string; type: string }[];
  readme: string;
  versions: { version: string; date: number; notes: string }[];
  computeRequirements: {
    minVram: string;
    recommendedVram: string;
    architecture: string[];
  };
}

const mockModel: ModelData = {
  id: '0x1234',
  name: 'llama-3-jeju-ft',
  organization: 'jeju',
  description: 'LLaMA 3 8B fine-tuned on Jeju Network documentation, smart contract code, and developer discussions. Optimized for Web3 development assistance, code generation, and technical explanations.',
  type: 'llm',
  task: 'Text Generation',
  framework: 'PyTorch',
  parameters: '8B',
  precision: 'bfloat16',
  license: 'LLAMA2',
  downloads: 12500,
  stars: 342,
  forks: 45,
  lastUpdated: Date.now() - 2 * 24 * 60 * 60 * 1000,
  createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
  isVerified: true,
  tags: ['llm', 'code', 'jeju', 'fine-tuned', 'web3', 'solidity', 'ethereum'],
  hasInference: true,
  inferenceEndpoint: 'https://inference.jeju.network/v1/models/jeju/llama-3-jeju-ft',
  files: [
    { name: 'model.safetensors', size: '15.2 GB', type: 'model' },
    { name: 'config.json', size: '1.2 KB', type: 'config' },
    { name: 'tokenizer.json', size: '4.8 MB', type: 'tokenizer' },
    { name: 'tokenizer_config.json', size: '456 B', type: 'config' },
    { name: 'special_tokens_map.json', size: '234 B', type: 'config' },
    { name: 'README.md', size: '8.4 KB', type: 'docs' },
  ],
  versions: [
    { version: 'v1.2.0', date: Date.now() - 2 * 24 * 60 * 60 * 1000, notes: 'Improved code generation quality' },
    { version: 'v1.1.0', date: Date.now() - 14 * 24 * 60 * 60 * 1000, notes: 'Added Solidity fine-tuning data' },
    { version: 'v1.0.0', date: Date.now() - 30 * 24 * 60 * 60 * 1000, notes: 'Initial release' },
  ],
  computeRequirements: {
    minVram: '16 GB',
    recommendedVram: '24 GB',
    architecture: ['NVIDIA A100', 'NVIDIA H100', 'NVIDIA RTX 4090'],
  },
  readme: `# LLaMA 3 Jeju Fine-Tuned

A fine-tuned version of Meta's LLaMA 3 8B model, specifically trained for Web3 development assistance.

## Model Description

This model has been fine-tuned on:
- Jeju Network documentation and codebase
- Smart contract examples (Solidity, Vyper)
- DeFi protocol implementations
- Security audit reports
- Developer discussions and Q&A

## Intended Uses

- **Code Generation**: Generate Solidity smart contracts, TypeScript SDK code, and more
- **Code Explanation**: Explain complex smart contract logic
- **Bug Detection**: Identify potential security vulnerabilities
- **Documentation**: Generate technical documentation

## Usage

\`\`\`python
from transformers import AutoModelForCausalLM, AutoTokenizer

model = AutoModelForCausalLM.from_pretrained("jeju/llama-3-jeju-ft")
tokenizer = AutoTokenizer.from_pretrained("jeju/llama-3-jeju-ft")

prompt = "Write a Solidity function that..."
inputs = tokenizer(prompt, return_tensors="pt")
outputs = model.generate(**inputs, max_length=512)
print(tokenizer.decode(outputs[0]))
\`\`\`

## Training

- **Base Model**: meta-llama/Meta-Llama-3-8B
- **Training Data**: 50K curated examples
- **Training Method**: QLoRA
- **Hardware**: 4x NVIDIA A100 80GB
- **Training Time**: 48 hours

## Limitations

- May generate plausible but incorrect code
- Should not be used for production smart contracts without review
- Limited knowledge of protocols released after training cutoff

## License

This model is released under the LLAMA 2 Community License.
`,
};

export default function ModelDetailPage() {
  const params = useParams();
  const org = params.org as string;
  const name = params.name as string;
  const { isConnected } = useAccount();
  
  const [tab, setTab] = useState<ModelTab>('model-card');
  const [copied, setCopied] = useState(false);
  const [isStarred, setIsStarred] = useState(false);
  
  // Inference state
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [inferenceConfig, setInferenceConfig] = useState({
    maxTokens: 256,
    temperature: 0.7,
    topP: 0.9,
  });

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

  const runInference = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    setResponse('');
    
    // Simulate streaming response
    const mockResponse = `Here's a Solidity function based on your request:

\`\`\`solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TokenVault {
    mapping(address => uint256) public balances;
    
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    
    function deposit() external payable {
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }
    
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
        emit Withdrawn(msg.sender, amount);
    }
}
\`\`\`

This contract provides basic deposit and withdraw functionality with proper events for tracking.`;

    // Simulate streaming
    for (let i = 0; i < mockResponse.length; i += 5) {
      await new Promise(r => setTimeout(r, 20));
      setResponse(mockResponse.slice(0, i + 5));
    }
    setResponse(mockResponse);
    setIsGenerating(false);
  };

  const typeColors = {
    llm: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    vision: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    audio: 'bg-green-500/20 text-green-400 border-green-500/30',
    embedding: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    multimodal: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  };

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
                    <span className="text-factory-400">{mockModel.organization}/</span>
                    {mockModel.name}
                  </h1>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={clsx('badge border', typeColors[mockModel.type])}>
                      {mockModel.type.toUpperCase()}
                    </span>
                    <span className="badge bg-factory-800 text-factory-300 border border-factory-700">
                      {mockModel.parameters}
                    </span>
                    {mockModel.isVerified && (
                      <span className="badge bg-green-500/20 text-green-400 border border-green-500/30">
                        <Shield className="w-3 h-3 mr-1" />
                        Verified
                      </span>
                    )}
                    {mockModel.hasInference && (
                      <span className="badge bg-blue-500/20 text-blue-400 border border-blue-500/30">
                        <Zap className="w-3 h-3 mr-1" />
                        Inference API
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-factory-400 max-w-2xl">{mockModel.description}</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setIsStarred(!isStarred)}
                className={clsx('btn text-sm', isStarred ? 'btn-primary' : 'btn-secondary')}
              >
                <Star className={clsx('w-4 h-4', isStarred && 'fill-current')} />
                {formatNumber(mockModel.stars)}
              </button>
              <button className="btn btn-secondary text-sm">
                <GitFork className="w-4 h-4" />
                {mockModel.forks}
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="flex items-center gap-3">
              <Download className="w-5 h-5 text-factory-500" />
              <div>
                <p className="font-semibold text-factory-100">{formatNumber(mockModel.downloads)}</p>
                <p className="text-factory-500 text-sm">Downloads</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Cpu className="w-5 h-5 text-factory-500" />
              <div>
                <p className="font-semibold text-factory-100">{mockModel.parameters}</p>
                <p className="text-factory-500 text-sm">Parameters</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <HardDrive className="w-5 h-5 text-factory-500" />
              <div>
                <p className="font-semibold text-factory-100">{mockModel.computeRequirements.minVram}</p>
                <p className="text-factory-500 text-sm">Min VRAM</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-factory-500" />
              <div>
                <p className="font-semibold text-factory-100">{formatDate(mockModel.lastUpdated)}</p>
                <p className="text-factory-500 text-sm">Updated</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto -mb-px">
            {([
              { id: 'model-card' as const, label: 'Model Card', icon: FileText },
              { id: 'files' as const, label: 'Files', icon: Code, count: mockModel.files.length },
              { id: 'inference' as const, label: 'Inference', icon: Play },
              { id: 'training' as const, label: 'Training', icon: Zap },
              { id: 'versions' as const, label: 'Versions', icon: History, count: mockModel.versions.length },
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
                <div className="prose prose-invert max-w-none prose-pre:bg-factory-950 prose-pre:border prose-pre:border-factory-800">
                  <ReactMarkdown>{mockModel.readme}</ReactMarkdown>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {/* Tags */}
              <div className="card p-6">
                <h3 className="font-semibold text-factory-100 mb-4">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {mockModel.tags.map((tag) => (
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
                    <span className="text-factory-300">{mockModel.task}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-factory-500">Framework</span>
                    <span className="text-factory-300">{mockModel.framework}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-factory-500">Precision</span>
                    <span className="text-factory-300">{mockModel.precision}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-factory-500">License</span>
                    <span className="text-factory-300">{mockModel.license}</span>
                  </div>
                </div>
              </div>

              {/* Compute Requirements */}
              <div className="card p-6">
                <h3 className="font-semibold text-factory-100 mb-4">Compute Requirements</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-factory-500">Min VRAM</span>
                    <span className="text-factory-300">{mockModel.computeRequirements.minVram}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-factory-500">Recommended</span>
                    <span className="text-factory-300">{mockModel.computeRequirements.recommendedVram}</span>
                  </div>
                  <div className="mt-3">
                    <span className="text-factory-500 block mb-2">Supported Hardware</span>
                    <div className="space-y-1">
                      {mockModel.computeRequirements.architecture.map((arch) => (
                        <span key={arch} className="badge bg-factory-800 text-factory-300 border border-factory-700 mr-1">
                          {arch}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'files' && (
          <div className="card divide-y divide-factory-800">
            {mockModel.files.map((file) => (
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

        {tab === 'inference' && (
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
                  placeholder="Enter your prompt here... e.g., 'Write a Solidity function that implements a simple token vault'"
                  className="input min-h-[120px] resize-none font-mono text-sm"
                />
                <div className="flex justify-end mt-4">
                  <button
                    onClick={runInference}
                    disabled={!prompt.trim() || isGenerating}
                    className="btn btn-primary"
                  >
                    {isGenerating ? (
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
                {response ? (
                  <div className="prose prose-invert max-w-none prose-pre:bg-factory-950 prose-pre:border prose-pre:border-factory-800">
                    <ReactMarkdown>{response}</ReactMarkdown>
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

              <div className="mt-6 pt-6 border-t border-factory-800">
                <h4 className="text-sm font-medium text-factory-300 mb-2">API Endpoint</h4>
                <code className="text-xs text-factory-500 block bg-factory-950 p-2 rounded break-all">
                  {mockModel.inferenceEndpoint}
                </code>
              </div>
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
            {mockModel.versions.map((version, i) => (
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

