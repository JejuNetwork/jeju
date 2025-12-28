import {
  Activity,
  Bot,
  Check,
  Copy,
  ExternalLink,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import {
  useAgents,
  useAgentTasks,
  useMCPResources,
  useMCPTools,
} from '../hooks'

type TabType = 'agents' | 'tasks' | 'mcp'

export default function AgentsPage() {
  const { isConnected } = useAccount()
  const {
    data: agentsData,
    isLoading: agentsLoading,
    refetch: refetchAgents,
  } = useAgents()
  const { data: mcpToolsData } = useMCPTools()
  const { data: mcpResourcesData } = useMCPResources()

  const [activeTab, setActiveTab] = useState<TabType>('agents')
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const { data: tasksData, isLoading: tasksLoading } = useAgentTasks(
    selectedAgent ?? undefined,
  )

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const agents = agentsData?.agents ?? []
  const tasks = tasksData?.tasks ?? []
  const tools = mcpToolsData?.tools ?? []
  const resources = mcpResourcesData?.resources ?? []

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'agents', label: 'A2A Agents', icon: <Bot size={16} /> },
    { id: 'tasks', label: 'Tasks', icon: <Activity size={16} /> },
    { id: 'mcp', label: 'MCP Tools', icon: <Zap size={16} /> },
  ]

  return (
    <div>
      <div
        className="page-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 className="page-title">Agents & MCP</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => refetchAgents()}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!isConnected}
          >
            <Plus size={16} /> Register Agent
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Bot size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Agents</div>
            <div className="stat-value">{agents.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Activity size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Active Tasks</div>
            <div className="stat-value">
              {tasks.filter((t) => t.status === 'running').length}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Zap size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">MCP Tools</div>
            <div className="stat-value">{tools.length}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <MessageSquare size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Resources</div>
            <div className="stat-value">{resources.length}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.25rem',
          borderBottom: '1px solid var(--border)',
          marginBottom: '1rem',
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`btn btn-ghost ${activeTab === tab.id ? 'active' : ''}`}
            style={{
              borderBottom:
                activeTab === tab.id ? '2px solid var(--primary)' : 'none',
              borderRadius: 0,
              paddingBottom: '0.75rem',
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="card">
        {activeTab === 'agents' &&
          (agentsLoading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '3rem',
              }}
            >
              <div className="spinner" />
            </div>
          ) : agents.length === 0 ? (
            <div className="empty-state">
              <Bot size={48} />
              <h3>No agents</h3>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!isConnected}
              >
                <Plus size={16} /> Register Agent
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  style={{
                    padding: '1rem',
                    background:
                      selectedAgent === agent.id
                        ? 'var(--accent-soft)'
                        : 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${selectedAgent === agent.id ? 'var(--accent)' : 'var(--border)'}`,
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                  }}
                  onClick={() =>
                    setSelectedAgent(
                      agent.id === selectedAgent ? null : agent.id,
                    )
                  }
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                      }}
                    >
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--gradient)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Bot size={20} style={{ color: 'white' }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{agent.name}</div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          <code
                            style={{
                              fontSize: '0.8rem',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {agent.id.slice(0, 12)}...
                          </code>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            style={{ padding: '0.15rem' }}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCopy(agent.id, agent.id)
                            }}
                          >
                            {copied === agent.id ? (
                              <Check size={12} />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <span
                        className={`badge ${
                          agent.status === 'active' || agent.status === 'online'
                            ? 'badge-success'
                            : agent.status === 'busy'
                              ? 'badge-warning'
                              : 'badge-neutral'
                        }`}
                      >
                        {agent.status}
                      </span>
                      <a
                        href={agent.endpoint}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={14} />
                      </a>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Settings size={14} />
                      </button>
                    </div>
                  </div>
                  {agent.capabilities && agent.capabilities.length > 0 && (
                    <div
                      style={{
                        marginTop: '0.75rem',
                        display: 'flex',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      {agent.capabilities.map((cap) => (
                        <span
                          key={cap}
                          className="badge badge-neutral"
                          style={{ fontSize: '0.75rem' }}
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ))}

        {activeTab === 'tasks' &&
          (!selectedAgent ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <Activity size={32} />
              <p>Select an agent</p>
            </div>
          ) : tasksLoading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '3rem',
              }}
            >
              <div className="spinner" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <Activity size={32} />
              <p>No tasks</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Task ID</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Input</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr key={task.id}>
                      <td
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.85rem',
                        }}
                      >
                        {task.id.slice(0, 12)}...
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            task.status === 'completed'
                              ? 'badge-success'
                              : task.status === 'running'
                                ? 'badge-info'
                                : task.status === 'failed'
                                  ? 'badge-error'
                                  : 'badge-neutral'
                          }`}
                        >
                          {task.status}
                        </span>
                      </td>
                      <td>{new Date(task.createdAt).toLocaleString()}</td>
                      <td>
                        <code style={{ fontSize: '0.8rem' }}>
                          {JSON.stringify(task.input).slice(0, 50)}...
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {activeTab === 'mcp' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
              gap: '1.5rem',
            }}
          >
            <div>
              <h4
                style={{
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Zap size={16} /> Tools ({tools.length})
              </h4>
              {tools.length === 0 ? (
                <div
                  style={{
                    padding: '2rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                  }}
                >
                  Connect MCP servers to enable tool access for your agents
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {tools.map((tool) => (
                    <div
                      key={tool.name}
                      style={{
                        padding: '0.75rem',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>
                        {tool.name}
                      </div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {tool.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4
                style={{
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <MessageSquare size={16} /> Resources ({resources.length})
              </h4>
              {resources.length === 0 ? (
                <div
                  style={{
                    padding: '2rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                  }}
                >
                  Resources from connected MCP servers will appear here
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {resources.map((resource) => (
                    <div
                      key={resource.uri}
                      style={{
                        padding: '0.75rem',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>
                        {resource.name}
                      </div>
                      <div
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <code>{resource.uri}</code>
                      </div>
                      <span
                        className="badge badge-neutral"
                        style={{ fontSize: '0.7rem', marginTop: '0.5rem' }}
                      >
                        {resource.mimeType}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
