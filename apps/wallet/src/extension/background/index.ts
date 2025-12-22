/**
 * Extension Background Script (Service Worker for MV3)
 * 
 * Handles:
 * - Wallet state management
 * - Transaction signing
 * - Provider requests from dApps
 * - Cross-chain operations via EIL/OIF
 */

import { z } from 'zod';
import { isAddress, isHex } from 'viem';
import { storage } from '../../platform/storage';
import { expectSchema, expectAddress, expectHex, expectDefined, expectNonEmpty } from '../../lib/validation';

// ============================================================================
// Validation Schemas
// ============================================================================

const MessageTypeSchema = z.enum([
  'connect',
  'disconnect',
  'eth_requestAccounts',
  'eth_accounts',
  'eth_chainId',
  'eth_sendTransaction',
  'eth_signTypedData_v4',
  'personal_sign',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'jeju_crossChainTransfer',
  'jeju_submitIntent',
]);

const MessageSchema = z.object({
  type: MessageTypeSchema,
  data: z.record(z.string(), z.unknown()).optional(),
  id: z.string().optional(),
});

const WalletStateSchema = z.object({
  isLocked: z.boolean(),
  accounts: z.array(z.string().refine((val) => isAddress(val), { error: 'Invalid address' })),
  chainId: z.string().refine((val) => /^0x[0-9a-fA-F]+$/.test(val), { error: 'Invalid chainId hex' }),
  connectedSites: z.array(z.string().min(1)),
});

const SendTransactionDataSchema = z.object({
  to: z.string().refine((val) => isAddress(val), { error: 'Invalid to address' }),
  value: z.string().optional(),
  data: z.string().refine((val) => isHex(val), { error: 'Invalid data hex' }).optional(),
  gas: z.string().optional(),
  gasPrice: z.string().optional(),
});

const PersonalSignDataSchema = z.object({
  message: z.string().min(1),
  address: z.string().refine((val) => isAddress(val), { error: 'Invalid address' }),
});

const SignTypedDataSchema = z.object({
  address: z.string().refine((val) => isAddress(val), { error: 'Invalid address' }),
  data: z.string().min(1),
});

const SwitchChainDataSchema = z.object({
  chainId: z.string().refine((val) => /^0x[0-9a-fA-F]+$/.test(val), { error: 'Invalid chainId hex' }),
});

const PopupResponseSchema = z.object({
  type: z.literal('popup_response'),
  requestId: z.string().uuid(),
  approved: z.boolean(),
  hash: z.string().optional(),
  signature: z.string().optional(),
  intentId: z.string().optional(),
});

const ConnectionResponseSchema = z.object({
  type: z.literal('connection_response'),
  origin: z.string().min(1),
  approved: z.boolean(),
});

// ============================================================================
// Types
// ============================================================================

type MessageType = z.infer<typeof MessageTypeSchema>;
type Message = z.infer<typeof MessageSchema>;
type WalletState = z.infer<typeof WalletStateSchema>;

// Initialize wallet state
const defaultState: WalletState = {
  isLocked: true,
  accounts: [],
  chainId: '0x2105', // Base mainnet
  connectedSites: [],
};

let walletState: WalletState = { ...defaultState };

// Load state on startup
async function loadState(): Promise<void> {
  const saved = await storage.getJSON('wallet_state', WalletStateSchema);
  if (saved) {
    walletState = { ...defaultState, ...saved };
  }
}

async function saveState(): Promise<void> {
  await storage.setJSON('wallet_state', walletState);
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const validatedMessage = expectSchema(message, MessageSchema, 'message');
  const origin = expectNonEmpty(sender.origin ?? '', 'sender.origin');
  
  handleMessage(validatedMessage, origin)
    .then(sendResponse)
    .catch((error: Error) => sendResponse({ error: error.message }));
  return true; // Keep channel open for async response
});

