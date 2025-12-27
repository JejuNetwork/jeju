/**
 * Injected Provider Script
 *
 * Provides window.jeju EIP-1193 compatible provider for dApps.
 * This script runs in the page context, not the extension context.
 */

import type { Address, Hex } from 'viem'

type EIP1193Param =
  | string
  | number
  | boolean
  | null
  | { [key: string]: EIP1193Param }
  | EIP1193Param[]

interface RequestArguments {
  method: string
  params?: EIP1193Param[]
}

interface ProviderConnectInfo {
  chainId: Hex
}

interface ProviderRpcError extends Error {
  code: number
  data?: EIP1193Param
}

type EventCallback<T = unknown> = (data: T) => void

interface PageResponse {
  type: 'jeju_response'
  id: string
  result?: EIP1193Param
  error?: { code: number; message: string }
}

interface PageEvent {
  type: 'jeju_event'
  event: string
  data: {
    type?: string
    chainId?: Hex
    accounts?: Address[]
  }
}

type MessageData = PageResponse | PageEvent | { type: string }

export class NetworkProvider {
  private eventListeners: Map<string, Set<EventCallback>> = new Map()
  private requestId = 0
  private pendingRequests: Map<
    string,
    { resolve: (v: EIP1193Param) => void; reject: (e: Error) => void }
  > = new Map()

  // EIP-1193 metadata
  isJeju = true
  isMetaMask = false // Don't impersonate MetaMask

  constructor() {
    // Listen for responses from content script
    window.addEventListener('message', (event: MessageEvent<MessageData>) => {
      if (event.source !== window) return
      if (!event.data || typeof event.data !== 'object') return

      const data = event.data
      if (data.type === 'jeju_response') {
        const response = data as PageResponse
        this.handleResponse(response)
      } else if (data.type === 'jeju_event') {
        const evt = data as PageEvent
        this.handleEvent(evt)
      }
    })

    // Announce provider (EIP-6963)
    this.announceProvider()
  }

  private handleResponse(response: PageResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) return

    this.pendingRequests.delete(response.id)

    if (response.error) {
      const error = new Error(response.error.message) as ProviderRpcError
      error.code = response.error.code
      pending.reject(error)
    } else {
      pending.resolve(response.result ?? null)
    }
  }

  private handleEvent(event: PageEvent): void {
    const { event: eventName, data } = event
    const listeners = this.eventListeners.get(eventName)
    if (!listeners) return

    // Dispatch based on event type
    if (data.type === 'chainChanged' && data.chainId) {
      for (const listener of listeners) {
        listener(data.chainId)
      }
    } else if (data.type === 'accountsChanged' && data.accounts) {
      for (const listener of listeners) {
        listener(data.accounts)
      }
    } else if (data.type === 'connect' && data.chainId) {
      for (const listener of listeners) {
        listener({ chainId: data.chainId } as ProviderConnectInfo)
      }
    } else if (data.type === 'disconnect') {
      for (const listener of listeners) {
        listener({ code: 4900, message: 'Disconnected' })
      }
    }
  }

  private announceProvider(): void {
    const info = {
      uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      name: 'Jeju Wallet',
      icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTI4IDEyOCI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHJ4PSIyNCIgZmlsbD0iIzEwQjk4MSIvPjx0ZXh0IHg9IjY0IiB5PSI4MCIgZm9udC1zaXplPSI2NCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiIGZvbnQtZmFtaWx5PSJzeXN0ZW0tdWkiIGZvbnQtd2VpZ2h0PSJib2xkIj5KPC90ZXh0Pjwvc3ZnPg==',
      rdns: 'org.jejunetwork.wallet',
    }

    // EIP-6963 provider announcement
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info, provider: this }),
      }),
    )

    // Listen for requests to announce
    window.addEventListener('eip6963:requestProvider', () => {
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: Object.freeze({ info, provider: this }),
        }),
      )
    })
  }

  /**
   * EIP-1193 request method
   */
  async request(args: RequestArguments): Promise<EIP1193Param> {
    const id = `${++this.requestId}`

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })

      window.postMessage(
        {
          type: 'jeju_request',
          id,
          method: args.method,
          params: args.params,
        },
        window.location.origin,
      )

      // Timeout after 5 minutes
      setTimeout(
        () => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id)
            reject(new Error('Request timed out'))
          }
        },
        5 * 60 * 1000,
      )
    })
  }

  /**
   * Legacy send method (deprecated)
   */
  send(
    methodOrPayload: string | RequestArguments,
    paramsOrCallback?:
      | EIP1193Param[]
      | ((error: Error | null, response?: EIP1193Param) => void),
  ): Promise<EIP1193Param> | undefined {
    if (typeof methodOrPayload === 'string') {
      return this.request({
        method: methodOrPayload,
        params: paramsOrCallback as EIP1193Param[] | undefined,
      })
    }

    // Callback pattern
    const callback = paramsOrCallback as (
      error: Error | null,
      response?: EIP1193Param,
    ) => void
    this.request(methodOrPayload)
      .then((result) => callback(null, result))
      .catch((error: Error) => callback(error))
  }

  /**
   * Legacy sendAsync method (deprecated)
   */
  sendAsync(
    request: RequestArguments,
    callback: (
      error: Error | null,
      response?: { result: EIP1193Param },
    ) => void,
  ): void {
    this.request(request)
      .then((result) => callback(null, { result }))
      .catch((error: Error) => callback(error))
  }

  /**
   * Subscribe to events
   */
  on(event: string, callback: EventCallback): this {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)?.add(callback)
    return this
  }

  /**
   * Subscribe once
   */
  once(event: string, callback: EventCallback): this {
    const wrapper: EventCallback = (data) => {
      this.removeListener(event, wrapper)
      callback(data)
    }
    return this.on(event, wrapper)
  }

  /**
   * Unsubscribe from events
   */
  removeListener(event: string, callback: EventCallback): this {
    this.eventListeners.get(event)?.delete(callback)
    return this
  }

  /**
   * Alias for removeListener
   */
  off(event: string, callback: EventCallback): this {
    return this.removeListener(event, callback)
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners(event?: string): this {
    if (event) {
      this.eventListeners.delete(event)
    } else {
      this.eventListeners.clear()
    }
    return this
  }

  /**
   * Get listener count
   */
  listenerCount(event: string): number {
    return this.eventListeners.get(event)?.size ?? 0
  }

  /**
   * Get listeners
   */
  listeners(event: string): EventCallback[] {
    return [...(this.eventListeners.get(event) ?? [])]
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return true
  }

  /**
   * Enable method (deprecated)
   */
  async enable(): Promise<Address[]> {
    return this.request({ method: 'eth_requestAccounts' }) as Promise<Address[]>
  }
}

// Create and expose provider
const provider = new NetworkProvider()

// Set as window.jeju
Object.defineProperty(window, 'jeju', {
  value: provider,
  writable: false,
  configurable: false,
})

// Also set as window.ethereum if not already present
if (typeof window.ethereum === 'undefined') {
  Object.defineProperty(window, 'ethereum', {
    value: provider,
    writable: false,
    configurable: false,
  })
}
