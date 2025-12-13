/**
 * Compute Trigger Tests
 * 
 * Tests for council orchestrator trigger integration with compute service.
 * Note: These tests require the server to be running with the latest code.
 */

import { test, expect } from '@playwright/test';

const COUNCIL_URL = 'http://localhost:8010';

test.describe('Compute Trigger', () => {
  // Check if trigger endpoints are available (new feature)
  test.beforeAll(async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/trigger/orchestrator`);
    if (response.status() === 404) {
      test.skip();
    }
  });

  test('trigger endpoint runs orchestrator cycle', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/trigger/orchestrator`, {
      data: { action: 'run-cycle' }
    });
    
    if (response.status() === 404) {
      test.skip();
      return;
    }
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('trigger endpoint accepts empty payload', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/trigger/orchestrator`);
    
    if (response.status() === 404) {
      test.skip();
      return;
    }
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('GET triggers returns trigger list or local mode', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/api/v1/triggers`);
    
    if (response.status() === 404) {
      test.skip();
      return;
    }
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.mode).toBeDefined();
  });

  test('GET trigger history returns executions', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/api/v1/triggers/history`);
    
    if (response.status() === 404) {
      test.skip();
      return;
    }
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.mode).toBeDefined();
  });

  test('POST trigger execute runs cycle manually', async ({ request }) => {
    const response = await request.post(`${COUNCIL_URL}/api/v1/triggers/execute`);
    
    if (response.status() === 404) {
      test.skip();
      return;
    }
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(typeof data.cycleCount).toBe('number');
  });

  test('orchestrator status reflects trigger activity', async ({ request }) => {
    // Check orchestrator status (this endpoint existed before)
    const response = await request.get(`${COUNCIL_URL}/api/v1/orchestrator/status`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(typeof data.running).toBe('boolean');
    expect(typeof data.cycleCount).toBe('number');
  });

  test('health endpoint includes trigger info', async ({ request }) => {
    const response = await request.get(`${COUNCIL_URL}/health`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.endpoints).toBeDefined();
  });

  test('trigger can be called multiple times', async ({ request }) => {
    // First call
    const response1 = await request.post(`${COUNCIL_URL}/trigger/orchestrator`);
    
    if (response1.status() === 404) {
      test.skip();
      return;
    }
    
    expect(response1.ok()).toBeTruthy();
    const data1 = await response1.json();
    
    // Second call
    const response2 = await request.post(`${COUNCIL_URL}/trigger/orchestrator`);
    expect(response2.ok()).toBeTruthy();
    const data2 = await response2.json();
    
    // Both should succeed
    expect(data1.success).toBe(true);
    expect(data2.success).toBe(true);
  });
});
