/**
 * JNS Name Service Actions
 * Register names, resolve, reverse lookup
 */

import { expectNonEmpty, expectPositive } from '../../lib/validation'
import { jnsService } from '../../services'
import type { ActionContext, ActionResult } from './wallet-info'

export const registerNameAction = {
  name: 'REGISTER_JNS_NAME',
  description: 'Register a .jeju name for the wallet address',
  similes: ['REGISTER_NAME', 'GET_JNS', 'BUY_NAME', 'REGISTER_JEJU'],

  async execute(
    context: ActionContext,
    params?: { name?: string; years?: number },
  ): Promise<ActionResult> {
    const { walletService, logger } = context

    const state = walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    if (!params?.name) {
      return {
        success: false,
        message:
          'Please provide a name to register. Example: "register myname.jeju"',
      }
    }

    const name = params.name.replace('.jeju', '')
    expectNonEmpty(name, 'name')
    if (name.length < 3) {
      return { success: false, message: 'Name must be at least 3 characters.' }
    }

    logger.info(`[JNS] Checking availability: ${name}`)

    if (params.years) expectPositive(params.years, 'years')
    const pricing = await jnsService.getPrice(name, params.years || 1)

    if (!pricing.available) {
      return {
        success: false,
        message: `${name}.jeju is already registered. Try a different name.`,
      }
    }

    const priceEth = Number(pricing.price) / 1e18

    return {
      success: true,
      message: `**Register ${name}.jeju**\n\nPrice: ${priceEth.toFixed(4)} ETH per year\nDuration: ${params.years || 1} year(s)\n\nConfirm to proceed with registration.`,
      data: {
        requiresConfirmation: true,
        action: 'registerName',
        name,
        duration: pricing.duration,
        price: pricing.price.toString(),
      },
    }
  },
}

export const resolveNameAction = {
  name: 'RESOLVE_JNS_NAME',
  description: 'Resolve a .jeju name to an address',
  similes: ['RESOLVE_NAME', 'LOOKUP_NAME', 'FIND_ADDRESS', 'WHO_IS'],

  async execute(
    _context: ActionContext,
    params?: { name?: string },
  ): Promise<ActionResult> {
    if (!params?.name) {
      return {
        success: false,
        message:
          'Please provide a name to resolve. Example: "resolve alice.jeju"',
      }
    }

    const name = params.name
    expectNonEmpty(name, 'name')
    const address = await jnsService.resolve(name)

    if (!address) {
      return {
        success: false,
        message: `${name.endsWith('.jeju') ? name : `${name}.jeju`} is not registered.`,
      }
    }

    const info = await jnsService.getNameInfo(name)
    let response = `**${name.endsWith('.jeju') ? name : `${name}.jeju`}**\n\nAddress: \`${address}\``

    if (info?.description) response += `\nDescription: ${info.description}`
    if (info?.expiresAt)
      response += `\nExpires: ${new Date(info.expiresAt).toLocaleDateString()}`

    return { success: true, message: response }
  },
}

export const setNameAction = {
  name: 'SET_PRIMARY_NAME',
  description: 'Set the primary .jeju name for your address',
  similes: ['SET_NAME', 'SET_PRIMARY', 'USE_NAME', 'MY_NAME'],

  async execute(
    context: ActionContext,
    params?: { name?: string },
  ): Promise<ActionResult> {
    const state = context.walletService.getState()
    if (!state.currentAccount) {
      return { success: false, message: 'Please connect your wallet first.' }
    }

    if (!params?.name) {
      return {
        success: false,
        message:
          'Please provide the name to set. Example: "set primary name alice.jeju"',
      }
    }

    expectNonEmpty(params.name, 'name')
    const tx = jnsService.buildSetPrimaryNameTx(params.name)
    if (!tx) {
      return {
        success: false,
        message: 'JNS contracts not configured on this network.',
      }
    }

    const fullName = params.name.endsWith('.jeju')
      ? params.name
      : `${params.name}.jeju`

    return {
      success: true,
      message: `Setting ${fullName} as your primary name. This enables reverse lookups from your address.`,
      data: {
        requiresConfirmation: true,
        action: 'setPrimaryName',
        name: params.name,
        tx,
      },
    }
  },
}
