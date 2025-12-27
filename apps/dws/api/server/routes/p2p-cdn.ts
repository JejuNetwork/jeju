/**
 * P2P CDN API Routes
 *
 * Endpoints for the hybrid CDN that combines edge caching with WebTorrent P2P.
 * Allows querying P2P status, managing magnet URIs, and viewing swarm stats.
 */

import { Elysia, t } from 'elysia'
import { getWebTorrentBackend } from '../../storage/webtorrent-backend'

export function createP2PCDNRouter(): Elysia {
  return (
    new Elysia({ prefix: '/p2p' })
      // =========================================================================
      // Swarm Status
      // =========================================================================
      .get('/status', async () => {
        const webtorrent = getWebTorrentBackend()
        const stats = webtorrent.getNodeStats()
        const healthy = await webtorrent.healthCheck()

        return {
          status: healthy ? 'healthy' : 'degraded',
          swarm: {
            activeTorrents: stats.activeTorrents ?? 0,
            seedingTorrents: stats.seedingTorrents ?? 0,
            downloadingTorrents: stats.downloadingTorrents ?? 0,
            peersConnected: stats.peersConnected ?? 0,
          },
          bandwidth: {
            bytesServed24h: stats.bytesServed24h ?? 0,
          },
          content: {
            system: {
              count: stats.systemContentCount ?? 0,
              size: stats.systemContentSize ?? 0,
            },
            popular: {
              count: stats.popularContentCount ?? 0,
              size: stats.popularContentSize ?? 0,
            },
            private: {
              count: stats.privateContentCount ?? 0,
              size: stats.privateContentSize ?? 0,
            },
          },
        }
      })

      // =========================================================================
      // Magnet URIs
      // =========================================================================
      .get(
        '/magnet/:cid',
        async ({ params, set }) => {
          const webtorrent = getWebTorrentBackend()
          const magnetUri = webtorrent.getMagnetUri(params.cid)

          if (!magnetUri) {
            set.status = 404
            return { error: 'Magnet URI not found for this CID' }
          }

          return {
            cid: params.cid,
            magnetUri,
          }
        },
        {
          params: t.Object({
            cid: t.String(),
          }),
        },
      )

      .post(
        '/magnet',
        async ({ body }) => {
          const { magnetUri, tier } = body as {
            magnetUri: string
            tier?: 'system' | 'popular' | 'private'
          }

          const webtorrent = getWebTorrentBackend()

          // Add the magnet to WebTorrent
          const torrent = await webtorrent.addMagnet(magnetUri, {
            tier: tier ?? 'popular',
          })

          return {
            cid: torrent.cid,
            infoHash: torrent.infoHash,
            name: torrent.name,
            size: torrent.size,
            magnetUri: torrent.magnetUri,
          }
        },
        {
          body: t.Object({
            cid: t.String(),
            magnetUri: t.String(),
            tier: t.Optional(
              t.Union([
                t.Literal('system'),
                t.Literal('popular'),
                t.Literal('private'),
              ]),
            ),
          }),
        },
      )

      // =========================================================================
      // Torrent Management
      // =========================================================================
      .get('/torrents', async () => {
        const webtorrent = getWebTorrentBackend()

        const system = webtorrent.getTorrentsByTier('system')
        const popular = webtorrent.getTorrentsByTier('popular')
        const privateContent = webtorrent.getTorrentsByTier('private')

        return {
          system: system.map((t) => ({
            cid: t.cid,
            name: t.name,
            size: t.size,
            infoHash: t.infoHash,
          })),
          popular: popular.map((t) => ({
            cid: t.cid,
            name: t.name,
            size: t.size,
            infoHash: t.infoHash,
          })),
          private: privateContent.map((t) => ({
            cid: t.cid,
            name: t.name,
            size: t.size,
            infoHash: t.infoHash,
          })),
          total: system.length + popular.length + privateContent.length,
        }
      })

      .get(
        '/torrents/:infoHash',
        async ({ params, set }) => {
          const webtorrent = getWebTorrentBackend()
          const stats = webtorrent.getTorrentStats(params.infoHash)
          const info = webtorrent.getTorrent(params.infoHash)

          if (!stats || !info) {
            set.status = 404
            return { error: 'Torrent not found' }
          }

          return {
            cid: info.cid,
            name: info.name,
            size: info.size,
            infoHash: info.infoHash,
            magnetUri: info.magnetUri,
            tier: info.tier,
            category: info.category,
            stats: {
              status: stats.status,
              progress: stats.progress,
              downloaded: stats.downloaded,
              uploaded: stats.uploaded,
              downloadSpeed: stats.downloadSpeed,
              uploadSpeed: stats.uploadSpeed,
              ratio: stats.ratio,
              peers: stats.peers,
            },
          }
        },
        {
          params: t.Object({
            infoHash: t.String(),
          }),
        },
      )

      .delete(
        '/torrents/:infoHash',
        async ({ params, set }) => {
          const webtorrent = getWebTorrentBackend()

          const info = webtorrent.getTorrent(params.infoHash)
          if (!info) {
            set.status = 404
            return { error: 'Torrent not found' }
          }

          // Don't allow deleting system content
          if (info.tier === 'system') {
            set.status = 403
            return { error: 'Cannot remove system content' }
          }

          await webtorrent.removeTorrent(params.infoHash)

          return { success: true, removed: params.infoHash }
        },
        {
          params: t.Object({
            infoHash: t.String(),
          }),
        },
      )

      // =========================================================================
      // Seeding Control
      // =========================================================================
      .post(
        '/seed/:infoHash/start',
        async ({ params, set }) => {
          const webtorrent = getWebTorrentBackend()

          const info = webtorrent.getTorrent(params.infoHash)
          if (!info) {
            set.status = 404
            return { error: 'Torrent not found' }
          }

          await webtorrent.startSeeding(params.infoHash)

          return { success: true, seeding: params.infoHash }
        },
        {
          params: t.Object({
            infoHash: t.String(),
          }),
        },
      )

      .post(
        '/seed/:infoHash/stop',
        async ({ params, set }) => {
          const webtorrent = getWebTorrentBackend()

          const info = webtorrent.getTorrent(params.infoHash)
          if (!info) {
            set.status = 404
            return { error: 'Torrent not found' }
          }

          // Don't allow stopping system content seeding
          if (info.tier === 'system') {
            set.status = 403
            return { error: 'Cannot stop seeding system content' }
          }

          await webtorrent.stopSeeding(params.infoHash)

          return { success: true, stopped: params.infoHash }
        },
        {
          params: t.Object({
            infoHash: t.String(),
          }),
        },
      )

      // =========================================================================
      // Content Upload with P2P
      // =========================================================================
      .post(
        '/seed',
        async ({ body, request }) => {
          const webtorrent = getWebTorrentBackend()

          // Get content from request body
          const arrayBuffer = await request.arrayBuffer()
          const content = Buffer.from(arrayBuffer)

          const { name, cid, tier, category } = body as {
            name?: string
            cid: string
            tier?: 'system' | 'popular' | 'private'
            category?: string
          }

          // Create torrent and start seeding
          const torrent = await webtorrent.createTorrent(content, {
            name: name ?? cid,
            cid,
            tier: tier ?? 'popular',
            category: (category ?? 'data') as
              | 'data'
              | 'app-bundle'
              | 'app-manifest'
              | 'contract-abi'
              | 'jns-record'
              | 'documentation'
              | 'user-content'
              | 'media',
          })

          return {
            cid: torrent.cid,
            infoHash: torrent.infoHash,
            magnetUri: torrent.magnetUri,
            name: torrent.name,
            size: torrent.size,
          }
        },
        {
          body: t.Object({
            name: t.Optional(t.String()),
            cid: t.String(),
            tier: t.Optional(
              t.Union([
                t.Literal('system'),
                t.Literal('popular'),
                t.Literal('private'),
              ]),
            ),
            category: t.Optional(t.String()),
          }),
        },
      )

      // =========================================================================
      // Popular Content Replication
      // =========================================================================
      .post(
        '/replicate-popular',
        async ({ body }) => {
          const webtorrent = getWebTorrentBackend()

          const { content } = body as {
            content: Array<{ cid: string; magnetUri: string; score: number }>
          }

          await webtorrent.replicatePopular(content)

          return {
            success: true,
            replicated: content.length,
          }
        },
        {
          body: t.Object({
            content: t.Array(
              t.Object({
                cid: t.String(),
                magnetUri: t.String(),
                score: t.Number(),
              }),
            ),
          }),
        },
      )

      // =========================================================================
      // Health Check
      // =========================================================================
      .get('/health', async () => {
        const webtorrent = getWebTorrentBackend()
        const healthy = await webtorrent.healthCheck()

        return {
          status: healthy ? 'healthy' : 'unhealthy',
          p2p: true,
          webtorrent: healthy,
        }
      })
  )
}
