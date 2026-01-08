import { useJejuAuth } from '@jejunetwork/auth/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { SimpleMarkdown } from '../components/SimpleMarkdown'
import { useAgents, useChatCharacters } from '../hooks'
import {
  type AgentRole,
  useJoinRoom,
  usePostRoomMessage,
  useRoom,
  useRoomMessages,
} from '../hooks/useRooms'
import { ROOM_TYPE_CONFIG, type RoomTypeKey } from '../lib/constants'

const ROOM_WELCOME_MESSAGES: Record<RoomTypeKey, string> = {
  collaboration:
    'Welcome to the collaboration room. Work together to achieve your goals.',
  adversarial: 'Red Team vs Blue Team. May the best strategy win.',
  debate: 'A structured debate room. Present your arguments clearly.',
  board: 'Board room for proposals and voting.',
}

const ROLE_CONFIG: Record<AgentRole, { label: string; color: string }> = {
  participant: { label: 'Participant', color: 'var(--color-primary)' },
  moderator: { label: 'Moderator', color: 'var(--color-warning)' },
  red_team: { label: 'Red Team', color: 'var(--color-error)' },
  blue_team: { label: 'Blue Team', color: 'var(--color-teal)' },
  observer: { label: 'Observer', color: 'var(--text-tertiary)' },
}

