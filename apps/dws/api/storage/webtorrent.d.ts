/**
 * Type declarations for webtorrent module
 */

declare module 'webtorrent' {
  import { EventEmitter } from 'node:events'

  interface TorrentFile {
    name: string
    path: string
    length: number
    createReadStream(): NodeJS.ReadableStream
  }

  interface Torrent extends EventEmitter {
    infoHash: string
    magnetURI: string
    name: string
    length: number
    files: TorrentFile[]
    done: boolean
    paused: boolean
    downloaded: number
    uploaded: number
    downloadSpeed: number
    uploadSpeed: number
    ratio: number
    numPeers: number
    progress: number
    pause(): void
    resume(): void
  }

  interface WebTorrentOptions {
    dht?: boolean
    downloadLimit?: number
    uploadLimit?: number
    maxConns?: number
  }

  interface AddOptions {
    path?: string
    announce?: string[]
  }

  interface SeedOptions {
    name?: string
    announce?: string[]
    comment?: string
  }

  interface RemoveOptions {
    destroyStore?: boolean
  }

  class WebTorrent extends EventEmitter {
    destroyed: boolean
    torrents: Torrent[]

    constructor(opts?: WebTorrentOptions)

    seed(
      path: string | Buffer,
      opts?: SeedOptions,
      cb?: (torrent: Torrent) => void,
    ): Torrent

    add(
      magnetUri: string,
      opts?: AddOptions,
      cb?: (torrent: Torrent) => void,
    ): Torrent

    get(infoHash: string): Torrent | null

    remove(
      infoHash: string,
      opts?: RemoveOptions,
      cb?: (err: Error | null) => void,
    ): void

    destroy(cb?: () => void): void
  }

  export default WebTorrent
}
