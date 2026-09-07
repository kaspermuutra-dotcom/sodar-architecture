import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { listZipEntries, readZipEntry, ZipError } from "./zip";

/** Tiny zip writer for the tests (stored or deflated), mirroring lib/scanner/zip.ts. */
function makeZip(entries: Array<{ name: string; data: Uint8Array; deflate?: boolean }>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const payload = entry.deflate ? new Uint8Array(deflateRawSync(entry.data)) : entry.data;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, entry.deflate ? 8 : 0, true);
    local.setUint32(18, payload.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, payload);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(10, entry.deflate ? 8 : 0, true);
    cd.setUint32(20, payload.length, true);
    cd.setUint32(24, entry.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + payload.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("zip reader", () => {
  it("lists and extracts stored and deflated entries", () => {
    const text = new TextEncoder().encode("ply\nformat binary_little_endian 1.0\n".repeat(50));
    const zip = makeZip([{ name: "model/scene.ply", data: text, deflate: true }, { name: "readme.txt", data: new TextEncoder().encode("hi") }]);
    const entries = listZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(["model/scene.ply", "readme.txt"]);
    expect(new TextDecoder().decode(readZipEntry(zip, entries[0]))).toContain("binary_little_endian");
    expect(new TextDecoder().decode(readZipEntry(zip, entries[1]))).toBe("hi");
  });
  it("rejects path traversal, absolute names and non-zip data", () => {
    expect(() => listZipEntries(makeZip([{ name: "../evil.ply", data: new Uint8Array(1) }]))).toThrow(ZipError);
    expect(() => listZipEntries(makeZip([{ name: "/abs.ply", data: new Uint8Array(1) }]))).toThrow(ZipError);
    expect(() => listZipEntries(new Uint8Array(40))).toThrow(ZipError);
  });
  it("enforces entry count and expanded size limits", () => {
    const zip = makeZip(Array.from({ length: 3 }, (_, i) => ({ name: `${i}.bin`, data: new Uint8Array(10) })));
    expect(() => listZipEntries(zip, { maxEntries: 2 })).toThrow(/entries/);
    expect(() => listZipEntries(zip, { maxTotalBytes: 15 })).toThrow(/size/);
  });
});
