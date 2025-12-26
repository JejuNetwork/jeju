import type {
  CommunicationTone,
  ConnectorType,
  DecisionStyle,
} from '../types/dao'
import { GitBranch, MessageSquare, type LucideIcon } from 'lucide-react'

export interface ModelOption {
  id: string
  name: string
  provider: string
  tier: 'lite' | 'standard' | 'pro'
  description: string
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'claude-opus-4-5-20250514',
    name: 'Claude Opus 4.5',
    provider: 'Anthropic',
    tier: 'pro',
    description: 'Most capable model',
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    tier: 'standard',
    description: 'Balanced performance',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    tier: 'standard',
    description: 'Fast multimodal',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    tier: 'lite',
    description: 'Cost-effective',
  },
]

export const TONE_OPTIONS: { value: CommunicationTone; label: string }[] = [
  { value: 'formal', label: 'Formal' },
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'playful', label: 'Playful' },
  { value: 'authoritative', label: 'Authoritative' },
]

export const DECISION_STYLE_OPTIONS: {
  value: DecisionStyle
  label: string
  description: string
}[] = [
  {
    value: 'aggressive',
    label: 'Aggressive',
    description: 'Bias toward action',
  },
  { value: 'balanced', label: 'Balanced', description: 'Weighs pros/cons' },
  { value: 'conservative', label: 'Conservative', description: 'Risk-averse' },
]

export interface ConnectorOption {
  type: ConnectorType
  label: string
  icon: LucideIcon
  description: string
}

export const CONNECTOR_OPTIONS: ConnectorOption[] = [
  {
    type: 'farcaster',
    label: 'Farcaster',
    icon: MessageSquare,
    description: 'Post and monitor',
  },
  {
    type: 'github',
    label: 'GitHub',
    icon: GitBranch,
    description: 'Review PRs',
  },
  {
    type: 'discord',
    label: 'Discord',
    icon: MessageSquare,
    description: 'Announcements',
  },
  {
    type: 'telegram',
    label: 'Telegram',
    icon: MessageSquare,
    description: 'Group posts',
  },
  {
    type: 'twitter',
    label: 'Twitter/X',
    icon: MessageSquare,
    description: 'Updates',
  },
]
