/**
 * @jejunetwork/messaging browser stub
 * 
 * Messaging functionality is handled via API, not directly in browser.
 */

export const createMessagingClient = () => {
  throw new Error('createMessagingClient is not available in browser')
}

export const MessagingClient = class {
  constructor() {
    throw new Error('MessagingClient is not available in browser')
  }
}

export type Message = Record<string, never>
export type Channel = Record<string, never>
