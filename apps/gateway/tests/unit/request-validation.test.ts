/**
 * x402 Request Validation Unit Tests
 *
 * Tests for validation of verify and settle requests
 */

import { describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import {
  validateSettleRequest,
  validateVerifyRequest,
} from '../../src/x402/lib/request-validation'

const validAddress: Address = '0x1234567890123456789012345678901234567890'
const validHex: Hex =
  '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'

const validPaymentRequirements = {
  scheme: 'exact' as const,
  network: 'jeju',
  maxAmountRequired: '1000000',
  payTo: validAddress,
  asset: validAddress,
  resource: '/api/test',
}

const validVerifyRequest = {
  x402Version: 1 as const,
  paymentHeader: 'dGVzdC1wYXltZW50LWhlYWRlcg==', // base64 encoded
  paymentRequirements: validPaymentRequirements,
}

const validSettleRequest = {
  x402Version: 1 as const,
  paymentHeader: 'dGVzdC1wYXltZW50LWhlYWRlcg==',
  paymentRequirements: validPaymentRequirements,
}

describe('x402 Request Validation - Verify Request', () => {
  describe('validateVerifyRequest', () => {
    test('accepts valid verify request', () => {
      const result = validateVerifyRequest(validVerifyRequest)

      expect(result.valid).toBe(true)
      expect(result.body).toBeDefined()
      expect(result.error).toBeUndefined()
    })

    test('rejects missing x402Version', () => {
      const request = { ...validVerifyRequest }
      delete (request as Record<string, unknown>).x402Version

      const result = validateVerifyRequest(request)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    test('rejects invalid x402Version', () => {
      const request = { ...validVerifyRequest, x402Version: 2 }

      const result = validateVerifyRequest(request)

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    test('rejects missing paymentHeader', () => {
      const request = { ...validVerifyRequest }
      delete (request as Record<string, unknown>).paymentHeader

      const result = validateVerifyRequest(request)

      expect(result.valid).toBe(false)
    })

    test('rejects empty paymentHeader', () => {
      const request = { ...validVerifyRequest, paymentHeader: '' }

      const result = validateVerifyRequest(request)

      expect(result.valid).toBe(false)
    })

    test('rejects missing paymentRequirements', () => {
      const request = { ...validVerifyRequest }
      delete (request as Record<string, unknown>).paymentRequirements

      const result = validateVerifyRequest(request)

      expect(result.valid).toBe(false)
    })

    test('rejects invalid scheme in paymentRequirements', () => {
      const request = {
        ...validVerifyRequest,
        paymentRequirements: {
          ...validPaymentRequirements,
          scheme: 'invalid',
        },
      }

      const result = validateVerifyRequest(request)

      expect(result.valid).toBe(false)
    })

    test('accepts upto scheme', () => {
      const request = {
        ...validVerifyRequest,
        paymentRequirements: {
          ...validPaymentRequirements,
          scheme: 'upto' as const,
        },
      }

      const result = validateVerifyRequest(request)

      expect(result.valid).toBe(true)
    })

    test('rejects invalid payTo address', () => {
      const request = {
        ...validVerifyRequest,
        paymentRequirements: {
          ...validPaymentRequirements,
          payTo: 'not-an-address',
        },
      }

      const result = validateVerifyRequest(request)

      expect(result.valid).toBe(false)
    })

    test('rejects invalid asset address', () => {
      const request = {
        ...validVerifyRequest,
        paymentRequirements: {
          ...validPaymentRequirements,
          asset: '0xinvalid',
        },
      }

      const result = validateVerifyRequest(request)

      expect(result.valid).toBe(false)
    })

    test('rejects empty network', () => {
      const request = {
        ...validVerifyRequest,
        paymentRequirements: {
          ...validPaymentRequirements,
          network: '',
        },
      }

      const result = validateVerifyRequest(request)

      expect(result.valid).toBe(false)
    })

    test('rejects empty maxAmountRequired', () => {
      const request = {
        ...validVerifyRequest,
        paymentRequirements: {
          ...validPaymentRequirements,
          maxAmountRequired: '',
        },
      }

      const result = validateVerifyRequest(request)

      expect(result.valid).toBe(false)
    })

    test('rejects empty resource', () => {
      const request = {
        ...validVerifyRequest,
        paymentRequirements: {
          ...validPaymentRequirements,
          resource: '',
        },
      }

      const result = validateVerifyRequest(request)

      expect(result.valid).toBe(false)
    })
  })
})

describe('x402 Request Validation - Settle Request', () => {
  describe('validateSettleRequest without auth params', () => {
    test('accepts valid settle request', () => {
      const result = validateSettleRequest(validSettleRequest)

      expect(result.valid).toBe(true)
      expect(result.body).toBeDefined()
    })

    test('rejects missing x402Version', () => {
      const request = { ...validSettleRequest }
      delete (request as Record<string, unknown>).x402Version

      const result = validateSettleRequest(request)

      expect(result.valid).toBe(false)
    })

    test('rejects missing paymentHeader', () => {
      const request = { ...validSettleRequest }
      delete (request as Record<string, unknown>).paymentHeader

      const result = validateSettleRequest(request)

      expect(result.valid).toBe(false)
    })

    test('rejects missing paymentRequirements', () => {
      const request = { ...validSettleRequest }
      delete (request as Record<string, unknown>).paymentRequirements

      const result = validateSettleRequest(request)

      expect(result.valid).toBe(false)
    })
  })

  describe('validateSettleRequest with auth params', () => {
    const validAuthParams = {
      validAfter: 0,
      validBefore: 1800000000, // Some future timestamp
      authNonce: validHex,
      authSignature: validHex,
    }

    const validSettleWithAuth = {
      ...validSettleRequest,
      authParams: validAuthParams,
    }

    test('accepts valid settle request with auth params', () => {
      const result = validateSettleRequest(validSettleWithAuth, true)

      expect(result.valid).toBe(true)
      expect(result.body).toBeDefined()
    })

    test('rejects missing authParams when required', () => {
      const result = validateSettleRequest(validSettleRequest, true)

      expect(result.valid).toBe(false)
    })

    test('rejects negative validAfter', () => {
      const request = {
        ...validSettleWithAuth,
        authParams: {
          ...validAuthParams,
          validAfter: -1,
        },
      }

      const result = validateSettleRequest(request, true)

      expect(result.valid).toBe(false)
    })

    test('rejects non-positive validBefore', () => {
      const request = {
        ...validSettleWithAuth,
        authParams: {
          ...validAuthParams,
          validBefore: 0,
        },
      }

      const result = validateSettleRequest(request, true)

      expect(result.valid).toBe(false)
    })

    test('rejects invalid authNonce format', () => {
      const request = {
        ...validSettleWithAuth,
        authParams: {
          ...validAuthParams,
          authNonce: 'not-a-hex',
        },
      }

      const result = validateSettleRequest(request, true)

      expect(result.valid).toBe(false)
    })

    test('rejects invalid authSignature format', () => {
      const request = {
        ...validSettleWithAuth,
        authParams: {
          ...validAuthParams,
          authSignature: '0xgg', // Invalid hex
        },
      }

      const result = validateSettleRequest(request, true)

      expect(result.valid).toBe(false)
    })

    test('accepts zero validAfter', () => {
      const request = {
        ...validSettleWithAuth,
        authParams: {
          ...validAuthParams,
          validAfter: 0,
        },
      }

      const result = validateSettleRequest(request, true)

      expect(result.valid).toBe(true)
    })
  })
})

describe('x402 Request Validation - Edge Cases', () => {
  test('handles null input', () => {
    const result = validateVerifyRequest(null)
    expect(result.valid).toBe(false)
  })

  test('handles undefined input', () => {
    const result = validateVerifyRequest(undefined)
    expect(result.valid).toBe(false)
  })

  test('handles empty object', () => {
    const result = validateVerifyRequest({})
    expect(result.valid).toBe(false)
  })

  test('handles string input', () => {
    const result = validateVerifyRequest('invalid')
    expect(result.valid).toBe(false)
  })

  test('handles number input', () => {
    const result = validateVerifyRequest(123)
    expect(result.valid).toBe(false)
  })

  test('handles array input', () => {
    const result = validateVerifyRequest([validVerifyRequest])
    expect(result.valid).toBe(false)
  })

  test('ignores extra fields in request', () => {
    const request = {
      ...validVerifyRequest,
      extraField: 'ignored',
      anotherExtra: 123,
    }

    const result = validateVerifyRequest(request)

    expect(result.valid).toBe(true)
  })

  test('accepts optional description in paymentRequirements', () => {
    const request = {
      ...validVerifyRequest,
      paymentRequirements: {
        ...validPaymentRequirements,
        description: 'Test payment',
      },
    }

    const result = validateVerifyRequest(request)

    expect(result.valid).toBe(true)
  })

  test('accepts optional mimeType in paymentRequirements', () => {
    const request = {
      ...validVerifyRequest,
      paymentRequirements: {
        ...validPaymentRequirements,
        mimeType: 'application/json',
      },
    }

    const result = validateVerifyRequest(request)

    expect(result.valid).toBe(true)
  })

  test('accepts optional maxTimeoutSeconds in paymentRequirements', () => {
    const request = {
      ...validVerifyRequest,
      paymentRequirements: {
        ...validPaymentRequirements,
        maxTimeoutSeconds: 30,
      },
    }

    const result = validateVerifyRequest(request)

    expect(result.valid).toBe(true)
  })

  test('rejects non-positive maxTimeoutSeconds', () => {
    const request = {
      ...validVerifyRequest,
      paymentRequirements: {
        ...validPaymentRequirements,
        maxTimeoutSeconds: 0,
      },
    }

    const result = validateVerifyRequest(request)

    expect(result.valid).toBe(false)
  })

  test('rejects negative maxTimeoutSeconds', () => {
    const request = {
      ...validVerifyRequest,
      paymentRequirements: {
        ...validPaymentRequirements,
        maxTimeoutSeconds: -1,
      },
    }

    const result = validateVerifyRequest(request)

    expect(result.valid).toBe(false)
  })
})

describe('x402 Request Validation - Address Format', () => {
  test('accepts lowercase address', () => {
    const request = {
      ...validVerifyRequest,
      paymentRequirements: {
        ...validPaymentRequirements,
        payTo: '0x1234567890abcdef1234567890abcdef12345678' as Address,
      },
    }

    const result = validateVerifyRequest(request)

    expect(result.valid).toBe(true)
  })

  test('accepts checksummed address', () => {
    const request = {
      ...validVerifyRequest,
      paymentRequirements: {
        ...validPaymentRequirements,
        payTo: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' as Address,
      },
    }

    const result = validateVerifyRequest(request)

    expect(result.valid).toBe(true)
  })

  test('rejects uppercase address (must be lowercase or checksummed)', () => {
    const request = {
      ...validVerifyRequest,
      paymentRequirements: {
        ...validPaymentRequirements,
        payTo: '0x1234567890ABCDEF1234567890ABCDEF12345678' as Address,
      },
    }

    const result = validateVerifyRequest(request)

    // Address validation may require lowercase or proper checksumming
    expect(result.valid).toBe(false)
  })

  test('accepts zero address', () => {
    const request = {
      ...validVerifyRequest,
      paymentRequirements: {
        ...validPaymentRequirements,
        asset: '0x0000000000000000000000000000000000000000' as Address,
      },
    }

    const result = validateVerifyRequest(request)

    expect(result.valid).toBe(true)
  })

  test('rejects address with wrong length', () => {
    const request = {
      ...validVerifyRequest,
      paymentRequirements: {
        ...validPaymentRequirements,
        payTo: '0x123456789',
      },
    }

    const result = validateVerifyRequest(request)

    expect(result.valid).toBe(false)
  })

  test('rejects address without 0x prefix', () => {
    const request = {
      ...validVerifyRequest,
      paymentRequirements: {
        ...validPaymentRequirements,
        payTo: '1234567890123456789012345678901234567890',
      },
    }

    const result = validateVerifyRequest(request)

    expect(result.valid).toBe(false)
  })
})
