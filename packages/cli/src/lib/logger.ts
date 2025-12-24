/** CLI logger with formatting utilities */

import { createLogger } from '@jejunetwork/shared'
import chalk from 'chalk'

export interface LoggerOptions {
  verbose?: boolean
  silent?: boolean
}

class Logger {
  private verbose = false
  private silent = false
  private baseLogger = createLogger('cli')

  configure(options: LoggerOptions) {
    this.verbose = options.verbose ?? false
    this.silent = options.silent ?? false
  }

  info(message: string) {
    if (!this.silent) {
      this.baseLogger.info(message)
    }
  }

  success(message: string) {
    if (!this.silent) {
      this.baseLogger.info(chalk.green('✓ ') + message)
    }
  }

  warn(message: string) {
    if (!this.silent) {
      this.baseLogger.warn(chalk.yellow('⚠ ') + message)
    }
  }

  error(message: string) {
    if (!this.silent) {
      this.baseLogger.error(chalk.red('✗ ') + message)
    }
  }

  debug(message: string) {
    if (this.verbose && !this.silent) {
      this.baseLogger.debug(chalk.gray(`  ${message}`))
    }
  }

  step(message: string) {
    if (!this.silent) {
      this.baseLogger.info(chalk.blue('→ ') + message)
    }
  }

  // CLI formatting utilities
  header(title: string) {
    if (this.silent) return
    const line = '═'.repeat(68)
    console.log('')
    console.log(chalk.cyan(`╔${line}╗`))
    console.log(
      chalk.cyan('║') +
        chalk.bold.white(`  ${title.padEnd(66)}`) +
        chalk.cyan('║'),
    )
    console.log(chalk.cyan(`╚${line}╝`))
    console.log('')
  }

  subheader(title: string) {
    if (this.silent) return
    console.log('')
    console.log(chalk.bold(title))
    console.log(chalk.dim('─'.repeat(40)))
  }

  table(
    rows: Array<{
      label: string
      value: string
      status?: 'ok' | 'warn' | 'error'
    }>,
  ) {
    if (this.silent) return
    for (const row of rows) {
      const icon =
        row.status === 'ok'
          ? chalk.green('✓')
          : row.status === 'warn'
            ? chalk.yellow('⚠')
            : row.status === 'error'
              ? chalk.red('✗')
              : ' '
      console.log(`  ${icon} ${row.label.padEnd(20)} ${chalk.cyan(row.value)}`)
    }
  }

  box(lines: string[]) {
    if (this.silent) return
    const maxLen = Math.max(...lines.map((l) => l.length), 40)
    const top = `┌${'─'.repeat(maxLen + 2)}┐`
    const bottom = `└${'─'.repeat(maxLen + 2)}┘`

    console.log(chalk.dim(top))
    for (const line of lines) {
      console.log(chalk.dim('│ ') + line.padEnd(maxLen) + chalk.dim(' │'))
    }
    console.log(chalk.dim(bottom))
  }

  newline() {
    if (!this.silent) console.log('')
  }

  separator() {
    if (!this.silent) console.log(chalk.dim('─'.repeat(70)))
  }

  keyValue(key: string, value: string) {
    if (!this.silent) console.log(`  ${chalk.dim(`${key}:`)} ${value}`)
  }

  list(items: string[]) {
    if (this.silent) return
    for (const item of items) {
      console.log(`  • ${item}`)
    }
  }
}

export const logger = new Logger()
