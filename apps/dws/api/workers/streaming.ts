import { createHash } from 'node:crypto'

export type StreamType = 'sse' | 'ndjson' | 'chunked' | 'raw'

export interface StreamConfig {
  type: StreamType
  keepAliveIntervalMs?: number
  maxDurationMs?: number
  bufferSize?: number
}

export interface SSEMessage {
  event?: string
  data: string
  id?: string
  retry?: number
}

export interface StreamConnection {
  connectionId: string
  workerId: string
  startedAt: number
  bytesWritten: number
  messagesWritten: number
  lastWriteAt: number
  closed: boolean
}

export interface StreamStats {
  activeConnections: number
  totalBytesWritten: number
  totalMessagesWritten: number
  averageConnectionDurationMs: number
}

// ============================================================================
// SSE Writer
// ============================================================================

export class SSEWriter {
  private encoder = new TextEncoder()
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null
  private closed = false
  private bytesWritten = 0
  private messagesWritten = 0
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null
  private config: StreamConfig

  constructor(config: StreamConfig = { type: 'sse' }) {
    this.config = config
  }

  createStream(): ReadableStream<Uint8Array> {
    const self = this

    return new ReadableStream<Uint8Array>({
      start(controller) {
        self.controller = controller

        // Start keep-alive if configured
        if (self.config.keepAliveIntervalMs) {
          self.keepAliveInterval = setInterval(() => {
            if (!self.closed) {
              self.writeComment('keep-alive')
            }
          }, self.config.keepAliveIntervalMs)
        }

        // Set max duration timeout
        if (self.config.maxDurationMs) {
          setTimeout(() => {
            if (!self.closed) {
              self.close()
            }
          }, self.config.maxDurationMs)
        }
      },

      cancel() {
        self.close()
      },
    })
  }

  write(message: SSEMessage): boolean {
    if (this.closed || !this.controller) return false

    let data = ''

    if (message.event) {
      data += `event: ${message.event}\n`
    }

    if (message.id) {
      data += `id: ${message.id}\n`
    }

    if (message.retry !== undefined) {
      data += `retry: ${message.retry}\n`
    }

    // Split data by newlines
    const lines = message.data.split('\n')
    for (const line of lines) {
      data += `data: ${line}\n`
    }

    data += '\n' // End of message

    try {
      const bytes = this.encoder.encode(data)
      this.controller.enqueue(bytes)
      this.bytesWritten += bytes.length
      this.messagesWritten++
      return true
    } catch {
      this.close()
      return false
    }
  }

  writeEvent(event: string, data: unknown): boolean {
    return this.write({
      event,
      data: typeof data === 'string' ? data : JSON.stringify(data),
    })
  }

  writeData(data: unknown): boolean {
    return this.write({
      data: typeof data === 'string' ? data : JSON.stringify(data),
    })
  }

  writeComment(comment: string): boolean {
    if (this.closed || !this.controller) return false

    try {
      const bytes = this.encoder.encode(`: ${comment}\n\n`)
      this.controller.enqueue(bytes)
      this.bytesWritten += bytes.length
      return true
    } catch {
      this.close()
      return false
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = null
    }

    if (this.controller) {
      try {
        this.controller.close()
      } catch {
        // Already closed
      }
      this.controller = null
    }
  }

  isClosed(): boolean {
    return this.closed
  }

  getStats(): { bytesWritten: number; messagesWritten: number } {
    return {
      bytesWritten: this.bytesWritten,
      messagesWritten: this.messagesWritten,
    }
  }
}

// ============================================================================
// NDJSON Writer (Newline-Delimited JSON)
// ============================================================================

export class NDJSONWriter {
  private encoder = new TextEncoder()
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null
  private closed = false

  createStream(): ReadableStream<Uint8Array> {
    const self = this

    return new ReadableStream<Uint8Array>({
      start(controller) {
        self.controller = controller
      },

      cancel() {
        self.close()
      },
    })
  }

  write(data: unknown): boolean {
    if (this.closed || !this.controller) return false

    try {
      const line = `${JSON.stringify(data)}\n`
      const bytes = this.encoder.encode(line)
      this.controller.enqueue(bytes)
      this.bytesWritten += bytes.length
      this.messagesWritten++
      return true
    } catch {
      this.close()
      return false
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true

    if (this.controller) {
      try {
        this.controller.close()
      } catch {
        // Already closed
      }
      this.controller = null
    }
  }

  isClosed(): boolean {
    return this.closed
  }
}

// ============================================================================
// Chunked Transfer Writer
// ============================================================================

export class ChunkedWriter {
  private encoder = new TextEncoder()
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null
  private closed = false
  private buffer: Uint8Array[] = []
  private bufferSize = 0
  private maxBufferSize: number

