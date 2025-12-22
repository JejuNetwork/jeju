'use client'

import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  BarChart3,
  Clock,
  Database,
  Download,
  Eye,
  FileText,
  Filter,
  HardDrive,
  Search,
  Shield,
  Star,
  Upload,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

interface Dataset {
  id: string
  name: string
  organization: string
  description: string
  type: 'text' | 'code' | 'image' | 'audio' | 'multimodal' | 'tabular'
  format: string
  size: string
  rows: number
  downloads: number
  stars: number
  lastUpdated: number
  license: string
  tags: string[]
  isVerified: boolean
  preview: { columns: string[]; sample: string[][] }
}

const mockDatasets: Dataset[] = [
  {
    id: '1',
    name: 'jeju-contracts-v2',
    organization: 'jeju',
    description:
      'Curated dataset of audited Solidity smart contracts with security annotations.',
    type: 'code',
    format: 'parquet',
    size: '2.3 GB',
    rows: 150000,
    downloads: 8420,
    stars: 234,
    lastUpdated: Date.now() - 3 * 24 * 60 * 60 * 1000,
    license: 'Apache-2.0',
    tags: ['solidity', 'smart-contracts', 'security', 'audited'],
    isVerified: true,
    preview: {
      columns: [
        'contract_name',
        'source_code',
        'vulnerabilities',
        'audit_score',
      ],
      sample: [
        ['ERC20Token', 'pragma solidity ^0.8...', '[]', '95'],
        ['Vault', 'contract Vault is...', '[reentrancy]', '78'],
      ],
    },
  },
  {
    id: '2',
    name: 'defi-protocols',
    organization: 'defi-research',
    description:
      'Comprehensive dataset of DeFi protocol implementations and documentation.',
    type: 'text',
    format: 'jsonl',
    size: '850 MB',
    rows: 45000,
    downloads: 3210,
    stars: 156,
    lastUpdated: Date.now() - 7 * 24 * 60 * 60 * 1000,
    license: 'MIT',
    tags: ['defi', 'protocols', 'documentation'],
    isVerified: true,
    preview: {
      columns: ['protocol', 'category', 'description', 'tvl'],
      sample: [
        ['Uniswap V3', 'DEX', 'Concentrated liquidity...', '$4.2B'],
        ['Aave V3', 'Lending', 'Multi-chain lending...', '$8.1B'],
      ],
    },
  },
  {
    id: '3',
    name: 'web3-qa-pairs',
    organization: 'community',
    description:
      'Question-answer pairs from Web3 developer forums and documentation.',
    type: 'text',
    format: 'csv',
    size: '420 MB',
    rows: 89000,
    downloads: 5670,
    stars: 312,
    lastUpdated: Date.now() - 14 * 24 * 60 * 60 * 1000,
    license: 'CC-BY-4.0',
    tags: ['qa', 'web3', 'education', 'finetuning'],
    isVerified: false,
    preview: {
      columns: ['question', 'answer', 'source', 'votes'],
      sample: [
        [
          'How do I deploy to Base?',
          'You can deploy using...',
          'Discord',
          '45',
        ],
        ['What is EIP-4844?', 'EIP-4844 introduces...', 'Forum', '128'],
      ],
    },
  },
  {
    id: '4',
    name: 'nft-metadata-collection',
    organization: 'art-dao',
    description: 'NFT metadata and IPFS content from major collections.',
    type: 'multimodal',
    format: 'parquet',
    size: '15.2 GB',
    rows: 1200000,
    downloads: 2340,
    stars: 189,
    lastUpdated: Date.now() - 30 * 24 * 60 * 60 * 1000,
    license: 'CC0-1.0',
    tags: ['nft', 'metadata', 'images', 'art'],
    isVerified: true,
    preview: {
      columns: ['collection', 'token_id', 'name', 'image_cid'],
      sample: [
        ['CryptoPunks', '7804', 'CryptoPunk #7804', 'Qm...'],
        ['Bored Apes', '1234', 'BAYC #1234', 'Qm...'],
      ],
    },
  },
]

const typeIcons: Record<string, React.ReactNode> = {
  text: <FileText className="w-4 h-4" />,
  code: <FileText className="w-4 h-4" />,
  image: <Eye className="w-4 h-4" />,
  audio: <BarChart3 className="w-4 h-4" />,
  multimodal: <Database className="w-4 h-4" />,
  tabular: <BarChart3 className="w-4 h-4" />,
}

// Remove unused typeIcons
void typeIcons

const typeColors: Record<string, string> = {
  text: 'bg-blue-500/20 text-blue-400',
  code: 'bg-purple-500/20 text-purple-400',
  image: 'bg-green-500/20 text-green-400',
  audio: 'bg-yellow-500/20 text-yellow-400',
  multimodal: 'bg-pink-500/20 text-pink-400',
  tabular: 'bg-cyan-500/20 text-cyan-400',
}

