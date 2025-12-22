/**
 * Utility Functions Unit Tests
 *
 * Tests for parsePort, parseTimeout, parseBoolean, and SQL identifier validation
 * with edge cases, boundary conditions, and property-based testing patterns.
 */

import { describe, expect, it } from 'bun:test'
import {
  parseBoolean,
  parsePort,
  parseTimeout,
  sanitizeObject,
  sanitizeRows,
  validateSQLDefault,
  validateSQLIdentifier,
  validateSQLIdentifiers,
} from './utils.js'

describe('parsePort', () => {
  describe('valid ports', () => {
    it('should return default when envValue is undefined', () => {
      expect(parsePort(undefined, 3000)).toBe(3000)
    })

    it('should return default when envValue is empty string', () => {
      expect(parsePort('', 3000)).toBe(3000)
    })

    it('should parse valid port number', () => {
      expect(parsePort('8080', 3000)).toBe(8080)
    })

    it('should parse minimum valid port (1)', () => {
      expect(parsePort('1', 3000)).toBe(1)
    })

    it('should parse maximum valid port (65535)', () => {
      expect(parsePort('65535', 3000)).toBe(65535)
    })

    it('should parse common ports', () => {
      expect(parsePort('80', 3000)).toBe(80)
      expect(parsePort('443', 3000)).toBe(443)
      expect(parsePort('3000', 8080)).toBe(3000)
      expect(parsePort('4000', 3000)).toBe(4000)
      expect(parsePort('8545', 3000)).toBe(8545)
    })

    it('should parse port with leading zeros', () => {
      // parseInt handles leading zeros
      expect(parsePort('0080', 3000)).toBe(80)
      expect(parsePort('00443', 3000)).toBe(443)
    })
  })

  describe('invalid ports', () => {
    it('should throw for port 0', () => {
      expect(() => parsePort('0', 3000)).toThrow()
    })

    it('should throw for negative port', () => {
      expect(() => parsePort('-1', 3000)).toThrow()
      expect(() => parsePort('-100', 3000)).toThrow()
    })

    it('should throw for port above 65535', () => {
      expect(() => parsePort('65536', 3000)).toThrow()
      expect(() => parsePort('70000', 3000)).toThrow()
      expect(() => parsePort('100000', 3000)).toThrow()
    })

    it('should truncate decimal port values (parseInt behavior)', () => {
      // parseInt truncates decimals, so 8080.5 becomes 8080
      expect(parsePort('8080.5', 3000)).toBe(8080)
      expect(parsePort('3000.999', 8080)).toBe(3000)
    })

    it('should throw for NaN input', () => {
      expect(() => parsePort('abc', 3000)).toThrow()
      expect(() => parsePort('not-a-number', 3000)).toThrow()
      expect(() => parsePort('port8080', 3000)).toThrow()
    })

    it('should throw for whitespace-only input', () => {
      // parseInt returns NaN for whitespace
      expect(() => parsePort('   ', 3000)).toThrow()
    })
  })

  describe('boundary testing (property-based patterns)', () => {
    it('should accept all ports from 1 to 100', () => {
      for (let port = 1; port <= 100; port++) {
        expect(parsePort(String(port), 0)).toBe(port)
      }
    })

    it('should accept ports near upper boundary', () => {
      for (let port = 65500; port <= 65535; port++) {
        expect(parsePort(String(port), 0)).toBe(port)
      }
    })

    it('should reject ports just above upper boundary', () => {
      for (let port = 65536; port <= 65550; port++) {
        expect(() => parsePort(String(port), 0)).toThrow()
      }
    })
  })
})

