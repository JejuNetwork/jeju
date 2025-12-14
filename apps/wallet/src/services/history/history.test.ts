/**
 * History Service Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService, type Transaction, type TransactionType } from './index';

describe('HistoryService', () => {
  let service: HistoryService;
  const userAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
  const recipientAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;

  beforeEach(() => {
    service = new HistoryService();
  });

  function createTx(overrides: Partial<Transaction> = {}): Transaction {
    return {
      hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
      chainId: 1,
      type: 'send',
      status: 'confirmed',
      from: userAddress,
      to: recipientAddress,
      value: BigInt(1e18), // 1 ETH
      timestamp: Date.now(),
      ...overrides,
    };
  }

  describe('formatTransaction', () => {
    it('should format send transaction', () => {
      const tx = createTx({ type: 'send' });
      const formatted = service.formatTransaction(tx, userAddress);
      
      expect(formatted.title).toBe('Sent');
      expect(formatted.subtitle).toContain('To');
      expect(formatted.amount).toContain('-');
      expect(formatted.amount).toContain('ETH');
    });

    it('should format receive transaction', () => {
      const tx = createTx({ 
        type: 'receive',
        from: recipientAddress,
        to: userAddress,
      });
      const formatted = service.formatTransaction(tx, userAddress);
      
      expect(formatted.title).toBe('Received');
      expect(formatted.subtitle).toContain('From');
      expect(formatted.amount).toContain('+');
    });

    it('should format contract call', () => {
      const tx = createTx({ type: 'contract' });
      const formatted = service.formatTransaction(tx, userAddress);
      
      expect(formatted.title).toBe('Contract Call');
    });

    it('should format approval', () => {
      const tx = createTx({ type: 'approve', value: 0n });
      const formatted = service.formatTransaction(tx, userAddress);
      
      expect(formatted.title).toBe('Approval');
    });

    it('should include transaction status', () => {
      const pendingTx = createTx({ status: 'pending' });
      const confirmedTx = createTx({ status: 'confirmed' });
      const failedTx = createTx({ status: 'failed' });
      
      expect(service.formatTransaction(pendingTx, userAddress).status).toBe('pending');
      expect(service.formatTransaction(confirmedTx, userAddress).status).toBe('confirmed');
      expect(service.formatTransaction(failedTx, userAddress).status).toBe('failed');
    });

    it('should format swap with token transfers', () => {
      const tx = createTx({ 
        type: 'swap',
        tokenTransfers: [
          { token: '0x1111111111111111111111111111111111111111' as const, symbol: 'USDC', from: userAddress, to: recipientAddress, value: BigInt(1e6) },
          { token: '0x2222222222222222222222222222222222222222' as const, symbol: 'ETH', from: recipientAddress, to: userAddress, value: BigInt(1e18) },
        ],
      });
      const formatted = service.formatTransaction(tx, userAddress);
      
      expect(formatted.title).toBe('Swap');
      expect(formatted.subtitle).toContain('→');
    });
  });

  describe('pending transactions', () => {
    it('should add pending transaction', () => {
      const tx = createTx({ status: 'pending' });
      service.addPending(tx);
      
      // Pending txs should be tracked
      expect(tx.status).toBe('pending');
    });

    it('should update transaction status', () => {
      const tx = createTx({ status: 'pending' });
      service.addPending(tx);
      
      service.updateStatus(tx.hash, 'confirmed');
      
      // Status should be updated
      expect(tx.status).toBe('confirmed');
    });

    it('should get pending transactions for address', async () => {
      const tx1 = createTx({ 
        hash: '0xaaaa567890123456789012345678901234567890123456789012345678901234',
        status: 'pending' 
      });
      const tx2 = createTx({ 
        hash: '0xbbbb567890123456789012345678901234567890123456789012345678901234',
        status: 'pending',
        from: recipientAddress, // Different sender
      });
      
      service.addPending(tx1);
      service.addPending(tx2);
      
      const pending = await service.getPendingTransactions(userAddress);
      
      expect(pending.length).toBe(1);
      expect(pending[0].hash).toBe(tx1.hash);
    });
  });
});