  constructor(maxBufferSize = 16384) {
    this.maxBufferSize = maxBufferSize
  }

  createStream(): ReadableStream<Uint8Array> {
    const self = this

    return new ReadableStream<Uint8Array>({
      start(controller) {
        self.controller = controller
      },

      cancel() {
        self.close()
      },
    })
  }

  write(data: string | Uint8Array): boolean {
    if (this.closed || !this.controller) return false

    const bytes = typeof data === 'string' ? this.encoder.encode(data) : data

    // Buffer small writes
    if (this.bufferSize + bytes.length < this.maxBufferSize) {
      this.buffer.push(bytes)
      this.bufferSize += bytes.length
      return true
    }

    // Flush buffer and write
    this.flush()

    try {
      this.controller.enqueue(bytes)
      this.bytesWritten += bytes.length
      return true
    } catch {
      this.close()
      return false
    }
  }

  flush(): boolean {
    if (this.closed || !this.controller || this.buffer.length === 0)
      return false

    try {
      // Combine buffered chunks
      const combined = new Uint8Array(this.bufferSize)
      let offset = 0
      for (const chunk of this.buffer) {
        combined.set(chunk, offset)
        offset += chunk.length
      }

      this.controller.enqueue(combined)
      this.bytesWritten += this.bufferSize
      this.buffer = []
      this.bufferSize = 0
      return true
    } catch {
      this.close()
      return false
    }
  }

  close(): void {
    if (this.closed) return

    this.flush()
    this.closed = true

    if (this.controller) {
      try {
        this.controller.close()
      } catch {
        // Already closed
      }
      this.controller = null
    }
  }

  isClosed(): boolean {
    return this.closed
  }
}

// ============================================================================
// Stream Connection Manager
// ============================================================================

export class StreamConnectionManager {
  private connections = new Map<string, StreamConnection>()
  private connectionsByWorker = new Map<string, Set<string>>()
  private totalBytesWritten = 0
  private totalMessagesWritten = 0
  private closedConnectionDurations: number[] = []

