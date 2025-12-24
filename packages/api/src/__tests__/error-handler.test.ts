import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  APIError,
  assert,
  ConflictError,
  expectDefined,
  expectValid,
  getStatusCode,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  sanitizeErrorMessage,
  toErrorResponse,
  ValidationError,
} from '../error-handler'

describe('Error Handler', () => {
  describe('APIError', () => {
    test('creates error with correct properties', () => {
      const error = new APIError('Test error', 400, 'TEST_ERROR', {
        field: 'value',
      })

      expect(error.message).toBe('Test error')
      expect(error.statusCode).toBe(400)
      expect(error.code).toBe('TEST_ERROR')
      expect(error.details).toEqual({ field: 'value' })
      expect(error.name).toBe('APIError')
    })

    test('toJSON returns correct structure', () => {
      const error = new APIError('Test', 500, 'TEST')
      const json = error.toJSON()

      expect(json).toEqual({
        error: 'Test',
        code: 'TEST',
        statusCode: 500,
      })
    })

    test('toJSON includes details when present', () => {
      const error = new APIError('Test', 500, 'TEST', { key: 'value' })
      const json = error.toJSON()

      expect(json.details).toEqual({ key: 'value' })
    })
  })

  describe('ValidationError', () => {
    test('creates 400 error', () => {
      const error = new ValidationError('Invalid input')

      expect(error.statusCode).toBe(400)
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.name).toBe('ValidationError')
    })
  })

  describe('NotFoundError', () => {
    test('creates 404 error with resource name', () => {
      const error = new NotFoundError('User')

      expect(error.statusCode).toBe(404)
      expect(error.message).toBe('User not found')
      expect(error.code).toBe('NOT_FOUND')
    })

    test('includes ID in message when provided', () => {
      const error = new NotFoundError('User', '123')

      expect(error.message).toBe('User not found: 123')
      expect(error.details).toEqual({ resource: 'User', id: '123' })
    })
  })

  describe('ConflictError', () => {
    test('creates 409 error', () => {
      const error = new ConflictError('Resource already exists')

      expect(error.statusCode).toBe(409)
      expect(error.code).toBe('CONFLICT')
    })
  })

  describe('ServiceUnavailableError', () => {
    test('creates 503 error', () => {
      const error = new ServiceUnavailableError('Database')

      expect(error.statusCode).toBe(503)
      expect(error.message).toBe('Service unavailable: Database')
      expect(error.code).toBe('SERVICE_UNAVAILABLE')
    })
  })

  describe('InternalError', () => {
    test('creates 500 error with default message', () => {
      const error = new InternalError()

      expect(error.statusCode).toBe(500)
      expect(error.message).toBe('Internal server error')
    })

    test('accepts custom message', () => {
      const error = new InternalError('Custom error')
      expect(error.message).toBe('Custom error')
    })
  })

  describe('sanitizeErrorMessage', () => {
    test('returns message in development', () => {
      const error = new Error('Sensitive database error')
      const message = sanitizeErrorMessage(error, true)

      expect(message).toBe('Sensitive database error')
    })

    test('returns generic message in production for unknown errors', () => {
      const error = new Error('Sensitive database error')
      const message = sanitizeErrorMessage(error, false)

      expect(message).toBe('An unexpected error occurred')
    })

    test('returns API error message in production', () => {
      const error = new ValidationError('Invalid email format')
      const message = sanitizeErrorMessage(error, false)

      expect(message).toBe('Invalid email format')
    })
  })

  describe('toErrorResponse', () => {
    test('converts APIError', () => {
      const error = new ValidationError('Invalid input')
      const response = toErrorResponse(error)

      expect(response.error).toBe('Invalid input')
      expect(response.code).toBe('VALIDATION_ERROR')
      expect(response.statusCode).toBe(400)
    })

    test('converts ZodError', () => {
      const schema = z.object({ name: z.string() })
      const result = schema.safeParse({ name: 123 })

      if (!result.success) {
        const response = toErrorResponse(result.error)

        expect(response.code).toBe('VALIDATION_ERROR')
        expect(response.statusCode).toBe(400)
        expect(response.error).toContain('Validation failed')
      }
    })

    test('converts generic error', () => {
      const error = new Error('Unknown error')
      const response = toErrorResponse(error, false)

      expect(response.code).toBe('INTERNAL_ERROR')
      expect(response.statusCode).toBe(500)
    })

    test('includes stack in development', () => {
      const error = new Error('Test')
      const response = toErrorResponse(error, true)

      expect(response.stack).toBeDefined()
    })

    test('excludes stack in production', () => {
      const error = new Error('Test')
      const response = toErrorResponse(error, false)

      expect(response.stack).toBeUndefined()
    })
  })

  describe('getStatusCode', () => {
    test('returns status code from APIError', () => {
      expect(getStatusCode(new ValidationError('test'))).toBe(400)
      expect(getStatusCode(new NotFoundError('test'))).toBe(404)
      expect(getStatusCode(new InternalError())).toBe(500)
    })

    test('returns 400 for ZodError', () => {
      const schema = z.string()
      const result = schema.safeParse(123)
      if (!result.success) {
        expect(getStatusCode(result.error)).toBe(400)
      }
    })

    test('returns 500 for generic error', () => {
      expect(getStatusCode(new Error('test'))).toBe(500)
    })
  })

  describe('expectDefined', () => {
    test('returns value when defined', () => {
      expect(expectDefined('hello', 'Value required')).toBe('hello')
      expect(expectDefined(0, 'Value required')).toBe(0)
      expect(expectDefined(false, 'Value required')).toBe(false)
    })

    test('throws for null', () => {
      expect(() => expectDefined(null, 'Value required')).toThrow(
        ValidationError,
      )
    })

    test('throws for undefined', () => {
      expect(() => expectDefined(undefined, 'Value required')).toThrow(
        ValidationError,
      )
    })
  })

  describe('expectValid', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().positive(),
    })

    test('returns parsed value for valid data', () => {
      const data = { name: 'John', age: 30 }
      const result = expectValid(schema, data)

      expect(result).toEqual(data)
    })

    test('throws ValidationError for invalid data', () => {
      const data = { name: 'John', age: -5 }

      expect(() => expectValid(schema, data)).toThrow(ValidationError)
    })

    test('includes context in error message', () => {
      const data = { name: 123 }
      expect(() => expectValid(schema, data, 'user data')).toThrow(/user data/)
    })
  })

  describe('assert', () => {
    test('does nothing when condition is true', () => {
      expect(() => assert(true, 'Should not throw')).not.toThrow()
    })

    test('throws when condition is false', () => {
      expect(() => assert(false, 'Assertion failed')).toThrow(APIError)
    })

    test('uses custom status code', () => {
      try {
        assert(false, 'Not found', 404, 'NOT_FOUND')
      } catch (error) {
        expect((error as APIError).statusCode).toBe(404)
        expect((error as APIError).code).toBe('NOT_FOUND')
      }
    })
  })
})
