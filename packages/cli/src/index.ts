#!/usr/bin/env bun
/**
 * Jeju CLI - Development toolchain for Jeju Network
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

// Import commands
import { devCommand } from './commands/dev';
import { testCommand } from './commands/test';
import { deployCommand } from './commands/deploy';
import { initCommand } from './commands/init';
import { keysCommand } from './commands/keys';
import { statusCommand } from './commands/status';

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
  console.log(chalk.cyan(`
     ██╗███████╗     ██╗██╗   ██╗
     ██║██╔════╝     ██║██║   ██║
     ██║█████╗       ██║██║   ██║
██   ██║██╔══╝  ██   ██║██║   ██║
╚█████╔╝███████╗╚█████╔╝╚██████╔╝
 ╚════╝ ╚══════╝ ╚════╝  ╚═════╝ 
`));
  console.log(chalk.dim('  The modern EVM chain for agents and humans\n'));
}

const program = new Command();

program
  .name('jeju')
  .description('Jeju Network CLI - Build, test, and deploy')
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

// Core commands only
program.addCommand(devCommand);
program.addCommand(testCommand);
program.addCommand(deployCommand);
program.addCommand(initCommand);
program.addCommand(keysCommand);
program.addCommand(statusCommand);

// Default: show help
program.action(() => {
  printBanner();
  
  console.log(chalk.bold('Development:\n'));
  console.log('  ' + chalk.cyan('jeju dev') + '              Start localnet + apps');
  console.log('  ' + chalk.cyan('jeju dev --minimal') + '    Localnet only');
  console.log('  ' + chalk.cyan('jeju test') + '             Run all tests');
  console.log('  ' + chalk.cyan('jeju status') + '           Check what\'s running\n');
  
  console.log(chalk.bold('Projects:\n'));
  console.log('  ' + chalk.cyan('jeju init my-agent') + '    Create new project\n');
  
  console.log(chalk.bold('Keys & Deployment:\n'));
  console.log('  ' + chalk.cyan('jeju keys') + '             Show/manage keys');
  console.log('  ' + chalk.cyan('jeju keys genesis') + '     Secure key ceremony');
  console.log('  ' + chalk.cyan('jeju deploy testnet') + '   Deploy to testnet');
  console.log('  ' + chalk.cyan('jeju deploy mainnet') + '   Deploy to mainnet\n');
  
  console.log(chalk.dim('Run `jeju <command> --help` for details.\n'));
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
    console.error(chalk.red(`\nUnknown command. Run 'jeju --help' for available commands.\n`));
    process.exit(1);
  }
  
  console.error(chalk.red(`\nError: ${err.message}\n`));
  process.exit(1);
}
