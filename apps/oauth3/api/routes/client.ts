/**
 * Client registration routes
 */

import type { AuthProvider } from '@jejunetwork/auth'
import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { isAddress, keccak256, toBytes, toHex } from 'viem'
import type { AuthConfig, RegisteredClient } from '../../lib/types'
import { clientState } from '../services/state'

const AuthProviderValues = [
  'wallet',
  'farcaster',
  'github',
  'google',
  'twitter',
  'discord',
  'apple',
  'email',
  'phone',
] as const

const RegisterClientBodySchema = t.Object({
  name: t.String(),
  redirectUris: t.Array(t.String()),
  allowedProviders: t.Optional(
    t.Array(t.Union(AuthProviderValues.map((p) => t.Literal(p)))),
  ),
  owner: t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
})

const UpdateClientBodySchema = t.Object({
  name: t.Optional(t.String()),
  redirectUris: t.Optional(t.Array(t.String())),
  allowedProviders: t.Optional(
    t.Array(t.Union(AuthProviderValues.map((p) => t.Literal(p)))),
  ),
  active: t.Optional(t.Boolean()),
})

export function createClientRouter(_config: AuthConfig) {
  return new Elysia({ name: 'client', prefix: '/client' })
    .post(
      '/register',
      async ({ body, set }) => {
        if (!isAddress(body.owner)) {
          set.status = 400
          return { error: 'invalid_owner_address' }
        }

        const owner: Address = body.owner
        const clientId = crypto.randomUUID()
        const clientSecret = toHex(
          toBytes(keccak256(toBytes(`${clientId}:${Date.now()}:${owner}`))),
        ) as Hex

        const client: RegisteredClient = {
          clientId,
          clientSecret,
          name: body.name,
          redirectUris: body.redirectUris,
          allowedProviders: (body.allowedProviders ?? [
            'wallet',
            'farcaster',
            'github',
            'google',
          ]) as AuthProvider[],
          owner: owner,
          createdAt: Date.now(),
          active: true,
        }

        await clientState.save(client)

        return {
          clientId,
          clientSecret,
          name: client.name,
          redirectUris: client.redirectUris,
          allowedProviders: client.allowedProviders,
          createdAt: client.createdAt,
        }
      },
      { body: RegisterClientBodySchema },
    )

    .get('/:clientId', async ({ params, set }) => {
      const client = await clientState.get(params.clientId)
      if (!client) {
        set.status = 404
        return { error: 'client_not_found' }
      }

      return {
        clientId: client.clientId,
        name: client.name,
        redirectUris: client.redirectUris,
        allowedProviders: client.allowedProviders,
        owner: client.owner,
        createdAt: client.createdAt,
        active: client.active,
      }
    })

    .patch(
      '/:clientId',
      async ({ params, body, set }) => {
        const client = await clientState.get(params.clientId)
        if (!client) {
          set.status = 404
          return { error: 'client_not_found' }
        }

        if (body.name !== undefined) client.name = body.name
        if (body.redirectUris !== undefined)
          client.redirectUris = body.redirectUris
        if (body.allowedProviders !== undefined)
          client.allowedProviders = body.allowedProviders as AuthProvider[]
        if (body.active !== undefined) client.active = body.active

        await clientState.save(client)

        return {
          clientId: client.clientId,
          name: client.name,
          redirectUris: client.redirectUris,
          allowedProviders: client.allowedProviders,
          active: client.active,
        }
      },
      { body: UpdateClientBodySchema },
    )

    .delete('/:clientId', async ({ params, set }) => {
      const client = await clientState.get(params.clientId)
      if (!client) {
        set.status = 404
        return { error: 'client_not_found' }
      }

      await clientState.delete(params.clientId)
      return { success: true }
    })

    .post('/:clientId/rotate-secret', async ({ params, set }) => {
      const client = await clientState.get(params.clientId)
      if (!client) {
        set.status = 404
        return { error: 'client_not_found' }
      }

      const newSecret = toHex(
        toBytes(
          keccak256(
            toBytes(`${params.clientId}:${Date.now()}:${client.owner}`),
          ),
        ),
      ) as Hex
      client.clientSecret = newSecret
      await clientState.save(client)

      return {
        clientId: client.clientId,
        clientSecret: newSecret,
      }
    })
}
