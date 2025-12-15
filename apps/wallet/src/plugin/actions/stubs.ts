/**
 * Action Stubs
 * 
 * These actions are NOT IMPLEMENTED. They will return errors when called.
 * Each stub clearly indicates what functionality is missing.
 * 
 * To implement: Replace the stub with actual logic using the SDK clients.
 */

import type { Action, IAgentRuntime, Memory, HandlerCallback, ActionResult } from '@elizaos/core';

// Helper to create stub actions that clearly fail
const createStubAction = (
  name: string,
  similes: string[],
  description: string
): Action => ({
  name,
  similes,
  description,
  parameters: {},
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: unknown,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    runtime.logger.warn(`[${name}] Action NOT IMPLEMENTED - this is a stub`);
    const errorText = `Action "${name}" is not yet implemented. This feature requires:\n` +
      `1. Deploy network contracts (CrossChainPaymaster, InputSettler, etc.)\n` +
      `2. Implement the action handler in /plugin/actions/\n\n` +
      `See README.md for setup instructions.`;
    callback?.({ text: errorText, content: { error: 'NOT_IMPLEMENTED', stub: true } });
    return { text: errorText, success: false, error: 'NOT_IMPLEMENTED', data: { stub: true } };
  },
  examples: [],
});

// Wallet Management Stubs
export const walletCreateAction = createStubAction(
  'WALLET_CREATE',
  ['CREATE_WALLET', 'NEW_WALLET', 'SETUP_WALLET'],
  'Create a new wallet with optional smart account support'
);

export const walletImportAction = createStubAction(
  'WALLET_IMPORT',
  ['IMPORT_WALLET', 'RESTORE_WALLET'],
  'Import wallet from seed phrase or private key'
);

export const walletExportAction = createStubAction(
  'WALLET_EXPORT',
  ['EXPORT_WALLET', 'BACKUP_WALLET'],
  'Export wallet backup'
);

export const walletLockAction = createStubAction(
  'WALLET_LOCK',
  ['LOCK_WALLET', 'SECURE_WALLET'],
  'Lock wallet for security'
);

export const walletUnlockAction = createStubAction(
  'WALLET_UNLOCK',
  ['UNLOCK_WALLET'],
  'Unlock wallet with password'
);

// Transaction Stubs
export const sendNFTAction = createStubAction(
  'SEND_NFT',
  ['TRANSFER_NFT', 'NFT_TRANSFER'],
  'Transfer NFT to another address'
);

export const bridgeAction = createStubAction(
  'BRIDGE',
  ['BRIDGE_TOKENS'],
  'Bridge tokens using EIL'
);

export const batchTransactionAction = createStubAction(
  'BATCH_TRANSACTION',
  ['BATCH', 'MULTI_TX'],
  'Execute multiple transactions in one'
);

// Signing Stubs
export const signTypedDataAction = createStubAction(
  'SIGN_TYPED_DATA',
  ['SIGN_EIP712', 'TYPED_SIGNATURE'],
  'Sign EIP-712 typed data'
);

export const signTransactionAction = createStubAction(
  'SIGN_TRANSACTION',
  ['SIGN_TX'],
  'Sign a transaction without broadcasting'
);

// Approval Stubs
export const approveTokenAction = createStubAction(
  'APPROVE_TOKEN',
  ['APPROVE', 'TOKEN_APPROVAL'],
  'Approve token spending'
);

export const revokeApprovalAction = createStubAction(
  'REVOKE_APPROVAL',
  ['REVOKE', 'REMOVE_APPROVAL'],
  'Revoke token approval'
);

export const listApprovalsAction = createStubAction(
  'LIST_APPROVALS',
  ['SHOW_APPROVALS', 'MY_APPROVALS'],
  'List active token approvals'
);

// Intent Stubs
export const createIntentAction = createStubAction(
  'CREATE_INTENT',
  ['NEW_INTENT'],
  'Create OIF intent for cross-chain operation'
);

export const checkIntentStatusAction = createStubAction(
  'CHECK_INTENT_STATUS',
  ['INTENT_STATUS'],
  'Check status of an intent'
);

// History Stubs
export const transactionHistoryAction = createStubAction(
  'TRANSACTION_HISTORY',
  ['TX_HISTORY', 'MY_TRANSACTIONS', 'HISTORY'],
  'View transaction history'
);

export const checkTransactionStatusAction = createStubAction(
  'CHECK_TX_STATUS',
  ['TX_STATUS', 'TRANSACTION_STATUS'],
  'Check status of a transaction'
);

export const getExplorerLinkAction = createStubAction(
  'GET_EXPLORER_LINK',
  ['EXPLORER_LINK', 'TX_LINK'],
  'Get block explorer link for transaction'
);

// Security Stubs
export const simulateTransactionAction = createStubAction(
  'SIMULATE_TRANSACTION',
  ['SIMULATE', 'DRY_RUN'],
  'Simulate transaction before execution'
);

export const analyzeRiskAction = createStubAction(
  'ANALYZE_RISK',
  ['RISK_CHECK', 'SECURITY_CHECK'],
  'Analyze transaction risk'
);

