/**
 * Storage Actions - IPFS upload/retrieve
 */

import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import type { JsonValue } from '@jejunetwork/types'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import {
  fetchWithTimeout,
  getMessageText,
  isUrlSafeToFetch,
  MAX_JSON_SIZE,
  safeJsonParseUnknown,
  truncateOutput,
  validateServiceExists,
} from '../validation'

export const uploadFileAction: Action = {
  name: 'UPLOAD_FILE',
  description: 'Upload a file to the network decentralized storage (IPFS)',
  similes: [
    'upload file',
    'store file',
    'save to ipfs',
    'pin file',
    'upload to storage',
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()

    const text = getMessageText(message)

    // Check for JSON data to upload (with size limit)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const jsonString = jsonMatch[0]

      // Check size before parsing
      if (jsonString.length > MAX_JSON_SIZE) {
        callback?.({
          text: `JSON data too large. Maximum size is ${MAX_JSON_SIZE / 1000}KB.`,
        })
        return
      }

      let jsonData: Record<string, JsonValue>
      try {
        const parsed = safeJsonParseUnknown(jsonString)
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error('JSON must be an object')
        }
        jsonData = parsed as Record<string, JsonValue>
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Invalid JSON'
        callback?.({
          text: `Invalid JSON format: ${errorMessage}`,
        })
        return
      }

      const result = await client.storage.uploadJson(jsonData)

      callback?.({
        text: `File uploaded to IPFS.
CID: ${result.cid}
Size: ${result.size} bytes
Gateway URL: ${result.gatewayUrl}`,
        content: result,
      })
      return
    }

    // Check for URL to content (with SSRF protection)
    const urlMatch = text.match(/https?:\/\/[^\s]+/)
    if (urlMatch) {
      const targetUrl = urlMatch[0]

      // Validate URL is safe to fetch (prevent SSRF)
      if (!isUrlSafeToFetch(targetUrl)) {
        callback?.({
          text: 'Cannot fetch from internal or private URLs for security reasons.',
        })
        return
      }

      callback?.({ text: `Fetching content from ${targetUrl}...` })

      // Use timeout-protected fetch with redirect blocking
      const response = await fetchWithTimeout(targetUrl, {}, 30000)
      const arrayBuffer = await response.arrayBuffer()

      // Limit downloaded content size (10MB max)
      if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
        callback?.({
          text: 'Content too large. Maximum download size is 10MB.',
        })
        return
      }

      const data = new Uint8Array(arrayBuffer)
      const result = await client.storage.upload(data)

      callback?.({
        text: `Content uploaded to IPFS.
CID: ${result.cid}
Size: ${result.size} bytes
Gateway URL: ${result.gatewayUrl}`,
        content: result,
      })
      return
    }

    // Upload text content
    const content = text.replace(/upload|file|store|save|ipfs/gi, '').trim()
    if (content) {
      const data = new TextEncoder().encode(content)
      const result = await client.storage.upload(data, { name: 'content.txt' })

      callback?.({
        text: `Content uploaded to IPFS.
CID: ${result.cid}
Size: ${result.size} bytes
Gateway URL: ${result.gatewayUrl}`,
        content: result,
      })
      return
    }

    callback?.({
      text: 'Please provide content to upload (text, JSON, or URL).',
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Upload this data: {"name": "test", "value": 123}' },
      },
      {
        name: 'agent',
        content: { text: 'File uploaded to IPFS. CID: Qm...' },
      },
    ],
  ],
}

export const retrieveFileAction: Action = {
  name: 'RETRIEVE_FILE',
  description: 'Retrieve a file from the network storage by CID',
  similes: [
    'get file',
    'retrieve file',
    'download',
    'fetch from ipfs',
    'get cid',
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()

    const text = getMessageText(message)

    // Extract CID
    const cidMatch = text.match(/Qm[a-zA-Z0-9]{44}|bafy[a-zA-Z0-9]+/)
    if (!cidMatch) {
      callback?.({
        text: 'Please provide an IPFS CID (starting with Qm or bafy).',
      })
      return
    }

    const cid = cidMatch[0]
    callback?.({ text: `Retrieving ${cid}...` })

    const data = await client.storage.retrieve(cid)

    // Limit retrieved content size for display
    if (data.length > 10 * 1024 * 1024) {
      callback?.({
        text: `Retrieved large file (${data.length} bytes). Content too large to display.`,
        content: {
          cid,
          size: data.length,
          gatewayUrl: client.storage.getGatewayUrl(cid),
        },
      })
      return
    }

    const text_content = new TextDecoder().decode(data)

    // Parse as JSON if it looks like JSON (with safe parsing)
    const isJson =
      text_content.trim().startsWith('{') || text_content.trim().startsWith('[')
    let parsed: Record<string, unknown> | unknown[] | string = text_content
    if (isJson && text_content.length < MAX_JSON_SIZE) {
      try {
        const jsonParsed = safeJsonParseUnknown(text_content)
        if (typeof jsonParsed === 'object' && jsonParsed !== null) {
          parsed = jsonParsed as Record<string, unknown> | unknown[]
        }
      } catch {
        // Not valid JSON despite looking like it, keep as string
        parsed = text_content
      }
    }

    const displayContent = truncateOutput(text_content, 2000)

    callback?.({
      text: `Retrieved content (${data.length} bytes):

${displayContent}`,
      content: {
        cid,
        size: data.length,
        content: parsed,
        gatewayUrl: client.storage.getGatewayUrl(cid),
      },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Retrieve QmXxxxxx' },
      },
      {
        name: 'agent',
        content: { text: 'Retrieved content (1234 bytes): ...' },
      },
    ],
  ],
}
