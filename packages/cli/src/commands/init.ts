/** Create a new dApp from template */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join, normalize, relative, resolve } from 'node:path'
import { getLocalhostHost } from '@jejunetwork/config'
import chalk from 'chalk'
import { Command } from 'commander'
import { execa } from 'execa'
import prompts from 'prompts'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { validateAppName } from '../lib/security'
import { findMonorepoRoot } from '../lib/system'
import { validate } from '../schemas'

const TemplatePackageJsonSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    version: z.string().optional(),
    scripts: z.record(z.string(), z.string()).optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
    peerDependencies: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()

interface InitConfig {
  name: string
  displayName: string
  jnsName: string
  databaseId: string
  description: string
  x402Enabled: boolean
  oauth3Enabled: boolean
  oauth3AppId: string
  outputDir: string
  template: 'worker' | 'frontend'
}

type TemplateType = 'worker' | 'frontend'

const TEMPLATE_PATHS: Record<TemplateType, string> = {
  worker: join(import.meta.dir, '../../templates/worker'),
  frontend: join(import.meta.dir, '../../templates/frontend'),
}

const vendorSubcommand = new Command('vendor')
  .description('Create vendor app manifest')
  .argument('<app-name>', 'Vendor app name')
  .action(async (appName) => {
    await createVendorManifest(appName)
  })

async function createVendorManifest(appName: string): Promise<void> {
  const rootDir = findMonorepoRoot()
  const scriptPath = join(
    rootDir,
    'packages/deployment/scripts/infrastructure/create-vendor-manifest.ts',
  )

  if (!existsSync(scriptPath)) {
    logger.error('Vendor manifest script not found')
    return
  }

  await execa('bun', ['run', scriptPath, appName], {
    cwd: rootDir,
    stdio: 'inherit',
  })
}

