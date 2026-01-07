// Browser shim for node:crypto using Web Crypto API
export function randomBytes(size: number): Uint8Array {
  const buffer = new Uint8Array(size)
  crypto.getRandomValues(buffer)
  return buffer
}

export function randomUUID(): string {
  return crypto.randomUUID()
}

export function createHash(algorithm: string) {
  const data: Uint8Array[] = []

  return {
    update(input: string | Uint8Array) {
      if (typeof input === 'string') {
        data.push(new TextEncoder().encode(input))
      } else {
        data.push(input)
      }
      return this
    },
    async digest(encoding?: 'hex'): Promise<string | ArrayBuffer> {
      const totalLength = data.reduce((sum, arr) => sum + arr.length, 0)
      const combined = new Uint8Array(totalLength)
      let offset = 0
      for (const arr of data) {
        combined.set(arr, offset)
        offset += arr.length
      }

      const hashAlgorithm = algorithm === 'sha256' ? 'SHA-256' : 'SHA-256'
      const hashBuffer = await crypto.subtle.digest(hashAlgorithm, combined)

      if (encoding === 'hex') {
        return Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      }
      return hashBuffer
    },
  }
}

export default {
  randomBytes,
  randomUUID,
  createHash,
}