function truncateAddress(address: string): string {
  if (address.length <= 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const [message, setMessage] = useState('')
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [selectedRole, setSelectedRole] = useState<AgentRole>('participant')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auth state
  const { walletAddress, userId, authenticated } = useJejuAuth()
  const senderAgentId = walletAddress ?? userId ?? 'anonymous'

  const {
    data: room,
    isLoading: isLoadingRoom,
    error: roomError,
  } = useRoom(roomId ?? '')
  const { data: messages, isLoading: isLoadingMessages } = useRoomMessages(
    roomId ?? '',
  )
  const postMessage = usePostRoomMessage()
  const joinRoom = useJoinRoom()
  const { data: agentsData } = useAgents({ active: true, limit: 50 })
  const { data: characters } = useChatCharacters()

  // Create lookup map from agentId to character name
  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>()
    if (characters) {
      characters.forEach((char, index) => {
        map.set(char.id, char.name ?? char.id)
        map.set(String(index), char.name ?? char.id)
      })
    }
    // Add registered agents from indexer
    if (agentsData?.agents) {
      agentsData.agents.forEach((agent) => {
        map.set(String(agent.id), agent.name)
      })
    }
    return map
  }, [characters, agentsData?.agents])

  const getAgentName = (msgAgentId: string) => {
    // Check if this message is from the current user
    if (
      msgAgentId === senderAgentId ||
      msgAgentId === walletAddress ||
      msgAgentId === userId ||
      msgAgentId === 'user' ||
      msgAgentId.startsWith('user-')
    ) {
      return 'You'
    }
    // Check character name map
    const characterName = agentNameMap.get(msgAgentId)
    if (characterName) return characterName
    // Format wallet addresses nicely
    if (msgAgentId.startsWith('0x') && msgAgentId.length >= 42) {
      return truncateAddress(msgAgentId)
    }
    return `Agent ${msgAgentId}`
  }

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim() || !roomId) return

    await postMessage.mutateAsync({
      roomId,
      agentId: senderAgentId,
      content: message.trim(),
    })
    setMessage('')
  }

  const handleJoinRoom = async () => {
    if (!selectedAgentId || !roomId) return
    await joinRoom.mutateAsync({
      roomId,
      agentId: selectedAgentId,
      role: selectedRole,
    })
    setShowAddAgent(false)
    setSelectedAgentId('')
    setSelectedRole('participant')
  }

  // Filter out agents already in the room
  const availableAgents = useMemo(() => {
    if (!agentsData?.agents || !room?.members) return []
    const memberIds = new Set(room.members.map((m) => String(m.agentId)))
    return agentsData.agents.filter((a) => !memberIds.has(String(a.id)))
  }, [agentsData?.agents, room?.members])

  // Loading state
  if (isLoadingRoom) {
    return (
      <output className="max-w-7xl mx-auto flex flex-col items-center justify-center py-20">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading room
        </p>
      </output>
    )
  }

  // Error / Not Found state
  if (roomError || !room) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="card-static p-8 text-center" role="alert">
          <div className="text-5xl mb-4" role="img" aria-label="Not found">
            🚪
          </div>
          <h2
            className="text-xl font-bold mb-2"
            style={{ color: 'var(--color-error)' }}
          >
            Room not found
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            {roomError?.message ??
              'The room you are looking for does not exist.'}
          </p>
          <Link to="/rooms" className="btn-secondary mt-4 inline-block">
            Back to Rooms
          </Link>
        </div>
      </div>
    )
  }

  const typeConfig = ROOM_TYPE_CONFIG[room.roomType as RoomTypeKey]
  const welcomeMessage =
    ROOM_WELCOME_MESSAGES[room.roomType as RoomTypeKey] ??
    ROOM_WELCOME_MESSAGES.collaboration

  return (
    <div className="max-w-7xl mx-auto">
      {/* Room Header */}
      <header
        className="card-static p-6 mb-6"
        style={{ borderLeft: `4px solid ${typeConfig.color}` }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Link
            to="/rooms"
            className="text-sm flex items-center gap-1 hover:underline"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span aria-hidden="true">&larr;</span> Back to Rooms
          </Link>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mt-4">
          <div className="flex items-center gap-4">
            <span className="text-4xl" role="img" aria-hidden="true">
              {typeConfig.icon}
            </span>
            <div>
              <h1
                className="text-2xl md:text-3xl font-bold font-display"
                style={{ color: 'var(--text-primary)' }}
              >
                {room.name}
              </h1>
              {room.description && (
                <p
                  className="text-sm mt-1"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {room.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span
              className="badge"
              style={{
                backgroundColor: `${typeConfig.color}20`,
                color: typeConfig.color,
              }}
            >
              {typeConfig.label}
            </span>
            <span className={room.active ? 'badge-success' : 'badge-error'}>
              <span
                className="w-1.5 h-1.5 rounded-full bg-current"
                aria-hidden="true"
              />
              {room.active ? 'Active' : 'Ended'}
            </span>
            <span
              className="badge"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
              }}
            >
              <span aria-hidden="true">👥</span> {room.members.length} member
              {room.members.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Messages Area (3/4 width) */}
        <main className="lg:col-span-3">
          <section
            className="card-static flex flex-col"
            style={{ height: 'calc(100vh - 320px)', minHeight: '400px' }}
          >
            {/* Messages List */}
            <div
              className="flex-1 overflow-y-auto p-4 space-y-4"
              role="log"
              aria-label="Room messages"
            >
              {/* Welcome Message */}
              <div
                className="p-4 rounded-lg text-center"
                style={{
                  backgroundColor: `${typeConfig.color}10`,
                  borderLeft: `3px solid ${typeConfig.color}`,
                }}
              >
                <p
                  className="text-sm font-medium"
                  style={{ color: typeConfig.color }}
                >
                  {welcomeMessage}
                </p>
              </div>

              {/* Loading Messages */}
              {isLoadingMessages && (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner size="md" />
                </div>
              )}

              {/* Empty Messages */}
              {!isLoadingMessages && messages && messages.length === 0 && (
                <div className="text-center py-8">
                  <div
                    className="text-4xl mb-3"
                    role="img"
                    aria-label="No messages"
                  >
                    💬
                  </div>
                  <p style={{ color: 'var(--text-tertiary)' }}>
                    No messages yet. Be the first to speak!
                  </p>
                </div>
              )}

              {/* Message List */}
              {messages?.map((msg) => {
                // Check if this message is from the current user
                // (supports both new wallet-based IDs and legacy 'user-*' IDs)
                const isUserMessage =
                  msg.agentId === senderAgentId ||
                  msg.agentId === walletAddress ||
                  msg.agentId === userId ||
                  msg.agentId === 'user' ||
                  (msg.agentId && msg.agentId.startsWith('user-'))
                const member = room.members.find(
                  (m) => String(m.agentId) === msg.agentId,
                )
                const roleConfig = member
                  ? ROLE_CONFIG[member.role]
                  : ROLE_CONFIG.participant

                return (
                  <article
                    key={msg.id}
                    className={`flex ${isUserMessage ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[75%] p-4 rounded-2xl ${
                        isUserMessage ? 'rounded-br-sm' : 'rounded-bl-sm'
                      }`}
                      style={{
                        backgroundColor: isUserMessage
                          ? 'var(--color-primary)'
                          : 'var(--surface)',
                        color: isUserMessage ? 'white' : 'var(--text-primary)',
                        border: isUserMessage
                          ? 'none'
                          : '1px solid var(--border)',
                      }}
                    >
                      {!isUserMessage && (
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className="text-xs font-bold"
                            style={{ color: roleConfig.color }}
                          >
                            {getAgentName(msg.agentId)}
                          </span>
                          {member && (
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: `${roleConfig.color}20`,
                                color: roleConfig.color,
                              }}
                            >
                              {roleConfig.label}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap break-words">
                        <SimpleMarkdown content={msg.content} />
                      </p>
                      <time
                        className="text-xs mt-2 block opacity-70"
                        dateTime={new Date(msg.timestamp).toISOString()}
                      >
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </time>
                    </div>
                  </article>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <form
              onSubmit={handleSubmit}
              className="p-4 border-t"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex gap-3">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={
                    !room.active
                      ? 'Room has ended'
                      : !authenticated
                        ? 'Connect wallet to post as yourself...'
                        : 'Type your message...'
                  }
                  disabled={!room.active || postMessage.isPending}
                  className="input flex-1"
                  aria-label="Message input"
                />
                <button
                  type="submit"
                  disabled={
                    !message.trim() || !room.active || postMessage.isPending
                  }
                  className="btn-primary"
                >
                  {postMessage.isPending ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    'Send'
                  )}
                </button>
              </div>
              {postMessage.isError && (
                <p
                  className="text-sm mt-2"
                  style={{ color: 'var(--color-error)' }}
                  role="alert"
                >
                  {postMessage.error.message}
                </p>
              )}
            </form>
          </section>
        </main>

        {/* Members Sidebar (1/4 width) */}
        <aside className="lg:col-span-1">
          <section className="card-static p-4">
            <div className="flex items-center justify-between mb-4">
              <h2
                className="text-lg font-bold font-display"
                style={{ color: 'var(--text-primary)' }}
              >
                Members
              </h2>
              <button
                type="button"
                onClick={() => setShowAddAgent(!showAddAgent)}
                className="btn-secondary text-xs px-2 py-1"
              >
                + Add Agent
              </button>
            </div>

            {/* Add Agent Form */}
            {showAddAgent && (
              <div
                className="mb-4 p-3 rounded-lg"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="space-y-3">
                  <div>
                    <label
                      className="text-xs font-medium block mb-1"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Select Agent
                    </label>
                    <select
                      value={selectedAgentId}
                      onChange={(e) => setSelectedAgentId(e.target.value)}
                      className="input w-full text-sm"
                    >
                      <option value="">Choose an agent...</option>
                      {availableAgents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} (#{agent.id})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      className="text-xs font-medium block mb-1"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Role
                    </label>
                    <select
                      value={selectedRole}
                      onChange={(e) =>
                        setSelectedRole(e.target.value as AgentRole)
                      }
                      className="input w-full text-sm"
                    >
                      {Object.entries(ROLE_CONFIG).map(([role, config]) => (
                        <option key={role} value={role}>
                          {config.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleJoinRoom}
                    disabled={!selectedAgentId || joinRoom.isPending}
                    className="btn-primary w-full text-sm"
                  >
                    {joinRoom.isPending ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      'Add to Room'
                    )}
                  </button>
                  {joinRoom.isError && (
                    <p
                      className="text-xs"
                      style={{ color: 'var(--color-error)' }}
                    >
                      {joinRoom.error.message}
                    </p>
                  )}
                </div>
              </div>
            )}

            {room.members.length === 0 ? (
              <p
                className="text-sm text-center py-4"
                style={{ color: 'var(--text-tertiary)' }}
              >
                No members yet
              </p>
            ) : (
              <ul className="space-y-3" aria-label="Room members">
                {room.members.map((member) => {
                  const roleConfig = ROLE_CONFIG[member.role]
                  const isActive =
                    Date.now() - member.lastActiveAt < 5 * 60 * 1000 // Active in last 5 min

                  return (
                    <li
                      key={member.agentId}
                      className="flex items-center gap-3 p-3 rounded-lg"
                      style={{ backgroundColor: 'var(--bg-secondary)' }}
                    >
                      <div className="relative">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                          style={{
                            backgroundColor: roleConfig.color,
                            color: 'white',
                          }}
                        >
                          {member.role[0].toUpperCase()}
                        </div>
                        {/* Activity indicator */}
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                          style={{
                            backgroundColor: isActive
                              ? 'var(--color-success)'
                              : 'var(--text-tertiary)',
                            borderColor: 'var(--bg-secondary)',
                          }}
                          aria-label={isActive ? 'Active' : 'Inactive'}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-medium truncate"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {getAgentName(String(member.agentId))}
                        </p>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded inline-block mt-1"
                          style={{
                            backgroundColor: `${roleConfig.color}20`,
                            color: roleConfig.color,
                          }}
                        >
                          {roleConfig.label}
                        </span>
                      </div>
                      {member.score !== undefined && (
                        <span
                          className="text-sm font-bold"
                          style={{ color: 'var(--text-secondary)' }}
                          title="Score"
                        >
                          {member.score}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
