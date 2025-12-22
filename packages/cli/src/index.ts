#!/usr/bin/env bun

/**
 * Network CLI - Development toolchain
 *
 * Core Commands:
 *   dev      Start development environment
 *   test     Run test suite
 *   deploy   Deploy to testnet/mainnet
 *   init     Create new project
 *   keys     Key management and genesis
 *   status   Check system status
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getCliBranding,
  getNetworkName,
  getNetworkTagline,
} from '@jejunetwork/config'
import chalk from 'chalk'
import { Command } from 'commander'
import { appsCommand } from './commands/apps'
import { botsCommand } from './commands/bots'
import { buildCommand } from './commands/build'
import { cleanCommand } from './commands/clean'
import { cleanupCommand } from './commands/cleanup'
import { computeCommand } from './commands/compute'
import { decentralizeCommand } from './commands/decentralize'
import { deployCommand } from './commands/deploy'
import { deployMipsCommand } from './commands/deploy-mips'
// Import commands
import { devCommand } from './commands/dev'
import { dwsCommand } from './commands/dws'
import { faucetCommand } from './commands/faucet'
import { federationCommand } from './commands/federation'
import { forkCommand } from './commands/fork'
import { fundCommand } from './commands/fund'
import { infraCommand } from './commands/infra'
import { initCommand } from './commands/init'
import { keysCommand } from './commands/keys'
import { portsCommand } from './commands/ports'
import { proxyCommand } from './commands/proxy'
import { publishCommand } from './commands/publish'
import { serviceCommand } from './commands/service'
import { statusCommand } from './commands/status'
import { superchainCommand } from './commands/superchain'
import { testCommand } from './commands/test'
import { tokenCommand } from './commands/token'
import { trainingCommand } from './commands/training'
import { validateCommand } from './commands/validate'
import { vendorCommand } from './commands/vendor'
import { verifyStage2Command } from './commands/verify-stage2'
import { logger } from './lib/logger'
import { CommanderErrorSchema, PackageJsonSchema, validate } from './schemas'

const cli = getCliBranding()
const networkName = getNetworkName()
const cliName = cli.name

function getVersion(): string {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const pkgPath = join(__dirname, '..', 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = validate(
      JSON.parse(readFileSync(pkgPath, 'utf-8')),
      PackageJsonSchema,
      'package.json',
    )
    return pkg.version
  }
  return '0.1.0'
}

function printBanner(): void {
  const banner = cli.banner.join('\n')
  console.log(chalk.cyan(`\n${banner}`))
  console.log(chalk.dim(`  ${getNetworkTagline()}\n`))
}

const program = new Command()

program
  .name(cliName)
  .description(`${networkName} CLI - Build, test, and deploy`)
  .version(getVersion())
  .option('-v, --verbose', 'Verbose output')
  .option('-q, --quiet', 'Quiet mode')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts()
    logger.configure({
      verbose: opts.verbose,
      silent: opts.quiet,
    })
  })

// Core commands
program.addCommand(devCommand)
program.addCommand(testCommand)
program.addCommand(deployCommand)
program.addCommand(keysCommand)
program.addCommand(statusCommand)
program.addCommand(fundCommand)
program.addCommand(forkCommand)
program.addCommand(federationCommand)
program.addCommand(superchainCommand)
program.addCommand(computeCommand)
program.addCommand(initCommand)
program.addCommand(appsCommand)
program.addCommand(portsCommand)
program.addCommand(buildCommand)
program.addCommand(cleanCommand)
program.addCommand(cleanupCommand)
program.addCommand(serviceCommand)
program.addCommand(publishCommand)
program.addCommand(infraCommand)
program.addCommand(tokenCommand)
program.addCommand(dwsCommand)
program.addCommand(validateCommand)
program.addCommand(trainingCommand)
program.addCommand(proxyCommand)
program.addCommand(decentralizeCommand)
program.addCommand(deployMipsCommand)
program.addCommand(verifyStage2Command)
program.addCommand(faucetCommand)
program.addCommand(botsCommand)
program.addCommand(vendorCommand)

// Default: show help
program.action(() => {
  printBanner()

  console.log(chalk.bold('Development:\n'))
  console.log(
    '  ' +
      chalk.cyan(`${cliName} init`) +
      '             Create new dApp from template',
  )
  console.log(
    `  ${chalk.cyan(`${cliName} dev`)}              Start localnet + apps`,
  )
  console.log(`  ${chalk.cyan(`${cliName} dev --minimal`)}    Localnet only`)
  console.log(
    '  ' +
      chalk.cyan(`${cliName} status`) +
      '           Check what is running\n',
  )

  console.log(chalk.bold('Testing:\n'))
  console.log(`  ${chalk.cyan(`${cliName} test`)}             Run all tests`)
  console.log(
    '  ' +
      chalk.cyan(`${cliName} test --phase=contracts`) +
      ' Forge tests only',
  )
  console.log(
    `  ${chalk.cyan(`${cliName} test --app=wallet`)} Test specific app\n`,
  )

  console.log(chalk.bold('Accounts:\n'))
  console.log(`  ${chalk.cyan(`${cliName} keys`)}             Show keys`)
  console.log(`  ${chalk.cyan(`${cliName} fund`)}             Show balances`)
  console.log(`  ${chalk.cyan(`${cliName} fund 0x...`)}       Fund address`)
  console.log(
    `  ${chalk.cyan(`${cliName} fund --all`)}       Fund all dev accounts`,
  )
  console.log(
    `  ${chalk.cyan(`${cliName} faucet`)}           Request testnet funds`,
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} faucet --list`) +
      '    List available faucets\n',
  )

  console.log(chalk.bold('Deploy:\n'))
  console.log(
    '  ' +
      chalk.cyan(`${cliName} keys genesis`) +
      '     Generate production keys',
  )
  console.log(
    `  ${chalk.cyan(`${cliName} deploy testnet`)}   Deploy to testnet`,
  )
  console.log(
    `  ${chalk.cyan(`${cliName} deploy mainnet`)}   Deploy to mainnet`,
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} deploy token`) +
      '     Deploy token contracts',
  )
  console.log(
    `  ${chalk.cyan(`${cliName} deploy oif`)}       Deploy OIF contracts`,
  )
  console.log(
    `  ${chalk.cyan(`${cliName} deploy jns`)}       Deploy JNS contracts`,
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} deploy commerce`) +
      '  Deploy Commerce contracts',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} deploy moderation`) +
      ' Deploy moderation system',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} deploy x402`) +
      '      Deploy x402 payment protocol',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} deploy chainlink`) +
      ' Deploy Chainlink integration',
  )
  console.log(
    `  ${chalk.cyan(`${cliName} deploy defi`)}      Deploy DeFi protocols`,
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} deploy blocking`) +
      '  Deploy blocking system',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} deploy security-council`) +
      ' Deploy Security Council\n',
  )

  console.log(chalk.bold('Utilities:\n'))
  console.log(
    `  ${chalk.cyan(`${cliName} build`)}            Build all components`,
  )
  console.log(
    `  ${chalk.cyan(`${cliName} clean`)}            Clean build artifacts`,
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} cleanup`) +
      '          Clean up orphaned processes',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} publish`) +
      '          Publish packages to JejuPkg',
  )
  console.log(`  ${chalk.cyan(`${cliName} apps`)}             List all apps`)
  console.log(
    '  ' +
      chalk.cyan(`${cliName} ports`) +
      '            Check port configuration\n',
  )

  console.log(chalk.bold('Local Proxy:\n'))
  console.log(
    `  ${chalk.cyan(`${cliName} proxy`)}            Check proxy status`,
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} proxy start`) +
      '      Start local reverse proxy',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} proxy stop`) +
      '       Stop local reverse proxy',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} proxy urls`) +
      '       Show local development URLs',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} proxy hosts:add`) +
      '  Add hosts file entries (sudo)',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} proxy hosts:remove`) +
      ' Remove hosts entries\n',
  )

  console.log(chalk.bold('Training (Psyche):\n'))
  console.log(
    '  ' +
      chalk.cyan(`${cliName} training status`) +
      '            Check training service',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} training create --model ...`) +
      ' Create training run',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} training list`) +
      '              List training runs',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} training join <run-id>`) +
      '     Join training run',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} training claim <run-id>`) +
      '    Claim rewards',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} training nodes`) +
      '             List compute nodes',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} training models`) +
      '            List available models\n',
  )

  console.log(chalk.bold('Services:\n'))
  console.log(
    '  ' +
      chalk.cyan(`${cliName} service auto-update`) +
      '  Auto-update manager',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} service bridge`) +
      '      Forced inclusion monitor',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} service dispute`) +
      '     Fraud proof challenger',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} service sequencer`) +
      '   Consensus coordinator',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} service zkbridge`) +
      '    ZK bridge orchestrator',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} service list`) +
      '        List running services\n',
  )

  console.log(chalk.bold('Tokens:\n'))
  console.log(
    `  ${chalk.cyan(`${cliName} token deploy:jeju`)}    Deploy JEJU token`,
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} token bridge`) +
      '         Cross-chain bridging',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} token status <token>`) +
      ' Check deployment status\n',
  )

  console.log(chalk.bold('Infrastructure:\n'))
  console.log(
    '  ' +
      chalk.cyan(`${cliName} infra start`) +
      '          Start Docker + services + localnet',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} infra stop`) +
      '           Stop all infrastructure',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} infra status`) +
      '         Check infrastructure status',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} infra restart`) +
      '        Restart all infrastructure',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} infra logs`) +
      '           View Docker service logs',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} infra validate`) +
      '       Validate configurations',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} infra terraform`) +
      '      Terraform operations',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} infra deploy-full`) +
      '    Full deployment pipeline\n',
  )

  console.log(chalk.bold('Federation:\n'))
  console.log(
    '  ' +
      chalk.cyan(`${cliName} fork`) +
      '               Fork your own network',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} federation join`) +
      '    Join the Jeju Federation',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} federation status`) +
      '  Check federation membership',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} federation list`) +
      '    List all federated networks',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} federation add-stake`) +
      ' Upgrade trust tier',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} federation configure-remotes`) +
      ' Configure Hyperlane remotes\n',
  )

  console.log(chalk.bold('Vendor Apps:\n'))
  console.log(
    '  ' +
      chalk.cyan(`${cliName} vendor init <name>`) +
      ' Create vendor manifest for external app\n',
  )

  console.log(chalk.bold('Validation:\n'))
  console.log(
    '  ' +
      chalk.cyan(`${cliName} validate manifests`) +
      ' Validate all jeju-manifest.json files',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} validate config`) +
      '    Validate all configuration files\n',
  )

  console.log(chalk.bold('Superchain:\n'))
  console.log(
    '  ' +
      chalk.cyan(`${cliName} superchain check`) +
      '   Check Superchain compatibility',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} superchain status`) +
      '  Show integration status',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} superchain register`) +
      ' Prepare registry submission\n',
  )

  console.log(chalk.bold('Decentralization (Stage 2):\n'))
  console.log(
    '  ' +
      chalk.cyan(`${cliName} verify-stage2`) +
      '          Check Stage 2 readiness',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} deploy-mips`) +
      '            Configure MIPS for fraud proofs',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} decentralize`) +
      '           Transfer ownership to timelock',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} decentralize status`) +
      '    Show current ownership',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} decentralize verify`) +
      '    Verify ownership transfer\n',
  )

  console.log(chalk.bold('DWS (Decentralized Web Services):\n'))
  console.log(
    '  ' +
      chalk.cyan(`${cliName} dws dev`) +
      '           Start DWS in dev mode (auto-infra)',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} dws status`) +
      '        Check all DWS services',
  )
  console.log(
    `  ${chalk.cyan(`${cliName} dws start`)}         Start DWS server`,
  )
  console.log(
    `  ${chalk.cyan(`${cliName} dws upload <file>`)} Upload to storage`,
  )
  console.log(
    `  ${chalk.cyan(`${cliName} dws seed`)}          Seed dev environment`,
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} dws repos`) +
      '         List Git repositories',
  )
  console.log(
    `  ${chalk.cyan(`${cliName} dws pkg-search`)}    Search packages\n`,
  )

  console.log(chalk.bold('Compute:\n'))
  console.log(
    `  ${chalk.cyan(`${cliName} compute status`)}    Check compute status`,
  )
  console.log(
    `  ${chalk.cyan(`${cliName} compute start`)}     Start DWS server`,
  )
  console.log(
    `  ${chalk.cyan(`${cliName} compute submit`)}    Submit compute job`,
  )
  console.log(
    `  ${chalk.cyan(`${cliName} compute jobs`)}      List compute jobs`,
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} compute inference`) +
      ' Run inference request\n',
  )

  console.log(chalk.bold('Trading Bots:\n'))
  console.log(
    '  ' +
      chalk.cyan(`${cliName} bots start`) +
      '                    Start trading bot',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} bots start --strategy <name>`) +
      '  Use specific strategy',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} bots backtest`) +
      '                 Run backtest simulation',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} bots simulate`) +
      '                 Run portfolio simulation',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} bots prices --tokens ETH,BTC`) +
      '  Fetch current prices',
  )
  console.log(
    '  ' +
      chalk.cyan(`${cliName} bots list`) +
      '                     List available strategies\n',
  )

  console.log(chalk.dim(`Run \`${cliName} <command> --help\` for details.\n`))
})

program.exitOverride()

try {
  await program.parseAsync(process.argv)
} catch (error) {
  // Commander throws objects with code/message properties
  const parsed = CommanderErrorSchema.safeParse(error)
  const err = parsed.success ? parsed.data : { message: String(error) }

  if (err.code === 'commander.help' || err.code === 'commander.helpDisplayed') {
    process.exit(0)
  }

  if (err.code === 'commander.version') {
    process.exit(0)
  }

  if (err.code === 'commander.unknownCommand') {
    console.error(
      chalk.red(
        `\nUnknown command. Run '${cliName} --help' for available commands.\n`,
      ),
    )
    process.exit(1)
  }

  console.error(chalk.red(`\nError: ${err.message ?? 'Unknown error'}\n`))
  process.exit(1)
}
