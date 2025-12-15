#!/usr/bin/env bun
/**
 * SP1 Toolchain Setup Script
 *
 * Installs the SP1 proving toolkit and sets up the development environment
 * for generating ZK proofs of cross-chain consensus.
 *
 * SP1 is Succinct's open-source RISC-V zkVM that allows proving arbitrary Rust programs.
 * See: https://docs.succinct.xyz/
 */

import { spawn } from 'bun';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'skip-install': { type: 'boolean', default: false },
    'skip-circuits': { type: 'boolean', default: false },
    'verify-only': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(`
SP1 Setup Script

Usage: bun run setup:sp1 [options]

Options:
  --skip-install    Skip SP1 toolchain installation
  --skip-circuits   Skip circuit compilation
  --verify-only     Only verify existing installation
  -h, --help        Show this help message
`);
  process.exit(0);
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log('\n🔧 SP1 Toolchain Setup\n');
  console.log('='.repeat(60) + '\n');

  // 1. Check prerequisites
  console.log('1️⃣  Checking prerequisites...\n');
  await checkPrerequisites();

  // 2. Install SP1
  if (!args['skip-install'] && !args['verify-only']) {
    console.log('\n2️⃣  Installing SP1 toolchain...\n');
    await installSP1();
  }

  // 3. Verify installation
  console.log('\n3️⃣  Verifying SP1 installation...\n');
  const installed = await verifySP1();

  if (!installed) {
    console.error('\n❌ SP1 installation failed or not found');
    console.log('\nTo install manually:');
    console.log('  curl -L https://sp1.succinct.xyz | bash');
    console.log('  sp1up');
    process.exit(1);
  }

  if (args['verify-only']) {
    console.log('\n✅ SP1 verification complete\n');
    process.exit(0);
  }

  // 4. Build circuits
  if (!args['skip-circuits']) {
    console.log('\n4️⃣  Building circuits...\n');
    await buildCircuits();
  }

  // 5. Generate verification keys
  console.log('\n5️⃣  Generating verification keys...\n');
  await generateVerificationKeys();

  // 6. Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n✅ SP1 Setup Complete!\n');
  console.log('Next steps:');
  console.log('  1. Deploy contracts with real verification keys');
  console.log('  2. Run bun run orchestrator:local to test');
  console.log('  3. Run bun run test:integration for full validation\n');
}

// =============================================================================
// PREREQUISITES
// =============================================================================