describe('parseTimeout', () => {
  describe('valid timeouts', () => {
    it('should return default when envValue is undefined', () => {
      expect(parseTimeout(undefined, 30000)).toBe(30000)
    })

    it('should return default when envValue is empty string', () => {
      expect(parseTimeout('', 30000)).toBe(30000)
    })

    it('should parse valid timeout', () => {
      expect(parseTimeout('5000', 30000)).toBe(5000)
    })

    it('should parse minimum valid timeout (1)', () => {
      expect(parseTimeout('1', 30000)).toBe(1)
    })

    it('should parse large timeouts', () => {
      expect(parseTimeout('60000', 30000)).toBe(60000)
      expect(parseTimeout('300000', 30000)).toBe(300000)
      expect(parseTimeout('1000000', 30000)).toBe(1000000)
    })

    it('should parse common timeout values', () => {
      expect(parseTimeout('1000', 5000)).toBe(1000) // 1 second
      expect(parseTimeout('5000', 30000)).toBe(5000) // 5 seconds
      expect(parseTimeout('10000', 30000)).toBe(10000) // 10 seconds
      expect(parseTimeout('30000', 60000)).toBe(30000) // 30 seconds
    })
  })

  describe('invalid timeouts', () => {
    it('should throw for zero timeout', () => {
      expect(() => parseTimeout('0', 30000)).toThrow()
    })

    it('should throw for negative timeout', () => {
      expect(() => parseTimeout('-1', 30000)).toThrow()
      expect(() => parseTimeout('-5000', 30000)).toThrow()
    })

    it('should truncate decimal timeout values (parseInt behavior)', () => {
      // parseInt truncates decimals, so 5000.5 becomes 5000
      expect(parseTimeout('5000.5', 30000)).toBe(5000)
      expect(parseTimeout('1000.001', 30000)).toBe(1000)
    })

    it('should throw for NaN input', () => {
      expect(() => parseTimeout('abc', 30000)).toThrow()
      expect(() => parseTimeout('timeout', 30000)).toThrow()
    })
  })

  describe('boundary testing (property-based patterns)', () => {
    it('should accept timeouts from 1 to 100', () => {
      for (let timeout = 1; timeout <= 100; timeout++) {
        expect(parseTimeout(String(timeout), 0)).toBe(timeout)
      }
    })

    it('should accept large timeouts', () => {
      const largeTimeouts = [100000, 500000, 1000000, 5000000, 10000000]
      for (const timeout of largeTimeouts) {
        expect(parseTimeout(String(timeout), 0)).toBe(timeout)
      }
    })
  })
})

