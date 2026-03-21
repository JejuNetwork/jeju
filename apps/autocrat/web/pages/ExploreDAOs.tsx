import {
  Bot,
  Compass,
  Paperclip,
  Send,
  UserPlus,
  Wallet,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDAOs } from '../hooks/useDAO'

// Reusable DAO app card matching the Figma "appCard" component
interface ExploreDAOCardProps {
  name: string
  description: string
  version: string
  iconBg: string
  iconLetter: string
  blockchain: string
  structure: string
  members: number
}

function ExploreDAOCard({
  name,
  description,
  version,
  iconBg,
  iconLetter,
  blockchain,
  structure,
  members,
}: ExploreDAOCardProps) {
  return (
    <div className="card-dao cursor-pointer">
      {/* Background overlay */}
      <div className="relative">
        <div
          className="absolute left-7 top-[70px] right-7 h-[102px]"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.08)' }}
        />
      </div>

      {/* Content */}
      <div className="px-7 pt-9 pb-4">
        <div className="flex gap-4">
          <div
            className="w-[70px] h-[70px] rounded-2xl shrink-0 flex items-center justify-center text-2xl font-bold text-white"
            style={{
              background: iconBg,
              border: '1px solid rgba(255, 255, 255, 0.5)',
            }}
          >
            {iconLetter}
          </div>
          <div className="space-y-2 min-w-0">
            <h3 className="text-white font-semibold">{name}</h3>
            <p className="text-sm text-white/80 leading-relaxed line-clamp-2">
              {description}
            </p>
            <p className="text-sm text-white/60">{version}</p>
          </div>
        </div>
        <div className="h-px bg-white mt-4" />
      </div>

      {/* Stats */}
      <div className="px-7 pb-5 flex justify-between">
        <div className="text-center">
          <p className="text-white text-sm font-medium">Blockchain</p>
          <div className="flex items-center gap-1 mt-1 justify-center">
            <svg
              className="w-3 h-3 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
            <span className="text-white text-sm">{blockchain}</span>
          </div>
        </div>
        <div className="text-center">
          <p className="text-white text-sm font-medium">Structure</p>
          <div className="flex items-center gap-1 mt-1 justify-center">
            <Compass className="w-3 h-3 text-white" aria-hidden="true" />
            <span className="text-white text-sm">{structure}</span>
          </div>
        </div>
        <div className="text-center">
          <p className="text-white text-sm font-medium">Members</p>
          <span className="text-white text-sm">{members}</span>
        </div>
      </div>
    </div>
  )
}

// Section header card matching the "AutopoolCard" from Figma
function SectionHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}) {
  return (
    <div className="section-header-dark">
      <h3 className="text-2xl font-semibold" style={{ color: '#d0d5dd' }}>
        {title}
      </h3>
      <p className="text-sm mt-1" style={{ color: '#f9fafb' }}>
        {subtitle}
      </p>
    </div>
  )
}

