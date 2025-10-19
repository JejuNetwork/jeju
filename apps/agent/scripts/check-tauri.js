#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function checkRustInstallation() {
  console.log('🦀 Checking for Rust installation...');

  try {
    const { stdout } = await execAsync('rustc --version');
    console.log('✅ Rust is already installed:', stdout.trim());
    return true;
  } catch (error) {
    console.log('⚠️  Rust not found.');
    console.log('\nTauri requires Rust to be installed. Please install Rust manually:');
    console.log("  Run: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh");
    console.log('\nFor more information, visit: https://www.rust-lang.org/tools/install');
    return false;
  }
}

async function checkTauriInstallation() {
  console.log('🔍 Checking for Tauri CLI installation...');

  try {
    // Check if Tauri CLI is installed
    const { stdout } = await execAsync('tauri --version');
    console.log('✅ Tauri CLI is already installed:', stdout.trim());
    return true;
  } catch (error) {
    console.log('⚠️  Tauri CLI not found. Installing...');

    try {
      // Detect package manager
      const isUsingBun = process.env.npm_execpath?.includes('bun');
      const installCommand = isUsingBun
        ? 'bun add -g @tauri-apps/cli'
        : 'npm install -g @tauri-apps/cli';

      console.log(`📦 Running: ${installCommand}`);
      await execAsync(installCommand);

      // Verify installation
      const { stdout: versionCheck } = await execAsync('tauri --version');
      console.log('✅ Tauri CLI successfully installed:', versionCheck.trim());
      return true;
    } catch (installError) {
      console.error('❌ Failed to install Tauri CLI:', installError.message);
      console.log('\nPlease install Tauri CLI manually:');
      console.log('  Using bun: bun add -g @tauri-apps/cli');
      console.log('  Using npm: npm install -g @tauri-apps/cli');
      console.log(
        '\nFor more information, visit: https://tauri.app/v1/guides/getting-started/prerequisites'
      );
      return false;
    }
  }
}

async function main() {
  console.log('🚀 Checking Tauri prerequisites...\n');

  // Check Rust first as it's required for Tauri
  const rustInstalled = await checkRustInstallation();
  console.log('');

  // Check Tauri CLI
  const tauriInstalled = await checkTauriInstallation();
  console.log('');

  if (rustInstalled && tauriInstalled) {
    console.log('✨ All Tauri prerequisites are installed!');
  } else {
    console.log('⚠️  Some prerequisites are missing. Please install them manually.');
    if (!rustInstalled) {
      console.log('\n📝 Note: Rust is required for building Tauri applications.');
    }
  }
}

// Run the checks
main().catch(console.error);
