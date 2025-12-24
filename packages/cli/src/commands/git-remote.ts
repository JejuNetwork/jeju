#!/usr/bin/env bun

/** Git remote helper for Jeju DWS */

import { createHash } from 'node:crypto'
import * as readline from 'node:readline'
import { deflateSync } from 'node:zlib'

const DWS_URL = process.env.DWS_URL || 'http://localhost:4030'

/** Validate owner format (Ethereum address or username) */
function validateOwner(owner: string): string {
  if (!owner) {
    throw new Error('Owner is required')
  }
  // Allow Ethereum addresses or alphanumeric usernames
  const ethAddressPattern = /^0x[a-fA-F0-9]{40}$/
  const usernamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

  if (!ethAddressPattern.test(owner) && !usernamePattern.test(owner)) {
    throw new Error('Invalid owner format')
  }
  return owner
}

/** Validate repository name */
function validateRepoName(name: string): string {
  if (!name) {
    throw new Error('Repository name is required')
  }
  const repoPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
  if (!repoPattern.test(name) || name.length > 100) {
    throw new Error('Invalid repository name')
  }
  return name
}

interface GitObject {
  oid: string
  type: 'blob' | 'tree' | 'commit' | 'tag'
  content: Buffer
}

export class JejuGitRemote {
  private remoteUrl: string
  private owner: string
  private repoName: string
  private refs: Map<string, string> = new Map()
  private address: string | null = null

  constructor(_remoteName: string, remoteUrl: string) {
    // Validate URL doesn't contain dangerous characters
    if (!remoteUrl || typeof remoteUrl !== 'string') {
      throw new Error('Remote URL is required')
    }

    // Reject URLs with injection attempts
    if (
      remoteUrl.includes('\n') ||
      remoteUrl.includes('\r') ||
      remoteUrl.includes('\0')
    ) {
      throw new Error('Invalid characters in remote URL')
    }

    this.remoteUrl = remoteUrl

    // Parse URL: jeju://owner/repo or http://localhost:4030/git/owner/repo
    const urlMatch = this.remoteUrl.match(/^jeju:\/\/([^/]+)\/(.+)$/)
    const httpMatch = this.remoteUrl.match(/\/git\/([^/]+)\/(.+)$/)

    if (urlMatch) {
      this.owner = validateOwner(urlMatch[1])
      this.repoName = validateRepoName(urlMatch[2])
    } else if (httpMatch) {
      this.owner = validateOwner(httpMatch[1])
      this.repoName = validateRepoName(httpMatch[2])
    } else {
      throw new Error(`Invalid Jeju remote URL: ${this.remoteUrl}`)
    }

    // Get and validate address from environment
    const envAddress = process.env.JEJU_ADDRESS
    if (envAddress) {
      const ethAddressPattern = /^0x[a-fA-F0-9]{40}$/
      if (!ethAddressPattern.test(envAddress)) {
        throw new Error('Invalid JEJU_ADDRESS format')
      }
      this.address = envAddress
    } else {
      this.address = null
    }
  }