async function handleMessage(message: Message, origin: string): Promise<unknown> {
  expectNonEmpty(origin, 'origin');
  
  switch (message.type) {
    case 'eth_requestAccounts':
      return handleRequestAccounts(origin);

    case 'eth_accounts':
      return handleGetAccounts(origin);

    case 'eth_chainId':
      return walletState.chainId;

    case 'eth_sendTransaction': {
      const data = expectDefined(message.data, 'message.data');
      const validated = expectSchema(data, SendTransactionDataSchema, 'eth_sendTransaction data');
      return handleSendTransaction(validated);
    }

    case 'personal_sign': {
      const data = expectDefined(message.data, 'message.data');
      const validated = expectSchema(data, PersonalSignDataSchema, 'personal_sign data');
      return handlePersonalSign(validated);
    }

    case 'eth_signTypedData_v4': {
      const data = expectDefined(message.data, 'message.data');
      const validated = expectSchema(data, SignTypedDataSchema, 'eth_signTypedData_v4 data');
      return handleSignTypedData(validated);
    }

    case 'wallet_switchEthereumChain': {
      const data = expectDefined(message.data, 'message.data');
      const validated = expectSchema(data, SwitchChainDataSchema, 'wallet_switchEthereumChain data');
      return handleSwitchChain(validated);
    }

    case 'wallet_addEthereumChain': {
      const data = expectDefined(message.data, 'message.data');
      return handleAddChain(data);
    }

    case 'jeju_crossChainTransfer': {
      const data = expectDefined(message.data, 'message.data');
      return handleCrossChainTransfer(data);
    }

    case 'jeju_submitIntent': {
      const data = expectDefined(message.data, 'message.data');
      return handleSubmitIntent(data);
    }

    case 'connect':
      return handleConnect(origin);

    case 'disconnect':
      return handleDisconnect(origin);

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function handleRequestAccounts(origin: string): Promise<string[]> {
  expectNonEmpty(origin, 'origin');
  
  if (walletState.isLocked) {
    // Open popup to unlock
    await openPopup('unlock');
    throw new Error('Wallet is locked');
  }

  if (!walletState.connectedSites.includes(origin)) {
    // Open popup to approve connection
    await openPopup('connect', { origin });
    // Wait for user approval
    return new Promise((resolve, reject) => {
      const listener = (msg: unknown) => {
        const validated = expectSchema(msg, ConnectionResponseSchema, 'connection_response');
        if (validated.origin === origin) {
          chrome.runtime.onMessage.removeListener(listener);
          if (validated.approved) {
            walletState.connectedSites.push(origin);
            saveState();
            resolve(walletState.accounts);
          } else {
            reject(new Error('User rejected connection'));
          }
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    });
  }

  return walletState.accounts;
}

async function handleGetAccounts(origin: string): Promise<string[]> {
  if (walletState.isLocked || !walletState.connectedSites.includes(origin)) {
    return [];
  }
  return walletState.accounts;
}

async function handleConnect(origin: string): Promise<boolean> {
  expectNonEmpty(origin, 'origin');
  
  if (!walletState.connectedSites.includes(origin)) {
    walletState.connectedSites.push(origin);
    await saveState();
  }
  return true;
}

async function handleDisconnect(origin: string): Promise<boolean> {
  expectNonEmpty(origin, 'origin');
  
  walletState.connectedSites = walletState.connectedSites.filter(s => s !== origin);
  await saveState();
  return true;
}

async function handleSendTransaction(tx: z.infer<typeof SendTransactionDataSchema>): Promise<string> {
  expectAddress(tx.to, 'tx.to');
  if (tx.data) {
    expectHex(tx.data, 'tx.data');
  }
  
  // Open popup for transaction approval
  const result = await openPopupWithResult('transaction', { tx });
  if (!result.approved) {
    throw new Error('User rejected transaction');
  }
  
  const hash = expectDefined(result.hash, 'result.hash');
  expectHex(hash, 'result.hash');
  return hash;
}

async function handlePersonalSign(data: z.infer<typeof PersonalSignDataSchema>): Promise<string> {
  expectNonEmpty(data.message, 'data.message');
  expectAddress(data.address, 'data.address');
  
  const result = await openPopupWithResult('sign', { 
    type: 'personal_sign',
    message: data.message,
    address: data.address,
  });
  if (!result.approved) {
    throw new Error('User rejected signature');
  }
  
  const signature = expectDefined(result.signature, 'result.signature');
  expectHex(signature, 'result.signature');
  return signature;
}

async function handleSignTypedData(data: z.infer<typeof SignTypedDataSchema>): Promise<string> {
  expectAddress(data.address, 'data.address');
  expectNonEmpty(data.data, 'data.data');
  
  const result = await openPopupWithResult('sign', {
    type: 'eth_signTypedData_v4',
    data: data.data,
    address: data.address,
  });
  if (!result.approved) {
    throw new Error('User rejected signature');
  }
  
  const signature = expectDefined(result.signature, 'result.signature');
  expectHex(signature, 'result.signature');
  return signature;
}

async function handleSwitchChain(data: z.infer<typeof SwitchChainDataSchema>): Promise<null> {
  expectNonEmpty(data.chainId, 'data.chainId');
  if (!/^0x[0-9a-fA-F]+$/.test(data.chainId)) {
    throw new Error(`Invalid chainId format: ${data.chainId}`);
  }
  
  walletState.chainId = data.chainId;
  await saveState();
  
  // Notify all connected tabs
  broadcastToTabs({ type: 'chainChanged', chainId: data.chainId });
  
  return null;
}

async function handleAddChain(chainData: Record<string, unknown>): Promise<null> {
  // Open popup to approve adding chain
  const result = await openPopupWithResult('add_chain', chainData);
  if (!result.approved) {
    throw new Error('User rejected adding chain');
  }
  return null;
}

async function handleCrossChainTransfer(data: Record<string, unknown>): Promise<string> {
  const result = await openPopupWithResult('cross_chain', data);
  if (!result.approved) {
    throw new Error('User rejected cross-chain transfer');
  }
  
  const requestId = expectDefined(result.requestId, 'result.requestId');
  expectNonEmpty(requestId, 'result.requestId');
  return requestId;
}

async function handleSubmitIntent(data: Record<string, unknown>): Promise<string> {
  const result = await openPopupWithResult('intent', data);
  if (!result.approved) {
    throw new Error('User rejected intent');
  }
  
  const intentId = expectDefined(result.intentId, 'result.intentId');
  expectHex(intentId, 'result.intentId');
  return intentId;
}

// Popup management
async function openPopup(path: string, params?: Record<string, unknown>): Promise<void> {
  expectNonEmpty(path, 'path');
  
  const url = new URL(chrome.runtime.getURL('popup.html'));
  url.hash = `/${path}`;
  if (params) {
    url.searchParams.set('data', JSON.stringify(params));
  }

  await chrome.windows.create({
    url: url.toString(),
    type: 'popup',
    width: 420,
    height: 680,
    focused: true,
  });
}

async function openPopupWithResult(
  path: string, 
  params: Record<string, unknown>
): Promise<{ approved: boolean; hash?: string; signature?: string; requestId?: string; intentId?: string }> {
  expectNonEmpty(path, 'path');
  
  const requestId = crypto.randomUUID();
  const url = new URL(chrome.runtime.getURL('popup.html'));
  url.hash = `/${path}`;
  url.searchParams.set('requestId', requestId);
  url.searchParams.set('data', JSON.stringify(params));

  await chrome.windows.create({
    url: url.toString(),
    type: 'popup',
    width: 420,
    height: 680,
    focused: true,
  });

  return new Promise((resolve) => {
    const listener = (msg: unknown) => {
      const validated = expectSchema(msg, PopupResponseSchema, 'popup_response');
      if (validated.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(listener);
        resolve({
          approved: validated.approved,
          hash: validated.hash,
          signature: validated.signature,
          requestId: validated.requestId,
          intentId: validated.intentId,
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
  });
}

function broadcastToTabs(message: Record<string, unknown>): void {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab might not have content script
        });
      }
    }
  });
}

// Initialize
loadState();

// Keep service worker alive (MV3)
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => {
  // Periodic check to keep service worker active
});

// Background script initialized

