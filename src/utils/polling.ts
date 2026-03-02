import { ProxmoxClient } from "../proxmox/client.js";
import type { ClusterResource, ProxmoxConnectionSettings } from "../proxmox/types.js";

export type ResourceListener = (
  resource: ClusterResource | null,
  error?: Error
) => void;

interface SubscriptionKey {
  vmid: number;
  vmType: "qemu" | "lxc";
  listenerId: string;
}

interface HostEntry {
  client: ProxmoxClient;
  intervalHandle: ReturnType<typeof setInterval> | null;
  lastResources: ClusterResource[];
  subscribers: Map<string, SubscriptionKey & { listener: ResourceListener }>;
  errorCount: number;
}

/** Unique key for a Proxmox host connection */
function hostKey(s: ProxmoxConnectionSettings): string {
  return `${s.host}::${s.apiToken}`;
}

/**
 * Singleton polling manager.
 * Maintains one polling interval per unique Proxmox host.
 * Multiple VM Monitor actions sharing the same host reuse the same poll.
 */
class PollingManager {
  private hosts = new Map<string, HostEntry>();
  private readonly POLL_INTERVAL_MS = 5_000;
  private readonly MAX_ERRORS_BEFORE_STOP = 5;

  subscribe(
    connectionSettings: ProxmoxConnectionSettings,
    vmid: number,
    vmType: "qemu" | "lxc",
    listenerId: string,
    listener: ResourceListener
  ): void {
    const key = hostKey(connectionSettings);

    if (!this.hosts.has(key)) {
      this.hosts.set(key, {
        client: new ProxmoxClient(connectionSettings),
        intervalHandle: null,
        lastResources: [],
        subscribers: new Map(),
        errorCount: 0,
      });
    }

    const entry = this.hosts.get(key)!;
    entry.subscribers.set(listenerId, { vmid, vmType, listenerId, listener });

    // Deliver last known data immediately if available
    if (entry.lastResources.length > 0) {
      const resource = this.findResource(entry.lastResources, vmid);
      listener(resource ?? null);
    }

    // Start polling if not already running
    if (!entry.intervalHandle) {
      // Immediate first poll
      this.poll(key);
      entry.intervalHandle = setInterval(() => this.poll(key), this.POLL_INTERVAL_MS);
    }
  }

  unsubscribe(
    connectionSettings: ProxmoxConnectionSettings,
    listenerId: string
  ): void {
    const key = hostKey(connectionSettings);
    const entry = this.hosts.get(key);
    if (!entry) return;

    entry.subscribers.delete(listenerId);

    // Stop polling when no more subscribers for this host
    if (entry.subscribers.size === 0) {
      if (entry.intervalHandle) {
        clearInterval(entry.intervalHandle);
        entry.intervalHandle = null;
      }
      this.hosts.delete(key);
    }
  }

  /** Force an immediate poll for a host (e.g., after a power action) */
  async refresh(connectionSettings: ProxmoxConnectionSettings): Promise<void> {
    const key = hostKey(connectionSettings);
    if (this.hosts.has(key)) {
      await this.poll(key);
    }
  }

  private async poll(key: string): Promise<void> {
    const entry = this.hosts.get(key);
    if (!entry || entry.subscribers.size === 0) return;

    try {
      const resources = await entry.client.getClusterResources();
      entry.lastResources = resources;
      entry.errorCount = 0;

      for (const sub of entry.subscribers.values()) {
        const resource = this.findResource(resources, sub.vmid);
        sub.listener(resource ?? null);
      }
    } catch (err) {
      entry.errorCount++;
      const error = err instanceof Error ? err : new Error(String(err));

      for (const sub of entry.subscribers.values()) {
        sub.listener(null, error);
      }

      // Stop polling after too many consecutive errors to avoid log spam
      if (entry.errorCount >= this.MAX_ERRORS_BEFORE_STOP && entry.intervalHandle) {
        clearInterval(entry.intervalHandle);
        entry.intervalHandle = null;
        // Restart after 30s backoff
        setTimeout(() => {
          if (entry.subscribers.size > 0 && !entry.intervalHandle) {
            entry.errorCount = 0;
            this.poll(key);
            entry.intervalHandle = setInterval(() => this.poll(key), this.POLL_INTERVAL_MS);
          }
        }, 30_000);
      }
    }
  }

  private findResource(
    resources: ClusterResource[],
    vmid: number,
  ): ClusterResource | undefined {
    // Match by vmid only; vmids are unique across qemu and lxc in Proxmox,
    // and settings.vmType may be stale/wrong.
    return resources.find(
      (r) => r.vmid === vmid && (r.type === "qemu" || r.type === "lxc")
    );
  }
}

// Singleton export
export const pollingManager = new PollingManager();
