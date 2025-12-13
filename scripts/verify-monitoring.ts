#!/usr/bin/env bun

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const MONITORING_DIR = join(process.cwd(), 'apps/monitoring');
const PROMETHEUS_CONFIG = join(MONITORING_DIR, 'prometheus/prometheus.yml');
const ALERT_RULES_DIR = join(MONITORING_DIR, 'prometheus/alerts');
const DOCKER_COMPOSE = join(MONITORING_DIR, 'docker-compose.yml');

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
}

const checks: CheckResult[] = [];

async function checkFileExists(path: string, name: string): Promise<boolean> {
  const exists = existsSync(path);
  checks.push({
    name: `${name} exists`,
    status: exists ? 'pass' : 'fail',
    message: exists ? `Found: ${path}` : `Missing: ${path}`,
  });
  return exists;
}

async function checkPrometheusConfig(): Promise<void> {
  if (!(await checkFileExists(PROMETHEUS_CONFIG, 'Prometheus config'))) return;
  
  try {
    const content = await readFile(PROMETHEUS_CONFIG, 'utf-8');
    const hasScrapeConfigs = content.includes('scrape_configs:');
    const hasAlertRules = content.includes('rule_files:');
    const hasOpNode = content.includes('op-node');
    const hasReth = content.includes('reth');
    
    checks.push({
      name: 'Prometheus scrape configs',
      status: hasScrapeConfigs ? 'pass' : 'fail',
      message: hasScrapeConfigs ? 'Scrape configs found' : 'No scrape_configs section',
    });
    
    checks.push({
      name: 'Prometheus alert rules',
      status: hasAlertRules ? 'pass' : 'warning',
      message: hasAlertRules ? 'Alert rules configured' : 'No rule_files section',
    });
    
    checks.push({
      name: 'OP Node monitoring',
      status: hasOpNode ? 'pass' : 'warning',
      message: hasOpNode ? 'OP Node job configured' : 'OP Node job not found',
    });
    
    checks.push({
      name: 'Reth monitoring',
      status: hasReth ? 'pass' : 'warning',
      message: hasReth ? 'Reth job configured' : 'Reth job not found',
    });
  } catch (error) {
    checks.push({
      name: 'Read Prometheus config',
      status: 'fail',
      message: `Error reading config: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function checkAlertRules(): Promise<void> {
  if (!existsSync(ALERT_RULES_DIR)) {
    checks.push({
      name: 'Alert rules directory',
      status: 'warning',
      message: `Directory not found: ${ALERT_RULES_DIR}`,
    });
    return;
  }
  
  const alertFiles = [
    'chain.yaml',
    'rpc.yaml',
    'da.yaml',
    'defi.yaml',
  ];
  
  for (const file of alertFiles) {
    const path = join(ALERT_RULES_DIR, file);
    const exists = existsSync(path);
    checks.push({
      name: `Alert rule: ${file}`,
      status: exists ? 'pass' : 'warning',
      message: exists ? `Found: ${file}` : `Missing: ${file}`,
    });
  }
}

async function checkDockerCompose(): Promise<void> {
  if (!(await checkFileExists(DOCKER_COMPOSE, 'Docker Compose'))) return;
  
  try {
    const content = await readFile(DOCKER_COMPOSE, 'utf-8');
    const hasPrometheus = content.includes('prometheus');
    const hasGrafana = content.includes('grafana');
    const hasAlertmanager = content.includes('alertmanager');
    
    checks.push({
      name: 'Prometheus service',
      status: hasPrometheus ? 'pass' : 'fail',
      message: hasPrometheus ? 'Prometheus service configured' : 'Prometheus service missing',
    });
    
    checks.push({
      name: 'Grafana service',
      status: hasGrafana ? 'pass' : 'warning',
      message: hasGrafana ? 'Grafana service configured' : 'Grafana service missing',
    });
    
    checks.push({
      name: 'Alertmanager service',
      status: hasAlertmanager ? 'pass' : 'warning',
      message: hasAlertmanager ? 'Alertmanager service configured' : 'Alertmanager service missing',
    });
  } catch (error) {
    checks.push({
      name: 'Read Docker Compose',
      status: 'fail',
      message: `Error reading docker-compose.yml: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function checkKubernetesMonitoring(): Promise<void> {
  const helmDir = join(process.cwd(), 'packages/deployment/kubernetes/helm');
  const alertmanagerChart = join(helmDir, 'alertmanager');
  const prometheusRuleExists = existsSync(join(helmDir, 'x402-facilitator/templates/prometheusrule.yaml'));
  
  checks.push({
    name: 'Alertmanager Helm chart',
    status: existsSync(alertmanagerChart) ? 'pass' : 'warning',
    message: existsSync(alertmanagerChart) ? 'Alertmanager chart found' : 'Alertmanager chart missing',
  });
  
  checks.push({
    name: 'PrometheusRule templates',
    status: prometheusRuleExists ? 'pass' : 'warning',
    message: prometheusRuleExists ? 'PrometheusRule templates found' : 'No PrometheusRule templates',
  });
}

async function checkServiceMetrics(): Promise<void> {
  const gatewayHealth = process.env.GATEWAY_URL || 'http://localhost:3001';
  
  try {
    const response = await fetch(`${gatewayHealth}/health`);
    if (response.ok) {
      const data = await response.json();
      const hasPoolService = data.poolService !== undefined;
      
      checks.push({
        name: 'Gateway health endpoint',
        status: 'pass',
        message: 'Gateway health endpoint accessible',
      });
      
      checks.push({
        name: 'Pool service health status',
        status: hasPoolService ? 'pass' : 'warning',
        message: hasPoolService ? 'Pool service health exposed' : 'Pool service health not in response',
      });
    } else {
      checks.push({
        name: 'Gateway health endpoint',
        status: 'warning',
        message: `Gateway health endpoint returned ${response.status}`,
      });
    }
  } catch (error) {
    checks.push({
      name: 'Gateway health endpoint',
      status: 'warning',
      message: `Cannot reach gateway: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function main() {
  console.log('🔍 Verifying Monitoring Setup...\n');
  
  await checkPrometheusConfig();
  await checkAlertRules();
  await checkDockerCompose();
  await checkKubernetesMonitoring();
  await checkServiceMetrics();
  
  const passed = checks.filter(c => c.status === 'pass').length;
  const failed = checks.filter(c => c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warning').length;
  
  console.log('\n=== Monitoring Verification Results ===\n');
  
  for (const check of checks) {
    const icon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : '⚠️';
    console.log(`${icon} ${check.name}: ${check.message}`);
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⚠️  Warnings: ${warnings}`);
  console.log(`Total: ${checks.length}`);
  
  if (failed > 0) {
    console.log('\n❌ Monitoring setup has failures. Please fix before production deployment.');
    process.exit(1);
  } else if (warnings > 0) {
    console.log('\n⚠️  Monitoring setup has warnings. Review before production deployment.');
    process.exit(0);
  } else {
    console.log('\n✅ Monitoring setup verified successfully!');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('❌ Verification failed:', error);
  process.exit(1);
});
