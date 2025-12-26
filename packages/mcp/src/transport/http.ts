/**
 * HTTP transport layer for MCP server.
 *
 * Provides a Bun-native HTTP server for handling MCP JSON-RPC requests.
 */

import type { MCPServer } from '../server/mcp-server'
import type { MCPAuthContext } from '../types/mcp'

/**
 * HTTP transport configuration
 */
export interface HTTPTransportConfig {
  /** Port to listen on */
  port: number
  /** Host to bind to (default: localhost) */
  host?: string
  /** API key header name (default: x-api-key) */
  apiKeyHeader?: string
  /** CORS origin (default: none) */
  corsOrigin?: string
}

/**
 * HTTP transport for MCP server
 *
 * Handles HTTP POST requests with JSON-RPC bodies.
 */
export class HTTPTransport {
  private server: MCPServer
  private config: HTTPTransportConfig
  private bunServer: ReturnType<typeof Bun.serve> | null = null

  constructor(server: MCPServer, config: HTTPTransportConfig) {
    this.server = server
    this.config = config
  }

  /**
   * Start the HTTP server
   */
  start(): void {
    const apiKeyHeader = this.config.apiKeyHeader || 'x-api-key'
    const corsOrigin = this.config.corsOrigin
    const hostname = this.config.host || 'localhost'

    this.bunServer = Bun.serve({
      port: this.config.port,
      hostname,

      fetch: async (request: Request): Promise<Response> => {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
          return this.corsResponse(corsOrigin)
        }

        // Only accept POST requests
        if (request.method !== 'POST') {
          return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: this.getHeaders(corsOrigin),
          })
        }

        // Check content type
        const contentType = request.headers.get('content-type')
        if (!contentType || !contentType.includes('application/json')) {
          return new Response(
            JSON.stringify({ error: 'Content-Type must be application/json' }),
            {
              status: 400,
              headers: this.getHeaders(corsOrigin),
            },
          )
        }

        // Extract API key from headers
        const headerApiKey = request.headers.get(apiKeyHeader)
        const bearerToken = this.extractBearerToken(
          request.headers.get('authorization'),
        )
        const apiKey = headerApiKey || bearerToken || undefined

        const authContext: MCPAuthContext = { apiKey }

        // Parse request body
        const body = await request.json()

        // Handle the request
        const response = await this.server.handleRequest(body, authContext)

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: this.getHeaders(corsOrigin),
        })
      },
    })
  }

  /**
   * Stop the HTTP server
   */
  stop(): void {
    if (this.bunServer) {
      this.bunServer.stop()
      this.bunServer = null
    }
  }

  /**
   * Get the server URL
   */
  getUrl(): string {
    const host = this.config.host || 'localhost'
    return `http://${host}:${this.config.port}`
  }

  /**
   * Get response headers
   */
  private getHeaders(corsOrigin?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (corsOrigin) {
      headers['Access-Control-Allow-Origin'] = corsOrigin
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
      headers['Access-Control-Allow-Headers'] =
        'Content-Type, Authorization, x-api-key'
    }

    return headers
  }

  /**
   * Create CORS preflight response
   */
  private corsResponse(corsOrigin?: string): Response {
    return new Response(null, {
      status: 204,
      headers: this.getHeaders(corsOrigin),
    })
  }

  /**
   * Extract bearer token from Authorization header
   */
  private extractBearerToken(header: string | null): string | null {
    if (!header) return null
    const match = header.match(/^Bearer\s+(.+)$/i)
    if (!match) return null
    return match[1] ?? null
  }
}

/**
 * Create and start an HTTP transport for an MCP server
 */
export function createHTTPTransport(
  server: MCPServer,
  config: HTTPTransportConfig,
): HTTPTransport {
  const transport = new HTTPTransport(server, config)
  transport.start()
  return transport
}