  async run(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    })

    for await (const line of rl) {
      if (!line.trim()) {
        continue
      }

      const [command, ...args] = line.trim().split(' ')

      switch (command) {
        case 'capabilities':
          await this.handleCapabilities()
          break
        case 'list':
          await this.handleList(args.includes('for-push'))
          break
        case 'fetch':
          await this.handleFetch(args, rl)
          break
        case 'push':
          await this.handlePush(args, rl)
          break
        case 'option':
          await this.handleOption(args)
          break
        case '':
          console.log('')
          break
        default:
          console.error(`Unknown command: ${command}`)
          console.log('')
      }
    }
  }

  private async handleCapabilities(): Promise<void> {
    console.log('fetch')
    console.log('push')
    console.log('option')
    console.log('')
  }

  private async handleList(_forPush: boolean): Promise<void> {
    const apiUrl = this.getApiUrl()

    const response = await fetch(
      `${apiUrl}/info/refs?service=git-upload-pack`,
      {
        headers: this.getHeaders(),
      },
    ).catch(() => null)

    if (!response?.ok) {
      if (response?.status === 404) {
        console.log('')
        return
      }
      console.error(
        `Failed to list refs: ${response?.statusText || 'Network error'}`,
      )
      console.log('')
      return
    }

    const data = await response.arrayBuffer()
    const lines = this.parsePktLines(Buffer.from(data))

    for (const line of lines) {
      if (line.startsWith('#') || !line.trim()) continue

      // Git protocol includes capabilities after NUL byte - extract the ref part first
      const refPart = line.split('\x00')[0]
      const match = refPart.match(/^([0-9a-f]{40})\s+(.+)$/)
      if (match) {
        const [, oid, refName] = match
        this.refs.set(refName, oid)
        console.log(`${oid} ${refName}`)
      }
    }

    const mainOid = this.refs.get('refs/heads/main')
    if (mainOid) {
      console.log(`@refs/heads/main HEAD`)
    }

    console.log('')
  }

  private async handleFetch(
    args: string[],
    rl: readline.Interface,
  ): Promise<void> {
    const wantOids: string[] = []

    const firstOid = args[0]
    if (firstOid && firstOid.length === 40) {
      wantOids.push(firstOid)
    }

    for await (const line of rl) {
      if (!line.trim()) break

      const [cmd, oid] = line.split(' ')
      if (cmd === 'fetch' && oid && oid.length === 40) {
        wantOids.push(oid)
      }
    }

    if (wantOids.length === 0) {
      console.log('')
      return
    }

    const request = `${wantOids.map((oid) => `want ${oid}`).join('\n')}\ndone\n`
    const pktRequest = this.createPktLines(request.split('\n').filter(Boolean))

    const apiUrl = this.getApiUrl()
    const response = await fetch(`${apiUrl}/git-upload-pack`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/x-git-upload-pack-request',
      },
      body: new Uint8Array(pktRequest),
    }).catch(() => null)

    if (!response?.ok) {
      console.error(`Fetch failed: ${response?.statusText || 'Network error'}`)
      console.log('')
      return
    }

    const packData = await response.arrayBuffer()
    process.stdout.write(Buffer.from(packData))
    console.log('')
  }

  private async handlePush(
    args: string[],
    rl: readline.Interface,
  ): Promise<void> {
    const pushSpecs: Array<{ force: boolean; src: string; dst: string }> = []

    if (args[0]) {
      pushSpecs.push(this.parsePushSpec(args[0]))
    }

    for await (const line of rl) {
      if (!line.trim()) break

      const [cmd, spec] = line.split(' ')
      if (cmd === 'push' && spec) {
        pushSpecs.push(this.parsePushSpec(spec))
      }
    }

    if (pushSpecs.length === 0) {
      console.log('')
      return
    }

    for (const spec of pushSpecs) {
      const localOid = await this.getLocalRef(spec.src)
      if (!localOid) {
        console.log(`error ${spec.dst} cannot resolve ${spec.src}`)
        continue
      }

      const remoteOid = this.refs.get(spec.dst) || '0'.repeat(40)
      const objects = await this.getObjectsToPush(localOid, remoteOid)
      const packfile = await this.createPackfile(objects)

      const command = `${remoteOid} ${localOid} ${spec.dst}`
      const commandLine = this.createPktLine(command)
      const flush = Buffer.from('0000')
      const request = Buffer.concat([commandLine, flush, packfile])

      const apiUrl = this.getApiUrl()
      const response = await fetch(`${apiUrl}/git-receive-pack`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'Content-Type': 'application/x-git-receive-pack-request',
        },
        body: new Uint8Array(request),
      }).catch(() => null)

      if (!response?.ok) {
        console.log(
          `error ${spec.dst} ${response?.statusText || 'Network error'}`,
        )
        continue
      }

      const result = await response.text()
      if (result.includes('ok')) {
        console.log(`ok ${spec.dst}`)
      } else {
        console.log(`error ${spec.dst} ${result}`)
      }
    }

    console.log('')
  }

  private async handleOption(args: string[]): Promise<void> {
    const [name] = args

    switch (name) {
      case 'verbosity':
      case 'progress':
        console.log('ok')
        break
      default:
        console.log('unsupported')
    }
  }

  private parsePushSpec(spec: string): {
    force: boolean
    src: string
    dst: string
  } {
    const force = spec.startsWith('+')
    const cleanSpec = force ? spec.slice(1) : spec
    const [src, dst] = cleanSpec.split(':')
    return { force, src, dst }
  }

  private async getLocalRef(refName: string): Promise<string | null> {
    const proc = Bun.spawn(['git', 'rev-parse', refName], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      return null
    }

    return output.trim()
  }

  private async getObjectsToPush(
    localOid: string,
    remoteOid: string,
  ): Promise<GitObject[]> {
    const rangeArg =
      remoteOid === '0'.repeat(40) ? localOid : `${remoteOid}..${localOid}`

    const proc = Bun.spawn(['git', 'rev-list', '--objects', rangeArg], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      return []
    }

    const objects: GitObject[] = []
    const lines = output.trim().split('\n').filter(Boolean)

    for (const line of lines) {
      const [oid] = line.split(' ')
      if (!oid || oid.length !== 40) continue

      const obj = await this.getLocalObject(oid)
      if (obj) {
        objects.push(obj)
      }
    }

    return objects
  }

  private async getLocalObject(oid: string): Promise<GitObject | null> {
    const typeProc = Bun.spawn(['git', 'cat-file', '-t', oid], {
      stdout: 'pipe',
    })
    const type = (
      await new Response(typeProc.stdout).text()
    ).trim() as GitObject['type']

    const contentProc = Bun.spawn(['git', 'cat-file', type, oid], {
      stdout: 'pipe',
    })
    const content = Buffer.from(
      await new Response(contentProc.stdout).arrayBuffer(),
    )

    return { oid, type, content }
  }

  private async createPackfile(objects: GitObject[]): Promise<Buffer> {
    const parts: Buffer[] = []

    const header = Buffer.alloc(12)
    header.write('PACK', 0)
    header.writeUInt32BE(2, 4)
    header.writeUInt32BE(objects.length, 8)
    parts.push(header)

    for (const obj of objects) {
      const typeCode = { commit: 1, tree: 2, blob: 3, tag: 4 }[obj.type]
      const encodedObj = this.encodePackObject(typeCode, obj.content)
      parts.push(encodedObj)
    }

    const content = Buffer.concat(parts)
    const checksum = createHash('sha1').update(content).digest()

    return Buffer.concat([content, checksum])
  }

  private encodePackObject(type: number, content: Buffer): Buffer {
    const size = content.length
    const sizeBytes: number[] = []

    let firstByte = (type << 4) | (size & 0x0f)
    let remaining = size >> 4

    if (remaining > 0) {
      firstByte |= 0x80
    }
    sizeBytes.push(firstByte)

    while (remaining > 0) {
      let byte = remaining & 0x7f
      remaining >>= 7
      if (remaining > 0) {
        byte |= 0x80
      }
      sizeBytes.push(byte)
    }

    const compressed = deflateSync(content)
    return Buffer.concat([Buffer.from(sizeBytes), compressed])
  }

  private getApiUrl(): string {
    if (this.remoteUrl.startsWith('http')) {
      return this.remoteUrl
    }
    return `${DWS_URL}/git/${this.owner}/${this.repoName}`
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.address) {
      headers['x-jeju-address'] = this.address
    }
    return headers
  }

  private parsePktLines(data: Buffer): string[] {
    const lines: string[] = []
    let offset = 0

    while (offset < data.length) {
      const lengthHex = data.subarray(offset, offset + 4).toString('ascii')
      const length = parseInt(lengthHex, 16)

      if (length === 0) {
        offset += 4
        continue
      }

      if (length < 4) {
        break
      }

      const content = data
        .subarray(offset + 4, offset + length)
        .toString('utf8')
      lines.push(content.replace(/\n$/, ''))
      offset += length
    }

    return lines
  }

  private createPktLine(content: string): Buffer {
    const data = `${content}\n`
    const length = data.length + 4
    const lengthHex = length.toString(16).padStart(4, '0')
    return Buffer.concat([Buffer.from(lengthHex), Buffer.from(data)])
  }

  private createPktLines(lines: string[]): Buffer {
    const parts = lines.map((line) => this.createPktLine(line))
    const flush = Buffer.from('0000')
    return Buffer.concat([...parts, flush])
  }
}

export async function runGitRemote(
  remoteName: string,
  remoteUrl: string,
): Promise<void> {
  const helper = new JejuGitRemote(remoteName, remoteUrl)
  await helper.run()
}
