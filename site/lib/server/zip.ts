/**
 * Minimal, defensive ZIP reader for provider model archives (KIRI returns the
 * finished 3DGS as a zip). Parses the central directory, supports stored and
 * deflated entries via node:zlib, and refuses archives that could be used to
 * exhaust memory or escape a path (zip bombs, `..` names, absolute names).
 */
import { inflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; compressedSize: number; size: number; method: number; localHeaderOffset: number; crc32: number };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export function listZipEntries(bytes: Uint8Array, limits: { maxEntries?: number; maxTotalBytes?: number } = {}): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const maxEntries = limits.maxEntries ?? 512;
  const maxTotal = limits.maxTotalBytes ?? 2 * 1024 * 1024 * 1024;
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("not a zip archive");
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count > maxEntries) throw new ZipError(`archive lists ${count} entries; limit is ${maxEntries}`);
  const entries: ZipEntry[] = [];
  let cursor = cdOffset;
  let total = 0;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL) throw new ZipError("corrupt central directory");
    const method = view.getUint16(cursor + 10, true);
    const crc32 = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (compressedSize === 0xffffffff || size === 0xffffffff) throw new ZipError("zip64 archives are not supported");
    if (name.includes("\0") || name.startsWith("/") || name.startsWith("\\") || /^[a-zA-Z]:/.test(name) || name.split(/[\\/]/).includes("..")) throw new ZipError(`unsafe entry name: ${JSON.stringify(name)}`);
    total += size;
    if (total > maxTotal) throw new ZipError("archive expands beyond the accepted size");
    entries.push({ name, compressedSize, size, method, localHeaderOffset, crc32 });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localHeaderOffset;
  if (at + 30 > bytes.length || view.getUint32(at, true) !== LOCAL) throw new ZipError("corrupt local header");
  const nameLength = view.getUint16(at + 26, true);
  const extraLength = view.getUint16(at + 28, true);
  const start = at + 30 + nameLength + extraLength;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) throw new ZipError("truncated entry");
  if (entry.method === 0) return data;
  if (entry.method === 8) {
    const out = inflateRawSync(data, { maxOutputLength: entry.size + 1 });
    if (out.length !== entry.size) throw new ZipError("entry size mismatch");
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }
  throw new ZipError(`unsupported compression method ${entry.method}`);
}
