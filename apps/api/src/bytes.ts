/**
 * Prisma's `Bytes` columns type as `Uint8Array<ArrayBuffer>`, which Node's
 * `Buffer` (ArrayBufferLike) does not satisfy under @types/node. `toBytes` copies
 * into a fresh ArrayBuffer-backed Uint8Array for Prisma reads/writes.
 */
export function toBytes(b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(b.byteLength);
  out.set(b);
  return out;
}
