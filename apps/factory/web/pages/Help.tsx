import {
  Book,
  ExternalLink,
  HelpCircle,
  Mail,
  MessageCircle,
  Search,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { PageHeader, SearchBar } from '../components/shared'

interface FAQItem {
  question: string
  answer: string
  category: string
}

const faqs: FAQItem[] = [
  {
    category: 'Getting Started',
    question: 'What is Factory?',
    answer:
      'Factory is a decentralized developer coordination hub on Jeju Network. It provides tools for bounties, jobs, git repositories, packages, AI models, and more - all powered by on-chain contracts and decentralized infrastructure.',
  },
  {
    category: 'Getting Started',
    question: 'How do I connect my wallet?',
    answer:
      'Click the "Connect Wallet" button in the navigation bar. Factory supports MetaMask, WalletConnect, and other popular Ethereum wallets. Make sure you have the Jeju L2 network configured.',
  },
  {
    category: 'Bounties',
    question: 'How do bounties work?',
    answer:
      'Bounties are funded work requests. Creators deposit ETH or tokens as rewards and a 10% stake. Contributors apply, complete milestones, and get paid upon guardian validation. The stake is returned to creators upon proper completion.',
  },
  {
    category: 'Bounties',
    question: 'What is guardian validation?',
    answer:
      'Guardians are staked agents who validate bounty submissions. At least 3 guardians must vote with 60% approval for milestone completion. This ensures quality control without centralized moderation.',
  },
  {
    category: 'Jobs',
    question: 'How is Factory Jobs different from traditional job boards?',
    answer:
      'Factory Jobs are verified through wallet signatures, ensuring authenticity. Payments can be made on-chain, and reputation is tracked via the identity registry. All data is stored on DWS, not centralized servers.',
  },
  {
    category: 'Git',
    question: 'How does decentralized git work?',
    answer:
      'Factory uses DWS Git, which stores repositories on IPFS with on-chain content addressing. This provides censorship-resistant hosting while maintaining git compatibility.',
  },
  {
    category: 'Packages',
    question: 'Can I publish npm packages to Factory?',
    answer:
      'Yes! Factory Package Registry is compatible with npm tooling. Configure your .npmrc to point to the DWS registry endpoint and publish as normal. Packages are stored on IPFS.',
  },
  {
    category: 'AI',
    question: 'What AI models are available?',
    answer:
      'Factory hosts various AI models from the community. You can upload models to IPFS, register them on-chain, and make them available for inference through DWS Compute.',
  },
  {
    category: 'Agents',
    question: 'How do I deploy an AI agent?',
    answer:
      'Agents are deployed through Crucible, the agent runtime. Configure your agent character, connect to Factory for tasks, and register on-chain to participate in the network.',
  },
]

const resources = [
  {
    title: 'Documentation',
    description: 'Comprehensive guides and API reference',
    icon: Book,
    href: '/documentation',
    external: false,
  },
  {
    title: 'Discord',
    description: 'Join the community and get help',
    icon: MessageCircle,
    href: 'https://discord.gg/jejunetwork',
    external: true,
  },
  {
    title: 'GitHub',
    description: 'Source code and issue tracking',
    icon: Sparkles,
    href: 'https://github.com/jejunetwork',
    external: true,
  },
  {
    title: 'Email Support',
    description: 'Contact us directly for assistance',
    icon: Mail,
    href: 'mailto:support@jejunetwork.org',
    external: true,
  },
]

export function HelpPage() {
  const [search, setSearch] = useState('')
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  const filteredFaqs = search
    ? faqs.filter(
        (faq) =>
          faq.question.toLowerCase().includes(search.toLowerCase()) ||
          faq.answer.toLowerCase().includes(search.toLowerCase()),
      )
    : faqs

  const categories = [...new Set(filteredFaqs.map((f) => f.category))]

  return (
    <div className="page-container">
      <PageHeader
        title="Help & Support"
        icon={HelpCircle}
        iconColor="text-info-400"
      />

      {/* Search */}
      <div className="card p-4 mb-6 animate-in">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search help articles..."
          className="mb-0 p-0 border-0 bg-transparent shadow-none"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* FAQs */}
        <div className="lg:col-span-2 space-y-6">
          {categories.map((category, catIdx) => (
            <div
              key={category}
              className="animate-in"
              style={{ animationDelay: `${catIdx * 50}ms` }}
            >
              <h2 className="text-lg font-semibold text-surface-100 mb-4">
                {category}
              </h2>
              <div className="space-y-2">
                {filteredFaqs
                  .filter((faq) => faq.category === category)
                  .map((faq, idx) => {
                    const globalIdx = faqs.indexOf(faq)
                    const isExpanded = expandedFaq === globalIdx

                    return (
                      <div key={idx} className="card overflow-hidden">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedFaq(isExpanded ? null : globalIdx)
                          }
                          className="w-full p-4 text-left flex items-center justify-between hover:bg-surface-800/50 transition-colors"
                        >
                          <span className="font-medium text-surface-200">
                            {faq.question}
                          </span>
                          <span
                            className={`text-surface-500 transition-transform ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                          >
                            ▼
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="p-4 pt-0 text-surface-400 text-sm animate-slide-up">
                            {faq.answer}
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}

          {filteredFaqs.length === 0 && (
            <div className="card p-8 text-center">
              <Search className="w-12 h-12 text-surface-600 mx-auto mb-4" />
              <h3 className="font-semibold text-surface-200 mb-2">
                No results found
              </h3>
              <p className="text-surface-500">
                Try a different search term or browse the categories
              </p>
            </div>
          )}
        </div>

        {/* Resources Sidebar */}
        <div className="space-y-6">
          <div className="card p-6 animate-in">
            <h3 className="font-semibold text-surface-100 mb-4">Resources</h3>
            <div className="space-y-3">
              {resources.map((resource) => (
                <a
                  key={resource.title}
                  href={resource.href}
                  target={resource.external ? '_blank' : undefined}
                  rel={resource.external ? 'noopener noreferrer' : undefined}
                  className="flex items-center gap-3 p-3 rounded-lg bg-surface-800/50 hover:bg-surface-800 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-surface-700 flex items-center justify-center">
                    <resource.icon className="w-5 h-5 text-surface-400 group-hover:text-factory-400 transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-surface-200 group-hover:text-surface-100 transition-colors">
                      {resource.title}
                    </p>
                    <p className="text-xs text-surface-500 truncate">
                      {resource.description}
                    </p>
                  </div>
                  {resource.external && (
                    <ExternalLink className="w-4 h-4 text-surface-600" />
                  )}
                </a>
              ))}
            </div>
          </div>

          <div
            className="card p-6 animate-in"
            style={{ animationDelay: '100ms' }}
          >
            <h3 className="font-semibold text-surface-100 mb-4">
              Need more help?
            </h3>
            <p className="text-surface-400 text-sm mb-4">
              Can't find what you're looking for? Our support team is here to
              help.
            </p>
            <a
              href="mailto:support@jejunetwork.org"
              className="btn btn-primary w-full"
            >
              <Mail className="w-4 h-4" />
              Contact Support
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
