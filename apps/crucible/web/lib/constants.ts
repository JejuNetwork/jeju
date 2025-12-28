export const BOT_TYPE_CONFIG = {
  ai_agent: {
    label: 'AI Agent',
    icon: '🤖',
    badgeClass: 'badge-primary',
  },
  trading_bot: {
    label: 'Trading Bot',
    icon: '📈',
    badgeClass: 'badge-teal',
  },
  org_tool: {
    label: 'Org Tool',
    icon: '🏢',
    badgeClass: 'badge-violet',
  },
} as const

export type BotType = keyof typeof BOT_TYPE_CONFIG

export function getBotTypeConfig(botType: string) {
  return BOT_TYPE_CONFIG[botType as BotType] ?? BOT_TYPE_CONFIG.ai_agent
}

export const ROOM_TYPE_CONFIG = {
  collaboration: {
    label: 'Collaboration',
    icon: '🤝',
    color: 'var(--color-teal)',
  },
  adversarial: {
    label: 'Adversarial',
    icon: '⚔️',
    color: 'var(--color-error)',
  },
  debate: {
    label: 'Debate',
    icon: '💬',
    color: 'var(--color-primary)',
  },
  council: {
    label: 'Council',
    icon: '🏛️',
    color: 'var(--color-violet)',
  },
} as const

export type RoomTypeKey = keyof typeof ROOM_TYPE_CONFIG

export function getRoomTypeConfig(roomType: string) {
  return (
    ROOM_TYPE_CONFIG[roomType as RoomTypeKey] ?? ROOM_TYPE_CONFIG.collaboration
  )
}

export const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/agents', label: 'Agents' },
  { href: '/chat', label: 'Chat' },
] as const
