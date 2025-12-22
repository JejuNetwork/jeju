/**
 * Transaction utilities
 * Shared business logic for transaction-related operations
 */

import { DataSource } from 'typeorm';
import { Transaction } from '../model';

export interface TransactionsQueryOptions {
  limit: number;
  offset: number;
}

export async function getTransactions(
  dataSource: DataSource,
  options: TransactionsQueryOptions
): Promise<Transaction[]> {
  if (!dataSource) {
    throw new Error('DataSource is required');
  }
  if (typeof options.limit !== 'number' || options.limit <= 0) {
    throw new Error(`Invalid limit: ${options.limit}. Must be a positive number.`);
  }
  if (typeof options.offset !== 'number' || options.offset < 0) {
    throw new Error(`Invalid offset: ${options.offset}. Must be a non-negative number.`);
  }

  return await dataSource.getRepository(Transaction).find({
    order: { blockNumber: 'DESC' },
    take: options.limit,
    skip: options.offset,
    relations: ['from', 'to'],
  });
}

export async function getTransactionByHash(
  dataSource: DataSource,
  hash: string
): Promise<Transaction | null> {
  if (!dataSource) {
    throw new Error('DataSource is required');
  }
  if (!hash || typeof hash !== 'string' || hash.trim().length === 0) {
    throw new Error('hash is required and must be a non-empty string');
  }

  return await dataSource.getRepository(Transaction).findOne({
    where: { hash },
    relations: ['from', 'to', 'block'],
  });
}
