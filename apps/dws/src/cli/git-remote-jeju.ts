#!/usr/bin/env bun
/**
 * git-remote-jeju - Git remote helper for Jeju DWS
 *
 * This script implements the git-remote-helper protocol for custom remotes.
 * It allows git to communicate with Jeju's decentralized git hosting.
 *
 * Usage:
 *   git remote add origin jeju://0x1234.../my-repo
 *   git clone jeju://0x1234.../my-repo
 *   git push origin main
 *
 * Install:
 *   1. Make this script executable: chmod +x git-remote-jeju
 *   2. Add to PATH or symlink to /usr/local/bin/git-remote-jeju
 *   3. Git will automatically find it when using jeju:// URLs
 */

import { createHash } from 'crypto';
import * as readline from 'readline';

// Configuration
const DWS_URL = process.env.DWS_URL || 'http://localhost:4030';
const JEJU_PRIVATE_KEY = process.env.JEJU_PRIVATE_KEY;

interface GitObject {
  oid: string;
  type: 'blob' | 'tree' | 'commit' | 'tag';
  content: Buffer;
}

interface Ref {
  name: string;
  oid: string;
}

class JejuGitRemote {
  private remoteName: string;
  private remoteUrl: string;
  private owner: string;
  private repoName: string;
  private refs: Map<string, string> = new Map();
  private address: string | null = null;