describe('parseBoolean', () => {
  describe('truthy values', () => {
    it('should return true for "true"', () => {
      expect(parseBoolean('true', false)).toBe(true)
    })

    it('should return true for "1"', () => {
      expect(parseBoolean('1', false)).toBe(true)
    })

    it('should return true with default true', () => {
      expect(parseBoolean('true', true)).toBe(true)
      expect(parseBoolean('1', true)).toBe(true)
    })
  })

  describe('falsy values', () => {
    it('should return false for "false"', () => {
      expect(parseBoolean('false', true)).toBe(false)
    })

    it('should return false for "0"', () => {
      expect(parseBoolean('0', true)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(parseBoolean('', true)).toBe(false)
    })

    it('should return false for any other string', () => {
      expect(parseBoolean('yes', true)).toBe(false)
      expect(parseBoolean('no', true)).toBe(false)
      expect(parseBoolean('True', true)).toBe(false) // Case sensitive
      expect(parseBoolean('TRUE', true)).toBe(false)
      expect(parseBoolean('False', true)).toBe(false)
    })
  })

  describe('undefined handling', () => {
    it('should return default when undefined', () => {
      expect(parseBoolean(undefined, true)).toBe(true)
      expect(parseBoolean(undefined, false)).toBe(false)
    })
  })

  describe('exhaustive value testing', () => {
    const trueValues = ['true', '1']
    const falseValues = [
      'false',
      '0',
      '',
      'yes',
      'no',
      'True',
      'FALSE',
      'TRUE',
      'on',
      'off',
      'enabled',
      'disabled',
    ]

    it('should only accept "true" and "1" as truthy', () => {
      for (const val of trueValues) {
        expect(parseBoolean(val, false)).toBe(true)
      }
    })

    it('should treat all other values as falsy', () => {
      for (const val of falseValues) {
        expect(parseBoolean(val, false)).toBe(false)
      }
    })
  })
})

describe('validateSQLIdentifier', () => {
  describe('valid identifiers', () => {
    it('should accept simple table names', () => {
      expect(validateSQLIdentifier('users', 'table')).toBe('users')
      expect(validateSQLIdentifier('posts', 'table')).toBe('posts')
      expect(validateSQLIdentifier('orders', 'table')).toBe('orders')
    })

    it('should accept identifiers starting with underscore', () => {
      expect(validateSQLIdentifier('_migrations', 'table')).toBe('_migrations')
      expect(validateSQLIdentifier('_internal', 'table')).toBe('_internal')
    })

    it('should accept identifiers with underscores', () => {
      expect(validateSQLIdentifier('user_accounts', 'table')).toBe(
        'user_accounts',
      )
      expect(validateSQLIdentifier('order_items', 'table')).toBe('order_items')
      expect(validateSQLIdentifier('created_at', 'column')).toBe('created_at')
    })

    it('should accept identifiers with numbers', () => {
      expect(validateSQLIdentifier('table1', 'table')).toBe('table1')
      expect(validateSQLIdentifier('v2_schema', 'table')).toBe('v2_schema')
      expect(validateSQLIdentifier('user123', 'table')).toBe('user123')
    })

    it('should accept mixed case identifiers', () => {
      expect(validateSQLIdentifier('UserAccounts', 'table')).toBe(
        'UserAccounts',
      )
      expect(validateSQLIdentifier('createdAt', 'column')).toBe('createdAt')
    })

    it('should accept index names', () => {
      expect(validateSQLIdentifier('idx_users_email', 'index')).toBe(
        'idx_users_email',
      )
      expect(validateSQLIdentifier('pk_orders', 'index')).toBe('pk_orders')
    })
  })

  describe('SQL injection prevention', () => {
    it('should reject identifiers with SQL keywords injected', () => {
      expect(() =>
        validateSQLIdentifier('users; DROP TABLE users;--', 'table'),
      ).toThrow()
      expect(() => validateSQLIdentifier("users' OR '1'='1", 'table')).toThrow()
      expect(() => validateSQLIdentifier('users--', 'table')).toThrow()
    })

    it('should reject identifiers with special characters', () => {
      expect(() => validateSQLIdentifier('user@domain', 'table')).toThrow()
      expect(() => validateSQLIdentifier('column#1', 'column')).toThrow()
      expect(() => validateSQLIdentifier('data$value', 'column')).toThrow()
    })

    it('should reject identifiers with spaces', () => {
      expect(() => validateSQLIdentifier('table name', 'table')).toThrow()
      expect(() => validateSQLIdentifier('column name', 'column')).toThrow()
    })

    it('should reject identifiers with quotes', () => {
      expect(() => validateSQLIdentifier("user's", 'table')).toThrow()
      expect(() => validateSQLIdentifier('table"name', 'table')).toThrow()
      expect(() => validateSQLIdentifier('col`name', 'column')).toThrow()
    })

    it('should reject identifiers with parentheses', () => {
      expect(() => validateSQLIdentifier('table()', 'table')).toThrow()
      expect(() => validateSQLIdentifier('func(x)', 'column')).toThrow()
    })

    it('should reject identifiers with semicolons', () => {
      expect(() => validateSQLIdentifier('table;', 'table')).toThrow()
      expect(() => validateSQLIdentifier(';column', 'column')).toThrow()
    })
  })

  describe('invalid identifiers', () => {
    it('should reject empty strings', () => {
      expect(() => validateSQLIdentifier('', 'table')).toThrow(
        'must be a non-empty string',
      )
    })

    it('should reject identifiers starting with numbers', () => {
      expect(() => validateSQLIdentifier('1table', 'table')).toThrow()
      expect(() => validateSQLIdentifier('123', 'column')).toThrow()
    })

    it('should reject very long identifiers', () => {
      const longName = 'a'.repeat(200)
      expect(() => validateSQLIdentifier(longName, 'table')).toThrow()
    })

    it('should reject SQL reserved words', () => {
      expect(() => validateSQLIdentifier('SELECT', 'table')).toThrow(
        'reserved word',
      )
      expect(() => validateSQLIdentifier('INSERT', 'table')).toThrow(
        'reserved word',
      )
      expect(() => validateSQLIdentifier('DROP', 'table')).toThrow(
        'reserved word',
      )
      expect(() => validateSQLIdentifier('TABLE', 'table')).toThrow(
        'reserved word',
      )
    })

    it('should reject reserved words case-insensitively', () => {
      expect(() => validateSQLIdentifier('select', 'table')).toThrow(
        'reserved word',
      )
      expect(() => validateSQLIdentifier('Select', 'table')).toThrow(
        'reserved word',
      )
      expect(() => validateSQLIdentifier('DROP', 'column')).toThrow(
        'reserved word',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle single character identifiers', () => {
      expect(validateSQLIdentifier('a', 'table')).toBe('a')
      expect(validateSQLIdentifier('_', 'column')).toBe('_')
    })

    it('should handle max length identifier (128 chars)', () => {
      const maxName = `a${'b'.repeat(127)}`
      expect(validateSQLIdentifier(maxName, 'table')).toBe(maxName)
    })

    it('should reject identifier just over max length', () => {
      const tooLong = `a${'b'.repeat(128)}`
      expect(() => validateSQLIdentifier(tooLong, 'table')).toThrow()
    })
  })
})

describe('validateSQLIdentifiers', () => {
  it('should validate array of column names', () => {
    const columns = ['id', 'name', 'email', 'created_at']
    const result = validateSQLIdentifiers(columns, 'column')
    expect(result).toEqual(columns)
  })

  it('should throw if any identifier is invalid', () => {
    const columns = ['id', 'valid_name', 'invalid;column']
    expect(() => validateSQLIdentifiers(columns, 'column')).toThrow()
  })

  it('should handle empty array', () => {
    expect(validateSQLIdentifiers([], 'column')).toEqual([])
  })

  it('should handle single element array', () => {
    expect(validateSQLIdentifiers(['id'], 'column')).toEqual(['id'])
  })
})

describe('validateSQLDefault', () => {
  describe('valid default values', () => {
    it('should accept numeric literals', () => {
      expect(validateSQLDefault('0')).toBe('0')
      expect(validateSQLDefault('123')).toBe('123')
      expect(validateSQLDefault('-456')).toBe('-456')
      expect(validateSQLDefault('3.14')).toBe('3.14')
      expect(validateSQLDefault('-0.5')).toBe('-0.5')
    })

    it('should accept string literals', () => {
      expect(validateSQLDefault("'hello'")).toBe("'hello'")
      expect(validateSQLDefault("'active'")).toBe("'active'")
      expect(validateSQLDefault("'hello world'")).toBe("'hello world'")
      expect(validateSQLDefault("''")).toBe("''")
    })

    it('should accept boolean values', () => {
      expect(validateSQLDefault('TRUE')).toBe('TRUE')
      expect(validateSQLDefault('FALSE')).toBe('FALSE')
      expect(validateSQLDefault('true')).toBe('true')
      expect(validateSQLDefault('false')).toBe('false')
    })

    it('should accept NULL', () => {
      expect(validateSQLDefault('NULL')).toBe('NULL')
      expect(validateSQLDefault('null')).toBe('null')
    })

    it('should accept CURRENT_TIMESTAMP variants', () => {
      expect(validateSQLDefault('CURRENT_TIMESTAMP')).toBe('CURRENT_TIMESTAMP')
      expect(validateSQLDefault('CURRENT_DATE')).toBe('CURRENT_DATE')
      expect(validateSQLDefault('CURRENT_TIME')).toBe('CURRENT_TIME')
    })

    it('should trim whitespace', () => {
      expect(validateSQLDefault('  123  ')).toBe('123')
      expect(validateSQLDefault('  TRUE  ')).toBe('TRUE')
    })
  })

  describe('SQL injection prevention', () => {
    it('should reject SQL injection attempts', () => {
      expect(() => validateSQLDefault('0; DROP TABLE users;--')).toThrow()
      expect(() => validateSQLDefault("'test' OR '1'='1'")).toThrow()
      expect(() => validateSQLDefault('(SELECT password FROM users)')).toThrow()
    })

    it('should reject unquoted strings', () => {
      expect(() => validateSQLDefault('hello')).toThrow()
      expect(() => validateSQLDefault('active')).toThrow()
    })

    it('should reject function calls that are not allowed', () => {
      expect(() => validateSQLDefault('random()')).toThrow()
      expect(() => validateSQLDefault('abs(-1)')).toThrow()
    })

    it('should reject expressions', () => {
      expect(() => validateSQLDefault('1 + 1')).toThrow()
      expect(() => validateSQLDefault('length(name)')).toThrow()
    })
  })

  describe('invalid inputs', () => {
    it('should reject empty string', () => {
      expect(() => validateSQLDefault('')).toThrow('must be a non-empty string')
    })
  })
})

describe('sanitizeObject', () => {
  it('should pass through normal objects', () => {
    const obj = { id: 1, name: 'test', value: null }
    const result = sanitizeObject(obj)
    expect(result).toEqual(obj)
  })

  it('should remove __proto__ key', () => {
    const obj = { id: 1, __proto__: { malicious: true } }
    const result = sanitizeObject(obj)
    expect(result).toEqual({ id: 1 })
    expect('__proto__' in result).toBe(false)
  })

  it('should remove constructor key', () => {
    const obj = { id: 1, constructor: 'malicious' }
    const result = sanitizeObject(obj)
    expect(result).toEqual({ id: 1 })
    expect('constructor' in result).toBe(false)
  })

  it('should remove prototype key', () => {
    const obj = { id: 1, prototype: { evil: true } }
    const result = sanitizeObject(obj)
    expect(result).toEqual({ id: 1 })
    expect('prototype' in result).toBe(false)
  })

  it('should remove all dangerous keys at once', () => {
    const obj = {
      id: 1,
      name: 'safe',
      __proto__: 'bad',
      constructor: 'bad',
      prototype: 'bad',
    }
    const result = sanitizeObject(obj)
    expect(result).toEqual({ id: 1, name: 'safe' })
  })
})

describe('sanitizeRows', () => {
  it('should sanitize array of objects', () => {
    const rows = [
      { id: 1, name: 'test1', __proto__: 'bad' },
      { id: 2, name: 'test2', constructor: 'bad' },
    ]
    const result = sanitizeRows(rows)
    expect(result).toEqual([
      { id: 1, name: 'test1' },
      { id: 2, name: 'test2' },
    ])
  })

  it('should handle empty array', () => {
    expect(sanitizeRows([])).toEqual([])
  })

  it('should pass through safe arrays', () => {
    const rows = [{ id: 1 }, { id: 2 }]
    const result = sanitizeRows(rows)
    expect(result).toEqual(rows)
  })
})
