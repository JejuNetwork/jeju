/**
 * IPFS Client Tests
 * 
 * Tests for IPFS URL generation and CID conversion utilities.
 */

import { describe, test, expect } from 'bun:test';
import {
  getIPFSUrl,
  cidToBytes32,
  createIPFSClient,
} from './ipfs-client';

describe('getIPFSUrl', () => {
  describe('basic functionality', () => {
    test('generates correct URL', () => {
      const url = getIPFSUrl('https://gateway.ipfs.io', 'QmTest123');
      expect(url).toBe('https://gateway.ipfs.io/ipfs/QmTest123');
    });

    test('handles gateway with trailing slash', () => {
      const url = getIPFSUrl('https://gateway.ipfs.io/', 'QmTest123');
      expect(url).toBe('https://gateway.ipfs.io/ipfs/QmTest123');
    });

    test('handles different gateway URLs', () => {
      expect(getIPFSUrl('https://ipfs.example.com', 'Qm123')).toBe('https://ipfs.example.com/ipfs/Qm123');
      expect(getIPFSUrl('https://cloudflare-ipfs.com', 'Qm456')).toBe('https://cloudflare-ipfs.com/ipfs/Qm456');
    });
  });

  describe('edge cases', () => {
    test('returns empty string for empty CID', () => {
      expect(getIPFSUrl('https://gateway.ipfs.io', '')).toBe('');
    });

    test('returns empty string for null CID (bytes32 zero)', () => {
      const zeroCid = '0x' + '0'.repeat(64);
      expect(getIPFSUrl('https://gateway.ipfs.io', zeroCid)).toBe('');
    });

    test('handles CIDv1 format', () => {
      const cidv1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const url = getIPFSUrl('https://gateway.ipfs.io', cidv1);
      expect(url).toBe(`https://gateway.ipfs.io/ipfs/${cidv1}`);
    });

    test('handles CIDv0 format', () => {
      const cidv0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
      const url = getIPFSUrl('https://gateway.ipfs.io', cidv0);
      expect(url).toBe(`https://gateway.ipfs.io/ipfs/${cidv0}`);
    });
  });

  describe('gateway URL normalization', () => {
    test('strips single trailing slash', () => {
      const url = getIPFSUrl('https://gateway.ipfs.io/', 'QmTest');
      expect(url).toBe('https://gateway.ipfs.io/ipfs/QmTest');
    });
  });
});

describe('cidToBytes32', () => {
  describe('basic functionality', () => {
    test('converts CID to bytes32', () => {
      const result = cidToBytes32('QmTest');
      expect(result.startsWith('0x')).toBe(true);
      expect(result.length).toBe(66); // 0x + 64 hex chars
    });

    test('returns consistent results', () => {
      const cid = 'QmTestCID123';
      expect(cidToBytes32(cid)).toBe(cidToBytes32(cid));
    });
  });

  describe('edge cases', () => {
    test('returns zero bytes32 for empty CID', () => {
      const result = cidToBytes32('');
      expect(result).toBe('0x' + '0'.repeat(64));
    });

    test('pads short CIDs', () => {
      const result = cidToBytes32('Qm');
      expect(result.length).toBe(66);
      expect(result.startsWith('0x')).toBe(true);
    });

    test('truncates long CIDs to 32 bytes', () => {
      const longCid = 'QmTestCIDThatIsVeryLongAndExceeds32BytesWhenEncodedAsHexadecimal';
      const result = cidToBytes32(longCid);
      expect(result.length).toBe(66);
    });

    test('handles special characters', () => {
      const result = cidToBytes32('Qm-special_chars.123');
      expect(result.startsWith('0x')).toBe(true);
      expect(result.length).toBe(66);
    });
  });

  describe('format validation', () => {
    test('output is valid hex string', () => {
      const result = cidToBytes32('QmTestCID');
      const hexPart = result.slice(2);
      expect(/^[0-9a-f]+$/i.test(hexPart)).toBe(true);
    });

    test('output is lowercase hex', () => {
      const result = cidToBytes32('QmABCDEF');
      const hexPart = result.slice(2);
      // All hex digits should be lowercase (after encoding)
      expect(hexPart).toBe(hexPart.toLowerCase());
    });
  });

  describe('property-based tests', () => {
    test('always produces 66-character output', () => {
      const testCases = [
        '',
        'Q',
        'Qm',
        'QmTest',
        'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        'a'.repeat(100),
      ];

      for (const cid of testCases) {
        const result = cidToBytes32(cid);
        expect(result.length).toBe(66);
      }
    });

    test('always starts with 0x', () => {
      for (let i = 0; i < 50; i++) {
        const randomCid = `Qm${Math.random().toString(36).slice(2)}`;
        const result = cidToBytes32(randomCid);
        expect(result.startsWith('0x')).toBe(true);
      }
    });
  });
});

describe('createIPFSClient', () => {
  const config = {
    apiUrl: 'https://api.ipfs.example.com',
    gatewayUrl: 'https://gateway.ipfs.example.com',
  };

  test('creates client with all methods', () => {
    const client = createIPFSClient(config);
    
    expect(typeof client.upload).toBe('function');
    expect(typeof client.uploadJSON).toBe('function');
    expect(typeof client.retrieve).toBe('function');
    expect(typeof client.retrieveJSON).toBe('function');
    expect(typeof client.getUrl).toBe('function');
    expect(typeof client.exists).toBe('function');
    expect(typeof client.cidToBytes32).toBe('function');
  });

  test('getUrl uses configured gateway', () => {
    const client = createIPFSClient(config);
    const url = client.getUrl('QmTest123');
    expect(url).toBe('https://gateway.ipfs.example.com/ipfs/QmTest123');
  });

  test('cidToBytes32 is exposed correctly', () => {
    const client = createIPFSClient(config);
    const result = client.cidToBytes32('QmTest');
    expect(result.startsWith('0x')).toBe(true);
    expect(result.length).toBe(66);
  });
});

describe('IPFS URL pattern validation', () => {
  test('generated URLs are valid HTTP URLs', () => {
    const testCids = [
      'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
      'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    ];

    for (const cid of testCids) {
      const url = getIPFSUrl('https://gateway.ipfs.io', cid);
      expect(() => new URL(url)).not.toThrow();
    }
  });

  test('path segment is always /ipfs/', () => {
    const url = getIPFSUrl('https://gateway.example.com', 'QmTest');
    expect(url).toContain('/ipfs/');
  });
});
