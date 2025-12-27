/**
 * Crucible Shared Constants
 */

export const BOT_TYPE_CONFIG = {
  ai_agent: {
    label: 'AI Agent',
    icon: '🤖',
    description: 'General-purpose conversational agent',
    badgeClass: 'badge-primary',
  },
  trading_bot: {
    label: 'Trading Bot',
    icon: '📈',
    description: 'Automated DeFi operations',
    badgeClass: 'badge-teal',
  },
  org_tool: {
    label: 'Org Tool',
    icon: '🏢',
    description: 'DAO and governance tooling',
    badgeClass: 'badge-violet',
  },
} as const

export type BotType = keyof typeof BOT_TYPE_CONFIG

export function getBotTypeConfig(botType: string) {
  return (
    BOT_TYPE_CONFIG[botType as BotType] ?? BOT_TYPE_CONFIG.ai_agent
  )
}

export const ROOM_TYPE_CONFIG = {
  collaboration: {
    label: 'Collaboration',
    icon: '🤝',
    description: 'Agents coordinate to solve problems together',
    color: 'var(--color-teal)',
  },
  adversarial: {
    label: 'Adversarial',
    icon: '⚔️',
    description: 'Red team vs blue team security exercises',
    color: 'var(--color-error)',
  },
  debate: {
    label: 'Debate',
    icon: '💬',
    description: 'Agents argue opposing viewpoints',
    color: 'var(--color-primary)',
  },
  council: {
    label: 'Council',
    icon: '🏛️',
    description: 'Weighted voting for group decisions',
    color: 'var(--color-violet)',
  },
} as const

export type RoomTypeKey = keyof typeof ROOM_TYPE_CONFIG

export function getRoomTypeConfig(roomType: string) {
  return (
    ROOM_TYPE_CONFIG[roomType as RoomTypeKey] ?? ROOM_TYPE_CONFIG.collaboration
  )
}

export const FEATURE_CARDS = [
  {
    href: '/agents',
    icon: '🤖',
    title: 'Agents',
    description: 'Register agents on-chain and manage their vaults',
    gradient: 'from-indigo-500 to-violet-500',
  },
  {
    href: '/chat',
    icon: '💬',
    title: 'Chat',
    description: 'Send messages to agents and view their responses',
    gradient: 'from-pink-500 to-rose-500',
  },
] as const

export const QUICK_START_STEPS = [
  {
    step: 1,
    title: 'Pick a Character',
    description: 'Select from pre-built agent templates',
  },
  {
    step: 2,
    title: 'Deploy On-Chain',
    description: 'Register the agent and fund its vault',
  },
  {
    step: 3,
    title: 'Interact',
    description: 'Chat directly or create multi-agent rooms',
  },
] as const

export const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/agents', label: 'Agents', icon: '🤖' },
  { href: '/chat', label: 'Chat', icon: '💬' },
] as const
