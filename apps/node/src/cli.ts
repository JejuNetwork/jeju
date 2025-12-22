#!/usr/bin/env node

/**
 * Network Node CLI - Run via npx/bunx
 *
 * Usage:
 *   npx @jejunetwork/node
 *   bunx @jejunetwork/node
 *   node-cli --help
 */

import { getCliBranding, getNetworkName } from '@jejunetwork/config'
import chalk from 'chalk'
import { Command } from 'commander'
import { z } from 'zod'
import { createNodeClient } from './lib/contracts'
import {
  detectHardware,
  getComputeCapabilities,
  NON_TEE_WARNING,
} from './lib/hardware'
import { createNodeServices } from './lib/services'

const VERSION = '0.1.0'
const networkName = getNetworkName()
const cliBranding = getCliBranding()

const program = new Command()

program
  .name(`${cliBranding.name}-node`)
  .description(
    `${networkName} Node - Earn by providing compute, storage, and network services`,
  )
  .version(VERSION)

// Status command
program
  .command('status')
  .description('Show hardware and capability status')
  .action(async () => {
    console.log(chalk.cyan(`\n  ${networkName} Node Status\n`))

    console.log(chalk.dim('  Detecting hardware...'))
    const hardware = detectHardware()
    const capabilities = getComputeCapabilities(hardware)

    console.log(chalk.bold('\n  System:'))
    console.log(`    OS: ${hardware.os} ${hardware.osVersion}`)
    console.log(`    Host: ${hardware.hostname}`)

    console.log(chalk.bold('\n  CPU:'))
    console.log(`    ${hardware.cpu.name}`)
    console.log(
      `    ${hardware.cpu.coresPhysical} cores (${hardware.cpu.coresLogical} threads) @ ${hardware.cpu.frequencyMhz} MHz`,
    )
    console.log(
      `    Estimated: ${hardware.cpu.estimatedFlops.toFixed(1)} GFLOPS`,
    )
    console.log(
      `    AVX: ${hardware.cpu.supportsAvx ? '✓' : '✗'} AVX2: ${hardware.cpu.supportsAvx2 ? '✓' : '✗'} AVX512: ${hardware.cpu.supportsAvx512 ? '✓' : '✗'}`,
    )

    console.log(chalk.bold('\n  Memory:'))
    console.log(
      `    ${(hardware.memory.totalMb / 1024).toFixed(1)} GB total, ${(hardware.memory.availableMb / 1024).toFixed(1)} GB available`,
    )

    console.log(chalk.bold('\n  GPUs:'))
    if (hardware.gpus.length === 0) {
      console.log(chalk.dim('    No NVIDIA GPUs detected'))
    } else {
      for (const gpu of hardware.gpus) {
        console.log(`    [${gpu.index}] ${gpu.name}`)
        console.log(
          `        VRAM: ${gpu.memoryTotalMb} MB (${gpu.memoryFreeMb} MB free)`,
        )
        console.log(
          `        Compute: ${gpu.computeCapability || 'N/A'}, Est. ${gpu.estimatedTflops.toFixed(1)} TFLOPS`,
        )
        console.log(
          `        Tensor Cores: ${gpu.tensorCores ? '✓' : '✗'}, CUDA: ${gpu.cudaVersion || 'N/A'}`,
        )
        if (gpu.temperatureCelsius) {
          console.log(
            `        Temp: ${gpu.temperatureCelsius}°C, Power: ${gpu.powerWatts?.toFixed(0) || 'N/A'}W`,
          )
        }
      }
    }

    console.log(chalk.bold('\n  TEE (Confidential Compute):'))
    console.log(
      `    Intel TDX: ${hardware.tee.hasIntelTdx ? chalk.green('✓') : chalk.dim('✗')}`,
    )
    console.log(
      `    Intel SGX: ${hardware.tee.hasIntelSgx ? chalk.green('✓') : chalk.dim('✗')}`,
    )
    console.log(
      `    AMD SEV: ${hardware.tee.hasAmdSev ? chalk.green('✓') : chalk.dim('✗')}`,
    )
    console.log(
      `    NVIDIA CC: ${hardware.tee.hasNvidiaCc ? chalk.green('✓') : chalk.dim('✗')}`,
    )

    console.log(chalk.bold('\n  Docker:'))
    if (hardware.docker.available) {
      console.log(`    Version: ${hardware.docker.version}`)
      console.log(
        `    Runtime: ${hardware.docker.runtimeAvailable ? chalk.green('Running') : chalk.yellow('Not running')}`,
      )
      console.log(
        `    GPU Support: ${hardware.docker.gpuSupport ? chalk.green('✓') : chalk.dim('✗')}`,
      )
      if (hardware.docker.images.length > 0) {
        console.log(`    Images: ${hardware.docker.images.join(', ')}`)
      }
    } else {
      console.log(chalk.dim('    Docker not installed'))
    }

    console.log(chalk.bold('\n  Compute Capabilities:'))
    console.log(
      `    CPU Compute: ${capabilities.cpuCompute.available ? chalk.green('Available') : chalk.dim('Not available')}`,
    )
    if (capabilities.cpuCompute.available) {
      console.log(
        `      Mode: ${capabilities.cpuCompute.teeAvailable ? chalk.green('Confidential (TEE)') : chalk.yellow('Non-confidential')}`,
      )
      console.log(
        `      Max Jobs: ${capabilities.cpuCompute.maxConcurrentJobs}`,
      )
    }
    console.log(
      `    GPU Compute: ${capabilities.gpuCompute.available ? chalk.green('Available') : chalk.dim('Not available')}`,
    )
    if (capabilities.gpuCompute.available) {
      console.log(
        `      Mode: ${capabilities.gpuCompute.teeAvailable ? chalk.green('Confidential (NVIDIA CC)') : chalk.yellow('Non-confidential')}`,
      )
      console.log(`      Total VRAM: ${capabilities.gpuCompute.totalVram} MB`)
      console.log(
        `      Est. Performance: ${capabilities.gpuCompute.estimatedTflops.toFixed(1)} TFLOPS`,
      )
    }

    if (capabilities.warnings.length > 0) {
      console.log(chalk.bold('\n  Warnings:'))
      for (const warning of capabilities.warnings) {
        console.log(chalk.yellow(`    ⚠ ${warning}`))
      }
    }

    console.log()
  })