  constructor() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
      console.error('Usage: git-remote-jeju <remotename> <url>');
      process.exit(1);
    }

    this.remoteName = args[0];
    this.remoteUrl = args[1];

    // Parse URL: jeju://owner/repo or http://localhost:4030/git/owner/repo
    const urlMatch = this.remoteUrl.match(/^jeju:\/\/([^/]+)\/(.+)$/);
    const httpMatch = this.remoteUrl.match(/\/git\/([^/]+)\/(.+)$/);

    if (urlMatch) {
      this.owner = urlMatch[1];
      this.repoName = urlMatch[2];
    } else if (httpMatch) {
      this.owner = httpMatch[1];
      this.repoName = httpMatch[2];
    } else {
      console.error(`Invalid Jeju remote URL: ${this.remoteUrl}`);
      process.exit(1);
    }

    // Get address from environment or key
    this.address = process.env.JEJU_ADDRESS || null;
  }

  async run(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      const [command, ...args] = line.trim().split(' ');

      switch (command) {
        case 'capabilities':
          await this.handleCapabilities();
          break;
        case 'list':
          await this.handleList(args.includes('for-push'));
          break;
        case 'fetch':
          await this.handleFetch(args);
          break;
        case 'push':
          await this.handlePush(args);
          break;
        case 'option':
          await this.handleOption(args);
          break;
        case '':
          // Empty line - end of batch
          console.log('');
          break;
        default:
          console.error(`Unknown command: ${command}`);
          console.log('');
      }
    }
  }

  private async handleCapabilities(): Promise<void> {
    // Report supported capabilities
    console.log('fetch');
    console.log('push');
    console.log('option');
    console.log('');
  }

  private async handleList(forPush: boolean): Promise<void> {
    const apiUrl = this.getApiUrl();

    const response = await fetch(`${apiUrl}/info/refs?service=git-upload-pack`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Empty repository - no refs
        console.log('');
        return;
      }
      console.error(`Failed to list refs: ${response.statusText}`);
      console.log('');
      return;
    }

    const data = await response.arrayBuffer();
    const lines = this.parsePktLines(Buffer.from(data));

    for (const line of lines) {
      if (line.startsWith('#') || !line.trim()) continue;

      // Parse "oid refname" possibly with capabilities
      const match = line.match(/^([0-9a-f]{40})\s+([^\x00]+)/);
      if (match) {
        const [, oid, refName] = match;
        const cleanRef = refName.split('\x00')[0];
        this.refs.set(cleanRef, oid);
        console.log(`${oid} ${cleanRef}`);
      }
    }

    // Add HEAD if we have refs/heads/main
    const mainOid = this.refs.get('refs/heads/main');
    if (mainOid) {
      console.log(`@refs/heads/main HEAD`);
    }

    console.log('');
  }

  private async handleFetch(args: string[]): Promise<void> {
    // Args: oid refname
    const wantOids: string[] = [];

    // Collect all wants from multi-line batch
    const firstOid = args[0];
    if (firstOid && firstOid.length === 40) {
      wantOids.push(firstOid);
    }

    // Read additional fetch lines until blank line
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    for await (const line of rl) {
      if (!line.trim()) break;

      const [cmd, oid] = line.split(' ');
      if (cmd === 'fetch' && oid && oid.length === 40) {
        wantOids.push(oid);
      }
    }

    if (wantOids.length === 0) {
      console.log('');
      return;
    }

    // Build upload-pack request
    const request = wantOids.map((oid) => `want ${oid}`).join('\n') + '\ndone\n';
    const pktRequest = this.createPktLines(request.split('\n').filter(Boolean));

    const apiUrl = this.getApiUrl();
    const response = await fetch(`${apiUrl}/git-upload-pack`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/x-git-upload-pack-request',
      },
      body: pktRequest,
    });

    if (!response.ok) {
      console.error(`Fetch failed: ${response.statusText}`);
      console.log('');
      return;
    }

    // Write packfile to git
    const packData = await response.arrayBuffer();
    process.stdout.write(Buffer.from(packData));
    console.log('');
  }

  private async handlePush(args: string[]): Promise<void> {
    // Args: +src:dst or src:dst
    const pushSpecs: Array<{ force: boolean; src: string; dst: string }> = [];

    // Parse first push spec
    if (args[0]) {
      pushSpecs.push(this.parsePushSpec(args[0]));
    }

    // Read additional push lines
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    for await (const line of rl) {
      if (!line.trim()) break;

      const [cmd, spec] = line.split(' ');
      if (cmd === 'push' && spec) {
        pushSpecs.push(this.parsePushSpec(spec));
      }
    }

    if (pushSpecs.length === 0) {
      console.log('');
      return;
    }

    for (const spec of pushSpecs) {
      // Get local ref OID
      const localOid = await this.getLocalRef(spec.src);
      if (!localOid) {
        console.log(`error ${spec.dst} cannot resolve ${spec.src}`);
        continue;
      }

      // Get remote ref OID (for optimistic lock)
      const remoteOid = this.refs.get(spec.dst) || '0'.repeat(40);

      // Get objects to push
      const objects = await this.getObjectsToPush(localOid, remoteOid);

      // Create packfile
      const packfile = await this.createPackfile(objects);

      // Build receive-pack request
      const command = `${remoteOid} ${localOid} ${spec.dst}`;
      const commandLine = this.createPktLine(command);
      const flush = Buffer.from('0000');
      const request = Buffer.concat([commandLine, flush, packfile]);

      // Send to server
      const apiUrl = this.getApiUrl();
      const response = await fetch(`${apiUrl}/git-receive-pack`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'Content-Type': 'application/x-git-receive-pack-request',
        },
        body: request,
      });

      if (!response.ok) {
        console.log(`error ${spec.dst} ${response.statusText}`);
        continue;
      }

      const result = await response.text();
      if (result.includes('ok')) {
        console.log(`ok ${spec.dst}`);
      } else {
        console.log(`error ${spec.dst} ${result}`);
      }
    }

    console.log('');
  }

  private async handleOption(args: string[]): Promise<void> {
    const [name, value] = args;

    switch (name) {
      case 'verbosity':
      case 'progress':
        console.log('ok');
        break;
      default:
        console.log('unsupported');
    }
  }

  private parsePushSpec(spec: string): { force: boolean; src: string; dst: string } {
    const force = spec.startsWith('+');
    const cleanSpec = force ? spec.slice(1) : spec;
    const [src, dst] = cleanSpec.split(':');
    return { force, src, dst };
  }

  private async getLocalRef(refName: string): Promise<string | null> {
    // Use git rev-parse to get the OID
    const proc = Bun.spawn(['git', 'rev-parse', refName], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return null;
    }

    return output.trim();
  }

  private async getObjectsToPush(localOid: string, remoteOid: string): Promise<GitObject[]> {
    // Get list of commits between remote and local
    const rangeArg = remoteOid === '0'.repeat(40) ? localOid : `${remoteOid}..${localOid}`;

    const proc = Bun.spawn(['git', 'rev-list', '--objects', rangeArg], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return [];
    }

    const objects: GitObject[] = [];
    const lines = output.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const [oid] = line.split(' ');
      if (!oid || oid.length !== 40) continue;

      const obj = await this.getLocalObject(oid);
      if (obj) {
        objects.push(obj);
      }
    }

    return objects;
  }

  private async getLocalObject(oid: string): Promise<GitObject | null> {
    // Get object type
    const typeProc = Bun.spawn(['git', 'cat-file', '-t', oid], {
      stdout: 'pipe',
    });
    const type = (await new Response(typeProc.stdout).text()).trim() as GitObject['type'];

    // Get object content
    const contentProc = Bun.spawn(['git', 'cat-file', type, oid], {
      stdout: 'pipe',
    });
    const content = Buffer.from(await new Response(contentProc.stdout).arrayBuffer());

    return { oid, type, content };
  }

  private async createPackfile(objects: GitObject[]): Promise<Buffer> {
    // Simple packfile creation (non-deltified)
    const parts: Buffer[] = [];

    // Header: PACK, version 2, num objects
    const header = Buffer.alloc(12);
    header.write('PACK', 0);
    header.writeUInt32BE(2, 4);
    header.writeUInt32BE(objects.length, 8);
    parts.push(header);

    // Objects
    for (const obj of objects) {
      const typeCode = { commit: 1, tree: 2, blob: 3, tag: 4 }[obj.type];
      const encodedObj = this.encodePackObject(typeCode, obj.content);
      parts.push(encodedObj);
    }

    // Compute checksum
    const content = Buffer.concat(parts);
    const checksum = createHash('sha1').update(content).digest();

    return Buffer.concat([content, checksum]);
  }

  private encodePackObject(type: number, content: Buffer): Buffer {
    const { deflateSync } = require('zlib');
    const size = content.length;
    const sizeBytes: number[] = [];

    // First byte: 1 bit MSB, 3 bits type, 4 bits size
    let firstByte = (type << 4) | (size & 0x0f);
    let remaining = size >> 4;

    if (remaining > 0) {
      firstByte |= 0x80;
    }
    sizeBytes.push(firstByte);

    while (remaining > 0) {
      let byte = remaining & 0x7f;
      remaining >>= 7;
      if (remaining > 0) {
        byte |= 0x80;
      }
      sizeBytes.push(byte);
    }

    const compressed = deflateSync(content);
    return Buffer.concat([Buffer.from(sizeBytes), compressed]);
  }

  private getApiUrl(): string {
    if (this.remoteUrl.startsWith('http')) {
      return this.remoteUrl;
    }
    return `${DWS_URL}/git/${this.owner}/${this.repoName}`;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.address) {
      headers['x-jeju-address'] = this.address;
    }
    return headers;
  }

  private parsePktLines(data: Buffer): string[] {
    const lines: string[] = [];
    let offset = 0;

    while (offset < data.length) {
      const lengthHex = data.subarray(offset, offset + 4).toString('ascii');
      const length = parseInt(lengthHex, 16);

      if (length === 0) {
        offset += 4;
        continue;
      }

      if (length < 4) {
        break;
      }

      const content = data.subarray(offset + 4, offset + length).toString('utf8');
      lines.push(content.replace(/\n$/, ''));
      offset += length;
    }

    return lines;
  }

  private createPktLine(content: string): Buffer {
    const data = content + '\n';
    const length = data.length + 4;
    const lengthHex = length.toString(16).padStart(4, '0');
    return Buffer.concat([Buffer.from(lengthHex), Buffer.from(data)]);
  }

  private createPktLines(lines: string[]): Buffer {
    const parts = lines.map((line) => this.createPktLine(line));
    const flush = Buffer.from('0000');
    return Buffer.concat([...parts, flush]);
  }
}

// Run the remote helper
const helper = new JejuGitRemote();
helper.run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

