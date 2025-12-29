export async function readResponseBody(
  response: Response,
  maxSize: number,
): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    throw new Error(`Response too large. Max size: ${maxSize} bytes`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const chunks: Uint8Array[] = []
  let totalSize = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    totalSize += value.length
    if (totalSize > maxSize) {
      reader.cancel()
      throw new Error(`Response too large. Max size: ${maxSize} bytes`)
    }
    chunks.push(value)
  }

  return new TextDecoder().decode(
    chunks.reduce((acc, chunk) => {
      const result = new Uint8Array(acc.length + chunk.length)
      result.set(acc)
      result.set(chunk, acc.length)
      return result
    }, new Uint8Array(0)),
  )
}
