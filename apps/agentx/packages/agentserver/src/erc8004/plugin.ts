/**
 * ERC-8004 Plugin for ElizaOS
 * Enables agents to discover and connect to decentralized services
 */

import type { Plugin } from '@elizaos/core';
import { erc8004Actions } from './actions';
import { detectRunMode } from '../config';

export const erc8004Plugin: Plugin = {
  name: 'erc8004',
  description: 'ERC-8004 service discovery and connection',
  actions: erc8004Actions,
  evaluators: [],
  providers: [],
  
  // Only enable if we have blockchain access
  init: async () => {
    const mode = detectRunMode();
    
    if (mode === 'local') {
      console.log('[ERC-8004] Plugin initialized in local mode');
      console.log('[ERC-8004] Will use local blockchain at', process.env.RPC_URL || 'http://localhost:8545');
    } else {
      console.log('[ERC-8004] Plugin initialized in cloud mode');
      console.log('[ERC-8004] Will proxy through cloud services');
    }
    
    return true;
  }
};

