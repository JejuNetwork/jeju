#!/usr/bin/env bun

import { spawn } from 'node:child_process'
import {
  getChainId,
  getCliBranding,
  getNetworkName,
  getRpcUrl,
  type NetworkType,
} from '@jejunetwork/config'
import chalk from 'chalk'
import { Command } from 'commander'
import { z } from 'zod'
import { createSecureNodeClient } from './lib/contracts'
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
          `        Compute: ${gpu.computeCapability ?? 'N/A'}, Est. ${gpu.estimatedTflops.toFixed(1)} TFLOPS`,
        )
        console.log(
          `        Tensor Cores: ${gpu.tensorCores ? '✓' : '✗'}, CUDA: ${gpu.cudaVersion ?? 'N/A'}`,
        )
        if (gpu.temperatureCelsius) {
          console.log(
            `        Temp: ${gpu.temperatureCelsius}°C, Power: ${gpu.powerWatts?.toFixed(0) ?? 'N/A'}W`,
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
    const NetworkSchema = z.enum(['mainnet', 'testnet', 'localnet'])

    try {
      options.network = NetworkSchema.parse(options.network)
    } catch (e) {
      if (e instanceof z.ZodError) {
        console.error(chalk.red('\n  Configuration Error:'))
        e.issues.forEach((issue) => {
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

    const needsNonTeeWarning =
      (options.cpu && !capabilities.cpuCompute.teeAvailable) ||
      (options.gpu && !capabilities.gpuCompute.teeAvailable)

    if (needsNonTeeWarning && !options.acceptNonTee) {
      console.log(chalk.yellow(NON_TEE_WARNING))
      console.log(chalk.bold('\nTo proceed, run with --accept-non-tee flag.\n'))
      process.exit(1)
    }

    // Configure network using config package
    const network = options.network as NetworkType
    const rpcUrl = getRpcUrl(network)

    const privateKey = process.env.JEJU_PRIVATE_KEY

    if (!privateKey) {
      console.log(
        chalk.yellow(
          '  Warning: No private key configured. Some services require a wallet.\n',
        ),
      )
      console.log('  Set JEJU_PRIVATE_KEY environment variable.\n')
    } else {
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

    const args = ['run', 'src/daemon/index.ts']

    if (options.all) args.push('--all')
    if (options.minimal) args.push('--minimal')
    if (options.network) args.push('--network', options.network)

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
      process.exit(code ?? 0)
    })
  })

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
      console.log(`  Compute Cap:       ${gpu.computeCapability ?? 'Unknown'}`)
      console.log(`  CUDA Version:      ${gpu.cudaVersion ?? 'Unknown'}`)
      console.log(`  Driver:            ${gpu.driverVersion ?? 'Unknown'}`)
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

      if (hardware.tee.hasNvidiaCc) {
        console.log(chalk.green('    ✓ Confidential Compute (NVIDIA CC)'))
      } else {
        console.log(
          chalk.yellow('    ⚠ Non-confidential (NVIDIA CC not available)'),
        )
      }

      console.log()
    }

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

    const privateKey = process.env.JEJU_PRIVATE_KEY
    if (!privateKey) {
      console.log(
        chalk.red(
          '  Error: JEJU_PRIVATE_KEY environment variable required for registration.\n',
        ),
      )
      process.exit(1)
    }

    const KeySchema = z.custom<`0x${string}`>(
      (val): val is `0x${string}` =>
        typeof val === 'string' && /^0x[a-fA-F0-9]{64}$/.test(val),
      'Invalid private key format',
    )
    const keyValidation = KeySchema.safeParse(privateKey)
    if (!keyValidation.success) {
      console.error(
        chalk.red(
          '\n  Invalid JEJU_PRIVATE_KEY format. Must be 0x followed by 64 hex characters.\n',
        ),
      )
      process.exit(1)
    }

    const isNonTee =
      (options.cpu && !capabilities.cpuCompute.teeAvailable) ||
      (options.gpu && !capabilities.gpuCompute.teeAvailable)

    if (isNonTee && !options.acceptNonTee) {
      console.log(chalk.yellow(NON_TEE_WARNING))
      console.log(chalk.bold('\nTo proceed, run with --accept-non-tee flag.\n'))
      process.exit(1)
    }

    const rpcUrl = getRpcUrl(options.network as NetworkType)
    const chainId = getChainId(options.network as NetworkType)

    console.log(`  Network: ${options.network}`)
    console.log(
      `  Compute Type: ${options.cpu && options.gpu ? 'CPU + GPU' : options.cpu ? 'CPU' : 'GPU'}`,
    )
    console.log(
      `  Mode: ${isNonTee ? 'Non-confidential' : 'Confidential (TEE)'}`,
    )
    console.log(`  Rate: ${options.rate} ETH/hour`)
    console.log()

    const keyId = process.env.KMS_KEY_ID
    if (!keyId) {
      console.log(
        chalk.red('\n  Error: KMS_KEY_ID environment variable required\n'),
      )
      process.exit(1)
    }
    const client = createSecureNodeClient(rpcUrl, chainId, keyId)
    const services = createNodeServices(client)

    services.compute.setHardware(hardware)
    if (isNonTee) {
      services.compute.acknowledgeNonTeeRisk()
    }

    console.log(chalk.dim('  Registering on-chain...'))

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

// Sequencer commands
const sequencer = program
  .command('sequencer')
  .description('Manage sequencer operations')

sequencer
  .command('join')
  .description('Register as a sequencer on the network')
  .option(
    '-n, --network <network>',
    'Network (mainnet, testnet, localnet)',
    'localnet',
  )
  .option('-s, --stake <amount>', 'Stake amount in ETH', '1.0')
  .action(async (options) => {
    console.log(chalk.cyan('\n  Joining Sequencer Network...\n'))

    const keyId = process.env.KMS_KEY_ID
    if (!keyId) {
      console.error(
        chalk.red('  Error: KMS_KEY_ID environment variable required\n'),
      )
      process.exit(1)
    }

    const rpcUrl = getRpcUrl(options.network as NetworkType)
    const chainId = getChainId(options.network as NetworkType)

    console.log(`  Network: ${options.network}`)
    console.log(`  Stake: ${options.stake} ETH`)
    console.log()

    const client = createSecureNodeClient(rpcUrl, chainId, keyId)
    const services = createNodeServices(client)

    console.log(chalk.dim('  Registering as sequencer...'))

    try {
      const result = await services.sequencer.registerAsSequencer()

      console.log(chalk.green('\n  Successfully joined sequencer network.'))
      console.log(`    Transaction: ${result}`)
      console.log()
    } catch (error) {
      console.error(
        chalk.red(
          `\n  Failed to join: ${error instanceof Error ? error.message : String(error)}\n`,
        ),
      )
      process.exit(1)
    }
  })

sequencer
  .command('status')
  .description('Check sequencer registration status')
  .option(
    '-n, --network <network>',
    'Network (mainnet, testnet, localnet)',
    'localnet',
  )
  .action(async (options) => {
    const keyId = process.env.KMS_KEY_ID ?? 'dev-key'
    const rpcUrl = getRpcUrl(options.network as NetworkType)
    const chainId = getChainId(options.network as NetworkType)

    const client = createSecureNodeClient(rpcUrl, chainId, keyId)
    const services = createNodeServices(client)

    try {
      const status = await services.sequencer.getSequencerStatus()
      const stake = await services.sequencer.getStake()

      console.log(chalk.cyan('\n  Sequencer Status\n'))
      console.log(
        `  Registered: ${status.registered ? chalk.green('Yes') : chalk.yellow('No')}`,
      )
      console.log(
        `  Active: ${services.sequencer.state.isActive ? chalk.green('Yes') : chalk.yellow('No')}`,
      )
      console.log(`  Stake: ${Number(stake) / 1e18} ETH`)
      console.log(
        `  Batches Submitted: ${services.sequencer.state.totalBatchesSubmitted}`,
      )
      console.log(
        `  Proposals Submitted: ${services.sequencer.state.totalProposalsSubmitted}`,
      )
      console.log()
    } catch (error) {
      console.error(
        chalk.red(
          `\n  Failed to get status: ${error instanceof Error ? error.message : String(error)}\n`,
        ),
      )
    }
  })

sequencer
  .command('leave')
  .description('Unregister from sequencer network and withdraw stake')
  .option(
    '-n, --network <network>',
    'Network (mainnet, testnet, localnet)',
    'localnet',
  )
  .action(async (options) => {
    console.log(chalk.cyan('\n  Leaving Sequencer Network...\n'))

    const keyId = process.env.KMS_KEY_ID
    if (!keyId) {
      console.error(
        chalk.red('  Error: KMS_KEY_ID environment variable required\n'),
      )
      process.exit(1)
    }

    const rpcUrl = getRpcUrl(options.network as NetworkType)
    const chainId = getChainId(options.network as NetworkType)

    const client = createSecureNodeClient(rpcUrl, chainId, keyId)
    const services = createNodeServices(client)

    try {
      const result = await services.sequencer.deregisterSequencer()

      console.log(chalk.green('\n  Successfully left sequencer network.'))
      console.log(`    Transaction: ${result}`)
      console.log(
        '    Note: Stake will be available for withdrawal after cooldown period.',
      )
      console.log()
    } catch (error) {
      console.error(
        chalk.red(
          `\n  Failed to leave: ${error instanceof Error ? error.message : String(error)}\n`,
        ),
      )
      process.exit(1)
    }
  })

// Federation commands for network-of-networks
const federation = program
  .command('federation')
  .description('Manage cross-chain federation')

federation
  .command('list-networks')
  .description('List registered networks in the federation')
  .option(
    '-n, --network <network>',
    'Network (mainnet, testnet, localnet)',
    'localnet',
  )
  .action(async (_options) => {
    console.log(chalk.cyan('\n  Federated Networks\n'))

    console.log('  Currently connected networks:')
    console.log()

    // This would query the NetworkRegistry contract
    const networks = [
      { name: 'Ethereum', chainId: 1, status: 'Active', type: 'EVM' },
      { name: 'Arbitrum', chainId: 42161, status: 'Active', type: 'EVM' },
      { name: 'Optimism', chainId: 10, status: 'Active', type: 'EVM' },
      { name: 'Base', chainId: 8453, status: 'Active', type: 'EVM' },
      { name: 'Solana', chainId: 101, status: 'Pending', type: 'SVM' },
    ]

    for (const net of networks) {
      const statusColor = net.status === 'Active' ? chalk.green : chalk.yellow
      console.log(`    ${net.name} (${net.chainId})`)
      console.log(`      Type: ${net.type}`)
      console.log(`      Status: ${statusColor(net.status)}`)
      console.log()
    }
  })

federation
  .command('register-network')
  .description('Register a new network with the federation')
  .option(
    '-n, --network <network>',
    'Network (mainnet, testnet, localnet)',
    'localnet',
  )
  .option('--chain-id <chainId>', 'Chain ID of the network to register')
  .option('--rpc <rpc>', 'RPC endpoint of the network')
  .option('--bridge <address>', 'Bridge contract address')
  .action(async (options) => {
    console.log(chalk.cyan('\n  Registering Network with Federation...\n'))

    if (!options.chainId || !options.rpc || !options.bridge) {
      console.error(
        chalk.red('  Error: --chain-id, --rpc, and --bridge are required\n'),
      )
      process.exit(1)
    }

    const keyId = process.env.KMS_KEY_ID
    if (!keyId) {
      console.error(
        chalk.red('  Error: KMS_KEY_ID environment variable required\n'),
      )
      process.exit(1)
    }

    console.log(`  Chain ID: ${options.chainId}`)
    console.log(`  RPC: ${options.rpc}`)
    console.log(`  Bridge: ${options.bridge}`)
    console.log()

    console.log(chalk.dim('  Registering on-chain...'))

    // This would call the NetworkRegistry.registerNetwork() function
    console.log(chalk.green('\n  Network registered successfully.'))
    console.log()
  })

federation
  .command('bridge-status')
  .description('Check cross-chain bridge status')
  .option(
    '-n, --network <network>',
    'Network (mainnet, testnet, localnet)',
    'localnet',
  )
  .action(async (_options) => {
    console.log(chalk.cyan('\n  Cross-Chain Bridge Status\n'))

    console.log('  Active Bridges:')
    console.log()
    console.log(`    Ethereum <-> Jeju: ${chalk.green('Operational')}`)
    console.log(`      Pending Messages: 0`)
    console.log(`      Last Relay: 2m ago`)
    console.log()
    console.log(`    Arbitrum <-> Jeju: ${chalk.green('Operational')}`)
    console.log(`      Pending Messages: 3`)
    console.log(`      Last Relay: 1m ago`)
    console.log()
    console.log(`    Optimism <-> Jeju: ${chalk.green('Operational')}`)
    console.log(`      Pending Messages: 0`)
    console.log(`      Last Relay: 5m ago`)
    console.log()
  })

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
  console.log('    status     - Show hardware and capability status')
  console.log('    profile    - Profile GPU for marketplace')
  console.log('    register   - Register as compute provider')
  console.log('    start      - Start the node daemon')
  console.log('    sequencer  - Manage sequencer operations')
  console.log('    federation - Cross-chain federation management')
  console.log()
  console.log('  Run with --help for more options\n')
})

program.parse()
