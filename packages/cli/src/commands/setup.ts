/** Setup development tools command */

import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import { execa } from 'execa'
import { logger } from '../lib/logger'
import { checkCommand, getCommandVersion } from '../lib/system'

type OS = 'linux' | 'macos' | 'windows' | 'unknown'

function detectOS(): OS {
  const p = platform()
  switch (p) {
    case 'linux':
      return 'linux'
    case 'darwin':
      return 'macos'
    case 'win32':
      return 'windows'
    default:
      return 'unknown'
  }
}

async function findPipCommand(): Promise<string | null> {
  if (await checkCommand('pip3')) return 'pip3'
  if (await checkCommand('pip')) return 'pip'
  if (await checkCommand('python3')) return 'python3 -m pip'
  if (await checkCommand('python')) return 'python -m pip'
  return null
}

function getCargoEnvPath(): string {
  const os = detectOS()
  if (os === 'windows') {
    const userProfile = process.env.USERPROFILE ?? homedir()
    const windowsPath = join(userProfile, '.cargo', 'env')
    if (existsSync(windowsPath)) return windowsPath
  }
  return join(homedir(), '.cargo', 'env')
}

async function sourceCargoEnv(): Promise<void> {
  const envPath = getCargoEnvPath()
  if (existsSync(envPath)) {
    // Add cargo bin to PATH if not already present
    const cargoBin = join(homedir(), '.cargo', 'bin')
    if (!process.env.PATH?.includes(cargoBin)) {
      process.env.PATH = `${cargoBin}:${process.env.PATH}`
    }
  }
}

async function installRust(os: OS): Promise<boolean> {
  if (await checkCommand('cargo')) {
    const version = await getCommandVersion('cargo')
    logger.info(`Rust/Cargo already installed: ${version ?? 'unknown version'}`)
    return true
  }

  logger.step('Installing Rust toolchain via rustup...')

  if (os === 'windows') {
    // Try winget first
    if (await checkCommand('winget')) {
      const result = await execa(
        'winget',
        ['install', '--id', 'Rustlang.Rustup', '-e', '--silent'],
        { reject: false, timeout: 300000 },
      )
      if (result.exitCode === 0) {
        await sourceCargoEnv()
        logger.success('Rust installed successfully via winget')
        return true
      }
    }

    // Try chocolatey
    if (await checkCommand('choco')) {
      const result = await execa('choco', ['install', 'rustup.install', '-y'], {
        reject: false,
        timeout: 300000,
      })
      if (result.exitCode === 0) {
        await sourceCargoEnv()
        logger.success('Rust installed successfully via chocolatey')
        return true
      }
    }

    // Fallback to rustup-init via curl (works in Git Bash/MSYS2)
    const result = await execa(
      'sh',
      [
        '-c',
        'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
      ],
      { reject: false, timeout: 300000 },
    )
    if (result.exitCode === 0) {
      await sourceCargoEnv()
      logger.success('Rust installed successfully')
      return true
    }

    logger.error('Please install Rust manually from https://rustup.rs')
    return false
  }

  // Linux/macOS
  const result = await execa(
    'sh',
    [
      '-c',
      'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
    ],
    { reject: false, timeout: 300000 },
  )

  if (result.exitCode !== 0) {
    logger.error('Failed to install Rust')
    logger.info(
      'Try: curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
    )
    return false
  }

  await sourceCargoEnv()
  logger.success('Rust installed successfully')
  return true
}

async function installRuff(): Promise<boolean> {
  if (await checkCommand('ruff')) {
    logger.info('ruff already installed')
    return true
  }

  const pipCmd = await findPipCommand()
  if (!pipCmd) {
    logger.warn('pip not found. Please install Python and pip first.')
    return false
  }

  logger.step('Installing ruff Python linter...')

  // Try with --break-system-packages first (needed on newer Debian/Ubuntu)
  const pipArgs = pipCmd.split(' ')
  const baseCmd = pipArgs[0]
  const baseArgs = pipArgs.slice(1)

  // Try with --break-system-packages flag
  let result = await execa(
    baseCmd,
    [...baseArgs, 'install', '--user', '--break-system-packages', 'ruff'],
    { reject: false, timeout: 120000 },
  )

  if (result.exitCode !== 0) {
    // Fall back to --user only
    result = await execa(baseCmd, [...baseArgs, 'install', '--user', 'ruff'], {
      reject: false,
      timeout: 120000,
    })
  }

  if (result.exitCode !== 0) {
    // Fall back to plain install
    result = await execa(baseCmd, [...baseArgs, 'install', 'ruff'], {
      reject: false,
      timeout: 120000,
    })
  }

  if (result.exitCode !== 0) {
    logger.warn(
      `Could not install ruff automatically. Please run: ${pipCmd} install ruff`,
    )
    return false
  }

  logger.success('ruff installed successfully')
  return true
}

async function installSetuptools(): Promise<boolean> {
  // Check if distutils is available
  const pythonCmd = (await checkCommand('python3')) ? 'python3' : 'python'
  const hasDistutils = await execa(pythonCmd, ['-c', 'import distutils'], {
    reject: false,
    timeout: 10000,
  })

  if (hasDistutils.exitCode === 0) {
    return true
  }

  const pipCmd = await findPipCommand()
  if (!pipCmd) {
    return true // Not critical, skip silently
  }

  logger.step('Installing Python setuptools for distutils...')

  const pipArgs = pipCmd.split(' ')
  const baseCmd = pipArgs[0]
  const baseArgs = pipArgs.slice(1)

  // Try with --break-system-packages first
  let result = await execa(
    baseCmd,
    [...baseArgs, 'install', '--user', '--break-system-packages', 'setuptools'],
    { reject: false, timeout: 120000 },
  )

  if (result.exitCode !== 0) {
    result = await execa(
      baseCmd,
      [...baseArgs, 'install', '--user', 'setuptools'],
      { reject: false, timeout: 120000 },
    )
  }

  if (result.exitCode !== 0) {
    result = await execa(baseCmd, [...baseArgs, 'install', 'setuptools'], {
      reject: false,
      timeout: 120000,
    })
  }

  return result.exitCode === 0
}

export const setupCommand = new Command('setup')
  .description('Install required development tools (Rust, ruff, etc.)')
  .option('--rust', 'Install only Rust/Cargo')
  .option('--ruff', 'Install only ruff Python linter')
  .option('--setuptools', 'Install only Python setuptools')
  .addHelpText(
    'after',
    `
Examples:
  ${chalk.cyan('jeju setup')}              Install all development tools
  ${chalk.cyan('jeju setup --rust')}       Install only Rust/Cargo
  ${chalk.cyan('jeju setup --ruff')}       Install only ruff Python linter
`,
  )
  .action(
    async (options: {
      rust?: boolean
      ruff?: boolean
      setuptools?: boolean
    }) => {
      const os = detectOS()
      logger.header('SETUP DEVELOPMENT TOOLS')
      logger.info(`Detected OS: ${os}`)

      await sourceCargoEnv()

      const installAll = !options.rust && !options.ruff && !options.setuptools
      let success = true

      if (installAll || options.rust) {
        const rustOk = await installRust(os)
        if (!rustOk) success = false
      }

      if (installAll || options.ruff) {
        const ruffOk = await installRuff()
        if (!ruffOk) success = false
      }

      if (installAll || options.setuptools) {
        await installSetuptools()
      }

      if (success) {
        logger.success('All development tools ready.')
      } else {
        logger.warn('Some tools could not be installed. See above for details.')
      }
    },
  )
