/**
 * @fileoverview Main types barrel export for Jeju Network
 *
 * This module exports all shared types, schemas, and utilities
 * for the Jeju ecosystem. Types are organized by domain and
 * include Zod schemas for runtime validation.
 */

// API types
export * from './api'
// Blockchain & DeFi
export * from './bridge'
// Infrastructure
export * from './cdn'
export * from './chain'
export * from './compute'
export * from './contracts'
export * from './defi'
// Cross-chain interoperability
export * from './eil'
// Domain-specific
export * from './events'
export * from './external-compute'
export * from './governance'
export * from './health'
export * from './infrastructure'
export * from './moderation'
export * from './names'
export * from './nft-eil'
export * from './oif'
export * from './oracle'
// JSON-RPC types
export * from './rpc'
export * from './torrent'
// Core validation primitives (must be first - contains base types)
export * from './validation'
export * from './vendor'
export * from './vpn'
