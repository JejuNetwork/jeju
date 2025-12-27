/**
 * Manifest signing and verification commands
 *
 * Provides GPG-style signing for deployment manifests to ensure
 * integrity and authenticity of deployments.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import type { z } from 'zod'
import { resolvePrivateKey } from '../lib/keys'
import { logger } from '../lib/logger'
import {
  getManifestFingerprint,
  SignedManifestSchema,
  signManifestFile,
  TrustedSignersSchema,
  verifyManifestFile,
} from '../lib/manifest-signing'
import type { NetworkType } from '../types'

export const manifestCommand = new Command('manifest')
  .description('Sign and verify deployment manifests')
  .addCommand(createSignCommand())
  .addCommand(createVerifyCommand())
  .addCommand(createInspectCommand())
  .addCommand(createTrustedSignersCommand())

function createSignCommand(): Command {
  return new Command('sign')
    .description('Sign a deployment manifest')
    .argument('<manifest>', 'Path to manifest file')
    .option('-o, --output <path>', 'Output path for signed manifest')
    .option('--network <network>', 'Network for key resolution', 'localnet')
    .option('--key <key>', 'Private key (hex) or path to key file')
    .option('--purpose <purpose>', 'Purpose description for signature')
    .option('--signed-by <name>', 'Name of signer (for metadata)')
    .action(async (manifestPath: string, options) => {
      logger.header('SIGN MANIFEST')

      const resolvedPath = resolve(manifestPath)
      if (!existsSync(resolvedPath)) {
        logger.error(`Manifest not found: ${resolvedPath}`)
        process.exit(1)
      }

      logger.keyValue('Manifest', resolvedPath)

      // Resolve private key
      let privateKey: `0x${string}`
      if (options.key) {
        if (options.key.startsWith('0x')) {
          privateKey = options.key as `0x${string}`
        } else if (existsSync(options.key)) {
          const keyContent = readFileSync(options.key, 'utf-8').trim()
          privateKey = keyContent as `0x${string}`
        } else {
          logger.error('Invalid key: must be hex string or path to key file')
          process.exit(1)
        }
      } else {
        const network = options.network as NetworkType
        privateKey = resolvePrivateKey(network) as `0x${string}`
      }

      logger.step('Signing manifest...')

      const outputPath = await signManifestFile(
        resolvedPath,
        privateKey,
        options.output,
        {
          signedBy: options.signedBy,
          purpose: options.purpose,
          network: options.network,
        },
      )

      // Show fingerprint
      const manifest = JSON.parse(
        readFileSync(resolvedPath, 'utf-8'),
      ) as Record<string, unknown>
      const fingerprint = getManifestFingerprint(manifest)

      logger.newline()
      logger.success('Manifest signed successfully')
      logger.keyValue('Output', outputPath)
      logger.keyValue('Fingerprint', fingerprint)
    })
}

function createVerifyCommand(): Command {
  return new Command('verify')
    .description('Verify a signed manifest')
    .argument('<manifest>', 'Path to signed manifest file')
    .option('--trusted-signers <path>', 'Path to trusted signers config')
    .option('--require-trusted', 'Require signer to be in trusted list', false)
    .action(async (manifestPath: string, options) => {
      logger.header('VERIFY MANIFEST')

      const resolvedPath = resolve(manifestPath)
      if (!existsSync(resolvedPath)) {
        logger.error(`Manifest not found: ${resolvedPath}`)
        process.exit(1)
      }

      logger.keyValue('Manifest', resolvedPath)
      logger.step('Verifying signature...')

      try {
        const result = await verifyManifestFile(
          resolvedPath,
          options.trustedSigners,
        )

        logger.newline()
        if (result.valid) {
          logger.success('Signature verified')
          logger.keyValue('Signer', result.signer)

          const fingerprint = getManifestFingerprint(result.manifest)
          logger.keyValue('Fingerprint', fingerprint)
        } else {
          logger.error('Signature verification failed')
          if (result.error) {
            logger.error(result.error)
          }
          process.exit(1)
        }
      } catch (error) {
        logger.error(
          `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
        process.exit(1)
      }
    })
}

function createInspectCommand(): Command {
  return new Command('inspect')
    .description('Inspect a signed manifest without verifying')
    .argument('<manifest>', 'Path to signed manifest file')
    .action(async (manifestPath: string) => {
      logger.header('INSPECT SIGNED MANIFEST')

      const resolvedPath = resolve(manifestPath)
      if (!existsSync(resolvedPath)) {
        logger.error(`Manifest not found: ${resolvedPath}`)
        process.exit(1)
      }

      const content = readFileSync(resolvedPath, 'utf-8')
      const rawData = JSON.parse(content) as unknown
      const result = SignedManifestSchema.safeParse(rawData)

      if (!result.success) {
        logger.error('Not a valid signed manifest')
        logger.error(result.error.message)
        process.exit(1)
      }

      const { manifest, signature, metadata } = result.data
      const fingerprint = getManifestFingerprint(manifest)

      logger.newline()
      logger.keyValue('Fingerprint', fingerprint)
      logger.keyValue('Signer', signature.signer)
      logger.keyValue('Signed At', signature.timestamp)
      logger.keyValue('Algorithm', signature.algorithm)
      logger.keyValue('Version', signature.version)

      if (metadata) {
        logger.newline()
        logger.subheader('Metadata')
        if (metadata.signedBy) logger.keyValue('Signed By', metadata.signedBy)
        if (metadata.purpose) logger.keyValue('Purpose', metadata.purpose)
        if (metadata.network) logger.keyValue('Network', metadata.network)
      }

      logger.newline()
      logger.subheader('Manifest Contents')
      logger.info(`${JSON.stringify(manifest, null, 2).slice(0, 500)}...`)
    })
}

function createTrustedSignersCommand(): Command {
  const cmd = new Command('trusted-signers').description(
    'Manage trusted signers',
  )

  cmd
    .command('init')
    .description('Initialize trusted signers config')
    .argument('<path>', 'Path to create config')
    .action((configPath: string) => {
      const resolvedPath = resolve(configPath)

      if (existsSync(resolvedPath)) {
        logger.error(`Config already exists: ${resolvedPath}`)
        process.exit(1)
      }

      const config: z.infer<typeof TrustedSignersSchema> = {
        signers: [],
        requireSignature: false,
      }

      writeFileSync(resolvedPath, JSON.stringify(config, null, 2))
      logger.success(`Created trusted signers config: ${resolvedPath}`)
    })

  cmd
    .command('add')
    .description('Add a trusted signer')
    .argument('<config>', 'Path to trusted signers config')
    .requiredOption('-a, --address <address>', 'Signer address (0x...)')
    .requiredOption('-n, --name <name>', 'Signer name')
    .option(
      '-r, --role <role>',
      'Signer role (deployer, admin, ci)',
      'deployer',
    )
    .action(
      (
        configPath: string,
        options: { address: string; name: string; role: string },
      ) => {
        const resolvedPath = resolve(configPath)

        if (!existsSync(resolvedPath)) {
          logger.error(`Config not found: ${resolvedPath}`)
          process.exit(1)
        }

        const content = readFileSync(resolvedPath, 'utf-8')
        const config = TrustedSignersSchema.parse(JSON.parse(content))

        // Check if address already exists
        if (
          config.signers.some(
            (s) => s.address.toLowerCase() === options.address.toLowerCase(),
          )
        ) {
          logger.error('Signer already exists')
          process.exit(1)
        }

        config.signers.push({
          address: options.address,
          name: options.name,
          role: options.role as 'deployer' | 'admin' | 'ci',
          addedAt: new Date().toISOString(),
        })

        writeFileSync(resolvedPath, JSON.stringify(config, null, 2))
        logger.success(
          `Added trusted signer: ${options.name} (${options.address})`,
        )
      },
    )

  cmd
    .command('list')
    .description('List trusted signers')
    .argument('<config>', 'Path to trusted signers config')
    .action((configPath: string) => {
      const resolvedPath = resolve(configPath)

      if (!existsSync(resolvedPath)) {
        logger.error(`Config not found: ${resolvedPath}`)
        process.exit(1)
      }

      const content = readFileSync(resolvedPath, 'utf-8')
      const config = TrustedSignersSchema.parse(JSON.parse(content))

      logger.header('TRUSTED SIGNERS')
      logger.keyValue('Require Signature', String(config.requireSignature))

      if (config.signers.length === 0) {
        logger.info('No trusted signers configured')
        return
      }

      logger.newline()
      for (const signer of config.signers) {
        logger.info(`• ${signer.name}`)
        logger.keyValue('  Address', signer.address)
        logger.keyValue('  Role', signer.role)
        logger.keyValue('  Added', signer.addedAt)
        logger.newline()
      }
    })

  cmd
    .command('remove')
    .description('Remove a trusted signer')
    .argument('<config>', 'Path to trusted signers config')
    .requiredOption('-a, --address <address>', 'Signer address to remove')
    .action((configPath: string, options: { address: string }) => {
      const resolvedPath = resolve(configPath)

      if (!existsSync(resolvedPath)) {
        logger.error(`Config not found: ${resolvedPath}`)
        process.exit(1)
      }

      const content = readFileSync(resolvedPath, 'utf-8')
      const config = TrustedSignersSchema.parse(JSON.parse(content))

      const initialCount = config.signers.length
      config.signers = config.signers.filter(
        (s) => s.address.toLowerCase() !== options.address.toLowerCase(),
      )

      if (config.signers.length === initialCount) {
        logger.error('Signer not found')
        process.exit(1)
      }

      writeFileSync(resolvedPath, JSON.stringify(config, null, 2))
      logger.success(`Removed signer: ${options.address}`)
    })

  return cmd
}