async function checkPrerequisites(): Promise<void> {
  // Check Rust
  const rustCheck = spawn({
    cmd: ['rustc', '--version'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await rustCheck.exited;

  if (rustCheck.exitCode !== 0) {
    console.log('  ⚠️  Rust not found. Installing...');
    await installRust();
  } else {
    const version = await new Response(rustCheck.stdout).text();
    console.log(`  ✅ Rust: ${version.trim()}`);
  }

  // Check Cargo
  const cargoCheck = spawn({
    cmd: ['cargo', '--version'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await cargoCheck.exited;

  if (cargoCheck.exitCode === 0) {
    const version = await new Response(cargoCheck.stdout).text();
    console.log(`  ✅ Cargo: ${version.trim()}`);
  }

  // Check for wasm32-unknown-unknown target
  const targetCheck = spawn({
    cmd: ['rustup', 'target', 'list', '--installed'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await targetCheck.exited;

  if (targetCheck.exitCode === 0) {
    const targets = await new Response(targetCheck.stdout).text();
    if (!targets.includes('wasm32-unknown-unknown')) {
      console.log('  📦 Adding wasm32-unknown-unknown target...');
      const addTarget = spawn({
        cmd: ['rustup', 'target', 'add', 'wasm32-unknown-unknown'],
        stdout: 'inherit',
        stderr: 'inherit',
      });
      await addTarget.exited;
    }
    console.log('  ✅ wasm32-unknown-unknown target available');
  }
}

async function installRust(): Promise<void> {
  const proc = spawn({
    cmd: [
      'sh',
      '-c',
      'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
    ],
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error('Failed to install Rust');
  }

  console.log('  ✅ Rust installed');
}

// =============================================================================
// SP1 INSTALLATION
// =============================================================================

async function installSP1(): Promise<void> {
  // Download and run SP1 installer
  console.log('  Downloading SP1 installer...');

  const downloadProc = spawn({
    cmd: ['sh', '-c', 'curl -L https://sp1.succinct.xyz | bash'],
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      HOME: process.env.HOME ?? '~',
    },
  });
  await downloadProc.exited;

  if (downloadProc.exitCode !== 0) {
    console.log('  ⚠️  SP1 installer download failed, trying alternative...');
    await installSP1FromCargo();
    return;
  }

  // Run sp1up
  console.log('  Running sp1up...');

  const sp1upPath = join(process.env.HOME ?? '~', '.sp1', 'bin', 'sp1up');

  const sp1upProc = spawn({
    cmd: [sp1upPath],
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PATH: `${join(process.env.HOME ?? '~', '.sp1', 'bin')}:${process.env.PATH}`,
    },
  });
  await sp1upProc.exited;

  console.log('  ✅ SP1 installed');
}

async function installSP1FromCargo(): Promise<void> {
  console.log('  Installing SP1 from cargo...');

  const proc = spawn({
    cmd: ['cargo', 'install', 'sp1-cli'],
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    console.log('  ⚠️  Cargo install failed');
  } else {
    console.log('  ✅ SP1 CLI installed via cargo');
  }
}

// =============================================================================
// VERIFICATION
// =============================================================================

async function verifySP1(): Promise<boolean> {
  // Check for sp1 in PATH or .sp1/bin
  const sp1Paths = [
    'sp1',
    join(process.env.HOME ?? '~', '.sp1', 'bin', 'sp1'),
    join(process.env.HOME ?? '~', '.cargo', 'bin', 'sp1'),
  ];

  for (const sp1Path of sp1Paths) {
    const proc = spawn({
      cmd: [sp1Path, '--version'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;

    if (proc.exitCode === 0) {
      const version = await new Response(proc.stdout).text();
      console.log(`  ✅ SP1 CLI: ${version.trim()}`);
      return true;
    }
  }

  // Check cargo-prove
  const cargoProveProc = spawn({
    cmd: ['cargo', 'prove', '--version'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await cargoProveProc.exited;

  if (cargoProveProc.exitCode === 0) {
    const version = await new Response(cargoProveProc.stdout).text();
    console.log(`  ✅ cargo-prove: ${version.trim()}`);
    return true;
  }

  console.log('  ⚠️  SP1 not found in PATH');
  return false;
}

// =============================================================================
// CIRCUIT BUILDING
// =============================================================================

async function buildCircuits(): Promise<void> {
  const circuitsDir = join(process.cwd(), 'circuits');

  if (!existsSync(circuitsDir)) {
    console.log('  ⚠️  Circuits directory not found, skipping build');
    return;
  }

  const circuits = [
    'solana-consensus',
    'ethereum-consensus',
    'token-transfer',
    'ed25519-aggregation',
  ];

  for (const circuit of circuits) {
    const circuitDir = join(circuitsDir, circuit);

    if (!existsSync(circuitDir)) {
      console.log(`  ⚠️  ${circuit} circuit not found, skipping`);
      continue;
    }

    console.log(`  Building ${circuit}...`);

    const proc = spawn({
      cmd: ['cargo', 'build', '--release'],
      cwd: circuitDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;

    if (proc.exitCode === 0) {
      console.log(`  ✅ ${circuit} built`);
    } else {
      const stderr = await new Response(proc.stderr).text();
      console.log(`  ⚠️  ${circuit} build failed: ${stderr.slice(0, 100)}`);
    }
  }
}

// =============================================================================
// VERIFICATION KEY GENERATION
// =============================================================================

async function generateVerificationKeys(): Promise<void> {
  const outputDir = join(process.cwd(), '.sp1-keys');

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // For now, generate placeholder keys
  // In production, these would be generated by SP1's keygen tool

  const placeholderVK = {
    alpha: ['0x1', '0x2'],
    beta: [
      ['0x3', '0x4'],
      ['0x5', '0x6'],
    ],
    gamma: [
      ['0x7', '0x8'],
      ['0x9', '0xa'],
    ],
    delta: [
      ['0xb', '0xc'],
      ['0xd', '0xe'],
    ],
    ic: [
      ['0xf', '0x10'],
      ['0x11', '0x12'],
    ],
    note: 'PLACEHOLDER - Replace with real SP1 verification key',
    generatedAt: new Date().toISOString(),
  };

  const circuits = [
    'solana_consensus',
    'ethereum_consensus',
    'token_transfer',
    'ed25519_aggregation',
  ];

  for (const circuit of circuits) {
    const vkPath = join(outputDir, `${circuit}_vk.json`);
    writeFileSync(vkPath, JSON.stringify(placeholderVK, null, 2));
    console.log(`  📝 Generated placeholder VK: ${circuit}_vk.json`);
  }

  console.log(`\n  ⚠️  IMPORTANT: These are placeholder verification keys!`);
  console.log(
    `  For production, generate real keys with: sp1-keygen --program <path>`
  );
}

// =============================================================================
// RUN
// =============================================================================

main().catch((error) => {
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
});
