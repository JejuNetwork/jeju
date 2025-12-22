/**
 * System utilities for checking dependencies
 */

import { execa } from 'execa';
import which from 'which';
import { existsSync } from 'fs';
import { platform, arch, homedir } from 'os';
import { join } from 'path';
import type { HealthCheckResult } from '../types';

export async function checkCommand(cmd: string): Promise<boolean> {
  try {
    await which(cmd);
    return true;
  } catch {
    return false;
  }
}

export async function getCommandVersion(cmd: string, versionFlag = '--version'): Promise<string | null> {
  try {
    const result = await execa(cmd, [versionFlag]);
    const output = result.stdout || result.stderr;
    // Extract version number from output
    const match = output.match(/\d+\.\d+(\.\d+)?/);
    return match ? match[0] : output.split('\n')[0].trim();
  } catch {
    return null;
  }
}

export async function checkDocker(): Promise<HealthCheckResult> {
  const hasDocker = await checkCommand('docker');
  if (!hasDocker) {
    return {
      name: 'Docker',
      status: 'error',
      message: 'Docker not installed',
      details: { install: 'https://docs.docker.com/get-docker/' },
    };
  }

  try {
    await execa('docker', ['info'], { timeout: 10000 });
    const version = await getCommandVersion('docker');
    return {
      name: 'Docker',
      status: 'ok',
      message: version || 'running',
    };
  } catch {
    return {
      name: 'Docker',
      status: 'error',
      message: 'Docker not running - start Docker Desktop',
    };
  }
}

export async function checkKurtosis(): Promise<HealthCheckResult> {
  const hasKurtosis = await checkCommand('kurtosis');
  if (!hasKurtosis) {
    return {
      name: 'Kurtosis',
      status: 'warn',
      message: 'Not installed (will install automatically)',
    };
  }

  const version = await getCommandVersion('kurtosis', 'version');
  return {
    name: 'Kurtosis',
    status: 'ok',
    message: version || 'installed',
  };
}

export async function checkFoundry(): Promise<HealthCheckResult> {
  const hasForge = await checkCommand('forge');
  if (!hasForge) {
    return {
      name: 'Foundry',
      status: 'warn',
      message: 'Not installed (needed for contract tests)',
      details: { install: 'curl -L https://foundry.paradigm.xyz | bash' },
    };
  }

  const version = await getCommandVersion('forge');
  return {
    name: 'Foundry',
    status: 'ok',
    message: version || 'installed',
  };
}

export async function checkBun(): Promise<HealthCheckResult> {
  const hasBun = await checkCommand('bun');
  if (!hasBun) {
    return {
      name: 'Bun',
      status: 'error',
      message: 'Not installed',
      details: { install: 'curl -fsSL https://bun.sh/install | bash' },
    };
  }

  const version = await getCommandVersion('bun');
  return {
    name: 'Bun',
    status: 'ok',
    message: version || 'installed',
  };
}

export async function checkSocat(): Promise<HealthCheckResult> {
  const hasSocat = await checkCommand('socat');
  if (!hasSocat) {
    const os = platform();
    let install = 'Install socat';
    if (os === 'darwin') install = 'brew install socat';
    else if (os === 'linux') install = 'apt-get install socat';
    
    return {
      name: 'Socat',
      status: 'warn',
      message: 'Not installed (needed for port forwarding)',
      details: { install },
    };
  }

  return {
    name: 'Socat',
    status: 'ok',
    message: 'installed',
  };
}

export function getSystemInfo(): { os: string; arch: string; home: string } {
  return {
    os: `${platform()} ${arch()}`,
    arch: arch(),
    home: homedir(),
  };
}

export function getNetworkDir(): string {
  return join(homedir(), '.jeju');
}

export function getKeysDir(): string {
  return join(getNetworkDir(), 'keys');
}

export function getConfigPath(): string {
  return join(getNetworkDir(), 'config.json');
}

export async function installKurtosis(): Promise<boolean> {
  const os = platform();
  
  try {
    if (os === 'darwin') {
      // macOS - use Homebrew
      const hasBrew = await checkCommand('brew');
      if (!hasBrew) {
        return false;
      }
      await execa('brew', ['install', 'kurtosis-tech/tap/kurtosis']);
      return true;
    } else if (os === 'linux') {
      // Linux - try install script first
      try {
        const response = await fetch('https://get.kurtosis.com');
        const script = await response.text();
        await execa('bash', ['-c', script]);
        return true;
      } catch {
        // Fallback to GitHub releases
        const archStr = arch() === 'x64' ? 'amd64' : 'arm64';
        const releaseUrl = 'https://api.github.com/repos/kurtosis-tech/kurtosis-cli-release-artifacts/releases/latest';
        const releaseInfo = await fetch(releaseUrl).then(r => r.json()) as { tag_name: string };
        const version = releaseInfo.tag_name;
        const tarball = `kurtosis-cli_${version}_linux_${archStr}.tar.gz`;
        const url = `https://github.com/kurtosis-tech/kurtosis-cli-release-artifacts/releases/download/${version}/${tarball}`;
        
        await execa('curl', ['-fsSL', url, '-o', `/tmp/${tarball}`]);
        await execa('tar', ['-xzf', `/tmp/${tarball}`, '-C', '/usr/local/bin', 'kurtosis']);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export async function isPortAvailable(port: number): Promise<boolean> {
  const result = await execa('lsof', ['-i', `:${port}`], { reject: false });
  return result.exitCode !== 0;
}

export async function killPort(port: number): Promise<void> {
  const result = await execa('lsof', ['-ti', `:${port}`], { reject: false });
  if (result.exitCode === 0 && result.stdout) {
    const pids = result.stdout.trim().split('\n');
    for (const pid of pids) {
      await execa('kill', ['-9', pid], { reject: false });
    }
  }
}

export function findMonorepoRoot(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    if (existsSync(join(dir, 'bun.lock')) && existsSync(join(dir, 'packages'))) {
      return dir;
    }
    dir = join(dir, '..');
  }
  return process.cwd();
}

