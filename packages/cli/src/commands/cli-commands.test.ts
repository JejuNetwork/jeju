/**
 * CLI Command Tests
 *
 * Tests CLI command exports and option definitions.
 * For comprehensive API testing, see: apps/dws/api/cli/routes.test.ts
 *
 * Run with:
 *   bun test cli-commands.test.ts
 */

import { describe, expect, test } from 'bun:test'
import { Command } from 'commander'
import { loginCommand, logoutCommand, whoamiCommand } from './login'
import { accountCommand } from './account'
import { workerCommand } from './worker'
import { secretCommand } from './secret'
import { domainCommand } from './domain'
import { publishCommand } from './publish'

// ============================================================================
// Test Login Commands
// ============================================================================

describe('Login Commands', () => {
  test('loginCommand is a valid Commander command', () => {
    expect(loginCommand).toBeInstanceOf(Command)
    expect(loginCommand.name()).toBe('login')
    expect(loginCommand.description()).toContain('Authenticate')
  })

  test('loginCommand has required options', () => {
    const options = loginCommand.options.map((o) => o.long)
    expect(options).toContain('--network')
    expect(options).toContain('--private-key')
    expect(options).toContain('--hardware')
  })

  test('logoutCommand is a valid Commander command', () => {
    expect(logoutCommand).toBeInstanceOf(Command)
    expect(logoutCommand.name()).toBe('logout')
  })

  test('whoamiCommand is a valid Commander command', () => {
    expect(whoamiCommand).toBeInstanceOf(Command)
    expect(whoamiCommand.name()).toBe('whoami')
  })
})

// ============================================================================
// Test Account Commands
// ============================================================================

describe('Account Commands', () => {
  test('accountCommand is a valid Commander command', () => {
    expect(accountCommand).toBeInstanceOf(Command)
    expect(accountCommand.name()).toBe('account')
    expect(accountCommand.description()).toContain('account')
  })

  test('accountCommand has expected subcommands', () => {
    const subcommands = accountCommand.commands.map((c) => c.name())
    expect(subcommands).toContain('info')
    expect(subcommands).toContain('topup')
    expect(subcommands).toContain('balance')
    expect(subcommands).toContain('upgrade')
    expect(subcommands).toContain('usage')
  })
})

// ============================================================================
// Test Worker Commands
// ============================================================================

describe('Worker Commands', () => {
  test('workerCommand is a valid Commander command', () => {
    expect(workerCommand).toBeInstanceOf(Command)
    expect(workerCommand.name()).toBe('worker')
    expect(workerCommand.description()).toContain('worker')
  })

  test('workerCommand has expected subcommands', () => {
    const subcommands = workerCommand.commands.map((c) => c.name())
    expect(subcommands).toContain('dev')
    expect(subcommands).toContain('deploy')
    expect(subcommands).toContain('list')
    expect(subcommands).toContain('info')
    expect(subcommands).toContain('logs')
    expect(subcommands).toContain('tail')
    expect(subcommands).toContain('delete')
    expect(subcommands).toContain('rollback')
  })
})

// ============================================================================
// Test Secret Commands
// ============================================================================

describe('Secret Commands', () => {
  test('secretCommand is a valid Commander command', () => {
    expect(secretCommand).toBeInstanceOf(Command)
    expect(secretCommand.name()).toBe('secret')
    expect(secretCommand.description()).toContain('secret')
  })

  test('secretCommand has expected subcommands', () => {
    const subcommands = secretCommand.commands.map((c) => c.name())
    expect(subcommands).toContain('set')
    expect(subcommands).toContain('list')
    expect(subcommands).toContain('delete')
    expect(subcommands).toContain('pull')
    expect(subcommands).toContain('push')
  })
})

// ============================================================================
// Test Domain Commands
// ============================================================================

describe('Domain Commands', () => {
  test('domainCommand is a valid Commander command', () => {
    expect(domainCommand).toBeInstanceOf(Command)
    expect(domainCommand.name()).toBe('domain')
    expect(domainCommand.description()).toContain('domain')
  })

  test('domainCommand has expected subcommands', () => {
    const subcommands = domainCommand.commands.map((c) => c.name())
    expect(subcommands).toContain('register')
    expect(subcommands).toContain('set')
    expect(subcommands).toContain('link')
    expect(subcommands).toContain('resolve')
    expect(subcommands).toContain('list')
    expect(subcommands).toContain('transfer')
    expect(subcommands).toContain('check')
    expect(subcommands).toContain('auto')
  })
})

// ============================================================================
// Test Publish Command
// ============================================================================

describe('Publish Commands', () => {
  test('publishCommand is a valid Commander command', () => {
    expect(publishCommand).toBeInstanceOf(Command)
    expect(publishCommand.name()).toBe('publish')
    expect(publishCommand.description()).toContain('project')
  })

  test('publishCommand has required options', () => {
    const options = publishCommand.options.map((o) => o.long)
    expect(options).toContain('--dry-run')
    expect(options).toContain('--prod')
    expect(options).toContain('--preview')
  })
})
