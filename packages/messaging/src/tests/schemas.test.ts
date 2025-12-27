/**
 * Schema Validation Tests
 *
 * Tests for Zod schemas with edge cases, boundary conditions, and malformed input.
 */

import { describe, expect, test } from 'bun:test'
import {
  DeliveryReceiptDataSchema,
  HexStringSchema,
  IPFSAddResponseSchema,
  MessageEnvelopeSchema,
  MessagingClientConfigBaseSchema,
  NodeConfigSchema,
  ReadReceiptDataSchema,
  SendMessageRequestSchema,
  SerializedEncryptedMessageSchema,
  WebSocketIncomingMessageSchema,
  WebSocketSubscribeSchema,
} from '../schemas'

describe('HexStringSchema', () => {
  test('accepts valid lowercase hex', () => {
    expect(HexStringSchema.safeParse('abcdef0123456789').success).toBe(true)
  })

  test('accepts valid uppercase hex', () => {
    expect(HexStringSchema.safeParse('ABCDEF0123456789').success).toBe(true)
  })

  test('accepts valid mixed case hex', () => {
    expect(HexStringSchema.safeParse('AbCdEf0123456789').success).toBe(true)
  })

  test('accepts empty string (boundary)', () => {
    // Empty string technically matches the regex ^[a-fA-F0-9]+$ as false
    // because + requires at least one character
    const result = HexStringSchema.safeParse('')
    expect(result.success).toBe(false)
  })

  test('accepts single hex character', () => {
    expect(HexStringSchema.safeParse('a').success).toBe(true)
    expect(HexStringSchema.safeParse('0').success).toBe(true)
    expect(HexStringSchema.safeParse('F').success).toBe(true)
  })

  test('rejects non-hex characters', () => {
    expect(HexStringSchema.safeParse('ghijkl').success).toBe(false)
    expect(HexStringSchema.safeParse('0x123').success).toBe(false) // 'x' is invalid
    expect(HexStringSchema.safeParse('12 34').success).toBe(false) // space
    expect(HexStringSchema.safeParse('12-34').success).toBe(false) // hyphen
  })

  test('rejects special characters', () => {
    expect(HexStringSchema.safeParse('abc!').success).toBe(false)
    expect(HexStringSchema.safeParse('abc@').success).toBe(false)
    expect(HexStringSchema.safeParse('abc\n').success).toBe(false)
    expect(HexStringSchema.safeParse('abc\t').success).toBe(false)
  })

  test('rejects non-string types', () => {
    expect(HexStringSchema.safeParse(123).success).toBe(false)
    expect(HexStringSchema.safeParse(null).success).toBe(false)
    expect(HexStringSchema.safeParse(undefined).success).toBe(false)
    expect(HexStringSchema.safeParse({}).success).toBe(false)
    expect(HexStringSchema.safeParse([]).success).toBe(false)
  })
})
describe('SerializedEncryptedMessageSchema', () => {
  const validMessage = {
    ciphertext: 'abcdef123456',
    nonce: '0123456789ab',
    ephemeralPublicKey: 'fedcba987654',
  }

  test('accepts valid encrypted message', () => {
    expect(
      SerializedEncryptedMessageSchema.safeParse(validMessage).success,
    ).toBe(true)
  })

  test('requires all three fields', () => {
    expect(
      SerializedEncryptedMessageSchema.safeParse({
        ciphertext: 'abc',
        nonce: '123',
      }).success,
    ).toBe(false)

    expect(
      SerializedEncryptedMessageSchema.safeParse({
        ciphertext: 'abc',
        ephemeralPublicKey: '456',
      }).success,
    ).toBe(false)

    expect(
      SerializedEncryptedMessageSchema.safeParse({
        nonce: '123',
        ephemeralPublicKey: '456',
      }).success,
    ).toBe(false)
  })

  test('rejects invalid hex in any field', () => {
    expect(
      SerializedEncryptedMessageSchema.safeParse({
        ...validMessage,
        ciphertext: 'xyz123', // invalid hex
      }).success,
    ).toBe(false)

    expect(
      SerializedEncryptedMessageSchema.safeParse({
        ...validMessage,
        nonce: 'not-hex!',
      }).success,
    ).toBe(false)

    expect(
      SerializedEncryptedMessageSchema.safeParse({
        ...validMessage,
        ephemeralPublicKey: '0x123', // contains 'x'
      }).success,
    ).toBe(false)
  })

  test('rejects empty object', () => {
    expect(SerializedEncryptedMessageSchema.safeParse({}).success).toBe(false)
  })

  test('rejects extra fields (strict mode)', () => {
    const withExtra = {
      ...validMessage,
      extraField: 'should-be-rejected',
    }
    const result = SerializedEncryptedMessageSchema.safeParse(withExtra)
    expect(result.success).toBe(false)
  })
})
describe('MessageEnvelopeSchema', () => {
  const validEnvelope = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    encryptedContent: {
      ciphertext: 'abcdef',
      nonce: '123456',
      ephemeralPublicKey: 'fedcba',
    },
    timestamp: 1234567890123,
  }

  test('accepts valid envelope', () => {
    expect(MessageEnvelopeSchema.safeParse(validEnvelope).success).toBe(true)
  })

  test('accepts envelope with optional signature', () => {
    const withSig = { ...validEnvelope, signature: '0xabc123' }
    expect(MessageEnvelopeSchema.safeParse(withSig).success).toBe(true)
  })

  test('accepts envelope with optional cid', () => {
    const withCid = {
      ...validEnvelope,
      cid: 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
    }
    expect(MessageEnvelopeSchema.safeParse(withCid).success).toBe(true)
  })

  test('rejects invalid UUID', () => {
    const invalid = { ...validEnvelope, id: 'not-a-uuid' }
    expect(MessageEnvelopeSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects empty from address', () => {
    const invalid = { ...validEnvelope, from: '' }
    expect(MessageEnvelopeSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects empty to address', () => {
    const invalid = { ...validEnvelope, to: '' }
    expect(MessageEnvelopeSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects zero timestamp', () => {
    const invalid = { ...validEnvelope, timestamp: 0 }
    expect(MessageEnvelopeSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects negative timestamp', () => {
    const invalid = { ...validEnvelope, timestamp: -1 }
    expect(MessageEnvelopeSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects non-integer timestamp', () => {
    const invalid = { ...validEnvelope, timestamp: 123.456 }
    expect(MessageEnvelopeSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects missing required fields', () => {
    const fields = [
      'id',
      'from',
      'to',
      'encryptedContent',
      'timestamp',
    ] as const

    for (const field of fields) {
      const { [field]: _, ...partial } = validEnvelope
      expect(MessageEnvelopeSchema.safeParse(partial).success).toBe(false)
    }
  })
})
describe('NodeConfigSchema', () => {
  const validConfig = {
    port: 8080,
    nodeId: 'node-1',
  }

  test('accepts valid minimal config', () => {
    expect(NodeConfigSchema.safeParse(validConfig).success).toBe(true)
  })

  test('accepts config with all optional fields', () => {
    // IPFS API port from centralized config (default 5001)
    const ipfsPort = process.env.IPFS_API_PORT ?? '5001'
    const full = {
      ...validConfig,
      ipfsUrl: `http://localhost:${ipfsPort}`,
      maxMessageSize: 1024000,
      messageRetentionDays: 30,
    }
    expect(NodeConfigSchema.safeParse(full).success).toBe(true)
  })

  test('rejects port 0', () => {
    const invalid = { ...validConfig, port: 0 }
    expect(NodeConfigSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects negative port', () => {
    const invalid = { ...validConfig, port: -1 }
    expect(NodeConfigSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects port > 65535', () => {
    const invalid = { ...validConfig, port: 65536 }
    expect(NodeConfigSchema.safeParse(invalid).success).toBe(false)
  })

  test('accepts port boundaries', () => {
    expect(
      NodeConfigSchema.safeParse({ ...validConfig, port: 1 }).success,
    ).toBe(true)
    expect(
      NodeConfigSchema.safeParse({ ...validConfig, port: 65535 }).success,
    ).toBe(true)
  })

  test('rejects empty nodeId', () => {
    const invalid = { ...validConfig, nodeId: '' }
    expect(NodeConfigSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects non-integer port', () => {
    const invalid = { ...validConfig, port: 8080.5 }
    expect(NodeConfigSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects invalid ipfsUrl', () => {
    const invalid = { ...validConfig, ipfsUrl: 'not-a-url' }
    expect(NodeConfigSchema.safeParse(invalid).success).toBe(false)
  })
})
describe('MessagingClientConfigBaseSchema', () => {
  const validConfig = {
    rpcUrl: 'https://rpc.example.com',
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }

  test('accepts valid minimal config', () => {
    expect(MessagingClientConfigBaseSchema.safeParse(validConfig).success).toBe(
      true,
    )
  })

  test('accepts config with all optional fields', () => {
    const full = {
      ...validConfig,
      relayUrl: 'https://relay.example.com',
      nodeRegistryAddress: '0x1234567890123456789012345678901234567890',
      keyRegistryAddress: '0x0987654321098765432109876543210987654321',
      autoReconnect: true,
      preferredRegion: 'us-east-1',
    }
    expect(MessagingClientConfigBaseSchema.safeParse(full).success).toBe(true)
  })

  test('rejects invalid rpcUrl', () => {
    const invalid = { ...validConfig, rpcUrl: 'not-a-url' }
    expect(MessagingClientConfigBaseSchema.safeParse(invalid).success).toBe(
      false,
    )
  })

  test('rejects empty address', () => {
    const invalid = { ...validConfig, address: '' }
    expect(MessagingClientConfigBaseSchema.safeParse(invalid).success).toBe(
      false,
    )
  })

  test('accepts http and https URLs', () => {
    expect(
      MessagingClientConfigBaseSchema.safeParse({
        ...validConfig,
        rpcUrl: 'http://localhost:6545',
      }).success,
    ).toBe(true)

    expect(
      MessagingClientConfigBaseSchema.safeParse({
        ...validConfig,
        rpcUrl: 'https://mainnet.infura.io/v3/xxx',
      }).success,
    ).toBe(true)
  })

  test('autoReconnect must be boolean', () => {
    expect(
      MessagingClientConfigBaseSchema.safeParse({
        ...validConfig,
        autoReconnect: 'true', // string, not boolean
      }).success,
    ).toBe(false)
  })
})
describe('WebSocketSubscribeSchema', () => {
  const validSubscription = {
    type: 'subscribe',
    address: '0x1234567890123456789012345678901234567890',
    signature:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
    timestamp: Date.now(),
  }

  test('accepts valid subscribe message with auth', () => {
    expect(WebSocketSubscribeSchema.safeParse(validSubscription).success).toBe(
      true,
    )
  })

  test('rejects wrong type literal', () => {
    const invalid = {
      ...validSubscription,
      type: 'unsubscribe',
    }
    expect(WebSocketSubscribeSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects empty address', () => {
    const invalid = {
      ...validSubscription,
      address: '',
    }
    expect(WebSocketSubscribeSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects missing signature', () => {
    const invalid = {
      type: 'subscribe',
      address: '0x123',
      timestamp: Date.now(),
    }
    expect(WebSocketSubscribeSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects missing timestamp', () => {
    const invalid = {
      type: 'subscribe',
      address: '0x123',
      signature: '0x1234567890abcdef',
    }
    expect(WebSocketSubscribeSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects invalid signature format', () => {
    const invalid = {
      ...validSubscription,
      signature: 'not-hex-prefixed',
    }
    expect(WebSocketSubscribeSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects negative timestamp', () => {
    const invalid = {
      ...validSubscription,
      timestamp: -1,
    }
    expect(WebSocketSubscribeSchema.safeParse(invalid).success).toBe(false)
  })
})
describe('DeliveryReceiptDataSchema', () => {
  test('accepts valid UUID messageId', () => {
    const valid = {
      messageId: '123e4567-e89b-12d3-a456-426614174000',
    }
    expect(DeliveryReceiptDataSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects invalid messageId', () => {
    const invalid = {
      messageId: 'not-a-uuid',
    }
    expect(DeliveryReceiptDataSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects empty messageId', () => {
    const invalid = {
      messageId: '',
    }
    expect(DeliveryReceiptDataSchema.safeParse(invalid).success).toBe(false)
  })
})
describe('ReadReceiptDataSchema', () => {
  test('accepts valid read receipt', () => {
    const valid = {
      messageId: '123e4567-e89b-12d3-a456-426614174000',
      readAt: 1234567890123,
    }
    expect(ReadReceiptDataSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects zero readAt', () => {
    const invalid = {
      messageId: '123e4567-e89b-12d3-a456-426614174000',
      readAt: 0,
    }
    expect(ReadReceiptDataSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects negative readAt', () => {
    const invalid = {
      messageId: '123e4567-e89b-12d3-a456-426614174000',
      readAt: -1000,
    }
    expect(ReadReceiptDataSchema.safeParse(invalid).success).toBe(false)
  })
})
describe('WebSocketIncomingMessageSchema', () => {
  test('accepts message type with envelope data', () => {
    const valid = {
      type: 'message',
      data: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        from: '0xaaa',
        to: '0xbbb',
        encryptedContent: {
          ciphertext: 'abc',
          nonce: '123',
          ephemeralPublicKey: 'def',
        },
        timestamp: 1234567890,
      },
    }
    expect(WebSocketIncomingMessageSchema.safeParse(valid).success).toBe(true)
  })

  test('accepts delivery_receipt type', () => {
    const valid = {
      type: 'delivery_receipt',
      data: {
        messageId: '123e4567-e89b-12d3-a456-426614174000',
      },
    }
    expect(WebSocketIncomingMessageSchema.safeParse(valid).success).toBe(true)
  })

  test('accepts read_receipt type', () => {
    const valid = {
      type: 'read_receipt',
      data: {
        messageId: '123e4567-e89b-12d3-a456-426614174000',
        readAt: 1234567890,
      },
    }
    expect(WebSocketIncomingMessageSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects unknown type', () => {
    const invalid = {
      type: 'unknown',
      data: {},
    }
    expect(WebSocketIncomingMessageSchema.safeParse(invalid).success).toBe(
      false,
    )
  })
})
describe('IPFSAddResponseSchema', () => {
  test('accepts valid IPFS hash', () => {
    const valid = {
      Hash: 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
    }
    expect(IPFSAddResponseSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects empty Hash', () => {
    const invalid = {
      Hash: '',
    }
    expect(IPFSAddResponseSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects missing Hash', () => {
    expect(IPFSAddResponseSchema.safeParse({}).success).toBe(false)
  })
})
describe('SendMessageRequestSchema', () => {
  test('accepts valid request', () => {
    const valid = {
      to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      content: 'Hello, World!',
    }
    expect(SendMessageRequestSchema.safeParse(valid).success).toBe(true)
  })

  test('accepts request with optional fields', () => {
    const valid = {
      to: '0xbbb',
      content: 'Hello',
      chatId: 'chat-123',
      replyTo: 'msg-456',
    }
    expect(SendMessageRequestSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects empty to address', () => {
    const invalid = {
      to: '',
      content: 'Hello',
    }
    expect(SendMessageRequestSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects empty content', () => {
    const invalid = {
      to: '0xbbb',
      content: '',
    }
    expect(SendMessageRequestSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects missing required fields', () => {
    expect(SendMessageRequestSchema.safeParse({ to: '0xbbb' }).success).toBe(
      false,
    )
    expect(
      SendMessageRequestSchema.safeParse({ content: 'hello' }).success,
    ).toBe(false)
  })
})
describe('Type Coercion Edge Cases', () => {
  test('schema rejects number as string', () => {
    expect(HexStringSchema.safeParse(123456).success).toBe(false)
  })

  test('schema rejects array', () => {
    expect(HexStringSchema.safeParse(['a', 'b', 'c']).success).toBe(false)
  })

  test('schema rejects boolean', () => {
    expect(HexStringSchema.safeParse(true).success).toBe(false)
  })

  test('schema handles null appropriately', () => {
    expect(MessageEnvelopeSchema.safeParse(null).success).toBe(false)
  })

  test('schema handles undefined appropriately', () => {
    expect(MessageEnvelopeSchema.safeParse(undefined).success).toBe(false)
  })

  test('deeply nested validation errors', () => {
    const invalid = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      from: '0xaaa',
      to: '0xbbb',
      encryptedContent: {
        ciphertext: 'invalid!hex',
        nonce: '123',
        ephemeralPublicKey: 'def',
      },
      timestamp: 1234567890,
    }

    const result = MessageEnvelopeSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })
})
describe('Large Input Handling', () => {
  test('accepts very long hex strings', () => {
    const longHex = 'a'.repeat(10000)
    expect(HexStringSchema.safeParse(longHex).success).toBe(true)
  })

  test('accepts large content in send request', () => {
    const largeContent = 'x'.repeat(100000)
    const valid = {
      to: '0xbbb',
      content: largeContent,
    }
    expect(SendMessageRequestSchema.safeParse(valid).success).toBe(true)
  })

  test('handles large timestamp values', () => {
    const valid = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      from: '0xaaa',
      to: '0xbbb',
      encryptedContent: {
        ciphertext: 'abc',
        nonce: '123',
        ephemeralPublicKey: 'def',
      },
      timestamp: Number.MAX_SAFE_INTEGER,
    }
    expect(MessageEnvelopeSchema.safeParse(valid).success).toBe(true)
  })
})
