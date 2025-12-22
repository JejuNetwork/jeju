import { Activity, AlertTriangle, Target, Zap, Search, type LucideIcon } from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: Activity },
  { href: '/alerts', label: 'Alerts', icon: AlertTriangle },
  { href: '/targets', label: 'Targets', icon: Target },
  { href: '/oif', label: 'OIF', icon: Zap },
  { href: '/query', label: 'Query', icon: Search },
]
