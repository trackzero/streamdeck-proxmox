import type { JsonValue } from "@elgato/utils";

/** Connection settings shared across all actions for a given Proxmox host */
export interface ProxmoxConnectionSettings {
  /** Hostname or IP with optional port, e.g. "192.168.1.10:8006" */
  host: string;
  /** Full API token string: "user@realm!tokenid=uuid" */
  apiToken: string;
  /** Whether to skip TLS certificate verification (needed for self-signed certs) */
  allowSelfSigned: boolean;
}

/**
 * Settings stored per VM Monitor action instance.
 * Index signature added so this satisfies @elgato/streamdeck's JsonObject constraint.
 */
export interface VmMonitorSettings extends ProxmoxConnectionSettings {
  /** Proxmox node name (e.g. "pve") */
  node: string;
  /** VM type */
  vmType: "qemu" | "lxc";
  /** VM/Container ID */
  vmid: number;
  /** Whether to require a confirmation press before executing actions */
  requireConfirmation: boolean;
  /** Duration in milliseconds a key must be held to trigger reboot (default: 500) */
  longPressMs: number;
  /** Index signature required to satisfy JsonObject */
  [key: string]: JsonValue;
}

/** A resource entry from /api2/json/cluster/resources */
export interface ClusterResource {
  type: "qemu" | "lxc" | "node" | "storage" | "sdn";
  id: string;
  node: string;
  vmid?: number;
  name?: string;
  status: string;
  /** CPU usage as fraction 0..1 (can exceed 1 on multi-core) */
  cpu: number;
  maxcpu: number;
  /** Memory used in bytes */
  mem: number;
  /** Memory max in bytes */
  maxmem: number;
  /** Disk used in bytes */
  disk: number;
  /** Disk max in bytes */
  maxdisk: number;
  uptime?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
}

/** Entry from /api2/json/nodes */
export interface NodeInfo {
  node: string;
  status: string;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  uptime: number;
}

/** Entry from /api2/json/nodes/{node}/qemu or /lxc */
export interface VmListEntry {
  vmid: number;
  name: string;
  status: string;
  type: "qemu" | "lxc";
}

/** Proxmox API envelope */
export interface PveApiResponse<T> {
  data: T;
}

/** Possible VM/LXC power actions */
export type VmAction = "start" | "stop" | "reboot" | "shutdown" | "reset" | "suspend" | "resume";