// Start daemon
program
  .command('start')
  .description('Start the node daemon')
  .option('-a, --all', 'Enable all services')
  .option('-m, --minimal', 'Only essential services')
  .option(
    '-n, --network <network>',
    'Network (mainnet, testnet, localnet)',
    'localnet',
  )
  .option('--cpu', 'Enable CPU compute')
  .option('--gpu', 'Enable GPU compute')
  .option('--accept-non-tee', 'Accept non-confidential compute risks')
  .action(async (options) => {
    // Validate options
    const NetworkSchema = z.enum(['mainnet', 'testnet', 'localnet'])

    try {
      options.network = NetworkSchema.parse(options.network)
    } catch (e) {
      if (e instanceof z.ZodError) {
        console.error(chalk.red('\n  Configuration Error:'))
        e.issues.forEach((issue: z.core.$ZodIssue) => {
          console.error(
            chalk.red(`    ${issue.path.join('.')}: ${issue.message}`),
          )
        })
        process.exit(1)
      }
      throw e
    }

    console.log(chalk.cyan('\n  Starting Network Node...\n'))

    const hardware = detectHardware()
    const capabilities = getComputeCapabilities(hardware)

    // Check for non-TEE warnings
    const needsNonTeeWarning =
      (options.cpu && !capabilities.cpuCompute.teeAvailable) ||
      (options.gpu && !capabilities.gpuCompute.teeAvailable)

    if (needsNonTeeWarning && !options.acceptNonTee) {
      console.log(chalk.yellow(NON_TEE_WARNING))
      console.log(chalk.bold('\nTo proceed, run with --accept-non-tee flag.\n'))
      process.exit(1)
    }

    // Configure network
    let rpcUrl = 'http://127.0.0.1:6546'

    switch (options.network) {
      case 'mainnet':
        rpcUrl = 'https://rpc.jejunetwork.org'
        break
      case 'testnet':
        rpcUrl = 'https://testnet-rpc.jejunetwork.org'
        break
    }

    if (process.env.JEJU_RPC_URL) {
      rpcUrl = process.env.JEJU_RPC_URL
    }

    // Private key must be provided via environment variable for security
    // (command line args are visible in process lists)
    const privateKey = process.env.JEJU_PRIVATE_KEY

    if (!privateKey) {
      console.log(
        chalk.yellow(
          '  Warning: No private key configured. Some services require a wallet.\n',
        ),
      )
      console.log('  Set JEJU_PRIVATE_KEY environment variable.\n')
    } else {
      // Validate key format without exposing the key
      const KeySchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/)
      const keyValidation = KeySchema.safeParse(privateKey)
      if (!keyValidation.success) {
        console.error(
          chalk.red(
            '\n  Invalid JEJU_PRIVATE_KEY format. Must be 0x followed by 64 hex characters.\n',
          ),
        )
        process.exit(1)
      }
    }

    console.log(`  Network: ${options.network}`)
    console.log(`  RPC: ${rpcUrl}`)
    console.log(
      `  Wallet: ${privateKey ? 'Configured (via env)' : 'Not configured'}`,
    )
    console.log(`  CPU Compute: ${options.cpu ? 'Enabled' : 'Disabled'}`)
    console.log(`  GPU Compute: ${options.gpu ? 'Enabled' : 'Disabled'}`)

    // Import and run daemon
    const { spawn } = await import('node:child_process')
    const args = ['run', 'src/daemon/index.ts']

    if (options.all) args.push('--all')
    if (options.minimal) args.push('--minimal')
    if (options.network) args.push('--network', options.network)
    // Private key passed via env only, not via command line args

    const daemon = spawn('bun', args, {
      cwd: import.meta.dir.replace('/src', ''),
      stdio: 'inherit',
      env: {
        ...process.env,
        JEJU_RPC_URL: rpcUrl,
        JEJU_ENABLE_CPU: options.cpu ? '1' : '0',
        JEJU_ENABLE_GPU: options.gpu ? '1' : '0',
        JEJU_ACCEPT_NON_TEE: options.acceptNonTee ? '1' : '0',
      },
    })

    daemon.on('exit', (code) => {
      process.exit(code || 0)
    })
  })

