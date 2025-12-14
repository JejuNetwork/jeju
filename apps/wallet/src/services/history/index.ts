/**
 * Transaction History Service
 * Uses network indexer for transaction data
 */

import type { Address, Hex } from 'viem';
import * as jeju from '../jeju';
import { SupportedChainId, SUPPORTED_CHAINS } from '../rpc';

export type TransactionType = 'send' | 'receive' | 'swap' | 'approve' | 'contract' | 'unknown';
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

export interface Transaction {
  hash: Hex;
  chainId: SupportedChainId;
  type: TransactionType;
  status: TransactionStatus;
  from: Address;
  to: Address | null;
  value: bigint;
  timestamp: number;
  gasUsed?: bigint;
  tokenTransfers?: Array<{
    token: Address;
    symbol: string;
    from: Address;
    to: Address;
    value: bigint;
  }>;
}

export interface FormattedTransaction {
  title: string;
  subtitle: string;
  amount: string;
  status: TransactionStatus;
}

// Pending transactions cache (per-session)
const pendingTxs = new Map<string, Transaction>();

class HistoryService {
  // Get transaction history from the network indexer
  async getHistory(
    address: Address,
    options: { chainId?: SupportedChainId; limit?: number } = {}
  ): Promise<Transaction[]> {
    const { limit = 50 } = options;

    try {
      const [txs, transfers] = await Promise.all([
        jeju.getAccountHistory(address, limit),
        jeju.getTokenTransfers(address, limit),
      ]);

      // Build transfer map by tx hash
      const transferMap = new Map<string, typeof transfers>();
      for (const t of transfers) {
        const existing = transferMap.get(t.txHash) || [];
        existing.push(t);
        transferMap.set(t.txHash, existing);
      }

      const transactions: Transaction[] = txs.map((tx) => {
        const isSend = tx.from.toLowerCase() === address.toLowerCase();
        const isContractCall = tx.input && tx.input.length > 2;
        const txTransfers = transferMap.get(tx.hash);

        let type: TransactionType = 'unknown';
        if (txTransfers?.length) {
          type = txTransfers.length > 1 ? 'swap' : (isSend ? 'send' : 'receive');
        } else if (isContractCall) {
          type = 'contract';
        } else {
          type = isSend ? 'send' : 'receive';
        }

        return {
          hash: tx.hash as Hex,
          chainId: 1337 as SupportedChainId, // Default to localnet; indexer provides actual chainId
          type,
          status: tx.status === 'SUCCESS' ? 'confirmed' : tx.status === 'FAILURE' ? 'failed' : 'pending',
          from: tx.from as Address,
          to: tx.to as Address | null,
          value: BigInt(tx.value),
          timestamp: new Date(tx.timestamp).getTime() / 1000,
          gasUsed: tx.gasUsed ? BigInt(tx.gasUsed) : undefined,
          tokenTransfers: txTransfers?.map((t) => ({
            token: t.token as Address,
            symbol: t.tokenSymbol,
            from: t.from as Address,
            to: t.to as Address,
            value: BigInt(t.value),
          })),
        };
      });

      // Add any pending transactions
      const pending = Array.from(pendingTxs.values())
        .filter((tx) => tx.from.toLowerCase() === address.toLowerCase())
        .filter((tx) => !transactions.some((t) => t.hash === tx.hash));

      return [...pending, ...transactions].slice(0, limit);
    } catch (error) {
      console.warn('Failed to fetch from indexer, returning pending only:', error);
      return Array.from(pendingTxs.values())
        .filter((tx) => tx.from.toLowerCase() === address.toLowerCase());
    }
  }

  // Get pending transactions
  async getPendingTransactions(address: Address): Promise<Transaction[]> {
    return Array.from(pendingTxs.values())
      .filter((tx) => tx.from.toLowerCase() === address.toLowerCase())
      .filter((tx) => tx.status === 'pending');
  }

  // Add a pending transaction
  addPending(tx: Transaction): void {
    pendingTxs.set(tx.hash, tx);
  }

  // Update transaction status
  updateStatus(hash: Hex, status: TransactionStatus): void {
    const tx = pendingTxs.get(hash);
    if (tx) {
      tx.status = status;
      if (status !== 'pending') {
        // Remove from pending after a delay
        setTimeout(() => pendingTxs.delete(hash), 60000);
      }
    }
  }

  // Format transaction for display
  formatTransaction(tx: Transaction, userAddress: Address): FormattedTransaction {
    const isSend = tx.from.toLowerCase() === userAddress.toLowerCase();
    const chain = SUPPORTED_CHAINS[tx.chainId];
    const symbol = chain?.nativeCurrency?.symbol || 'ETH';

    let title = '';
    let subtitle = '';
    let amount = '';

    switch (tx.type) {
      case 'send':
        title = 'Sent';
        subtitle = tx.to ? `To ${tx.to.slice(0, 6)}...${tx.to.slice(-4)}` : 'Contract';
        amount = `-${(Number(tx.value) / 1e18).toFixed(4)} ${symbol}`;
        break;
      case 'receive':
        title = 'Received';
        subtitle = `From ${tx.from.slice(0, 6)}...${tx.from.slice(-4)}`;
        amount = `+${(Number(tx.value) / 1e18).toFixed(4)} ${symbol}`;
        break;
      case 'swap':
        title = 'Swap';
        if (tx.tokenTransfers?.length === 2) {
          const inToken = tx.tokenTransfers.find((t) => t.to.toLowerCase() === userAddress.toLowerCase());
          const outToken = tx.tokenTransfers.find((t) => t.from.toLowerCase() === userAddress.toLowerCase());
          subtitle = `${outToken?.symbol || '?'} → ${inToken?.symbol || '?'}`;
          amount = inToken ? `+${(Number(inToken.value) / 1e18).toFixed(4)} ${inToken.symbol}` : '';
        } else {
          subtitle = 'Token swap';
          amount = '';
        }
        break;
      case 'approve':
        title = 'Approval';
        subtitle = tx.to ? `For ${tx.to.slice(0, 10)}...` : 'Token approval';
        amount = '';
        break;
      case 'contract':
        title = 'Contract Call';
        subtitle = tx.to ? tx.to.slice(0, 10) + '...' : 'Unknown';
        amount = tx.value > 0n ? `${(Number(tx.value) / 1e18).toFixed(4)} ${symbol}` : '';
        break;
      default:
        title = isSend ? 'Outgoing' : 'Incoming';
        subtitle = tx.hash.slice(0, 10) + '...';
        amount = `${(Number(tx.value) / 1e18).toFixed(4)} ${symbol}`;
    }

    return { title, subtitle, amount, status: tx.status };
  }
}

export const historyService = new HistoryService();
export { HistoryService };