export const initCommand = new Command('init')
  .description('Create a new decentralized app from template')
  .addCommand(vendorSubcommand)
  .argument('[name]', 'App name (e.g., my-app)')
  .option('-d, --dir <directory>', 'Output directory')
  .option('-y, --yes', 'Skip prompts and use defaults')
  .option('--no-x402', 'Disable x402 payment support')
  .option('-t, --template <template>', 'Template type (worker, frontend)')
  .addHelpText(
    'after',
    `
Templates:
  ${chalk.cyan('worker')}      Worker only (Elysia API, deploy to DWS)
  ${chalk.cyan('frontend')}    Frontend only (React, deploy to IPFS)

Examples:
  ${chalk.cyan('jeju init my-api -t worker')}        Create worker-only project
  ${chalk.cyan('jeju init my-site -t frontend')}     Create frontend-only project
  ${chalk.cyan('jeju init my-app -d ./projects')}    Create in specific directory
  ${chalk.cyan('jeju init -y')}                      Quick create with defaults
  ${chalk.cyan('jeju init vendor my-app')}           Create vendor app manifest
`,
  )
  .action(
    async (
      nameArg: string | undefined,
      options: {
        dir?: string
        yes?: boolean
        x402?: boolean
        template?: TemplateType
      },
    ) => {
      logger.header('CREATE NEW PROJECT')

      let config: InitConfig

      if (options.yes && nameArg) {
        const validName = validateAppName(nameArg)
        const template = options.template ?? 'worker'

        const outputDir = resolve(
          normalize(options.dir || join(process.cwd(), validName)),
        )

        // Ensure output is under cwd for safety
        const cwd = resolve(process.cwd())
        if (!outputDir.startsWith(cwd) && !options.dir) {
          throw new Error(
            'Output directory must be within current working directory',
          )
        }

        config = {
          name: validName,
          displayName: formatDisplayName(validName),
          jnsName: `${validName}.jeju`,
          databaseId: `${validName}-db`,
          description: `A decentralized ${validName} application`,
          x402Enabled: options.x402 !== false,
          oauth3Enabled: false,
          oauth3AppId: '',
          outputDir,
          template,
        }
      } else {
        // Interactive prompts
        const answers = await prompts([
          {
            type: 'select',
            name: 'template',
            message: 'Project template:',
            choices: [
              { title: 'Worker only (API, deploy to DWS)', value: 'worker' },
              {
                title: 'Frontend only (React, deploy to IPFS)',
                value: 'frontend',
              },
            ],
            initial: options.template === 'frontend' ? 1 : 0,
          },
          {
            type: 'text',
            name: 'name',
            message: 'Project name (lowercase, hyphens allowed):',
            initial: nameArg || 'my-dapp',
            validate: (value: string) => {
              try {
                validateAppName(value)
                return true
              } catch (err) {
                return (err as Error).message
              }
            },
          },
          {
            type: 'text',
            name: 'displayName',
            message: 'Display name:',
            initial: (prev: string) => formatDisplayName(prev),
          },
          {
            type: 'text',
            name: 'description',
            message: 'Description:',
            initial: (_prev: string, values: { name: string }) =>
              `A decentralized ${values.name} application`,
          },
          {
            type: 'text',
            name: 'jnsName',
            message: 'JNS domain name:',
            initial: (_prev: string, values: { name: string }) =>
              `${values.name}.jeju`,
          },
          {
            type: (_prev: string, values: { template: TemplateType }) =>
              values.template !== 'frontend' ? 'text' : null,
            name: 'databaseId',
            message: 'Database ID:',
            initial: (_prev: string, values: { name: string }) =>
              `${values.name}-db`,
          },
          {
            type: (_prev: string, values: { template: TemplateType }) =>
              values.template !== 'frontend' ? 'confirm' : null,
            name: 'x402Enabled',
            message: 'Enable x402 payments?',
            initial: true,
          },
          {
            type: null, // OAuth3 app ID prompt disabled - not currently used
            name: 'oauth3AppId',
            message: 'OAuth3 App ID:',
            initial: '',
          },
          {
            type: 'text',
            name: 'outputDir',
            message: 'Output directory:',
            initial: (_prev: string, values: { name: string }) =>
              options.dir || join(process.cwd(), values.name),
          },
        ])

        if (!answers.name) {
          logger.error('Setup cancelled')
          process.exit(1)
        }

        // Set defaults for non-prompted fields
        if (answers.template === 'frontend') {
          answers.databaseId = ''
          answers.x402Enabled = false
        }
        // Validate and resolve output directory
        answers.outputDir = resolve(normalize(answers.outputDir))

        // Build config with defaults for non-prompted fields
        config = {
          name: answers.name,
          displayName: answers.displayName,
          description: answers.description,
          jnsName: answers.jnsName,
          databaseId: answers.databaseId ?? '',
          x402Enabled: answers.x402Enabled ?? false,
          oauth3Enabled: false, // OAuth3 not currently prompted
          oauth3AppId: '',
          outputDir: answers.outputDir,
          template: answers.template as 'worker' | 'frontend',
        }
      }

      // Verify template exists
      const templatePath = TEMPLATE_PATHS[config.template]
      if (!existsSync(templatePath)) {
        logger.error(`Template not found at ${templatePath}`)
        logger.info(`Make sure the ${config.template} template exists`)
        process.exit(1)
      }

      if (existsSync(config.outputDir)) {
        const files = readdirSync(config.outputDir)
        if (files.length > 0) {
          const { overwrite } = await prompts({
            type: 'confirm',
            name: 'overwrite',
            message: `Directory ${config.outputDir} is not empty. Overwrite?`,
            initial: false,
          })

          if (!overwrite) {
            logger.info('Cancelled')
            process.exit(0)
          }
        }
      }

      logger.step(
        `Creating ${config.displayName} (${config.template} template)...`,
      )

      mkdirSync(config.outputDir, { recursive: true })

      await copyTemplate(templatePath, config.outputDir, config)

      await generateCustomFiles(config)

      logger.success(`\nCreated ${config.displayName} at ${config.outputDir}`)

      // Print next steps based on template
      console.log(chalk.bold('\nNext steps:\n'))
      console.log(
        `  ${chalk.cyan('cd')} ${relative(process.cwd(), config.outputDir)}`,
      )
      console.log(`  ${chalk.cyan('bun install')}`)

      const host = getLocalhostHost()

      if (config.template === 'worker') {
        console.log(
          `  ${chalk.cyan('bun run dev')}      # Start worker with hot reload`,
        )

        console.log(chalk.bold('\nTo deploy:\n'))
        console.log(`  ${chalk.cyan('jeju login')}       # Authenticate`)
        console.log(`  ${chalk.cyan('jeju publish')}     # Deploy to DWS`)

        console.log(chalk.bold('\nEndpoints:\n'))
        console.log(`  API:        http://${host}:8787/api`)
        console.log(`  Health:     http://${host}:8787/health`)
      } else if (config.template === 'frontend') {
        console.log(
          `  ${chalk.cyan('bun run dev')}      # Start Vite dev server`,
        )

        console.log(chalk.bold('\nTo deploy:\n'))
        console.log(`  ${chalk.cyan('jeju login')}       # Authenticate`)
        console.log(
          `  ${chalk.cyan('jeju publish')}     # Deploy to IPFS via DWS`,
        )

        console.log(chalk.bold('\nEndpoints:\n'))
        console.log(`  Dev:        http://${host}:5173`)
      }

      console.log(
        chalk.dim(`\nDocumentation: https://docs.jejunetwork.org/templates\n`),
      )
    },
  )

