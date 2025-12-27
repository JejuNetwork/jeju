import {
  Archive,
  Edit,
  Inbox,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Send,
  Star,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useMailbox, useSendEmail } from '../../hooks'

interface EmailEntry {
  id: string
  messageId?: string
  subject: string
  from: string
  date: string
  size: number
  read: boolean
  flags?: {
    read?: boolean
    starred?: boolean
  }
  snippet?: string
}

export default function EmailPage() {
  const { isConnected, address } = useAccount()
  const {
    data: mailboxData,
    isLoading: mailboxLoading,
    refetch: refetchMailbox,
  } = useMailbox()
  const sendEmail = useSendEmail()

  const [selectedFolder, setSelectedFolder] = useState('inbox')
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null)
  const [showComposeModal, setShowComposeModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [composeData, setComposeData] = useState({
    to: '',
    subject: '',
    body: '',
  })

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address) return

    try {
      await sendEmail.mutateAsync({
        from: `${address.slice(0, 8).toLowerCase()}@jeju.mail`,
        to: composeData.to.split(',').map((t) => t.trim()),
        subject: composeData.subject,
        bodyText: composeData.body,
      })
      setShowComposeModal(false)
      setComposeData({ to: '', subject: '', body: '' })
      refetchMailbox()
    } catch (error) {
      console.error('Failed to send email:', error)
    }
  }

  const mailbox = mailboxData?.mailbox
  const index = mailboxData?.index
  const unreadCount = mailboxData?.unreadCount ?? 0

  const folders = [
    {
      id: 'inbox',
      label: 'Inbox',
      icon: <Inbox size={18} />,
      count: unreadCount,
    },
    { id: 'sent', label: 'Sent', icon: <Send size={18} />, count: 0 },
    {
      id: 'drafts',
      label: 'Drafts',
      icon: <Edit size={18} />,
      count: index?.drafts.length ?? 0,
    },
    { id: 'starred', label: 'Starred', icon: <Star size={18} />, count: 0 },
    {
      id: 'archive',
      label: 'Archive',
      icon: <Archive size={18} />,
      count: index.archive?.length ?? 0,
    },
    {
      id: 'trash',
      label: 'Trash',
      icon: <Trash2 size={18} />,
      count: index?.trash.length ?? 0,
    },
  ]

  const getCurrentEmails = () => {
    if (!index) return []
    switch (selectedFolder) {
      case 'inbox':
        return index.inbox ?? []
      case 'sent':
        return index.sent ?? []
      case 'drafts':
        return index.drafts ?? []
      case 'archive':
        return index.archive ?? []
      case 'trash':
        return index.trash ?? []
      case 'spam':
        return index.spam ?? []
      default:
        return index.folders?.[selectedFolder] ?? []
    }
  }

  const emails = getCurrentEmails().filter(
    (email: EmailEntry) =>
      !searchQuery ||
      email.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.from.toLowerCase().includes(searchQuery.toLowerCase()),
  )

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
          <h1 className="page-title">Decentralized Email</h1>
          <p className="page-subtitle">
            End-to-end encrypted email powered by your wallet
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => refetchMailbox()}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowComposeModal(true)}
            disabled={!isConnected}
          >
            <Plus size={16} /> Compose
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-icon storage">
            <Inbox size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Unread</div>
            <div className="stat-value">
              {mailboxLoading ? (
                <span className="shimmer inline-block w-8 h-6 rounded" />
              ) : (
                unreadCount
              )}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon compute">
            <Mail size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Total Emails</div>
            <div className="stat-value">
              {mailboxLoading ? (
                <span className="shimmer inline-block w-8 h-6 rounded" />
              ) : (
                (index?.inbox.length ?? 0) + (index?.sent.length ?? 0)
              )}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon network">
            <Send size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Sent</div>
            <div className="stat-value">
              {mailboxLoading ? (
                <span className="shimmer inline-block w-8 h-6 rounded" />
              ) : (
                (index?.sent.length ?? 0)
              )}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon ai">
            <Archive size={24} />
          </div>
          <div className="stat-content">
            <div className="stat-label">Storage Used</div>
            <div className="stat-value">
              {mailboxLoading ? (
                <span className="shimmer inline-block w-12 h-6 rounded" />
              ) : mailbox ? (
                formatBytes(Number(mailbox.quotaUsedBytes))
              ) : (
                '0 B'
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '220px 1fr',
          gap: '1.5rem',
        }}
      >
        <div className="card" style={{ height: 'fit-content' }}>
          <div className="card-header">
            <h3 className="card-title">
              <Mail size={18} /> Folders
            </h3>
          </div>
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => setSelectedFolder(folder.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  background:
                    selectedFolder === folder.id
                      ? 'var(--accent-soft)'
                      : 'transparent',
                  border: 'none',
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                {folder.icon}
                <span style={{ flex: 1 }}>{folder.label}</span>
                {folder.count > 0 && (
                  <span className="badge badge-neutral">{folder.count}</span>
                )}
              </button>
            ))}
          </div>

          {index?.folders && Object.keys(index.folders).length > 0 && (
            <>
              <div
                style={{
                  borderTop: '1px solid var(--border)',
                  margin: '0.75rem 0',
                }}
              />
              <div style={{ display: 'grid', gap: '0.25rem' }}>
                {Object.entries(index.folders).map(([name, folderEmails]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setSelectedFolder(name)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      background:
                        selectedFolder === name
                          ? 'var(--accent-soft)'
                          : 'transparent',
                      border: 'none',
                      width: '100%',
                      textAlign: 'left',
                    }}
                  >
                    <Mail size={18} />
                    <span style={{ flex: 1 }}>{name}</span>
                    <span className="badge badge-neutral">
                      {folderEmails.length}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                flex: 1,
              }}
            >
              <h3
                className="card-title"
                style={{ marginBottom: 0, textTransform: 'capitalize' }}
              >
                {selectedFolder}
              </h3>
              <div style={{ flex: 1, maxWidth: '300px' }}>
                <div style={{ position: 'relative' }}>
                  <Search
                    size={16}
                    style={{
                      position: 'absolute',
                      left: '0.75rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                    }}
                  />
                  <input
                    className="input"
                    placeholder="Search emails..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ paddingLeft: '2.25rem' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {mailboxLoading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '3rem',
              }}
            >
              <div className="spinner" />
            </div>
          ) : !isConnected ? (
            <div className="empty-state">
              <Mail size={48} />
              <h3>Connect your wallet</h3>
              <p>Connect your wallet to access your decentralized mailbox</p>
            </div>
          ) : emails.length === 0 ? (
            <div className="empty-state">
              <Inbox size={48} />
              <h3>No emails</h3>
              <p>Your {selectedFolder} is empty</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0' }}>
              {emails.map((email: EmailEntry) => (
                <button
                  key={email.id}
                  type="button"
                  onClick={() => setSelectedEmail(email.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    padding: '1rem',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    background:
                      selectedEmail === email.id
                        ? 'var(--accent-soft)'
                        : 'transparent',
                    border: 'none',
                    width: '100%',
                    textAlign: 'left',
                  }}
                >
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: email.read ? 'transparent' : 'var(--accent)',
                      marginTop: '0.5rem',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '0.25rem',
                      }}
                    >
                      <span
                        style={{
                          fontWeight: email.read ? 400 : 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {email.from ?? 'Unknown sender'}
                      </span>
                      <span
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-muted)',
                          flexShrink: 0,
                          marginLeft: '0.5rem',
                        }}
                      >
                        {email.date
                          ? new Date(email.date).toLocaleDateString()
                          : ''}
                      </span>
                    </div>
                    <div
                      style={{
                        fontWeight: email.read ? 400 : 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginBottom: '0.25rem',
                      }}
                    >
                      {email.subject ?? '(No subject)'}
                    </div>
                    {email.snippet && (
                      <div
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {email.snippet}
                      </div>
                    )}
                  </div>
                  {email.flags?.starred && (
                    <Star
                      size={16}
                      style={{
                        color: 'var(--warning)',
                        fill: 'var(--warning)',
                      }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showComposeModal && (
        <div className="modal-overlay">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowComposeModal(false)}
            aria-label="Close modal"
          />
          <div
            className="modal"
            style={{ maxWidth: '600px' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setShowComposeModal(false)
              }
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <h3 className="modal-title">Compose Email</h3>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowComposeModal(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSendEmail}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="email-to" className="form-label">
                    To *
                  </label>
                  <input
                    id="email-to"
                    className="input"
                    placeholder="recipient@jeju.mail"
                    value={composeData.to}
                    onChange={(e) =>
                      setComposeData({ ...composeData, to: e.target.value })
                    }
                    required
                  />
                  <div className="form-hint">
                    Separate multiple recipients with commas
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="email-subject" className="form-label">
                    Subject
                  </label>
                  <input
                    id="email-subject"
                    className="input"
                    placeholder="Subject"
                    value={composeData.subject}
                    onChange={(e) =>
                      setComposeData({
                        ...composeData,
                        subject: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="email-body" className="form-label">
                    Message
                  </label>
                  <textarea
                    id="email-body"
                    className="input"
                    placeholder="Write your message..."
                    value={composeData.body}
                    onChange={(e) =>
                      setComposeData({ ...composeData, body: e.target.value })
                    }
                    style={{ minHeight: '200px', resize: 'vertical' }}
                  />
                </div>
                {sendEmail.error && (
                  <div
                    style={{
                      padding: '0.75rem',
                      background: 'var(--error-soft)',
                      color: 'var(--error)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    {sendEmail.error instanceof Error
                      ? sendEmail.error.message
                      : 'Failed to send email'}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowComposeModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={sendEmail.isPending}
                >
                  {sendEmail.isPending ? (
                    'Sending...'
                  ) : (
                    <>
                      <Send size={16} /> Send
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}
