/**
 * Extension Background Script (Service Worker for MV3)
 * 
 * Handles:
 * - Wallet state management
 * - Transaction signing
 * - Provider requests from dApps
 * - Cross-chain operations via EIL/OIF
 */

import { storage } from '../../platform/storage';

// Message types
type MessageType =
  | 'connect'
  | 'disconnect'
  | 'eth_requestAccounts'
  | 'eth_accounts'
  | 'eth_chainId'
  | 'eth_sendTransaction'
  | 'eth_signTypedData_v4'
  | 'personal_sign'
  | 'wallet_switchEthereumChain'
  | 'wallet_addEthereumChain'
  | 'jeju_crossChainTransfer'
  | 'jeju_submitIntent';

interface Message {
  type: MessageType;
  data?: Record<string, unknown>;
  id?: string;
}

interface WalletState {
  isLocked: boolean;
  accounts: string[];
  chainId: string;
  connectedSites: string[];
}

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
  const saved = await storage.getJSON<WalletState>('wallet_state');
  if (saved) {
    walletState = { ...defaultState, ...saved };
  }
}

async function saveState(): Promise<void> {
  await storage.setJSON('wallet_state', walletState);
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender.origin ?? '')
    .then(sendResponse)
    .catch((error: Error) => sendResponse({ error: error.message }));
  return true; // Keep channel open for async response
});

async function handleMessage(message: Message, origin: string): Promise<unknown> {
  switch (message.type) {
    case 'eth_requestAccounts':
      return handleRequestAccounts(origin);

    case 'eth_accounts':
      return handleGetAccounts(origin);

    case 'eth_chainId':
      return walletState.chainId;

    case 'eth_sendTransaction':
      return handleSendTransaction(message.data as Record<string, unknown>);

    case 'personal_sign':
      return handlePersonalSign(message.data as { message: string; address: string });

    case 'eth_signTypedData_v4':
      return handleSignTypedData(message.data as { address: string; data: string });

    case 'wallet_switchEthereumChain':
      return handleSwitchChain(message.data as { chainId: string });

    case 'wallet_addEthereumChain':
      return handleAddChain(message.data as Record<string, unknown>);

    case 'jeju_crossChainTransfer':
      return handleCrossChainTransfer(message.data as Record<string, unknown>);

    case 'jeju_submitIntent':
      return handleSubmitIntent(message.data as Record<string, unknown>);

    case 'connect':
      return handleConnect(origin);

    case 'disconnect':
      return handleDisconnect(origin);

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function handleRequestAccounts(origin: string): Promise<string[]> {
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
      const listener = (msg: { type?: string; approved?: boolean; origin?: string }) => {
        if (msg.type === 'connection_response' && msg.origin === origin) {
          chrome.runtime.onMessage.removeListener(listener);
          if (msg.approved) {
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
  if (!walletState.connectedSites.includes(origin)) {
    walletState.connectedSites.push(origin);
    await saveState();
  }
  return true;
}

async function handleDisconnect(origin: string): Promise<boolean> {
  walletState.connectedSites = walletState.connectedSites.filter(s => s !== origin);
  await saveState();
  return true;
}

async function handleSendTransaction(tx: Record<string, unknown>): Promise<string> {
  // Open popup for transaction approval
  const result = await openPopupWithResult('transaction', { tx });
  if (!result.approved) {
    throw new Error('User rejected transaction');
  }
  return result.hash as string;
}

async function handlePersonalSign(data: { message: string; address: string }): Promise<string> {
  const result = await openPopupWithResult('sign', { 
    type: 'personal_sign',
    message: data.message,
    address: data.address,
  });
  if (!result.approved) {
    throw new Error('User rejected signature');
  }
  return result.signature as string;
}

async function handleSignTypedData(data: { address: string; data: string }): Promise<string> {
  const result = await openPopupWithResult('sign', {
    type: 'eth_signTypedData_v4',
    data: data.data,
    address: data.address,
  });
  if (!result.approved) {
    throw new Error('User rejected signature');
  }
  return result.signature as string;
}

async function handleSwitchChain(data: { chainId: string }): Promise<null> {
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
  return result.requestId as string;
}

async function handleSubmitIntent(data: Record<string, unknown>): Promise<string> {
  const result = await openPopupWithResult('intent', data);
  if (!result.approved) {
    throw new Error('User rejected intent');
  }
  return result.intentId as string;
}

// Popup management
async function openPopup(path: string, params?: Record<string, unknown>): Promise<void> {
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
): Promise<{ approved: boolean; [key: string]: unknown }> {
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
    const listener = (msg: { type?: string; requestId?: string; approved?: boolean }) => {
      if (msg.type === 'popup_response' && msg.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(msg as { approved: boolean; [key: string]: unknown });
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

console.log('Network Wallet background script initialized');