export default function ExploreDAOsPage() {
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<string[]>([
    'According to the DAO parameters this week decisions have been made by @trauedemeri, who proposed a funding initiative for proposal B. Agents 1-2 agreed on terms, Agent 3 proposes follow up questions. Agent 1 and 2 consider adding more human participants to act in alignment with the Hierarchy of decision-making, referring to the .pdf ruleset. Would you like to add more friends to this discussion?',
  ])

  const { data: daos = [] } = useDAOs({})

  // Sample DAO data for the explore page
  const popularDAOs: ExploreDAOCardProps[] = [
    {
      name: 'Humanitarian ECO DAO',
      description:
        'Building sustainable solutions for communities worldwide through decentralized coordination.',
      version: 'v1.2.0',
      iconBg: 'linear-gradient(135deg, #065f46, #34d399)',
      iconLetter: 'H',
      blockchain: 'Ethereum',
      structure: 'NFT-Based',
      members: 128,
    },
    {
      name: 'EMBERQUILL STUDIOS',
      description:
        'Over 50 tight-knit art buddies collaborating on digital art, NFTs, and creative projects.',
      version: 'v2.0.1',
      iconBg: 'linear-gradient(135deg, #b45309, #ea580c)',
      iconLetter: 'E',
      blockchain: 'Ethereum',
      structure: 'NFT-Based',
      members: 128,
    },
  ]

  const freshDAOs: ExploreDAOCardProps[] = [
    {
      name: 'Autocrat DAO',
      description:
        'AI-powered governance with transparent on-chain management and autonomous agents.',
      version: 'v1.0.0',
      iconBg: 'linear-gradient(135deg, #8B5CF6, #6366F1)',
      iconLetter: 'A',
      blockchain: 'Ethereum',
      structure: 'NFT-Based',
      members: 128,
    },
    {
      name: 'DeFi Collective',
      description:
        'Community-driven decentralized finance protocols and yield optimization strategies.',
      version: 'v0.9.0',
      iconBg: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
      iconLetter: 'D',
      blockchain: 'Ethereum',
      structure: 'NFT-Based',
      members: 128,
    },
  ]

  return (
    <div style={{ backgroundColor: '#0b1120' }}>
      {/* Hero Banner */}
      <section
        className="relative overflow-hidden"
        style={{
          height: '241px',
          background: 'var(--gradient-hero-dashboard)',
          borderBottom: '3px solid transparent',
          borderImage: 'var(--gradient-rainbow-border) 1',
        }}
      >
        <div className="absolute left-9 top-[55px]">
          <h1 className="text-3xl font-bold text-white leading-tight">
            Explore DAOs
          </h1>
          <p className="text-sm text-white/80 mt-6 max-w-[500px] leading-relaxed">
            Agents need to update this dashboard, ask questions to each other,
            and suggest trades using a special way of talking.
          </p>
        </div>
      </section>

      {/* Main Layout: Sidebar + Content */}
      <div className="flex">
        {/* Left Sidebar - Chat & Controls */}
        <aside
          className="hidden lg:flex shrink-0 flex-col"
          style={{
            width: '407px',
            borderRight: '1px solid rgba(255, 255, 255, 0.15)',
          }}
        >
          {/* Header Bar */}
          <div className="sidebar-header">
            <span className="text-xs font-semibold tracking-widest text-rainbow">
              {'>'} AUTOCRAT UI V.3.23.41
            </span>
          </div>

          {/* Chat Messages */}
          <div
            className="flex-1 p-4 overflow-y-auto"
            style={{
              backgroundColor: 'var(--color-sidebar-bg)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
              minHeight: '280px',
            }}
          >
            {chatMessages.map((msg, i) => (
              <p
                key={`msg-${i}`}
                className="text-sm text-white/90 leading-relaxed mb-3"
              >
                {msg}
              </p>
            ))}
          </div>

          {/* Chat Input Area */}
          <div
            className="p-3"
            style={{
              backgroundColor: 'var(--color-sidebar-bg)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
            }}
          >
            <div
              className="rounded-none p-3 mb-3"
              style={{
                backgroundColor: 'var(--color-sidebar-header)',
                border: '1px solid var(--color-sidebar-border)',
                minHeight: '100px',
              }}
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Or type to the agent to filter based on preferences..."
                className="w-full bg-transparent text-sm text-white placeholder-white/50 outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && chatInput.trim()) {
                    setChatMessages((prev) => [...prev, chatInput.trim()])
                    setChatInput('')
                  }
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                if (chatInput.trim()) {
                  setChatMessages((prev) => [...prev, chatInput.trim()])
                  setChatInput('')
                }
              }}
              className="w-full py-2 text-sm text-white font-medium flex items-center justify-center gap-2 transition-all hover:brightness-110"
              style={{
                border: '1px solid transparent',
                borderImage: 'var(--gradient-rainbow-border) 1',
              }}
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              Send
            </button>
          </div>

          {/* Action Buttons Grid */}
          <div className="p-3 grid grid-cols-2 gap-2">
            {[
              { label: 'ATTACHMENTS', icon: Paperclip },
              { label: 'ATTACHMENTS', icon: Paperclip },
              { label: 'AGENT LIST', icon: Bot },
              { label: 'AGENT LIST', icon: Bot },
              { label: 'AGENT LIST', icon: Bot },
              { label: 'AGENT LIST', icon: Bot },
              { label: 'ADD FRIENDS', icon: UserPlus },
              { label: 'ADD FRIENDS', icon: UserPlus },
              { label: 'ADD FRIENDS', icon: UserPlus },
              { label: 'ADD FRIENDS', icon: UserPlus },
            ].map((btn, i) => {
              const BtnIcon = btn.icon
              return (
                <button
                  key={`action-${i}`}
                  type="button"
                  className="sidebar-action-btn"
                >
                  <BtnIcon
                    className="w-3 h-3 opacity-60"
                    aria-hidden="true"
                  />
                  {btn.label}
                </button>
              )
            })}
          </div>

          {/* Deposit Funds Card */}
          <div className="card-frosted mx-3 mb-3 px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-8 h-8 shrink-0" style={{ color: '#44dee9' }} aria-hidden="true" />
              <div>
                <p className="text-white text-sm font-medium">Deposit Funds</p>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary-light)' }}>&mdash;</p>
              </div>
            </div>
            <button
              type="button"
              className="text-xs font-medium px-2 py-2 transition-colors hover:opacity-80"
              style={{ color: '#ababe9' }}
            >
              Connect
            </button>
          </div>

          {/* Account Balance Card */}
          <div className="card-frosted mx-3 mb-3 px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Wallet className="w-8 h-8 shrink-0" style={{ color: '#f575c2' }} aria-hidden="true" />
              <div>
                <p className="text-white text-sm font-medium">Account Balance</p>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary-light)' }}>&mdash;</p>
              </div>
            </div>
            <button
              type="button"
              className="text-xs font-medium px-2 py-2 transition-colors hover:opacity-80"
              style={{ color: '#ababe9' }}
            >
              View Wallet
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 py-4">
          {/* Stats Row */}
          <div className="px-6 py-4">
            <div className="flex gap-3 justify-center">
              {[
                { label: 'Chain', value: 'Ethereum' },
                { label: 'APY', value: '8.54%' },
                { label: 'TVL', value: '$30.93M' },
                { label: 'Plug-Ins', value: '6 tokens' },
                { label: 'Daily Returns', value: '1.31 ETH' },
              ].map((stat) => (
                <div key={stat.label} className="stat-card-dark flex-1 max-w-[180px]">
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-stat-label)' }}>
                    {stat.label}
                  </p>
                  <p className="text-sm font-semibold text-white mt-0.5">{stat.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Gradient Divider */}
          <div className="px-6 py-4">
            <div className="gradient-divider" />
          </div>

          {/* Popular DAOs Section */}
          <div className="px-6 space-y-5">
            <SectionHeader
              title="Popular DAOs"
              subtitle="Large swinging capital and large swinging chats."
            />

            <div className="grid gap-5 md:grid-cols-2 max-w-[820px] mx-auto">
              {popularDAOs.map((dao) => (
                <Link key={dao.name} to={`/dao/${dao.name.toLowerCase().replace(/\s+/g, '-')}`}>
                  <ExploreDAOCard {...dao} />
                </Link>
              ))}
            </div>
          </div>

          {/* Fresh DAOs Section */}
          <div className="px-6 mt-6 space-y-5">
            <SectionHeader
              title="Fresh DAOs"
              subtitle="Large swinging capital and large swinging chats."
            />

            <div className="grid gap-5 md:grid-cols-2 max-w-[820px] mx-auto">
              {freshDAOs.map((dao) => (
                <Link key={dao.name} to={`/dao/${dao.name.toLowerCase().replace(/\s+/g, '-')}`}>
                  <ExploreDAOCard {...dao} />
                </Link>
              ))}

              {/* Also render any dynamic DAOs from the API */}
              {daos.slice(0, 2).map((dao) => (
                <Link key={dao.daoId} to={`/dao/${dao.daoId}`}>
                  <ExploreDAOCard
                    name={dao.displayName}
                    description={dao.description || 'An AI-governed DAO'}
                    version="v1.0.0"
                    iconBg="linear-gradient(135deg, #8B5CF6, #6366F1)"
                    iconLetter={dao.displayName.charAt(0).toUpperCase()}
                    blockchain="Ethereum"
                    structure="NFT-Based"
                    members={dao.memberCount || 0}
                  />
                </Link>
              ))}
            </div>
          </div>

          {/* Bottom spacer */}
          <div className="h-20" />
        </main>
      </div>
    </div>
  )
}
