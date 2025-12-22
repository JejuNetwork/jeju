/**
 * @fileoverview Main types barrel export for Jeju Network
 *
 * This module exports all shared types, schemas, and utilities
 * for the Jeju ecosystem. Types are organized by domain and
 * include Zod schemas for runtime validation.
 */

// Core validation primitives (must be first - contains base types)
export * from './validation';

// API types
export * from './api';

// Blockchain & DeFi
export * from './bridge';
export * from './chain';
export * from './contracts';
export * from './defi';

// Cross-chain interoperability
export * from './eil';
export * from './nft-eil';
export * from './oif';

// Infrastructure
export * from './cdn';
export * from './compute';
export * from './external-compute';
export * from './infrastructure';
export * from './vpn';

// Domain-specific
export * from './events';
export * from './funding';
export * from './governance';
export * from './health';
export * from './moderation';
export * from './names';
export * from './oracle';
export * from './torrent';
export * from './vendor';
