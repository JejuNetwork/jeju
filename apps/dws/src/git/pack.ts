/**
 * Git Packfile Operations
 * Handles pack/unpack of git objects for network transfer
 */

import { createHash } from 'crypto';
import { inflate, deflate } from 'zlib';
import { promisify } from 'util';
import type { GitObjectType, PackedObject, PackfileHeader } from './types';
import { GitObjectStore } from './object-store';

const inflateAsync = promisify(inflate);
const deflateAsync = promisify(deflate);

const PACK_SIGNATURE = Buffer.from('PACK');
const PACK_VERSION = 2;

// Object type codes in pack format
const PACK_TYPE = {
  COMMIT: 1,
  TREE: 2,
  BLOB: 3,
  TAG: 4,
  OFS_DELTA: 6,
  REF_DELTA: 7,
} as const;

const TYPE_TO_NAME: Record<number, GitObjectType> = {
  1: 'commit',
  2: 'tree',
  3: 'blob',
  4: 'tag',
};

const NAME_TO_TYPE: Record<GitObjectType, number> = {
  commit: 1,
  tree: 2,
  blob: 3,
  tag: 4,
};

export class PackfileWriter {
  private objects: Array<{ type: GitObjectType; data: Buffer; oid: string }> = [];

  addObject(type: GitObjectType, data: Buffer, oid: string): void {
    this.objects.push({ type, data, oid });
  }

  async build(): Promise<Buffer> {
    const parts: Buffer[] = [];

    // Header: PACK, version, num objects
    const header = Buffer.alloc(12);
    PACK_SIGNATURE.copy(header, 0);
    header.writeUInt32BE(PACK_VERSION, 4);
    header.writeUInt32BE(this.objects.length, 8);
    parts.push(header);

    // Objects
    for (const obj of this.objects) {
      const encoded = await this.encodeObject(obj.type, obj.data);
      parts.push(encoded);
    }

    // Compute SHA-1 of everything
    const content = Buffer.concat(parts);
    const checksum = createHash('sha1').update(content).digest();

    return Buffer.concat([content, checksum]);
  }

  private async encodeObject(type: GitObjectType, data: Buffer): Promise<Buffer> {
    const typeNum = NAME_TO_TYPE[type];
    const size = data.length;

    // Variable-length size encoding with type in first byte
    const sizeBytes: number[] = [];
    let remaining = size;

    // First byte: 1 bit MSB, 3 bits type, 4 bits size
    let firstByte = (typeNum << 4) | (remaining & 0x0f);
    remaining >>= 4;

    if (remaining > 0) {
      firstByte |= 0x80; // Set MSB to indicate more bytes
    }
    sizeBytes.push(firstByte);

    // Subsequent bytes: 1 bit MSB, 7 bits size
    while (remaining > 0) {
      let byte = remaining & 0x7f;
      remaining >>= 7;
      if (remaining > 0) {
        byte |= 0x80;
      }
      sizeBytes.push(byte);
    }

    // Compress data
    const compressed = await deflateAsync(data);

    return Buffer.concat([Buffer.from(sizeBytes), Buffer.from(compressed)]);
  }
}

export class PackfileReader {
  private buffer: Buffer;
  private offset: number = 0;
  private objects: PackedObject[] = [];
  private objectsByOffset: Map<number, PackedObject> = new Map();

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  async parse(): Promise<PackedObject[]> {
    // Verify signature
    const sig = this.buffer.subarray(0, 4);
    if (!sig.equals(PACK_SIGNATURE)) {
      throw new Error('Invalid packfile signature');
    }

    const version = this.buffer.readUInt32BE(4);
    if (version !== 2 && version !== 3) {
      throw new Error(`Unsupported packfile version: ${version}`);
    }

    const numObjects = this.buffer.readUInt32BE(8);
    this.offset = 12;

    for (let i = 0; i < numObjects; i++) {
      const objectOffset = this.offset;
      const obj = await this.readObject();
      obj.offset = objectOffset;
      this.objects.push(obj);
      this.objectsByOffset.set(objectOffset, obj);
    }

    // Resolve deltas
    await this.resolveDeltas();

    return this.objects;
  }

