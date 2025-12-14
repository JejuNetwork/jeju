/**
 * CLI Logger with styled output
 */

import chalk from 'chalk';

export interface LoggerOptions {
  verbose?: boolean;
  silent?: boolean;
}

class Logger {
  private verbose = false;
  private silent = false;

  configure(options: LoggerOptions) {
    this.verbose = options.verbose ?? false;
    this.silent = options.silent ?? false;
  }

  private log(message: string) {
    if (!this.silent) {
      console.log(message);
    }
  }

  info(message: string) {
    this.log(message);
  }

  success(message: string) {
    this.log(chalk.green('✓ ') + message);
  }

  warn(message: string) {
    this.log(chalk.yellow('⚠ ') + message);
  }

  error(message: string) {
    this.log(chalk.red('✗ ') + message);
  }

  debug(message: string) {
    if (this.verbose) {
      this.log(chalk.gray('  ' + message));
    }
  }

  step(message: string) {
    this.log(chalk.blue('→ ') + message);
  }

  header(title: string) {
    const line = '═'.repeat(68);
    this.log('');
    this.log(chalk.cyan('╔' + line + '╗'));
    this.log(chalk.cyan('║') + chalk.bold.white('  ' + title.padEnd(66)) + chalk.cyan('║'));
    this.log(chalk.cyan('╚' + line + '╝'));
    this.log('');
  }

  subheader(title: string) {
    this.log('');
    this.log(chalk.bold(title));
    this.log(chalk.dim('─'.repeat(40)));
  }

  table(rows: Array<{ label: string; value: string; status?: 'ok' | 'warn' | 'error' }>) {
    for (const row of rows) {
      const icon = row.status === 'ok' ? chalk.green('✓') :
                   row.status === 'warn' ? chalk.yellow('⚠') :
                   row.status === 'error' ? chalk.red('✗') : ' ';
      this.log(`  ${icon} ${row.label.padEnd(20)} ${chalk.cyan(row.value)}`);
    }
  }

  box(lines: string[]) {
    const maxLen = Math.max(...lines.map(l => l.length), 40);
    const top = '┌' + '─'.repeat(maxLen + 2) + '┐';
    const bottom = '└' + '─'.repeat(maxLen + 2) + '┘';
    
    this.log(chalk.dim(top));
    for (const line of lines) {
      this.log(chalk.dim('│ ') + line.padEnd(maxLen) + chalk.dim(' │'));
    }
    this.log(chalk.dim(bottom));
  }

  newline() {
    this.log('');
  }

  separator() {
    this.log(chalk.dim('─'.repeat(70)));
  }

  keyValue(key: string, value: string) {
    this.log(`  ${chalk.dim(key + ':')} ${value}`);
  }

  list(items: string[]) {
    for (const item of items) {
      this.log(`  • ${item}`);
    }
  }
}

export const logger = new Logger();

