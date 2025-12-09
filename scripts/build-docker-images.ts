#!/usr/bin/env bun
/**
 * Build and Push Docker Images to ECR
 * 
 * This script builds Docker images for all apps and pushes them to ECR.
 * It handles the monorepo workspace dependencies by building from root.
 */

import { $ } from 'bun';
import { join, resolve } from 'path';
import { existsSync, readdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '..');
const APPS_DIR = join(ROOT, 'apps');
const ECR_REGISTRY = '502713364895.dkr.ecr.us-east-1.amazonaws.com';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

interface AppConfig {
  name: string;
  path: string;
  hasDockerfile: boolean;
  ecrRepo: string;
}

async function getApps(): Promise<AppConfig[]> {
  const apps: AppConfig[] = [];
  const entries = readdirSync(APPS_DIR, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const appPath = join(APPS_DIR, entry.name);
      const dockerfilePath = join(appPath, 'Dockerfile');
      
      apps.push({
        name: entry.name,
        path: appPath,
        hasDockerfile: existsSync(dockerfilePath),
        ecrRepo: `jeju/${entry.name}`,
      });
    }
  }
  
  return apps;
}

async function loginToECR() {
  console.log('Logging into ECR...');
  const password = await $`aws ecr get-login-password --region ${AWS_REGION}`.text();
  await $`echo ${password.trim()} | docker login --username AWS --password-stdin ${ECR_REGISTRY}`.quiet();
  console.log('ECR login successful.');
}

async function buildImage(app: AppConfig, tag: string): Promise<boolean> {
  const imageTag = `${ECR_REGISTRY}/${app.ecrRepo}:${tag}`;
  const latestTag = `${ECR_REGISTRY}/${app.ecrRepo}:latest`;
  
  console.log(`\nBuilding ${app.name}...`);
  console.log(`  Image: ${imageTag}`);
  
  // Build from app directory
  const result = await $`docker build -t ${imageTag} -t ${latestTag} ${app.path}`.nothrow();
  
  if (result.exitCode !== 0) {
    console.error(`  ❌ Build failed for ${app.name}`);
    return false;
  }
  
  console.log(`  ✅ Build successful`);
  return true;
}

async function pushImage(app: AppConfig, tag: string): Promise<boolean> {
  const imageTag = `${ECR_REGISTRY}/${app.ecrRepo}:${tag}`;
  const latestTag = `${ECR_REGISTRY}/${app.ecrRepo}:latest`;
  
  console.log(`Pushing ${app.name}...`);
  
  const result1 = await $`docker push ${imageTag}`.nothrow();
  const result2 = await $`docker push ${latestTag}`.nothrow();
  
  if (result1.exitCode !== 0 || result2.exitCode !== 0) {
    console.error(`  ❌ Push failed for ${app.name}`);
    return false;
  }
  
  console.log(`  ✅ Push successful`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const doPush = args.includes('--push');
  const specificApp = args.find(a => !a.startsWith('--'));
  const tag = process.env.IMAGE_TAG || 'latest';
  
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  Docker Image Builder                                                ║
║  Registry: ${ECR_REGISTRY.padEnd(55)}║
║  Tag: ${tag.padEnd(60)}║
║  Push: ${String(doPush).padEnd(59)}║
╚══════════════════════════════════════════════════════════════════════╝
`);

  // Login to ECR
  await loginToECR();
  
  // Get apps to build
  const allApps = await getApps();
  const apps = specificApp 
    ? allApps.filter(a => a.name === specificApp)
    : allApps.filter(a => a.hasDockerfile);
  
  if (apps.length === 0) {
    console.log('No apps with Dockerfiles found.');
    return;
  }
  
  console.log(`\nApps to build: ${apps.map(a => a.name).join(', ')}`);
  
  const results: { app: string; built: boolean; pushed: boolean }[] = [];
  
  for (const app of apps) {
    if (!app.hasDockerfile) {
      console.log(`\nSkipping ${app.name} (no Dockerfile)`);
      continue;
    }
    
    const built = await buildImage(app, tag);
    let pushed = false;
    
    if (built && doPush) {
      pushed = await pushImage(app, tag);
    }
    
    results.push({ app: app.name, built, pushed });
  }
  
  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('Build Summary');
  console.log('═'.repeat(70));
  
  for (const r of results) {
    const buildStatus = r.built ? '✅' : '❌';
    const pushStatus = doPush ? (r.pushed ? '✅' : '❌') : '⏭️';
    console.log(`  ${r.app.padEnd(20)} Build: ${buildStatus}  Push: ${pushStatus}`);
  }
  
  const allBuilt = results.every(r => r.built);
  const allPushed = !doPush || results.every(r => r.pushed);
  
  if (!allBuilt) {
    console.log('\n⚠️  Some builds failed. Fix Dockerfiles and retry.');
    process.exit(1);
  }
  
  if (doPush && !allPushed) {
    console.log('\n⚠️  Some pushes failed. Check ECR permissions.');
    process.exit(1);
  }
  
  console.log('\n✅ All operations completed successfully.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});