// Profile GPU
program
  .command('profile')
  .description('Profile GPU capabilities for compute marketplace')
  .action(async () => {
    console.log(chalk.cyan('\n  Profiling GPU Capabilities...\n'))

    const hardware = detectHardware()

    if (hardware.gpus.length === 0) {
      console.log(chalk.yellow('  No NVIDIA GPUs detected.\n'))
      console.log('  GPU compute requires an NVIDIA GPU with CUDA support.')
      console.log(
        '  Install nvidia-smi and CUDA drivers to enable GPU compute.\n',
      )
      process.exit(1)
    }

    console.log(chalk.bold('  GPU Profile for Marketplace:\n'))

    for (const gpu of hardware.gpus) {
      console.log(chalk.cyan(`  GPU ${gpu.index}: ${gpu.name}`))
      console.log(`  ${'─'.repeat(50)}`)
      console.log(`  VRAM:              ${gpu.memoryTotalMb} MB`)
      console.log(`  Available VRAM:    ${gpu.memoryFreeMb} MB`)
      console.log(`  Compute Cap:       ${gpu.computeCapability || 'Unknown'}`)
      console.log(`  CUDA Version:      ${gpu.cudaVersion || 'Unknown'}`)
      console.log(`  Driver:            ${gpu.driverVersion || 'Unknown'}`)
      console.log(`  Tensor Cores:      ${gpu.tensorCores ? 'Yes' : 'No'}`)
      console.log(
        `  Est. Performance:  ${gpu.estimatedTflops.toFixed(1)} TFLOPS`,
      )

      if (gpu.powerWatts) {
        console.log(`  Power Draw:        ${gpu.powerWatts.toFixed(0)}W`)
      }
      if (gpu.temperatureCelsius) {
        console.log(`  Temperature:       ${gpu.temperatureCelsius}°C`)
      }

      // Suitability assessment
      console.log()
      console.log(chalk.bold('  Suitability:'))

      if (gpu.memoryTotalMb >= 24000) {
        console.log(chalk.green('    ✓ Large language models (70B+)'))
      }
      if (gpu.memoryTotalMb >= 16000) {
        console.log(chalk.green('    ✓ Medium language models (13B-30B)'))
      }
      if (gpu.memoryTotalMb >= 8000) {
        console.log(chalk.green('    ✓ Small language models (7B-13B)'))
      }
      if (gpu.memoryTotalMb >= 4000) {
        console.log(chalk.green('    ✓ Image generation (Stable Diffusion)'))
      }
      if (gpu.tensorCores) {
        console.log(
          chalk.green('    ✓ Optimized for AI inference (Tensor Cores)'),
        )
      }

      // TEE status
      if (hardware.tee.hasNvidiaCc) {
        console.log(chalk.green('    ✓ Confidential Compute (NVIDIA CC)'))
      } else {
        console.log(
          chalk.yellow('    ⚠ Non-confidential (NVIDIA CC not available)'),
        )
      }

      console.log()
    }

    // Suggested pricing
    console.log(chalk.bold('  Suggested Marketplace Pricing:\n'))
    const totalTflops = hardware.gpus.reduce(
      (sum, g) => sum + g.estimatedTflops,
      0,
    )
    const baseRate = 0.001 // ETH per TFLOP-hour
    const suggestedRate = totalTflops * baseRate
    console.log(
      `    ${suggestedRate.toFixed(4)} ETH/hour (based on ${totalTflops.toFixed(1)} TFLOPS)`,
    )
    console.log()
  })

