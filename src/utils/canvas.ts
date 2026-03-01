import type { ClusterResource } from "../proxmox/types.js";

export type KeyDisplayState =
  | "normal"
  | "loading"
  | "error"
  | "confirm-stop"
  | "confirm-start"
  | "confirm-reboot"
  | "actioning";

const STATUS_COLORS: Record<string, string> = {
  running: "#2e7d32",
  stopped: "#b71c1c",
  paused: "#e65100",
  suspended: "#4527a0",
  unknown: "#424242",
};

const CONFIRM_COLOR = "#f57f17";
const LOADING_COLOR = "#1565c0";
const ERROR_COLOR = "#37474f";
const ACTIONING_COLOR = "#00695c";

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? STATUS_COLORS["unknown"];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function pct(used: number, max: number): string {
  if (!max || max === 0) return "—";
  return `${Math.round((used / max) * 100)}%`;
}

function bar(used: number, max: number, width = 48): string {
  if (!max || max === 0) return "";
  const fill = Math.round((used / max) * width);
  const empty = width - fill;
  return `<rect x="12" y="{Y}" width="${fill}" height="3" rx="1" fill="{COLOR}" opacity="0.9"/>` +
    `<rect x="${12 + fill}" y="{Y}" width="${empty}" height="3" rx="1" fill="#555"/>`;
}

function toBase64Svg(svg: string): string {
  const b64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}

/** Generate a key image for a VM with live stats */
export function buildKeyImage(
  vm: ClusterResource | null,
  state: KeyDisplayState,
  errorMsg?: string
): string {
  const size = 72;

  if (state === "loading" || !vm) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${LOADING_COLOR}"/>
  <text x="36" y="30" text-anchor="middle" fill="white" font-size="10" font-family="sans-serif" font-weight="bold">VM Monitor</text>
  <text x="36" y="46" text-anchor="middle" fill="white" font-size="9" font-family="sans-serif">Connecting…</text>
  <text x="36" y="60" text-anchor="middle" fill="#aaa" font-size="8" font-family="sans-serif">Check settings</text>
</svg>`;
    return toBase64Svg(svg);
  }

  if (state === "error") {
    const msg = truncate(errorMsg ?? "Error", 11);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${ERROR_COLOR}"/>
  <text x="36" y="22" text-anchor="middle" fill="#ff5252" font-size="18" font-family="sans-serif">⚠</text>
  <text x="36" y="40" text-anchor="middle" fill="white" font-size="9" font-family="sans-serif">Connection</text>
  <text x="36" y="52" text-anchor="middle" fill="white" font-size="9" font-family="sans-serif">Error</text>
  <text x="36" y="65" text-anchor="middle" fill="#aaa" font-size="7" font-family="sans-serif">${esc(msg)}</text>
</svg>`;
    return toBase64Svg(svg);
  }

  if (state === "confirm-stop") {
    return buildConfirmImage(vm, "STOP?", CONFIRM_COLOR);
  }
  if (state === "confirm-start") {
    return buildConfirmImage(vm, "START?", "#1b5e20");
  }
  if (state === "confirm-reboot") {
    return buildConfirmImage(vm, "REBOOT?", CONFIRM_COLOR);
  }
  if (state === "actioning") {
    return buildActioningImage(vm);
  }

  // Normal display
  const name = truncate(vm.name ?? `VM ${vm.vmid}`, 9);
  const bgColor = statusColor(vm.status);
  const cpuPct = pct(vm.cpu * (vm.maxcpu || 1), vm.maxcpu || 1);
  const ramPct = pct(vm.mem, vm.maxmem);

  const cpuBar = bar(vm.cpu, 1)
    .replace("{Y}", "44")
    .replace("{COLOR}", "#81c784");
  const ramBar = bar(vm.mem, vm.maxmem)
    .replace("{Y}", "57")
    .replace("{COLOR}", "#64b5f6");

  const typeLabel = vm.type === "lxc" ? "LXC" : "VM";
  const statusLabel = vm.status.toUpperCase();
  const statusDotColor = vm.status === "running" ? "#69f0ae" : "#ef5350";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bgColor}"/>
  <!-- Header bar -->
  <rect width="${size}" height="16" fill="rgba(0,0,0,0.3)"/>
  <text x="5" y="11" fill="#aaa" font-size="7" font-family="monospace">${typeLabel}</text>
  <text x="36" y="11" text-anchor="middle" fill="white" font-size="9" font-family="sans-serif" font-weight="bold">${esc(name)}</text>
  <!-- Status indicator -->
  <circle cx="60" cy="8" r="4" fill="${statusDotColor}"/>
  <!-- Status text -->
  <text x="36" y="26" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="8" font-family="sans-serif">${statusLabel}</text>
  <!-- CPU row -->
  <text x="5" y="42" fill="#81c784" font-size="7" font-family="monospace">CPU</text>
  <text x="67" y="42" text-anchor="end" fill="#81c784" font-size="7" font-family="monospace">${esc(cpuPct)}</text>
  ${cpuBar}
  <!-- RAM row -->
  <text x="5" y="55" fill="#64b5f6" font-size="7" font-family="monospace">RAM</text>
  <text x="67" y="55" text-anchor="end" fill="#64b5f6" font-size="7" font-family="monospace">${esc(ramPct)}</text>
  ${ramBar}
  <!-- VM ID -->
  <text x="36" y="69" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="7" font-family="monospace">#${vm.vmid}</text>
</svg>`;

  return toBase64Svg(svg);
}

function buildConfirmImage(vm: ClusterResource, label: string, bgColor: string): string {
  const size = 72;
  const name = truncate(vm.name ?? `VM ${vm.vmid}`, 9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bgColor}"/>
  <text x="36" y="14" text-anchor="middle" fill="white" font-size="9" font-family="sans-serif">${esc(name)}</text>
  <text x="36" y="34" text-anchor="middle" fill="white" font-size="16" font-family="sans-serif" font-weight="bold">${esc(label)}</text>
  <text x="36" y="50" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="8" font-family="sans-serif">Press again</text>
  <text x="36" y="62" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="8" font-family="sans-serif">to confirm</text>
</svg>`;
  return toBase64Svg(svg);
}

function buildActioningImage(vm: ClusterResource): string {
  const size = 72;
  const name = truncate(vm.name ?? `VM ${vm.vmid}`, 9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${ACTIONING_COLOR}"/>
  <text x="36" y="20" text-anchor="middle" fill="white" font-size="9" font-family="sans-serif">${esc(name)}</text>
  <text x="36" y="40" text-anchor="middle" fill="white" font-size="12" font-family="sans-serif">Working…</text>
  <text x="36" y="58" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-size="8" font-family="sans-serif">Please wait</text>
</svg>`;
  return toBase64Svg(svg);
}

/** Build an unconfigured/placeholder key image */
export function buildUnconfiguredImage(): string {
  const size = 72;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#263238"/>
  <text x="36" y="25" text-anchor="middle" fill="#546e7a" font-size="9" font-family="sans-serif">VM Monitor</text>
  <text x="36" y="42" text-anchor="middle" fill="#546e7a" font-size="20">⚙</text>
  <text x="36" y="58" text-anchor="middle" fill="#546e7a" font-size="8" font-family="sans-serif">Not configured</text>
</svg>`;
  return toBase64Svg(svg);
}
