// Type guards for Bun runtime

type BunValue = string | number | boolean | bigint | symbol | object | null | undefined

export function isString(value: BunValue): value is string {
  return typeof value === 'string'
}

export function isArrayBuffer(value: BunValue): value is ArrayBuffer {
  return value instanceof ArrayBuffer
}

export function isUint8Array(value: BunValue): value is Uint8Array {
  return value instanceof Uint8Array
}
