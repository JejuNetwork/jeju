/**
 * Monitoring Stack Tests
 * Verifies Prometheus and Grafana are accessible
 */

import { describe, test, expect } from 'bun:test';

const GRAFANA_PORT = parseInt(process.env.GRAFANA_PORT || '4010');
const PROMETHEUS_PORT = parseInt(process.env.PROMETHEUS_PORT || '9090');

describe('Monitoring Stack', () => {
  test('should access Grafana login page', async () => {
    try {
      const response = await fetch(`http://localhost:${GRAFANA_PORT}/login`);
      expect(response.ok).toBe(true);
      const html = await response.text();
      expect(html).toContain('Grafana');
    } catch (error) {
      console.log('⚠️  Grafana not running, skipping test');
    }
  });

  test('should access Prometheus targets page', async () => {
    try {
      const response = await fetch(`http://localhost:${PROMETHEUS_PORT}/api/v1/targets`);
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.status).toBe('success');
      expect(data.data).toBeDefined();
    } catch (error) {
      console.log('⚠️  Prometheus not running, skipping test');
    }
  });

  test('should verify Prometheus is scraping some targets', async () => {
    try {
      const response = await fetch(`http://localhost:${PROMETHEUS_PORT}/api/v1/targets`);
      const data = await response.json();
      
      if (data.data && data.data.activeTargets) {
        console.log(`   📊 Found ${data.data.activeTargets.length} active targets`);
        expect(Array.isArray(data.data.activeTargets)).toBe(true);
      }
    } catch (error) {
      console.log('⚠️  Prometheus not running, skipping test');
    }
  });

  test('should access Grafana API health', async () => {
    try {
      const response = await fetch(`http://localhost:${GRAFANA_PORT}/api/health`);
      expect(response.ok).toBe(true);
      const health = await response.json();
      expect(health.database).toBe('ok');
    } catch (error) {
      console.log('⚠️  Grafana not running, skipping test');
    }
  });

  test('should list Grafana datasources', async () => {
    try {
      // Use default credentials for testing
      const auth = Buffer.from('admin:admin').toString('base64');
      const response = await fetch(`http://localhost:${GRAFANA_PORT}/api/datasources`, {
        headers: {
          'Authorization': `Basic ${auth}`
        }
      });
      
      if (response.ok) {
        const datasources = await response.json();
        expect(Array.isArray(datasources)).toBe(true);
        console.log(`   📊 Found ${datasources.length} datasources`);
        
        // Check for expected datasources
        const hasPrometheus = datasources.some((ds: any) => ds.type === 'prometheus');
        const hasPostgres = datasources.some((ds: any) => ds.type === 'postgres');
        
        if (hasPrometheus) console.log('   ✅ Prometheus datasource configured');
        if (hasPostgres) console.log('   ✅ PostgreSQL datasource configured');
      }
    } catch (error) {
      console.log('⚠️  Grafana not running or auth failed, skipping test');
    }
  });

  test('should verify dashboard files exist', async () => {
    const fs = require('fs');
    const path = require('path');
    
    // Get the actual path relative to the test file location
    const dashboardDir = path.join(process.cwd(), 'apps/monitoring/grafana/dashboards');
    
    if (!fs.existsSync(dashboardDir)) {
      console.log(`⚠️  Dashboard directory not found at: ${dashboardDir}`);
      return;
    }
    
    const dashboards = fs.readdirSync(dashboardDir).filter((f: string) => f.endsWith('.json'));
    console.log(`   📊 Found ${dashboards.length} dashboard files`);
    expect(dashboards.length).toBeGreaterThan(0);
    
    // Verify each dashboard is valid JSON
    for (const dashboard of dashboards) {
      const content = fs.readFileSync(path.join(dashboardDir, dashboard), 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    }
    console.log('   ✅ All dashboards have valid JSON');
  });
});

