// Safe bigint-buffer implementation using native BigInt
// This replaces the vulnerable native addon version

function toBufferBE(num, width) {
  const hex = num.toString(16).padStart(width * 2, '0')
  return Buffer.from(hex, 'hex')
}

function toBufferLE(num, width) {
  const buffer = toBufferBE(num, width)
  return Buffer.from(buffer.reverse())
}

function toBigIntBE(buffer) {
  return BigInt('0x' + buffer.toString('hex'))
}

function toBigIntLE(buffer) {
  return toBigIntBE(Buffer.from(buffer).reverse())
}

module.exports = {
  toBufferBE,
  toBufferLE,
  toBigIntBE,
  toBigIntLE
}
