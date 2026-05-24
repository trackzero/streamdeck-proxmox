#!/usr/bin/env node
/**
 * scripts/create-icons.mjs
 *
 * Generates:
 *  - White-on-transparent RGBA PNG icons (plugin, category, action)
 *  - Dark key default-state PNGs (key.png / key@2x.png)
 *  - 288×288 marketplace product icon (dark bg + white server rack)
 *  - SVG preview images for the marketplace product page
 *
 * Run: npm run icons
 */

import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

// ── CRC32 ────────────────────────────────────────────────────────────────────

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

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length);
  const crcVal = Buffer.allocUnsafe(4);
  crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcVal]);
}

// ── PNG encoders ──────────────────────────────────────────────────────────────

/** RGBA PNG (colour-type 6, transparent background support) */
function rgbaPng(w, h, pixels) {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;

  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.allocUnsafe(1 + w * 4);
    row[0] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = 1 + x * 4;
      row[d]=pixels[s]; row[d+1]=pixels[s+1]; row[d+2]=pixels[s+2]; row[d+3]=pixels[s+3];
    }
    rows.push(row);
  }

  const SIG = Buffer.from([137,80,78,71,13,10,26,10]);
  return Buffer.concat([
    SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Solid opaque RGB PNG (for dark key backgrounds) */
function solidPng(w, h, r, g, b) {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8]=8; ihdr[9]=2; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;

  const row = Buffer.allocUnsafe(1 + w * 3);
  row[0] = 0;
  for (let x = 0; x < w; x++) { row[1+x*3]=r; row[2+x*3]=g; row[3+x*3]=b; }

  const SIG = Buffer.from([137,80,78,71,13,10,26,10]);
  return Buffer.concat([
    SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Pixel canvas ──────────────────────────────────────────────────────────────

function makeCanvas(w, h) {
  const px = new Uint8Array(w * h * 4); // all transparent by default

  const setPixel = (x, y, r=255, g=255, b=255, a=255) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 4;
    px[i]=r; px[i+1]=g; px[i+2]=b; px[i+3]=a;
  };

  const fillRect = (x, y, fw, fh, r=255, g=255, b=255, a=255) => {
    x=Math.round(x); y=Math.round(y); fw=Math.round(fw); fh=Math.round(fh);
    for (let dy = 0; dy < fh; dy++)
      for (let dx = 0; dx < fw; dx++)
        setPixel(x+dx, y+dy, r, g, b, a);
  };

  const strokeRect = (x, y, sw, sh, t=1, r=255, g=255, b=255, a=255) => {
    t = Math.max(1, Math.round(t));
    sw = Math.round(sw); sh = Math.round(sh);
    x = Math.round(x); y = Math.round(y);
    fillRect(x, y, sw, t, r, g, b, a);          // top
    fillRect(x, y+sh-t, sw, t, r, g, b, a);     // bottom
    fillRect(x, y, t, sh, r, g, b, a);           // left
    fillRect(x+sw-t, y, t, sh, r, g, b, a);     // right
  };

  const fillCircle = (cx, cy, rc, r=255, g=255, b=255, a=255) => {
    cx=Math.round(cx); cy=Math.round(cy);
    for (let dy = -rc; dy <= rc; dy++)
      for (let dx = -rc; dx <= rc; dx++)
        if (dx*dx + dy*dy <= rc*rc + 0.5)
          setPixel(cx+dx, cy+dy, r, g, b, a);
  };

  return { setPixel, fillRect, strokeRect, fillCircle, toPng: () => rgbaPng(w, h, px) };
}

// ── Server rack drawing ────────────────────────────────────────────────────────

/**
 * Draws a server-rack icon onto `canvas` at position (ox, oy) scaled to `size`.
 * The design is defined in a 28-unit grid and scaled proportionally.
 * Pixels are drawn in white (255,255,255,255) by default.
 */
function drawServerRack(canvas, ox, oy, size) {
  const sr = v => Math.round(v * size / 28);

  const margin = sr(2);
  const ow     = size - margin * 2;
  const oh     = size - margin * 2;
  const border = Math.max(1, sr(1.8));
  canvas.strokeRect(ox + margin, oy + margin, ow, oh, border);

  const ix = ox + margin + border;
  const iy = oy + margin + border;
  const iw = ow - border * 2;
  const ih = oh - border * 2;

  const slotH = Math.max(2, sr(3.2));

  for (const fy of [0.22, 0.50, 0.78]) {
    const cy  = Math.round(iy + fy * ih);
    const sy  = cy - Math.floor(slotH / 2);
    const ledR = Math.max(1, sr(1.2));
    const ledX = Math.round(ix + sr(2.5));

    canvas.fillCircle(ledX, cy, ledR);

    const barX = ledX + ledR + Math.max(1, sr(1));
    const barW = (ix + iw - sr(1)) - barX;
    if (barW > 0) canvas.fillRect(barX, sy, barW, slotH);
  }
}

// ── Icon generators ───────────────────────────────────────────────────────────

/** Plugin / category icon: white server rack on transparent, any square size */
function serverRackIcon(size) {
  const c = makeCanvas(size, size);
  drawServerRack(c, 0, 0, size);
  return c.toPng();
}

/** Action icon: 2-slot server, optimised for 20×20 */
function actionIcon(size) {
  const c = makeCanvas(size, size);
  const sr = v => Math.round(v * size / 20);

  const margin = Math.max(1, sr(1.5));
  const ow     = size - margin * 2;
  const oh     = size - margin * 2;
  const border = Math.max(1, sr(1.2));
  c.strokeRect(margin, margin, ow, oh, border);

  const ix = margin + border;
  const iy = margin + border;
  const iw = ow - border * 2;
  const ih = oh - border * 2;

  const slotH = Math.max(2, sr(3));

  for (const fy of [0.33, 0.67]) {
    const cy   = Math.round(iy + fy * ih);
    const sy   = cy - Math.floor(slotH / 2);
    const ledR = Math.max(1, sr(1));
    const ledX = Math.round(ix + sr(2));
    c.fillCircle(ledX, cy, ledR);
    const barX = ledX + ledR + Math.max(1, sr(0.8));
    const barW = (ix + iw - sr(0.8)) - barX;
    if (barW > 0) c.fillRect(barX, sy, barW, slotH);
  }

  return c.toPng();
}

/** 288×288 marketplace product icon: white server rack on dark navy */
function marketplaceIcon() {
  const size = 288;
  const c = makeCanvas(size, size);
  c.fillRect(0, 0, size, size, 0x1a, 0x1a, 0x2e, 255); // dark navy bg
  const iconSize = Math.round(size * 0.60);
  const offset   = Math.floor((size - iconSize) / 2);
  drawServerRack(c, offset, offset, iconSize);
  return c.toPng();
}

// ── SVG preview image ─────────────────────────────────────────────────────────

function previewSvg() {
  const W = 1200, H = 675;

  const keys = [
    {
      name: "ubuntu-22", type: "VM", vmid: 100,
      bgColor: "#1b5e20", dotColor: "#69f0ae", statusLabel: "RUNNING",
      cpu: "12%", ram: "34%", cpuFill: 12, ramFill: 34,
    },
    {
      name: "win11-pro", type: "VM", vmid: 101,
      bgColor: "#7f1111", dotColor: "#ef5350", statusLabel: "STOPPED",
      cpu: "—", ram: "—", cpuFill: 0, ramFill: 0,
    },
    {
      name: "nginx-ct", type: "LXC", vmid: 200,
      bgColor: "#1b5e20", dotColor: "#69f0ae", statusLabel: "RUNNING",
      cpu: "3%", ram: "18%", cpuFill: 3, ramFill: 18,
    },
    {
      name: "plex", type: "VM", vmid: 102,
      bgColor: "#f57f17", dotColor: "", statusLabel: "STOP?",
      cpu: "", ram: "", cpuFill: 0, ramFill: 0,
      confirm: true,
    },
  ];

  const KS  = 148;  // key size
  const GAP = 28;
  const TOTAL_W = keys.length * KS + (keys.length - 1) * GAP;
  const KX0 = Math.floor((W - TOTAL_W) / 2);
  const KY  = Math.floor((H - KS) / 2) - 20;
  const R   = 14;   // corner radius

  const keysSvg = keys.map((k, i) => {
    const kx = KX0 + i * (KS + GAP);
    const ky = KY;

    if (k.confirm) {
      return `<g>
      <rect x="${kx}" y="${ky}" width="${KS}" height="${KS}" rx="${R}" fill="${k.bgColor}"/>
      <text x="${kx+KS/2}" y="${ky+30}" text-anchor="middle" fill="white" font-size="17" font-family="sans-serif">${k.name}</text>
      <text x="${kx+KS/2}" y="${ky+72}" text-anchor="middle" fill="white" font-size="30" font-weight="bold" font-family="sans-serif">STOP?</text>
      <text x="${kx+KS/2}" y="${ky+100}" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-size="15" font-family="sans-serif">Press again</text>
      <text x="${kx+KS/2}" y="${ky+118}" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-size="15" font-family="sans-serif">to confirm</text>
      <text x="${kx+KS/2}" y="${ky+KS-10}" text-anchor="middle" fill="rgba(255,255,255,0.4)" font-size="13" font-family="monospace">#${k.vmid}</text>
    </g>`;
    }

    const barW    = KS - 52;
    const cpuFill = Math.round(k.cpuFill / 100 * barW);
    const ramFill = Math.round(k.ramFill / 100 * barW);

    return `<g>
      <rect x="${kx}" y="${ky}" width="${KS}" height="${KS}" rx="${R}" fill="${k.bgColor}"/>
      <rect x="${kx}" y="${ky}" width="${KS}" height="34" rx="${R}" fill="rgba(0,0,0,0.3)"/>
      <rect x="${kx}" y="${ky+R}" width="${KS}" height="${34-R}" fill="rgba(0,0,0,0.3)"/>
      <text x="${kx+10}" y="${ky+22}" fill="#aaa" font-size="12" font-family="monospace">${k.type}</text>
      <text x="${kx+KS/2}" y="${ky+22}" text-anchor="middle" fill="white" font-size="16" font-weight="bold" font-family="sans-serif">${k.name}</text>
      <circle cx="${kx+KS-14}" cy="${ky+17}" r="7" fill="${k.dotColor}"/>
      <text x="${kx+KS/2}" y="${ky+54}" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="13" font-family="sans-serif">${k.statusLabel}</text>
      <text x="${kx+10}" y="${ky+84}" fill="#81c784" font-size="12" font-family="monospace">CPU</text>
      <text x="${kx+KS-10}" y="${ky+84}" text-anchor="end" fill="#81c784" font-size="12" font-family="monospace">${k.cpu}</text>
      <rect x="${kx+26}" y="${ky+88}" width="${barW}" height="6" rx="2" fill="#333"/>
      <rect x="${kx+26}" y="${ky+88}" width="${cpuFill}" height="6" rx="2" fill="#81c784"/>
      <text x="${kx+10}" y="${ky+110}" fill="#64b5f6" font-size="12" font-family="monospace">RAM</text>
      <text x="${kx+KS-10}" y="${ky+110}" text-anchor="end" fill="#64b5f6" font-size="12" font-family="monospace">${k.ram}</text>
      <rect x="${kx+26}" y="${ky+114}" width="${barW}" height="6" rx="2" fill="#333"/>
      <rect x="${kx+26}" y="${ky+114}" width="${ramFill}" height="6" rx="2" fill="#64b5f6"/>
      <text x="${kx+KS/2}" y="${ky+KS-10}" text-anchor="middle" fill="rgba(255,255,255,0.4)" font-size="13" font-family="monospace">#${k.vmid}</text>
    </g>`;
  }).join("\n");

  const captionY = KY + KS + 48;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0d1117"/>
  <text x="${W/2}" y="78" text-anchor="middle" fill="white" font-size="34" font-weight="bold" font-family="sans-serif">Proxmox Monitor</text>
  <text x="${W/2}" y="112" text-anchor="middle" fill="#888" font-size="18" font-family="sans-serif">Live VM status · CPU &amp; RAM · Start / Stop / Reboot · Optional confirmation</text>
  ${keysSvg}
  <text x="${W/2}" y="${captionY}" text-anchor="middle" fill="#555" font-size="15" font-family="sans-serif">Short press: start / stop  ·  Hold: reboot  ·  Multiple VMs share one API poll</text>
</svg>`;
}

// ── Write helper ──────────────────────────────────────────────────────────────

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`  wrote ${path}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const BASE = "com.trackzero.proxmox.sdPlugin/imgs";
const PREV = "com.trackzero.proxmox.sdPlugin/previews";

console.log("Generating in-app icons (white on transparent)…");
write(`${BASE}/plugin-icon.png`,                          serverRackIcon(28));
write(`${BASE}/plugin-icon@2x.png`,                      serverRackIcon(56));
write(`${BASE}/category-icon.png`,                       serverRackIcon(28));
write(`${BASE}/category-icon@2x.png`,                    serverRackIcon(56));
write(`${BASE}/actions/vm-monitor/action-icon.png`,      actionIcon(20));
write(`${BASE}/actions/vm-monitor/action-icon@2x.png`,   actionIcon(40));

console.log("\nGenerating key default-state backgrounds…");
write(`${BASE}/actions/vm-monitor/key.png`,    solidPng(72,  72,  0x26, 0x32, 0x38));
write(`${BASE}/actions/vm-monitor/key@2x.png`, solidPng(144, 144, 0x26, 0x32, 0x38));

console.log("\nGenerating marketplace assets…");
write("marketplace-icon-288.png",           marketplaceIcon());
write(`${PREV}/preview-keys.svg`,           Buffer.from(previewSvg(), "utf8"));

console.log(`
✓ Done.

Next steps for marketplace submission:
  1. Open com.trackzero.proxmox.sdPlugin/previews/preview-keys.svg in a browser
  2. Screenshot at 1200×675 and save as preview-keys.png
  3. Upload marketplace-icon-288.png as the product icon in Maker Console
  4. Upload preview-keys.png as the product preview image in Maker Console
`);
