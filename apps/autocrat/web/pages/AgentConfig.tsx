import { Bot, ChevronRight, Cpu, Diamond, Heart, MessageSquare, RefreshCw, Shield, Star } from 'lucide-react'
import { useState } from 'react'

interface TreeNode {
  label: string
  icon?: typeof Bot
  avatar?: string
  disabled?: boolean
  children?: TreeNode[]
}

const agentTree: TreeNode[] = [
  {
    label: 'Azura Agent Configuration',
    avatar: 'https://i.imgur.com/HFjHyUZ.png',
    children: [
      {
        label: 'Personality Module',
        icon: Heart,
        children: [
          { label: 'Tone: Empathetic & Direct' },
          { label: 'Response Style: Conversational' },
          { label: 'Creativity: 0.7' },
          { label: 'Language: Multi-lingual' },
        ],
      },
      {
        label: 'Memory & Context',
        icon: Cpu,
        children: [
          { label: 'Session Memory: Enabled' },
          { label: 'Long-term Recall: Active' },
          { label: 'Context Window: 128k tokens' },
          { label: 'RAG Pipeline: Connected' },
        ],
      },
      {
        label: 'Skills & Capabilities',
        icon: Star,
        children: [
          { label: 'Journal Review' },
          { label: 'Quest Generation' },
          { label: 'Governance Advisor' },
          { label: 'Meditation Guide' },
          { label: 'Crisis Detection' },
        ],
      },
      {
        label: 'Wallet Integration',
        icon: Diamond,
        children: [
          { label: 'Auto-distribute Rewards' },
          { label: 'Treasury Monitoring' },
          { label: 'Gas Optimization: On' },
          { label: 'Network: Base Mainnet' },
        ],
      },
      {
        label: 'Safety & Moderation',
        icon: Shield,
        children: [
          { label: 'Content Filtering: Strict' },
          { label: 'Escalation Protocol: Active' },
          { label: 'Audit Logging: Enabled' },
        ],
      },
      {
        label: 'Scheduling & Automation',
        icon: RefreshCw,
        disabled: true,
        children: [
          { label: 'Cron Jobs: Paused' },
          { label: 'Event Triggers: Disabled' },
          { label: 'Batch Processing: Off' },
        ],
      },
    ],
  },
]

function TreeNodeRow({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle: (label: string) => void
}) {
  const hasChildren = node.children && node.children.length > 0
  const isExpanded = expanded.has(node.label)
  const Icon = node.icon

  return (
    <>
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-colors ${
          node.disabled
            ? 'opacity-40 cursor-not-allowed'
            : 'hover:bg-slate-800/60'
        }`}
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
        onClick={() => hasChildren && !node.disabled && onToggle(node.label)}
      >
        {hasChildren && (
          <ChevronRight
            size={14}
            className={`transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
            style={{ color: 'var(--text-tertiary)' }}
          />
        )}
        {!hasChildren && <span className="w-3.5 flex-shrink-0" />}
        {node.avatar && (
          <img
            src={node.avatar}
            alt="Azura"
            className="w-6 h-6 rounded-full border border-slate-600 flex-shrink-0"
          />
        )}
        {Icon && !node.avatar && (
          <Icon size={14} className="flex-shrink-0" style={{ color: 'var(--accent)' }} />
        )}
        <span
          className="text-sm font-medium"
          style={{ color: node.disabled ? 'var(--text-tertiary)' : 'var(--text-primary)' }}
        >
          {node.label}
        </span>
        {node.disabled && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Paused
          </span>
        )}
      </div>
      {hasChildren &&
        isExpanded &&
        node.children!.map((child) => (
          <TreeNodeRow
            key={child.label}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </>
  )
}

export default function AgentConfigPage() {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(['Azura Agent Configuration', 'Skills & Capabilities', 'Personality Module']),
  )

  const onToggle = (label: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Bot size={28} style={{ color: 'var(--accent)' }} />
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            AI Co-pilot
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Modular agent settings for Azura
          </p>
        </div>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderColor: 'var(--border)',
        }}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <span
            className="text-xs font-bold uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Modular Agent Settings
          </span>
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded"
            style={{
              backgroundColor: 'var(--bg-tertiary, rgba(255,255,255,0.05))',
              color: 'var(--text-tertiary)',
            }}
          >
            v1.3
          </span>
        </div>

        <div className="p-2">
          {agentTree.map((node) => (
            <TreeNodeRow
              key={node.label}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>

        <div
          className="flex items-center gap-2 px-4 py-3 border-t text-xs"
          style={{
            borderColor: 'var(--border)',
            color: 'var(--text-tertiary)',
          }}
        >
          <MessageSquare size={12} />
          Azura has reviewed 340 submissions this season
        </div>
      </div>
    </div>
  )
}
