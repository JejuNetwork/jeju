/**
 * ERC-8004 Actions Tests
 * Tests ElizaOS actions for service discovery
 */

import { describe, it, expect } from 'bun:test';
import { 
  discoverServicesAction,
  connectToServiceAction,
  sendToServiceAction,
  disconnectFromServiceAction,
  listConnectionsAction
} from '../erc8004/actions';

describe('ERC-8004 Actions', () => {
  it('should define discover services action', () => {
    expect(discoverServicesAction).toBeDefined();
    expect(discoverServicesAction.name).toBe('DISCOVER_SERVICES');
    expect(discoverServicesAction.description).toContain('ERC-8004');
    expect(discoverServicesAction.handler).toBeDefined();
    expect(discoverServicesAction.validate).toBeDefined();
    expect(Array.isArray(discoverServicesAction.similes)).toBe(true);
    expect(Array.isArray(discoverServicesAction.examples)).toBe(true);
    
    console.log('[Test] ✓ DISCOVER_SERVICES action properly defined');
  });

  it('should define connect to service action', () => {
    expect(connectToServiceAction).toBeDefined();
    expect(connectToServiceAction.name).toBe('CONNECT_TO_SERVICE');
    expect(connectToServiceAction.description).toContain('ERC-8004');
    expect(connectToServiceAction.handler).toBeDefined();
    expect(connectToServiceAction.validate).toBeDefined();
    
    console.log('[Test] ✓ CONNECT_TO_SERVICE action properly defined');
  });

  it('should define send to service action', () => {
    expect(sendToServiceAction).toBeDefined();
    expect(sendToServiceAction.name).toBe('SEND_TO_SERVICE');
    expect(sendToServiceAction.handler).toBeDefined();
    expect(sendToServiceAction.validate).toBeDefined();
    
    console.log('[Test] ✓ SEND_TO_SERVICE action properly defined');
  });

  it('should define disconnect from service action', () => {
    expect(disconnectFromServiceAction).toBeDefined();
    expect(disconnectFromServiceAction.name).toBe('DISCONNECT_FROM_SERVICE');
    expect(disconnectFromServiceAction.handler).toBeDefined();
    expect(disconnectFromServiceAction.validate).toBeDefined();
    
    console.log('[Test] ✓ DISCONNECT_FROM_SERVICE action properly defined');
  });

  it('should define list connections action', () => {
    expect(listConnectionsAction).toBeDefined();
    expect(listConnectionsAction.name).toBe('LIST_CONNECTIONS');
    expect(listConnectionsAction.handler).toBeDefined();
    expect(listConnectionsAction.validate).toBeDefined();
    
    console.log('[Test] ✓ LIST_CONNECTIONS action properly defined');
  });

  it('should have proper action similes for natural language', () => {
    const allSimiles = [
      ...discoverServicesAction.similes,
      ...connectToServiceAction.similes,
      ...sendToServiceAction.similes,
      ...disconnectFromServiceAction.similes,
      ...listConnectionsAction.similes
    ];
    
    expect(allSimiles.length).toBeGreaterThan(10);
    expect(allSimiles.some(s => s.includes('list'))).toBe(true);
    expect(allSimiles.some(s => s.includes('connect'))).toBe(true);
    expect(allSimiles.some(s => s.includes('disconnect'))).toBe(true);
    
    console.log(`[Test] ✓ ${allSimiles.length} natural language variations defined`);
  });

  it('should have example conversations for all actions', () => {
    const actions = [
      discoverServicesAction,
      connectToServiceAction,
      sendToServiceAction,
      disconnectFromServiceAction,
      listConnectionsAction
    ];
    
    actions.forEach(action => {
      expect(action.examples).toBeDefined();
      expect(Array.isArray(action.examples)).toBe(true);
      expect(action.examples.length).toBeGreaterThan(0);
      
      action.examples.forEach((example: unknown[]) => {
        expect(Array.isArray(example)).toBe(true);
        expect(example.length).toBeGreaterThanOrEqual(2);
      });
    });
    
    console.log('[Test] ✓ All actions have example conversations');
  });
});

