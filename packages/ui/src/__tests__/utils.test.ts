/**
 * Tests for UI hook utilities
 * 
 * Note: These tests verify the utility functions work correctly.
 * React hooks cannot be tested in isolation - they require a React component context.
 * Full hook testing should be done with @testing-library/react-hooks or in E2E tests.
 */

import { describe, expect, test } from 'bun:test'
import { requireClient } from '../hooks/utils'

describe('requireClient', () => {
  test('should return client when provided', () => {
    const mockClient = {
      network: 'localnet',
      defi: {},
      identity: {},
    } as never // Mock client

    const result = requireClient(mockClient)
    expect(result).toBe(mockClient)
  })

  test('should throw when client is null', () => {
    expect(() => requireClient(null)).toThrow('Not connected')
  })
})
