/**
 * Local Development Proxy
 * 
 * Manages a Caddy reverse proxy for local development
 * Routes *.local.jejunetwork.org to localhost ports
 * 
 * Works automatically once DNS is configured:
 * - gateway.local.jejunetwork.org -> localhost:4001
 * - bazaar.local.jejunetwork.org -> localhost:4006
 * - docs.local.jejunetwork.org -> localhost:4004
 * - rpc.local.jejunetwork.org -> localhost:9545
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';

const DOMAIN = 'local.jejunetwork.org';
const CADDY_DIR = '.jeju/caddy';
const CADDYFILE_PATH = `${CADDY_DIR}/Caddyfile`;
const PID_FILE = `${CADDY_DIR}/caddy.pid`;

// Service port mappings
const SERVICES: Record<string, number> = {
  gateway: 4001,
  bazaar: 4006,
  docs: 4004,
  indexer: 4350,
  rpc: 9545,
  ws: 9546,
  crucible: 4003,
  compute: 4007,
  storage: 4010,
  monitoring: 4002,
  autocrat: 4008,
};

interface ProxyConfig {
  services?: Partial<typeof SERVICES>;
  domain?: string;
}

export async function isCaddyInstalled(): Promise<boolean> {
  const result = await $`which caddy`.nothrow().quiet();
  return result.exitCode === 0;
}

export async function installCaddy(): Promise<boolean> {
  const platform = process.platform;
  
  console.log('📦 Installing Caddy...');
  
  if (platform === 'darwin') {
    // macOS
    const result = await $`brew install caddy`.nothrow();
    return result.exitCode === 0;
  } else if (platform === 'linux') {
    // Linux - try apt first, then other package managers
    let result = await $`which apt-get`.nothrow().quiet();
    if (result.exitCode === 0) {
      await $`sudo apt-get update`.nothrow().quiet();
      result = await $`sudo apt-get install -y caddy`.nothrow();
      return result.exitCode === 0;
    }
    
    // Try yum/dnf
    result = await $`which dnf`.nothrow().quiet();
    if (result.exitCode === 0) {
      result = await $`sudo dnf install -y caddy`.nothrow();
      return result.exitCode === 0;
    }
    
    // Fallback: download binary
    console.log('   Downloading Caddy binary...');
    const arch = process.arch === 'x64' ? 'amd64' : 'arm64';
    const url = `https://caddyserver.com/api/download?os=linux&arch=${arch}`;
    result = await $`curl -fsSL ${url} -o /tmp/caddy && chmod +x /tmp/caddy && sudo mv /tmp/caddy /usr/local/bin/caddy`.nothrow();
    return result.exitCode === 0;
  } else if (platform === 'win32') {
    // Windows - use scoop or chocolatey
    let result = await $`where scoop`.nothrow().quiet();
    if (result.exitCode === 0) {
      result = await $`scoop install caddy`.nothrow();
      return result.exitCode === 0;
    }
    
    result = await $`where choco`.nothrow().quiet();
    if (result.exitCode === 0) {
      result = await $`choco install caddy -y`.nothrow();
      return result.exitCode === 0;
    }
    
    console.error('   Please install Caddy manually: https://caddyserver.com/docs/install#windows');
    return false;
  }
  
  return false;
}

export function generateCaddyfile(config: ProxyConfig = {}): string {
  const domain = config.domain || DOMAIN;
  const services = { ...SERVICES, ...config.services };
  
  const entries: string[] = [
    '# Auto-generated Caddyfile for local development',
    '# Do not edit - regenerated on each `bun run dev`',
    '',
    '# Global options',
    '{',
    '    # Disable HTTPS for local development',
    '    auto_https off',
    '    # Bind to localhost only',
    '    default_bind 127.0.0.1',
    '}',
    '',
  ];
  
  // Root landing page
  entries.push(`# Landing page at local.${domain.replace('local.', '')}`);
  entries.push(`:80 {`);
  entries.push(`    respond "Jeju Local Development\\n\\nAvailable services:\\n${Object.keys(services).map(s => `- http://${s}.${domain}`).join('\\n')}" 200`);
  entries.push(`}`);
  entries.push('');
  
  // Service routes
  for (const [service, port] of Object.entries(services)) {
    entries.push(`# ${service}`);
    entries.push(`${service}.${domain}:80 {`);
    entries.push(`    reverse_proxy localhost:${port}`);
    entries.push(`}`);
    entries.push('');
  }
  
  return entries.join('\n');
}

export async function startProxy(config: ProxyConfig = {}): Promise<boolean> {
  // Check if Caddy is installed
  if (!(await isCaddyInstalled())) {
    console.log('⚠️  Caddy not installed');
    const installed = await installCaddy();
    if (!installed) {
      console.error('❌ Failed to install Caddy');
      console.error('   Local proxy disabled - apps available at localhost ports');
      return false;
    }
    console.log('✅ Caddy installed');
  }
  
  // Create config directory
  if (!existsSync(CADDY_DIR)) {
    mkdirSync(CADDY_DIR, { recursive: true });
  }
  
  // Generate Caddyfile
  const caddyfile = generateCaddyfile(config);
  writeFileSync(CADDYFILE_PATH, caddyfile);
  
  // Stop any existing Caddy process
  await stopProxy();
  
  // Start Caddy
  console.log('🔄 Starting local proxy...');
  
  const proc = Bun.spawn(['caddy', 'run', '--config', CADDYFILE_PATH], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  
  // Save PID
  writeFileSync(PID_FILE, String(proc.pid));
  
  // Wait for startup
  await Bun.sleep(500);
  
  // Check if running
  if (proc.exitCode !== null) {
    const stderr = await new Response(proc.stderr).text();
    console.error('❌ Proxy failed to start:', stderr);
    return false;
  }
  
  console.log('✅ Local proxy running');
  return true;
}

export async function stopProxy(): Promise<void> {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(await Bun.file(PID_FILE).text(), 10);
    if (pid) {
      await $`kill ${pid}`.nothrow().quiet();
    }
    unlinkSync(PID_FILE);
  }
  
  // Also try to stop any caddy processes using our config
  await $`pkill -f "caddy run --config ${CADDYFILE_PATH}"`.nothrow().quiet();
}

export function getLocalUrls(config: ProxyConfig = {}): Record<string, string> {
  const domain = config.domain || DOMAIN;
  const services = { ...SERVICES, ...config.services };
  
  const urls: Record<string, string> = {};
  for (const service of Object.keys(services)) {
    urls[service] = `http://${service}.${domain}`;
  }
  return urls;
}

// CLI entry point
if (import.meta.main) {
  const command = process.argv[2];
  
  switch (command) {
    case 'start':
      await startProxy();
      break;
    case 'stop':
      await stopProxy();
      console.log('✅ Proxy stopped');
      break;
    case 'urls':
      console.log('Local development URLs:');
      for (const [name, url] of Object.entries(getLocalUrls())) {
        console.log(`  ${name.padEnd(12)} ${url}`);
      }
      break;
    case 'caddyfile':
      console.log(generateCaddyfile());
      break;
    default:
      console.log('Usage: bun run scripts/shared/local-proxy.ts <start|stop|urls|caddyfile>');
  }
}