export default function DatasetsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'downloads' | 'stars' | 'updated'>(
    'downloads',
  )
  const [previewDataset, setPreviewDataset] = useState<Dataset | null>(null)

  const filteredDatasets = mockDatasets
    .filter(
      (d) =>
        !searchQuery ||
        d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.description.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .filter((d) => !selectedType || d.type === selectedType)
    .sort((a, b) => {
      if (sortBy === 'downloads') return b.downloads - a.downloads
      if (sortBy === 'stars') return b.stars - a.stars
      return b.lastUpdated - a.lastUpdated
    })

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-factory-100 flex items-center gap-3">
              <Database className="w-8 h-8 text-cyan-400" />
              Datasets
            </h1>
            <p className="text-factory-400 mt-1">
              Training data for AI models in the Jeju ecosystem
            </p>
          </div>
          <Link href="/models/datasets/upload" className="btn btn-primary">
            <Upload className="w-4 h-4" />
            Upload Dataset
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Datasets', value: '156', icon: Database },
            { label: 'Total Downloads', value: '234K', icon: Download },
            { label: 'Contributors', value: '89', icon: Users },
            { label: 'Total Size', value: '1.2 TB', icon: HardDrive },
          ].map((stat) => (
            <div key={stat.label} className="card p-4">
              <div className="flex items-center gap-3">
                <stat.icon className="w-8 h-8 text-factory-500" />
                <div>
                  <p className="text-2xl font-bold text-factory-100">
                    {stat.value}
                  </p>
                  <p className="text-factory-500 text-sm">{stat.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search datasets..."
                className="input pl-10"
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-factory-400" />
              <select
                value={selectedType || ''}
                onChange={(e) => setSelectedType(e.target.value || null)}
                className="input text-sm py-2"
              >
                <option value="">All types</option>
                <option value="text">Text</option>
                <option value="code">Code</option>
                <option value="image">Image</option>
                <option value="audio">Audio</option>
                <option value="multimodal">Multimodal</option>
                <option value="tabular">Tabular</option>
              </select>
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="input text-sm py-2"
            >
              <option value="downloads">Most downloads</option>
              <option value="stars">Most stars</option>
              <option value="updated">Recently updated</option>
            </select>
          </div>
        </div>

        {/* Dataset List */}
        <div className="space-y-4">
          {filteredDatasets.map((dataset) => (
            <div
              key={dataset.id}
              className="card p-6 hover:border-factory-600 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <Link
                      href={`/models/datasets/${dataset.organization}/${dataset.name}`}
                      className="text-lg font-semibold text-factory-100 hover:text-accent-400"
                    >
                      {dataset.organization}/{dataset.name}
                    </Link>
                    {dataset.isVerified && (
                      <div title="Verified">
                        <Shield className="w-4 h-4 text-green-400" />
                      </div>
                    )}
                    <span
                      className={clsx(
                        'badge text-xs',
                        typeColors[dataset.type],
                      )}
                    >
                      {dataset.type}
                    </span>
                  </div>

                  <p className="text-factory-400 mb-3">{dataset.description}</p>

                  <div className="flex items-center gap-4 text-sm text-factory-500 mb-3">
                    <span className="flex items-center gap-1">
                      <HardDrive className="w-4 h-4" />
                      {dataset.size}
                    </span>
                    <span className="flex items-center gap-1">
                      <BarChart3 className="w-4 h-4" />
                      {dataset.rows.toLocaleString()} rows
                    </span>
                    <span className="flex items-center gap-1">
                      <Download className="w-4 h-4" />
                      {dataset.downloads.toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Star className="w-4 h-4" />
                      {dataset.stars}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {formatDistanceToNow(dataset.lastUpdated, {
                        addSuffix: true,
                      })}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {dataset.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="badge bg-factory-800 text-factory-400 text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                    {dataset.tags.length > 4 && (
                      <span className="text-factory-500 text-xs">
                        +{dataset.tags.length - 4} more
                      </span>
                    )}
                    <span className="text-factory-600">·</span>
                    <span className="text-factory-500 text-xs">
                      {dataset.license}
                    </span>
                    <span className="text-factory-600">·</span>
                    <span className="text-factory-500 text-xs font-mono">
                      {dataset.format}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() =>
                      setPreviewDataset(
                        previewDataset?.id === dataset.id ? null : dataset,
                      )
                    }
                    className="btn btn-secondary text-sm"
                  >
                    <Eye className="w-4 h-4" />
                    Preview
                  </button>
                  <Link
                    href={`/models/datasets/${dataset.organization}/${dataset.name}`}
                    className="btn btn-primary text-sm"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </Link>
                </div>
              </div>

              {/* Preview Panel */}
              {previewDataset?.id === dataset.id && (
                <div className="mt-4 pt-4 border-t border-factory-800">
                  <h4 className="text-sm font-medium text-factory-300 mb-2">
                    Data Preview
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-factory-800">
                          {dataset.preview.columns.map((col) => (
                            <th
                              key={col}
                              className="px-3 py-2 text-left text-factory-400 font-medium"
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataset.preview.sample.map((row, i) => (
                          <tr key={i} className="border-t border-factory-800">
                            {row.map((cell, j) => (
                              <td
                                key={j}
                                className="px-3 py-2 text-factory-300 font-mono truncate max-w-[200px]"
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))}

          {filteredDatasets.length === 0 && (
            <div className="card p-12 text-center">
              <Database className="w-12 h-12 mx-auto mb-4 text-factory-600" />
              <p className="text-factory-400">No datasets found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