  createConnection(workerId: string): StreamConnection {
    const connectionId = createHash('sha256')
      .update(`${workerId}-${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 16)

    const connection: StreamConnection = {
      connectionId,
      workerId,
      startedAt: Date.now(),
      bytesWritten: 0,
      messagesWritten: 0,
      lastWriteAt: Date.now(),
      closed: false,
    }

    this.connections.set(connectionId, connection)

    // Track by worker
    const workerConnections =
      this.connectionsByWorker.get(workerId) ?? new Set()
    workerConnections.add(connectionId)
    this.connectionsByWorker.set(workerId, workerConnections)

    return connection
  }

  recordWrite(connectionId: string, bytes: number, messages = 1): void {
    const connection = this.connections.get(connectionId)
    if (!connection) return

    connection.bytesWritten += bytes
    connection.messagesWritten += messages
    connection.lastWriteAt = Date.now()

    this.totalBytesWritten += bytes
    this.totalMessagesWritten += messages
  }

  closeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId)
    if (!connection || connection.closed) return

    connection.closed = true
    const duration = Date.now() - connection.startedAt
    this.closedConnectionDurations.push(duration)

    // Keep only last 1000 durations for average calculation
    if (this.closedConnectionDurations.length > 1000) {
      this.closedConnectionDurations.shift()
    }

    // Remove from worker tracking
    const workerConnections = this.connectionsByWorker.get(connection.workerId)
    workerConnections?.delete(connectionId)
  }

  getConnection(connectionId: string): StreamConnection | undefined {
    return this.connections.get(connectionId)
  }

  getWorkerConnections(workerId: string): StreamConnection[] {
    const connectionIds = this.connectionsByWorker.get(workerId)
    if (!connectionIds) return []

    return Array.from(connectionIds)
      .map((id) => this.connections.get(id))
      .filter((c): c is StreamConnection => c !== undefined && !c.closed)
  }

  getStats(): StreamStats {
    const activeConnections = Array.from(this.connections.values()).filter(
      (c) => !c.closed,
    )
    const avgDuration =
      this.closedConnectionDurations.length > 0
        ? this.closedConnectionDurations.reduce((a, b) => a + b, 0) /
          this.closedConnectionDurations.length
        : 0

    return {
      activeConnections: activeConnections.length,
      totalBytesWritten: this.totalBytesWritten,
      totalMessagesWritten: this.totalMessagesWritten,
      averageConnectionDurationMs: avgDuration,
    }
  }

  cleanup(maxIdleMs = 300000): number {
    const now = Date.now()
    let closedCount = 0

    for (const connection of this.connections.values()) {
      if (connection.closed) continue

      // Close idle connections
      if (now - connection.lastWriteAt > maxIdleMs) {
        this.closeConnection(connection.connectionId)
        closedCount++
      }
    }

    // Remove old closed connections from map
    for (const [id, connection] of this.connections.entries()) {
      if (connection.closed && now - connection.lastWriteAt > 60000) {
        this.connections.delete(id)
      }
    }

    return closedCount
  }
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Create an SSE response
 */
export function createSSEResponse(
  handler: (writer: SSEWriter) => Promise<void>,
  config: StreamConfig = { type: 'sse' },
): Response {
  const writer = new SSEWriter(config)
  const stream = writer.createStream()

  // Run handler asynchronously
  handler(writer).catch((error) => {
    console.error('[SSE] Handler error:', error)
    writer.writeEvent('error', { message: String(error) })
    writer.close()
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}

/**
 * Create an NDJSON streaming response
 */
export function createNDJSONResponse(
  handler: (writer: NDJSONWriter) => Promise<void>,
): Response {
  const writer = new NDJSONWriter()
  const stream = writer.createStream()

  handler(writer).catch((error) => {
    console.error('[NDJSON] Handler error:', error)
    writer.write({ error: String(error) })
    writer.close()
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
    },
  })
}

/**
 * Create a chunked transfer response
 */
export function createChunkedResponse(
  handler: (writer: ChunkedWriter) => Promise<void>,
  contentType = 'application/octet-stream',
): Response {
  const writer = new ChunkedWriter()
  const stream = writer.createStream()

  handler(writer).catch((error) => {
    console.error('[Chunked] Handler error:', error)
    writer.close()
  })

  return new Response(stream, {
    headers: {
      'Content-Type': contentType,
      'Transfer-Encoding': 'chunked',
    },
  })
}

/**
 * Stream a ReadableStream with progress tracking
 */
export async function streamWithProgress(
  source: ReadableStream<Uint8Array>,
  destination: WritableStream<Uint8Array>,
  onProgress?: (bytes: number) => void,
): Promise<number> {
  const reader = source.getReader()
  const writer = destination.getWriter()
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      await writer.write(value)
      totalBytes += value.length
      onProgress?.(totalBytes)
    }
  } finally {
    reader.releaseLock()
    await writer.close()
  }

  return totalBytes
}

// ============================================================================
// AI Streaming Helpers (for LLM responses)
// ============================================================================

export interface LLMStreamEvent {
  type: 'start' | 'token' | 'done' | 'error'
  content?: string
  usage?: { promptTokens: number; completionTokens: number }
  error?: string
}

/**
 * Stream LLM responses with standardized format
 */
export function createLLMStreamResponse(
  handler: (emit: (event: LLMStreamEvent) => boolean) => Promise<void>,
): Response {
  return createSSEResponse(
    async (writer) => {
      const emit = (event: LLMStreamEvent): boolean => {
        return writer.writeEvent(event.type, event)
      }

      emit({ type: 'start' })

      try {
        await handler(emit)
        emit({ type: 'done' })
      } catch (error) {
        emit({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      }

      writer.close()
    },
    {
      type: 'sse',
      keepAliveIntervalMs: 15000,
      maxDurationMs: 300000, // 5 minutes max
    },
  )
}

// ============================================================================
// Factory
// ============================================================================

let streamConnectionManager: StreamConnectionManager | null = null

export function getStreamConnectionManager(): StreamConnectionManager {
  if (!streamConnectionManager) {
    streamConnectionManager = new StreamConnectionManager()

    // Start cleanup interval
    setInterval(() => {
      const closed = streamConnectionManager?.cleanup() ?? 0
      if (closed > 0) {
        console.log(`[Streaming] Cleaned up ${closed} idle connections`)
      }
    }, 60000)
  }
  return streamConnectionManager
}
