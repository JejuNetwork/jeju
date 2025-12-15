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

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from './lib/logger';
import { getCliBranding, getNetworkName, getNetworkTagline } from '@jejunetwork/config';

// Import commands
import { devCommand } from './commands/dev';
import { testCommand } from './commands/test';
import { deployCommand } from './commands/deploy';
import { keysCommand } from './commands/keys';
import { statusCommand } from './commands/status';
import { fundCommand } from './commands/fund';
import { forkCommand } from './commands/fork';
import { computeCommand } from './commands/compute';

const cli = getCliBranding();
const networkName = getNetworkName();
const cliName = cli.name;

function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkgPath = join(__dirname, '..', 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.version;
    }
  } catch {
    // Fallback
  }
  return '0.1.0';
}

function printBanner() {
  const banner = cli.banner.join('\n');
  console.log(chalk.cyan('\n' + banner));
  console.log(chalk.dim(`  ${getNetworkTagline()}\n`));
}

const program = new Command();

program
  .name(cliName)
  .description(`${networkName} CLI - Build, test, and deploy`)
  .version(getVersion())
  .option('-v, --verbose', 'Verbose output')
  .option('-q, --quiet', 'Quiet mode')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    logger.configure({
      verbose: opts.verbose,
      silent: opts.quiet,
    });
  });

// Core commands
program.addCommand(devCommand);
program.addCommand(testCommand);
program.addCommand(deployCommand);
program.addCommand(keysCommand);
program.addCommand(statusCommand);
program.addCommand(fundCommand);
program.addCommand(forkCommand);
program.addCommand(computeCommand);

// Default: show help
program.action(() => {
  printBanner();
  
  console.log(chalk.bold('Development:\n'));
  console.log('  ' + chalk.cyan(`${cliName} dev`) + '              Start localnet + apps');
  console.log('  ' + chalk.cyan(`${cliName} dev --minimal`) + '    Localnet only');
  console.log('  ' + chalk.cyan(`${cliName} status`) + '           Check what is running\n');
  
  console.log(chalk.bold('Testing:\n'));
  console.log('  ' + chalk.cyan(`${cliName} test`) + '             Run all tests');
  console.log('  ' + chalk.cyan(`${cliName} test --phase=contracts`) + ' Forge tests only');
  console.log('  ' + chalk.cyan(`${cliName} test --app=wallet`) + ' Test specific app\n');
  
  console.log(chalk.bold('Accounts:\n'));
  console.log('  ' + chalk.cyan(`${cliName} keys`) + '             Show keys');
  console.log('  ' + chalk.cyan(`${cliName} fund`) + '             Show balances');
  console.log('  ' + chalk.cyan(`${cliName} fund 0x...`) + '       Fund address');
  console.log('  ' + chalk.cyan(`${cliName} fund --all`) + '       Fund all dev accounts\n');
  
  console.log(chalk.bold('Deploy:\n'));
  console.log('  ' + chalk.cyan(`${cliName} keys genesis`) + '     Generate production keys');
  console.log('  ' + chalk.cyan(`${cliName} deploy testnet`) + '   Deploy to testnet');
  console.log('  ' + chalk.cyan(`${cliName} deploy mainnet`) + '   Deploy to mainnet\n');
  
  console.log(chalk.bold('Federation:\n'));
  console.log('  ' + chalk.cyan(`${cliName} fork`) + '             Fork your own network');
  console.log('  ' + chalk.cyan(`${cliName} fork list`) + '        List existing forks\n');
  
  console.log(chalk.bold('Compute:\n'));
  console.log('  ' + chalk.cyan(`${cliName} compute status`) + '   Check compute services');
  console.log('  ' + chalk.cyan(`${cliName} compute bridge`) + '   Start external compute bridge');
  console.log('  ' + chalk.cyan(`${cliName} compute offerings`) + ' List available compute');
  console.log('  ' + chalk.cyan(`${cliName} compute deploy <image>`) + ' Deploy container\n');
  
  console.log(chalk.dim(`Run \`${cliName} <command> --help\` for details.\n`));
});

program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const err = error as { code?: string; message?: string };
  
  if (err.code === 'commander.help' || err.code === 'commander.helpDisplayed') {
    process.exit(0);
  }
  
  if (err.code === 'commander.version') {
    process.exit(0);
  }
  
  if (err.code === 'commander.unknownCommand') {
    console.error(chalk.red(`\nUnknown command. Run '${cliName} --help' for available commands.\n`));
    process.exit(1);
  }
  
  console.error(chalk.red(`\nError: ${err.message}\n`));
  process.exit(1);
}
