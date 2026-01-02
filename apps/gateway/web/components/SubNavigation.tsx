import type { LucideIcon } from 'lucide-react'

export interface SubNavTab {
  id: string
  label: string
  icon?: LucideIcon
}

interface SubNavigationProps {
  tabs: SubNavTab[]
  activeTab: string
  onTabChange: (tabId: string) => void
}

export function SubNavigation({
  tabs,
  activeTab,
  onTabChange,
}: SubNavigationProps) {
  return (
    <div className="sub-tab-container">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={`sub-tab ${activeTab === id ? 'sub-tab-active' : ''}`}
          onClick={() => onTabChange(id)}
        >
          {Icon && <Icon size={16} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