  private async readObject(): Promise<PackedObject> {
    // Read type and size from variable-length header
    let byte = this.buffer[this.offset++];
    const type = (byte >> 4) & 0x07;
    let size = byte & 0x0f;
    let shift = 4;

    while (byte & 0x80) {
      byte = this.buffer[this.offset++];
      size |= (byte & 0x7f) << shift;
      shift += 7;
    }

    if (type === PACK_TYPE.OFS_DELTA) {
      // Offset delta - reference by negative offset
      const baseOffset = this.readVariableOffset();
      const data = await this.readCompressedData();
      return {
        type: 'blob', // Will be resolved later
        size,
        data,
        baseOid: undefined,
        offset: this.offset,
      };
    } else if (type === PACK_TYPE.REF_DELTA) {
      // Reference delta - reference by OID
      const baseOid = this.buffer.subarray(this.offset, this.offset + 20).toString('hex');
      this.offset += 20;
      const data = await this.readCompressedData();
      return {
        type: 'blob', // Will be resolved later
        size,
        data,
        baseOid,
      };
    } else {
      // Regular object
      const typeName = TYPE_TO_NAME[type];
      if (!typeName) {
        throw new Error(`Unknown object type: ${type}`);
      }
      const data = await this.readCompressedData();
      return { type: typeName, size, data };
    }
  }

  private readVariableOffset(): number {
    let byte = this.buffer[this.offset++];
    let offset = byte & 0x7f;

    while (byte & 0x80) {
      offset += 1;
      byte = this.buffer[this.offset++];
      offset = (offset << 7) | (byte & 0x7f);
    }

    return offset;
  }

  private async readCompressedData(): Promise<Buffer> {
    // Find the end of compressed data by trying to inflate
    // This is inefficient but correct
    let endOffset = this.offset + 2; // Minimum zlib size

    while (endOffset <= this.buffer.length) {
      const compressed = this.buffer.subarray(this.offset, endOffset);
      const inflated = await inflateAsync(compressed).catch(() => null);
      if (inflated) {
        this.offset = endOffset;
        return Buffer.from(inflated);
      }
      endOffset++;
    }

    throw new Error('Failed to decompress object');
  }

  private async resolveDeltas(): Promise<void> {
    // For now, we don't support delta objects in parsing
    // A full implementation would need to resolve delta chains
    // This is sufficient for non-deltified packs
  }
}

/**
 * Create a packfile from a list of objects
 */
export async function createPackfile(
  objectStore: GitObjectStore,
  oids: string[]
): Promise<Buffer> {
  const writer = new PackfileWriter();

  for (const oid of oids) {
    const obj = await objectStore.getObject(oid);
    if (obj) {
      writer.addObject(obj.type, obj.content, oid);
    }
  }

  return writer.build();
}

/**
 * Extract objects from a packfile and store them
 */
export async function extractPackfile(
  objectStore: GitObjectStore,
  packData: Buffer
): Promise<string[]> {
  const reader = new PackfileReader(packData);
  const objects = await reader.parse();
  const oids: string[] = [];

  for (const obj of objects) {
    const stored = await objectStore.storeObject(obj.type, obj.data);
    oids.push(stored.oid);
    obj.oid = stored.oid;
  }

  return oids;
}

/**
 * Parse pkt-line format used in git protocol
 */
export function parsePktLines(data: Buffer): string[] {
  const lines: string[] = [];
  let offset = 0;

  while (offset < data.length) {
    const lengthHex = data.subarray(offset, offset + 4).toString('ascii');
    const length = parseInt(lengthHex, 16);

    if (length === 0) {
      // Flush packet
      lines.push('');
      offset += 4;
    } else if (length < 4) {
      throw new Error(`Invalid pkt-line length: ${length}`);
    } else {
      const content = data.subarray(offset + 4, offset + length).toString('utf8');
      lines.push(content.replace(/\n$/, ''));
      offset += length;
    }
  }

  return lines;
}

/**
 * Create pkt-line format
 */
export function createPktLine(content: string): Buffer {
  if (content === '') {
    return Buffer.from('0000');
  }

  const data = content + '\n';
  const length = data.length + 4;
  const lengthHex = length.toString(16).padStart(4, '0');
  return Buffer.concat([Buffer.from(lengthHex), Buffer.from(data)]);
}

/**
 * Create flush packet
 */
export function createFlushPkt(): Buffer {
  return Buffer.from('0000');
}

/**
 * Create a pkt-line stream from multiple lines
 */
export function createPktLines(lines: string[]): Buffer {
  const parts = lines.map((line) => createPktLine(line));
  return Buffer.concat([...parts, createFlushPkt()]);
}

