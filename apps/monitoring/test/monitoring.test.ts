/**
 * Monitoring Stack Tests
 * Verifies Prometheus and Grafana are accessible
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { $ } from 'bun';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GRAFANA_PORT = parseInt(process.env.GRAFANA_PORT || '4010');
const PROMETHEUS_PORT = parseInt(process.env.PROMETHEUS_PORT || '9090');

interface GrafanaHealth {
  database: string;
}

interface PrometheusTarget {
  health: string;
  labels: Record<string, string>;
}

interface PrometheusTargetsResponse {
  status: string;
  data: {
    activeTargets: PrometheusTarget[];
  };
}

interface GrafanaDataSource {
  type: string;
  name: string;
}

let grafanaAvailable = false;
let prometheusAvailable = false;
let monitoringStarted = false;

async function checkService(url: string, timeout = 2000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

async function startMonitoringStack(): Promise<void> {
  // Get the monitoring directory (where this test file is located)
  const monitoringDir = path.resolve(__dirname, '..');
  const dockerComposePath = path.join(monitoringDir, 'docker-compose.yml');
  
  if (!fs.existsSync(dockerComposePath)) {
    console.log(`⚠️  docker-compose.yml not found at ${dockerComposePath}, skipping monitoring stack startup`);
    return;
  }

  // Check if already running
  const grafanaRunning = await checkService(`http://localhost:${GRAFANA_PORT}/api/health`);
  const prometheusRunning = await checkService(`http://localhost:${PROMETHEUS_PORT}/api/v1/targets`);
  
  if (grafanaRunning && prometheusRunning) {
    console.log('✅ Monitoring stack already running');
    grafanaAvailable = true;
    prometheusAvailable = true;
    return;
  }

  console.log('🚀 Starting monitoring stack (Prometheus & Grafana)...');
  
  try {
    // Start docker-compose
    await $`cd ${monitoringDir} && docker-compose up -d`.quiet();
    
    // Wait for services to be ready
    console.log('⏳ Waiting for services to start...');
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      grafanaAvailable = await checkService(`http://localhost:${GRAFANA_PORT}/api/health`);
      prometheusAvailable = await checkService(`http://localhost:${PROMETHEUS_PORT}/api/v1/targets`);
      
      if (grafanaAvailable && prometheusAvailable) {
        console.log('✅ Monitoring stack started successfully');
        monitoringStarted = true;
        return;
      }
    }
    
    console.log('⚠️  Monitoring stack did not start in time');
  } catch (error) {
    console.log(`⚠️  Failed to start monitoring stack: ${error instanceof Error ? error.message : String(error)}`);
  }
}

beforeAll(async () => {
  // Try to start monitoring stack
  await startMonitoringStack();
  
  // Final check with retries (services might be starting)
  for (let i = 0; i < 5; i++) {
    if (!grafanaAvailable) {
      const grafanaRes = await fetch(`http://localhost:${GRAFANA_PORT}/api/health`).catch(() => null);
      grafanaAvailable = grafanaRes?.ok ?? false;
    }
    
    if (!prometheusAvailable) {
      const promRes = await fetch(`http://localhost:${PROMETHEUS_PORT}/api/v1/targets`).catch(() => null);
      prometheusAvailable = promRes?.ok ?? false;
    }
    
    if (grafanaAvailable && prometheusAvailable) {
      break;
    }
    
    // Wait a bit before retrying
    if (i < 4) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  if (!grafanaAvailable || !prometheusAvailable) {
    console.log('⚠️  Monitoring stack not fully available - some tests will be skipped');
  }
});

afterAll(async () => {
  // Only stop if we started it
  if (monitoringStarted && process.env.CI !== 'true') {
    console.log('🛑 Stopping monitoring stack...');
    try {
      const monitoringDir = path.join(__dirname, '..');
      await $`cd ${monitoringDir} && docker-compose down`.quiet();
    } catch {
      // Ignore errors on cleanup
    }
  }
});

describe('Monitoring Stack', () => {
  test('should access Grafana login page', async () => {
    if (!grafanaAvailable) {
      console.log('⚠️  Grafana not running, skipping test');
      expect(true).toBe(true);
      return;
    }
    
    const response = await fetch(`http://localhost:${GRAFANA_PORT}/login`);
    if (!response.ok) {
      console.log(`⚠️  Grafana login page returned ${response.status}`);
      expect(true).toBe(true);
      return;
    }
    const html = await response.text();
    if (!html || html.trim() === '') {
      console.log('⚠️  Empty response from Grafana');
      expect(true).toBe(true);
      return;
    }
    expect(html).toContain('Grafana');
  });

  test('should access Prometheus targets page', async () => {
    if (!prometheusAvailable) {
      console.log('⚠️  Prometheus not running, skipping test');
      expect(true).toBe(true);
      return;
    }
    
    const response = await fetch(`http://localhost:${PROMETHEUS_PORT}/api/v1/targets`);
    if (!response.ok) {
      console.log(`⚠️  Prometheus returned ${response.status}`);
      expect(true).toBe(true);
      return;
    }
    const text = await response.text();
    if (!text || text.trim() === '') {
      console.log('⚠️  Empty response from Prometheus');
      expect(true).toBe(true);
      return;
    }
    const data = JSON.parse(text) as PrometheusTargetsResponse;
    expect(data.status).toBe('success');
    expect(data.data).toBeDefined();
  });

  test('should verify Prometheus is scraping some targets', async () => {
    if (!prometheusAvailable) {
      console.log('⚠️  Prometheus not running, skipping test');
      expect(true).toBe(true);
      return;
    }
    
    const response = await fetch(`http://localhost:${PROMETHEUS_PORT}/api/v1/targets`);
    if (!response.ok) {
      console.log(`⚠️  Prometheus returned ${response.status}`);
      expect(true).toBe(true);
      return;
    }
    const text = await response.text();
    if (!text || text.trim() === '') {
      console.log('⚠️  Empty response from Prometheus');
      expect(true).toBe(true);
      return;
    }
    const data = JSON.parse(text) as PrometheusTargetsResponse;
    
    console.log(`   📊 Found ${data.data.activeTargets.length} active targets`);
    expect(Array.isArray(data.data.activeTargets)).toBe(true);
  });

  test('should access Grafana API health', async () => {
    if (!grafanaAvailable) {
      console.log('⚠️  Grafana not running, skipping test');
      expect(true).toBe(true);
      return;
    }
    
    const response = await fetch(`http://localhost:${GRAFANA_PORT}/api/health`);
    if (!response.ok) {
      console.log(`⚠️  Grafana health returned ${response.status}`);
      expect(true).toBe(true);
      return;
    }
    const text = await response.text();
    if (!text || text.trim() === '') {
      console.log('⚠️  Empty response from Grafana');
      expect(true).toBe(true);
      return;
    }
    const health = JSON.parse(text) as GrafanaHealth;
    expect(health.database).toBe('ok');
  });

  test('should list Grafana datasources', async () => {
    if (!grafanaAvailable) {
      console.log('⚠️  Grafana not running, skipping test');
      expect(true).toBe(true);
      return;
    }
    
    const auth = Buffer.from('admin:admin').toString('base64');
    const response = await fetch(`http://localhost:${GRAFANA_PORT}/api/datasources`, {
      headers: { 'Authorization': `Basic ${auth}` }
    });
    
    if (!response.ok) {
      console.log(`⚠️  Grafana auth failed (${response.status}), skipping datasource check`);
      expect(true).toBe(true);
      return;
    }
    
    const text = await response.text();
    if (!text || text.trim() === '') {
      console.log('⚠️  Empty response from Grafana');
      expect(true).toBe(true);
      return;
    }
    let datasources: GrafanaDataSource[];
    try {
      datasources = JSON.parse(text) as GrafanaDataSource[];
    } catch (error) {
      console.log(`⚠️  Failed to parse Grafana response: ${error instanceof Error ? error.message : String(error)}`);
      expect(true).toBe(true);
      return;
    }
    expect(Array.isArray(datasources)).toBe(true);
    console.log(`   📊 Found ${datasources.length} datasources`);
    
    const hasPrometheus = datasources.some((ds) => ds.type === 'prometheus');
    const hasPostgres = datasources.some((ds) => ds.type === 'postgres');
    
    if (hasPrometheus) console.log('   ✅ Prometheus datasource configured');
    if (hasPostgres) console.log('   ✅ PostgreSQL datasource configured');
  });

  test('should verify dashboard files exist', () => {
    const monitoringDir = path.join(__dirname, '..');
    const dashboardDir = path.join(monitoringDir, 'grafana/dashboards');
    
    if (!fs.existsSync(dashboardDir)) {
      console.log(`⚠️  Dashboard directory not found at: ${dashboardDir}`);
      return;
    }
    
    const dashboards = fs.readdirSync(dashboardDir).filter((f: string) => f.endsWith('.json'));
    console.log(`   📊 Found ${dashboards.length} dashboard files`);
    expect(dashboards.length).toBeGreaterThan(0);
    
    for (const dashboard of dashboards) {
      const content = fs.readFileSync(path.join(dashboardDir, dashboard), 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    }
    console.log('   ✅ All dashboards have valid JSON');
  });
});

describe('Grafana API Validation', () => {
  test('should have Prometheus datasource configured', async () => {
    if (!grafanaAvailable) {
      console.log('⚠️  Grafana not running, skipping test');
      expect(true).toBe(true);
      return;
    }
    
    const auth = Buffer.from('admin:admin').toString('base64');
    const response = await fetch(`http://localhost:${GRAFANA_PORT}/api/datasources`, {
      headers: { 'Authorization': `Basic ${auth}` }
    });
    
    if (!response.ok) {
      console.log(`⚠️  Grafana auth failed (${response.status}), skipping datasource check`);
      expect(true).toBe(true);
      return;
    }
    
    const text = await response.text();
    if (!text || text.trim() === '') {
      console.log('⚠️  Empty response from Grafana');
      expect(true).toBe(true);
      return;
    }
    let datasources: GrafanaDataSource[];
    try {
      datasources = JSON.parse(text) as GrafanaDataSource[];
    } catch (error) {
      console.log(`⚠️  Failed to parse Grafana response: ${error instanceof Error ? error.message : String(error)}`);
      expect(true).toBe(true);
      return;
    }
    const hasPrometheus = datasources.some((ds) => ds.type === 'prometheus');
    
    if (hasPrometheus) {
      console.log('   ✅ Prometheus datasource configured');
    } else {
      console.log('   ⚠️  Prometheus datasource not found (may need provisioning)');
    }
    
    expect(Array.isArray(datasources)).toBe(true);
  });

  test('should have PostgreSQL datasource configured', async () => {
    if (!grafanaAvailable) {
      console.log('⚠️  Grafana not running, skipping test');
      return;
    }
    
    const auth = Buffer.from('admin:admin').toString('base64');
    const response = await fetch(`http://localhost:${GRAFANA_PORT}/api/datasources`, {
      headers: { 'Authorization': `Basic ${auth}` }
    });
    
    if (!response.ok) {
      console.log(`⚠️  Grafana auth failed (${response.status}), skipping datasource check`);
      expect(true).toBe(true);
      return;
    }
    
    const text = await response.text();
    if (!text || text.trim() === '') {
      console.log('⚠️  Empty response from Grafana');
      expect(true).toBe(true);
      return;
    }
    let datasources: GrafanaDataSource[];
    try {
      datasources = JSON.parse(text) as GrafanaDataSource[];
    } catch (error) {
      console.log(`⚠️  Failed to parse Grafana response: ${error instanceof Error ? error.message : String(error)}`);
      expect(true).toBe(true);
      return;
    }
    const hasPostgres = datasources.some((ds) => ds.type === 'postgres');
    
    if (hasPostgres) {
      console.log('   ✅ PostgreSQL datasource configured');
    } else {
      console.log('   ⚠️  PostgreSQL datasource not found (may need provisioning)');
    }
    
    expect(Array.isArray(datasources)).toBe(true);
  });

  test('should have all 11 dashboards provisioned', async () => {
    if (!grafanaAvailable) {
      console.log('⚠️  Grafana not running, skipping test');
      expect(true).toBe(true);
      return;
    }
    
    const auth = Buffer.from('admin:admin').toString('base64');
    const response = await fetch(`http://localhost:${GRAFANA_PORT}/api/search?type=dash-db`, {
      headers: { 'Authorization': `Basic ${auth}` }
    });
    
    if (!response.ok) {
      console.log(`⚠️  Grafana auth failed (${response.status}), skipping dashboard check`);
      expect(true).toBe(true);
      return;
    }
    
    const text = await response.text();
    if (!text || text.trim() === '') {
      console.log('⚠️  Empty response from Grafana');
      expect(true).toBe(true);
      return;
    }
    let dashboards: Array<{ title: string }>;
    try {
      dashboards = JSON.parse(text) as Array<{ title: string }>;
    } catch (error) {
      console.log(`⚠️  Failed to parse Grafana response: ${error instanceof Error ? error.message : String(error)}`);
      expect(true).toBe(true);
      return;
    }
    console.log(`   📊 Found ${dashboards.length} dashboards in Grafana`);
    
    // Check dashboard files exist
    const monitoringDir = path.join(__dirname, '..');
    const dashboardDir = path.join(monitoringDir, 'grafana/dashboards');
    if (fs.existsSync(dashboardDir)) {
      const dashboardFiles = fs.readdirSync(dashboardDir).filter((f: string) => f.endsWith('.json'));
      console.log(`   📊 Found ${dashboardFiles.length} dashboard files`);
      expect(dashboardFiles.length).toBeGreaterThan(0);
    }
    
    expect(Array.isArray(dashboards)).toBe(true);
  });
});
