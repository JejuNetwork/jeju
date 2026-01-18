import { clsx } from 'clsx'
import {
  Bot,
  Box,
  Brain,
  Briefcase,
  DollarSign,
  GitBranch,
  HelpCircle,
  Home,
  LayoutDashboard,
  Mail,
  Package,
  Play,
  Search,
  Settings,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface CommandItem {
  id: string
  title: string
  description?: string
  icon: React.ComponentType<{ className?: string }>
  href?: string
  action?: () => void
  category: string
}

const commands: CommandItem[] = [
  // Navigation
  {
    id: 'home',
    title: 'Go to Home',
    icon: Home,
    href: '/',
    category: 'Navigation',
  },
  {
    id: 'bounties',
    title: 'Go to Bounties',
    icon: DollarSign,
    href: '/bounties',
    category: 'Navigation',
  },
  {
    id: 'jobs',
    title: 'Go to Jobs',
    icon: Briefcase,
    href: '/jobs',
    category: 'Navigation',
  },
  {
    id: 'git',
    title: 'Go to Repositories',
    icon: GitBranch,
    href: '/git',
    category: 'Navigation',
  },
  {
    id: 'packages',
    title: 'Go to Packages',
    icon: Package,
    href: '/packages',
    category: 'Navigation',
  },
  {
    id: 'containers',
    title: 'Go to Containers',
    icon: Box,
    href: '/containers',
    category: 'Navigation',
  },
  {
    id: 'projects',
    title: 'Go to Projects',
    icon: LayoutDashboard,
    href: '/projects',
    category: 'Navigation',
  },
  {
    id: 'ci',
    title: 'Go to CI/CD',
    icon: Play,
    href: '/ci',
    category: 'Navigation',
  },
  {
    id: 'models',
    title: 'Go to Models',
    icon: Brain,
    href: '/models',
    category: 'Navigation',
  },
  {
    id: 'agents',
    title: 'Go to Agents',
    icon: Bot,
    href: '/agents',
    category: 'Navigation',
  },
  {
    id: 'messages',
    title: 'Go to Messages',
    icon: Mail,
    href: '/messages',
    category: 'Navigation',
  },
  {
    id: 'settings',
    title: 'Go to Settings',
    icon: Settings,
    href: '/settings',
    category: 'Navigation',
  },
  {
    id: 'help',
    title: 'Go to Help',
    icon: HelpCircle,
    href: '/help',
    category: 'Navigation',
  },

  // Actions
  {
    id: 'create-bounty',
    title: 'Create Bounty',
    description: 'Create a new bounty',
    icon: DollarSign,
    href: '/bounties/create',
    category: 'Actions',
  },
  {
    id: 'post-job',
    title: 'Post Job',
    description: 'Post a new job listing',
    icon: Briefcase,
    href: '/jobs/create',
    category: 'Actions',
  },
  {
    id: 'new-repo',
    title: 'New Repository',
    description: 'Create a new repository',
    icon: GitBranch,
    href: '/git/new',
    category: 'Actions',
  },
  {
    id: 'new-project',
    title: 'New Project',
    description: 'Create a new project',
    icon: LayoutDashboard,
    href: '/projects/new',
    category: 'Actions',
  },
]

export function CommandPalette() {
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter commands
  const filteredCommands = query
    ? commands.filter(
        (cmd) =>
          cmd.title.toLowerCase().includes(query.toLowerCase()) ||
          cmd.description?.toLowerCase().includes(query.toLowerCase()),
      )
    : commands

  const categories = [...new Set(filteredCommands.map((c) => c.category))]

  // Keyboard shortcut to open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0,
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1,
          )
          break
        case 'Enter': {
          e.preventDefault()
          const selected = filteredCommands[selectedIndex]
          if (selected) {
            if (selected.href) {
              navigate(selected.href)
            } else if (selected.action) {
              selected.action()
            }
            setIsOpen(false)
          }
          break
        }
        case 'Escape':
          setIsOpen(false)
          break
      }
    },
    [filteredCommands, selectedIndex, navigate],
  )

  // Scroll selected into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return

    const selected = list.children[selectedIndex] as HTMLElement
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-surface-950/80 backdrop-blur-sm border-0"
        onClick={() => setIsOpen(false)}
        aria-label="Close command palette"
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl overflow-hidden animate-in">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-800">
          <Search className="w-5 h-5 text-surface-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent border-none focus:outline-none text-surface-100 placeholder-surface-500"
          />
          <kbd className="hidden sm:inline-block px-2 py-1 text-xs bg-surface-800 text-surface-500 rounded">
            ESC
          </kbd>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="sm:hidden p-1 text-surface-500 hover:text-surface-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto custom-scrollbar py-2"
        >
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-surface-500">
              No results found
            </div>
          ) : (
            categories.map((category) => (
              <div key={category}>
                <div className="px-4 py-2 text-xs font-medium text-surface-500 uppercase tracking-wider">
                  {category}
                </div>
                {filteredCommands
                  .filter((c) => c.category === category)
                  .map((command) => {
                    const globalIndex = filteredCommands.indexOf(command)
                    const isSelected = globalIndex === selectedIndex

                    return (
                      <button
                        key={command.id}
                        type="button"
                        className={clsx(
                          'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                          isSelected
                            ? 'bg-factory-500/15 text-factory-400'
                            : 'text-surface-300 hover:bg-surface-800',
                        )}
                        onClick={() => {
                          if (command.href) {
                            navigate(command.href)
                          } else if (command.action) {
                            command.action()
                          }
                          setIsOpen(false)
                        }}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                      >
                        <command.icon className="w-5 h-5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {command.title}
                          </p>
                          {command.description && (
                            <p className="text-sm text-surface-500 truncate">
                              {command.description}
                            </p>
                          )}
                        </div>
                        {isSelected && (
                          <kbd className="hidden sm:inline-block px-2 py-0.5 text-xs bg-surface-800 text-surface-500 rounded">
                            ↵
                          </kbd>
                        )}
                      </button>
                    )
                  })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="hidden sm:flex items-center justify-between px-4 py-2 border-t border-surface-800 text-xs text-surface-500">
          <div className="flex items-center gap-4">
            <span>
              <kbd className="px-1.5 py-0.5 bg-surface-800 rounded">↑</kbd>{' '}
              <kbd className="px-1.5 py-0.5 bg-surface-800 rounded">↓</kbd> to
              navigate
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-surface-800 rounded">↵</kbd> to
              select
            </span>
          </div>
          <span>
            <kbd className="px-1.5 py-0.5 bg-surface-800 rounded">⌘K</kbd> to
            toggle
          </span>
        </div>
      </div>
    </div>
  )
}