// Marketplace registration
program
  .command('register')
  .description('Register as a compute provider on the marketplace')
  .option(
    '-n, --network <network>',
    'Network (mainnet, testnet, localnet)',
    'localnet',
  )
  .option('--cpu', 'Register CPU compute')
  .option('--gpu', 'Register GPU compute')
  .option('--rate <rate>', 'Hourly rate in ETH', '0.01')
  .option('--accept-non-tee', 'Accept non-confidential compute risks')
  .action(async (options) => {
    console.log(chalk.cyan('\n  Registering as Compute Provider...\n'))

    const hardware = detectHardware()
    const capabilities = getComputeCapabilities(hardware)

    // Validate
    if (options.gpu && !capabilities.gpuCompute.available) {
      console.log(
        chalk.red(
          '  Error: GPU compute requested but no suitable GPU detected.\n',
        ),
      )
      process.exit(1)
    }

    if (options.cpu && !capabilities.cpuCompute.available) {
      console.log(
        chalk.red(
          '  Error: CPU compute requested but system does not meet requirements.\n',
        ),
      )
      process.exit(1)
    }

    // Private key must be provided via environment variable for security
    const privateKey = process.env.JEJU_PRIVATE_KEY
    if (!privateKey) {
      console.log(
        chalk.red(
          '  Error: JEJU_PRIVATE_KEY environment variable required for registration.\n',
        ),
      )
      process.exit(1)
    }

    // Validate key format
    const KeySchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/)
    const keyValidation = KeySchema.safeParse(privateKey)
    if (!keyValidation.success) {
      console.error(
        chalk.red(
          '\n  Invalid JEJU_PRIVATE_KEY format. Must be 0x followed by 64 hex characters.\n',
        ),
      )
      process.exit(1)
    }

    // Check non-TEE
    const isNonTee =
      (options.cpu && !capabilities.cpuCompute.teeAvailable) ||
      (options.gpu && !capabilities.gpuCompute.teeAvailable)

    if (isNonTee && !options.acceptNonTee) {
      console.log(chalk.yellow(NON_TEE_WARNING))
      console.log(chalk.bold('\nTo proceed, run with --accept-non-tee flag.\n'))
      process.exit(1)
    }

    // Configure network
    let rpcUrl = 'http://127.0.0.1:6546'
    let chainId = 1337

    switch (options.network) {
      case 'mainnet':
        rpcUrl = 'https://rpc.jejunetwork.org'
        chainId = 420690
        break
      case 'testnet':
        rpcUrl = 'https://testnet-rpc.jejunetwork.org'
        chainId = 420691
        break
    }

    console.log(`  Network: ${options.network}`)
    console.log(
      `  Compute Type: ${options.cpu && options.gpu ? 'CPU + GPU' : options.cpu ? 'CPU' : 'GPU'}`,
    )
    console.log(
      `  Mode: ${isNonTee ? 'Non-confidential' : 'Confidential (TEE)'}`,
    )
    console.log(`  Rate: ${options.rate} ETH/hour`)
    console.log()

    // Create client and register
    const client = createNodeClient(rpcUrl, chainId, privateKey)
    const services = createNodeServices(client)

    services.compute.setHardware(hardware)
    if (isNonTee) {
      services.compute.acknowledgeNonTeeRisk()
    }

    console.log(chalk.dim('  Registering on-chain...'))

    // This would make the actual contract call
    // For now, just show what would be registered
    const offer = services.compute.createOffer(
      BigInt(Math.floor(parseFloat(options.rate) * 1e18)),
      BigInt(Math.floor(parseFloat(options.rate) * 1e18)),
      options.cpu && options.gpu ? 'both' : options.cpu ? 'cpu' : 'gpu',
    )

    if (offer) {
      console.log(chalk.green('\n  Registration ready:'))
      console.log(
        `    CPU: ${offer.cpuCores} cores, ${offer.cpuGflops.toFixed(1)} GFLOPS`,
      )
      console.log(`    Memory: ${(offer.memoryMb / 1024).toFixed(1)} GB`)
      if (offer.gpuCount > 0) {
        console.log(`    GPU: ${offer.gpuCount}x ${offer.gpuModels.join(', ')}`)
        console.log(
          `    VRAM: ${offer.gpuVramMb} MB, ${offer.gpuTflops.toFixed(1)} TFLOPS`,
        )
      }
      console.log(
        `    TEE: ${offer.teeAvailable ? offer.teeType : 'Not available'}`,
      )
    }

    console.log()
  })

// Help for running without arguments
program.action(() => {
  console.log(
    chalk.cyan(`
     ██╗███████╗     ██╗██╗   ██╗
     ██║██╔════╝     ██║██║   ██║
     ██║█████╗       ██║██║   ██║
██   ██║██╔══╝  ██   ██║██║   ██║
╚█████╔╝███████╗╚█████╔╝╚██████╔╝
 ╚════╝ ╚══════╝ ╚════╝  ╚═════╝ 
`),
  )
  console.log(
    chalk.dim(
      '  Network Node - Earn by providing compute, storage, and services\n',
    ),
  )
  console.log('  Commands:')
  console.log('    status    - Show hardware and capability status')
  console.log('    profile   - Profile GPU for marketplace')
  console.log('    register  - Register as compute provider')
  console.log('    start     - Start the node daemon')
  console.log()
  console.log('  Run with --help for more options\n')
})

program.parse()
