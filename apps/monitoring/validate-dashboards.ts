#!/usr/bin/env bun
/**
 * Validate all Grafana dashboards
 * Tests dashboard queries against the database and Grafana API
 */

import { Pool, PoolClient, QueryResult } from 'pg';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import {
  GrafanaDashboardSchema,
  PrometheusQueryResponseSchema,
  type GrafanaDashboard,
  type ValidationResult,
} from './types';

const pool = new Pool({
  host: 'localhost',
  port: 23798,
  user: 'postgres',
  password: 'postgres',
  database: 'indexer',
});

const GRAFANA_URL = 'http://localhost:4010';
const GRAFANA_AUTH = 'Basic ' + Buffer.from('admin:admin').toString('base64');

async function testDatabaseQuery(query: string): Promise<{ success: boolean; error?: string; rowCount?: number }> {
  const client: PoolClient = await pool.connect();
  const result: QueryResult = await client.query(query);
  client.release();
  return { success: true, rowCount: result.rowCount ?? 0 };
}

async function testGrafanaDashboard(dashboardUid: string): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${GRAFANA_URL}/api/dashboards/uid/${dashboardUid}`, {
    headers: { Authorization: GRAFANA_AUTH },
  });
  
  if (!response.ok) {
    return { success: false, error: `HTTP ${response.status}` };
  }
  
  return { success: true };
}

async function validateDashboards(): Promise<void> {
  console.log('🔍 Validating Grafana dashboards...\n');

  const dashboardsDir = join(import.meta.dir, 'grafana/dashboards');
  const files = await readdir(dashboardsDir);
  const dashboardFiles = files.filter(f => f.endsWith('.json'));

  const results: ValidationResult[] = [];

  for (const file of dashboardFiles) {
    console.log(`\n📊 Testing ${file}...`);
    const content = await readFile(join(dashboardsDir, file), 'utf-8');
    const dashboard = GrafanaDashboardSchema.parse(JSON.parse(content));

    const result: ValidationResult = {
      dashboard: dashboard.title || file,
      passed: 0,
      failed: 0,
      errors: [],
      queries: [],
    };

    // Test Grafana can load the dashboard
    if (dashboard.uid) {
      const grafanaTest = await testGrafanaDashboard(dashboard.uid);
      if (grafanaTest.success) {
        console.log(`  ✅ Dashboard loaded in Grafana`);
        result.passed++;
      } else {
        console.log(`  ❌ Dashboard failed to load: ${grafanaTest.error}`);
        result.failed++;
        result.errors.push(`Dashboard load failed: ${grafanaTest.error}`);
      }
    }

    // Extract and test SQL queries from panels
    const panels = dashboard.panels || [];
    let queryCount = 0;

    for (const panel of panels) {
      if (!panel.targets) continue;

      for (const target of panel.targets) {
        if (target.rawSql) {
          queryCount++;
          const query = target.rawSql
            .replace(/\$__timeFilter\((\w+)\)/g, '$1 > NOW() - INTERVAL \'24 hours\'')
            .replace(/\$__time\((\w+)\)/g, '$1')
            .replace(/\$__unixEpochGroup\(([^)]+)\)/g, 'DATE_TRUNC(\'hour\', $1)')
            .trim();

          if (query) {
            const queryResult = await testDatabaseQuery(query).catch((err: Error) => ({
              success: false,
              error: err.message,
            }));
            
            if (queryResult.success) {
              console.log(`  ✅ Panel "${panel.title || panel.id}": ${queryResult.rowCount} rows`);
              result.passed++;
              result.queries.push({
                query: panel.title || `Panel ${panel.id}`,
                result: `${queryResult.rowCount} rows`,
              });
            } else {
              console.log(`  ❌ Panel "${panel.title || panel.id}": ${queryResult.error}`);
              result.failed++;
              result.errors.push(`Panel "${panel.title}": ${queryResult.error}`);
            }
          }
        }
      }
    }

    if (queryCount === 0) {
      console.log(`  ℹ️  No SQL queries found in this dashboard`);
    }

    results.push(result);
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('📋 VALIDATION SUMMARY');
  console.log('='.repeat(80) + '\n');

  let totalPassed = 0;
  let totalFailed = 0;

  for (const result of results) {
    const status = result.failed === 0 ? '✅' : '⚠️ ';
    console.log(`${status} ${result.dashboard}`);
    console.log(`   Passed: ${result.passed}, Failed: ${result.failed}`);
    
    if (result.errors.length > 0) {
      console.log(`   Errors:`);
      result.errors.forEach(err => console.log(`     - ${err}`));
    }
    console.log('');

    totalPassed += result.passed;
    totalFailed += result.failed;
  }

  console.log('='.repeat(80));
  console.log(`TOTAL: ${totalPassed} passed, ${totalFailed} failed`);
  console.log('='.repeat(80) + '\n');

  // Test Prometheus connectivity
  console.log('🔥 Testing Prometheus...');
  const response = await fetch(`${GRAFANA_URL.replace('4010', '9090')}/api/v1/query?query=up`).catch(() => null);
  if (response?.ok) {
    const rawData = await response.json();
    const parsed = PrometheusQueryResponseSchema.safeParse(rawData);
    if (parsed.success) {
      const upCount = parsed.data.data?.result?.filter((r) => r.value[1] === '1').length || 0;
      console.log(`✅ Prometheus responding: ${upCount} services up`);
    } else {
      console.log(`⚠️ Prometheus response invalid: ${parsed.error.message}`);
    }
  } else {
    console.log(`❌ Prometheus unreachable`);
  }

  console.log('\n✅ Validation complete!\n');

  await pool.end();
}

// Run if called directly
if (import.meta.main) {
  validateDashboards().catch((error: Error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { validateDashboards };
