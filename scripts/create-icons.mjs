#!/usr/bin/env node
/**
 * scripts/create-icons.mjs
 *
 * Generates the PNG icon files required by the @elgato/cli package validator.
 * Uses only Node.js built-in modules — no extra npm dependencies.
 *
 * Run once (or after changing icon colors):
 *   npm run icons
 */

import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

// ── CRC32 ──────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── PNG chunk helper ────────────────────────────────────────────────────────

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length);
  const crcVal = Buffer.allocUnsafe(4);
  crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcVal]);
}

// ── Solid-colour PNG generator ──────────────────────────────────────────────

/**
 * Creates a valid PNG buffer filled with a single RGB colour.
 * @param {number} w Width in pixels
 * @param {number} h Height in pixels
 * @param {number} r Red   0–255
 * @param {number} g Green 0–255
 * @param {number} b Blue  0–255
 * @returns {Buffer}
 */
function solidPng(w, h, r, g, b) {
  // IHDR: width, height, bit-depth=8, colour-type=2 (RGB), compress=0, filter=0, interlace=0
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Raw scanlines: 1 filter byte (0=None) + w*3 RGB bytes per row
  const row = Buffer.allocUnsafe(1 + w * 3);
  row[0] = 0;
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const idat = deflateSync(raw);

  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    PNG_SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Write helper ────────────────────────────────────────────────────────────

function write(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  console.log(`  wrote ${path}`);
}

// ── Icon definitions ────────────────────────────────────────────────────────

const BASE = "com.trackzero.proxmox.sdPlugin/imgs";

const icons = [
  // Plugin icon — dark navy, 28×28 and @2x 56×56
  { path: `${BASE}/plugin-icon.png`,       w: 28,  h: 28,  r: 0x1a, g: 0x1a, b: 0x2e },
  { path: `${BASE}/plugin-icon@2x.png`,    w: 56,  h: 56,  r: 0x1a, g: 0x1a, b: 0x2e },

  // Action icon — dark blue, 20×20 and @2x 40×40
  { path: `${BASE}/actions/vm-monitor/action-icon.png`,    w: 20,  h: 20,  r: 0x1e, g: 0x3a, b: 0x5f },
  { path: `${BASE}/actions/vm-monitor/action-icon@2x.png`, w: 40,  h: 40,  r: 0x1e, g: 0x3a, b: 0x5f },

  // Key default state — dark charcoal (matches unconfigured colour in canvas.ts), 72×72 and @2x 144×144
  { path: `${BASE}/actions/vm-monitor/key.png`,    w: 72,  h: 72,  r: 0x26, g: 0x32, b: 0x38 },
  { path: `${BASE}/actions/vm-monitor/key@2x.png`, w: 144, h: 144, r: 0x26, g: 0x32, b: 0x38 },
];

// ── Main ────────────────────────────────────────────────────────────────────

console.log("Generating PNG icon files…");
for (const { path, w, h, r, g, b } of icons) {
  write(path, solidPng(w, h, r, g, b));
}
console.log(`\n✓ ${icons.length} files written.`);
