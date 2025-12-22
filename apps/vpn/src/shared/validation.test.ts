/**
 * Unit tests for validation utilities
 */

import { describe, test, expect } from 'bun:test';
import { z } from 'zod';
import { expectValid, expectExists, expect as assertCondition, getExists } from './validation';

describe('expectValid', () => {
  const stringSchema = z.string().min(3);
  const numberSchema = z.number().int().positive();
  const objectSchema = z.object({
    name: z.string(),
    age: z.number(),
  });

  test('returns parsed value for valid input', () => {
    const result = expectValid(stringSchema, 'hello');
    expect(result).toBe('hello');
  });

  test('parses numbers correctly', () => {
    const result = expectValid(numberSchema, 42);
    expect(result).toBe(42);
  });

  test('parses objects correctly', () => {
    const input = { name: 'Alice', age: 30 };
    const result = expectValid(objectSchema, input);
    expect(result.name).toBe('Alice');
    expect(result.age).toBe(30);
  });

  test('throws on invalid string (too short)', () => {
    expect(() => expectValid(stringSchema, 'ab')).toThrow('Validation failed');
  });

  test('throws on invalid number (not positive)', () => {
    expect(() => expectValid(numberSchema, -5)).toThrow('Validation failed');
  });

  test('throws on invalid number (not integer)', () => {
    expect(() => expectValid(numberSchema, 3.5)).toThrow('Validation failed');
  });

  test('throws on missing object property', () => {
    expect(() => expectValid(objectSchema, { name: 'Alice' })).toThrow('Validation failed');
  });

  test('includes context in error message', () => {
    expect(() => expectValid(stringSchema, 'ab', 'user input')).toThrow('in user input');
  });

  test('includes path in error message', () => {
    const schema = z.object({
      user: z.object({
        email: z.string().email(),
      }),
    });
    expect(() => expectValid(schema, { user: { email: 'not-an-email' } })).toThrow('user.email');
  });

  test('handles transformations', () => {
    const transformSchema = z.string().transform((s) => s.toUpperCase());
    const result = expectValid(transformSchema, 'hello');
    expect(result).toBe('HELLO');
  });
});

describe('expectExists', () => {
  test('does not throw for existing value', () => {
    expect(() => expectExists('value', 'Value required')).not.toThrow();
  });

  test('does not throw for zero', () => {
    expect(() => expectExists(0, 'Value required')).not.toThrow();
  });

  test('does not throw for empty string', () => {
    expect(() => expectExists('', 'Value required')).not.toThrow();
  });

  test('does not throw for false', () => {
    expect(() => expectExists(false, 'Value required')).not.toThrow();
  });

  test('does not throw for object', () => {
    expect(() => expectExists({ key: 'value' }, 'Value required')).not.toThrow();
  });

  test('throws for null', () => {
    expect(() => expectExists(null, 'Value cannot be null')).toThrow('Value cannot be null');
  });

  test('throws for undefined', () => {
    expect(() => expectExists(undefined, 'Value cannot be undefined')).toThrow('Value cannot be undefined');
  });

  test('uses custom error message', () => {
    expect(() => expectExists(null, 'Custom error')).toThrow('Custom error');
  });
});

describe('expect (assertCondition)', () => {
  test('does not throw for true condition', () => {
    expect(() => assertCondition(true, 'Should be true')).not.toThrow();
  });

  test('does not throw for truthy expressions', () => {
    expect(() => assertCondition(1 > 0, 'Math works')).not.toThrow();
    expect(() => assertCondition('hello'.length > 0, 'String has length')).not.toThrow();
    expect(() => assertCondition([1, 2, 3].includes(2), 'Array includes value')).not.toThrow();
  });

  test('throws for false condition', () => {
    expect(() => assertCondition(false, 'Condition failed')).toThrow('Condition failed');
  });

  test('throws for falsy expressions', () => {
    expect(() => assertCondition(1 < 0, 'Math failed')).toThrow('Math failed');
    expect(() => assertCondition(''.length > 0, 'Empty string')).toThrow('Empty string');
  });

  test('uses custom error message', () => {
    expect(() => assertCondition(false, 'Custom assertion error')).toThrow('Custom assertion error');
  });
});

describe('getExists', () => {
  test('returns value when it exists', () => {
    const result = getExists('hello', 'Value required');
    expect(result).toBe('hello');
  });

  test('returns zero when value is zero', () => {
    const result = getExists(0, 'Value required');
    expect(result).toBe(0);
  });

  test('returns empty string when value is empty string', () => {
    const result = getExists('', 'Value required');
    expect(result).toBe('');
  });

  test('returns false when value is false', () => {
    const result = getExists(false, 'Value required');
    expect(result).toBe(false);
  });

  test('returns object when value is object', () => {
    const obj = { key: 'value' };
    const result = getExists(obj, 'Value required');
    expect(result).toBe(obj);
  });

  test('throws for null', () => {
    expect(() => getExists(null, 'Value is null')).toThrow('Value is null');
  });

  test('throws for undefined', () => {
    expect(() => getExists(undefined, 'Value is undefined')).toThrow('Value is undefined');
  });

  test('preserves type narrowing', () => {
    const maybeString: string | null = 'hello';
    const result: string = getExists(maybeString, 'String required');
    expect(result).toBe('hello');
  });
});