function formatDisplayName(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

async function copyTemplate(
  templateDir: string,
  outputDir: string,
  config: InitConfig,
): Promise<void> {
  const skipFiles = ['node_modules', '.git', 'dist', 'bun.lockb', '.turbo']

  const resolvedTemplateDir = resolve(templateDir)
  const resolvedOutputDir = resolve(outputDir)

  function copyRecursive(src: string, dest: string) {
    // Ensure src is within template directory
    const resolvedSrc = resolve(src)
    if (!resolvedSrc.startsWith(resolvedTemplateDir)) {
      throw new Error('Path traversal detected in template')
    }

    // Ensure dest is within output directory
    const resolvedDest = resolve(dest)
    if (!resolvedDest.startsWith(resolvedOutputDir)) {
      throw new Error('Path traversal detected in output')
    }

    // SECURITY: Check for symlinks to prevent symlink attacks
    // Use lstatSync (doesn't follow symlinks) instead of statSync
    const lstat = lstatSync(resolvedSrc)

    // Reject symlinks entirely to prevent attacks that could read/write outside directories
    if (lstat.isSymbolicLink()) {
      throw new Error(`Symlink not allowed in template: ${resolvedSrc}`)
    }

    if (lstat.isDirectory()) {
      const baseName = resolvedSrc.split('/').pop() || ''
      if (skipFiles.includes(baseName)) return

      mkdirSync(resolvedDest, { recursive: true })
      const files = readdirSync(resolvedSrc)

      for (const file of files) {
        // Skip files with suspicious names
        if (file.includes('..') || file.includes('\0')) continue
        copyRecursive(join(resolvedSrc, file), join(resolvedDest, file))
      }
    } else if (lstat.isFile()) {
      // Only process regular files, not special files (devices, sockets, etc.)
      let content = readFileSync(resolvedSrc, 'utf-8')
      content = transformContent(content, config)
      writeFileSync(resolvedDest, content)
    }
    // Skip any other file types (devices, sockets, etc.) silently
  }

  copyRecursive(resolvedTemplateDir, resolvedOutputDir)
}

function transformContent(content: string, config: InitConfig): string {
  // Handle {{PLACEHOLDER}} style replacements (worker/frontend templates)
  return content
    .replace(/\{\{APP_NAME\}\}/g, config.name)
    .replace(/\{\{DISPLAY_NAME\}\}/g, config.displayName)
    .replace(/\{\{DESCRIPTION\}\}/g, config.description)
    .replace(/\{\{JNS_NAME\}\}/g, config.jnsName)
    .replace(/\{\{DATABASE_ID\}\}/g, config.databaseId || '')
}

async function generateCustomFiles(config: InitConfig): Promise<void> {
  const host = getLocalhostHost()

  // For worker/frontend templates, the placeholders are already replaced during copy
  // We just need to finalize the package.json name
  const packageJsonPath = join(config.outputDir, 'package.json')
  if (existsSync(packageJsonPath)) {
    const rawPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
    const packageJson = validate(
      rawPackageJson,
      TemplatePackageJsonSchema,
      `template package.json at ${packageJsonPath}`,
    )

    // For worker/frontend templates, name is already set via placeholder
    packageJson.description = config.description

    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))
  }

  // Generate .env.example based on template type
  let envContent = ''

  if (config.template === 'worker') {
    envContent = `# ${config.displayName} Configuration

# Server
PORT=8787
APP_NAME="${config.displayName}"

# Network
NETWORK=localnet
L2_RPC_URL=http://${host}:6546

# Services
SQLIT_BLOCK_PRODUCER_ENDPOINT=http://${host}:4661
SQLIT_DATABASE_ID=${config.databaseId}
DWS_URL=http://${host}:4030

# x402 Payments
X402_ENABLED=${config.x402Enabled}
X402_PAYMENT_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# Deployment
DEPLOYER_PRIVATE_KEY=
JNS_NAME=${config.jnsName}
`
  } else if (config.template === 'frontend') {
    envContent = `# ${config.displayName} Configuration

# Network
VITE_NETWORK=localnet
VITE_RPC_URL=http://${host}:6546
VITE_DWS_URL=http://${host}:4030

# JNS
VITE_JNS_NAME=${config.jnsName}

# Deployment
DEPLOYER_PRIVATE_KEY=
`
  }

  writeFileSync(join(config.outputDir, '.env.example'), envContent)
}
