/**
 * Singleton Utilities Tests
 */

import { afterEach, describe, expect, test } from 'bun:test'
import {
  createGlobalSingleton,
  createPortSingleton,
  createSingleton,
} from './singleton'

describe('createSingleton', () => {
  test('returns null initially', () => {
    const singleton = createSingleton<string>()
    expect(singleton.getInstance()).toBeNull()
  })

  test('stores and retrieves instance', () => {
    const singleton = createSingleton<string>()
    singleton.setInstance('test-value')
    expect(singleton.getInstance()).toBe('test-value')
  })

  test('clears instance', () => {
    const singleton = createSingleton<string>()
    singleton.setInstance('test-value')
    singleton.clearInstance()
    expect(singleton.getInstance()).toBeNull()
  })

  test('replaces instance when set again', () => {
    const singleton = createSingleton<number>()
    singleton.setInstance(1)
    singleton.setInstance(2)
    expect(singleton.getInstance()).toBe(2)
  })

  test('works with object types', () => {
    interface TestObj {
      id: number
      name: string
    }
    const singleton = createSingleton<TestObj>()
    const obj = { id: 1, name: 'test' }
    singleton.setInstance(obj)
    expect(singleton.getInstance()).toEqual(obj)
  })

  test('multiple singletons are independent', () => {
    const singleton1 = createSingleton<string>()
    const singleton2 = createSingleton<string>()

    singleton1.setInstance('value1')
    singleton2.setInstance('value2')

    expect(singleton1.getInstance()).toBe('value1')
    expect(singleton2.getInstance()).toBe('value2')
  })
})

describe('createGlobalSingleton', () => {
  const TEST_KEY = '__test_singleton__'

  afterEach(() => {
    // Clean up global state after each test
    const globalObj = global as Record<string, unknown>
    delete globalObj[TEST_KEY]
  })

  test('returns null initially', () => {
    const singleton = createGlobalSingleton<string>(TEST_KEY)
    expect(singleton.getInstance()).toBeNull()
  })

  test('stores and retrieves instance globally', () => {
    const singleton = createGlobalSingleton<string>(TEST_KEY)
    singleton.setInstance('global-value')
    expect(singleton.getInstance()).toBe('global-value')
  })

  test('persists across multiple accessor creations', () => {
    const singleton1 = createGlobalSingleton<string>(TEST_KEY)
    singleton1.setInstance('persisted-value')

    const singleton2 = createGlobalSingleton<string>(TEST_KEY)
    expect(singleton2.getInstance()).toBe('persisted-value')
  })

  test('clears instance', () => {
    const singleton = createGlobalSingleton<string>(TEST_KEY)
    singleton.setInstance('value')
    singleton.clearInstance()
    expect(singleton.getInstance()).toBeNull()
  })

  test('different keys are independent', () => {
    const singleton1 = createGlobalSingleton<string>('__key1__')
    const singleton2 = createGlobalSingleton<string>('__key2__')

    singleton1.setInstance('value1')
    singleton2.setInstance('value2')

    expect(singleton1.getInstance()).toBe('value1')
    expect(singleton2.getInstance()).toBe('value2')

    // Clean up
    singleton1.clearInstance()
    singleton2.clearInstance()
  })
})

describe('createPortSingleton', () => {
  const TEST_KEY = '__test_port_singleton__'
  const PORT_KEY = `${TEST_KEY}Port`

  afterEach(() => {
    // Clean up global state after each test
    const globalObj = global as Record<string, unknown>
    delete globalObj[TEST_KEY]
    delete globalObj[PORT_KEY]
  })

  test('returns null initially', () => {
    const singleton = createPortSingleton<string>(TEST_KEY)
    expect(singleton.getInstance()).toBeNull()
  })

  test('stores and retrieves instance without port', () => {
    const singleton = createPortSingleton<string>(TEST_KEY)
    singleton.setInstance('value')
    expect(singleton.getInstance()).toBe('value')
  })

  test('stores and retrieves instance with port', () => {
    const singleton = createPortSingleton<string>(TEST_KEY)
    singleton.setInstance('value', 8080)
    expect(singleton.getInstance(8080)).toBe('value')
  })

  test('returns null when port does not match', () => {
    const singleton = createPortSingleton<string>(TEST_KEY)
    singleton.setInstance('value', 8080)
    expect(singleton.getInstance(3000)).toBeNull()
  })

  test('returns instance when no port specified in getter', () => {
    const singleton = createPortSingleton<string>(TEST_KEY)
    singleton.setInstance('value', 8080)
    expect(singleton.getInstance()).toBe('value')
  })

  test('clears instance and port', () => {
    const singleton = createPortSingleton<string>(TEST_KEY)
    singleton.setInstance('value', 8080)
    singleton.clearInstance()
    expect(singleton.getInstance()).toBeNull()
    expect(singleton.getInstance(8080)).toBeNull()
  })

  test('uses custom port key', () => {
    const customPortKey = '__custom_port_key__'
    const singleton = createPortSingleton<string>(TEST_KEY, customPortKey)
    singleton.setInstance('value', 9000)
    expect(singleton.getInstance(9000)).toBe('value')

    // Clean up
    const globalObj = global as Record<string, unknown>
    delete globalObj[customPortKey]
  })

  test('prevents binding to same port with different instance', () => {
    const singleton = createPortSingleton<string>(TEST_KEY)
    singleton.setInstance('first', 8080)

    // Try to get instance for different port - should return null
    expect(singleton.getInstance(3000)).toBeNull()

    // Original port still works
    expect(singleton.getInstance(8080)).toBe('first')
  })
})
