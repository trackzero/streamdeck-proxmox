import https from "https";
import axios, { AxiosInstance, AxiosError } from "axios";
import type {
  ProxmoxConnectionSettings,
  ClusterResource,
  NodeInfo,
  VmListEntry,
  PveApiResponse,
  VmAction,
} from "./types.js";

export class ProxmoxClient {
  private http: AxiosInstance;

  constructor(private settings: ProxmoxConnectionSettings) {
    const host = settings.host.includes(":")
      ? settings.host
      : `${settings.host}:8006`;

    this.http = axios.create({
      baseURL: `https://${host}/api2/json`,
      headers: {
        Authorization: `PVEAPIToken=${settings.apiToken}`,
        "Content-Type": "application/json",
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: !settings.allowSelfSigned,
      }),
      timeout: 10_000,
    });
  }

  /** Fetch all cluster resources (VMs, containers, nodes, storage) in one call */
  async getClusterResources(): Promise<ClusterResource[]> {
    try {
      const res = await this.http.get<PveApiResponse<ClusterResource[]>>(
        "/cluster/resources"
      );
      return res.data.data;
    } catch (err) {
      throw this.wrapError("getClusterResources", err);
    }
  }

  /** Fetch list of nodes */
  async getNodes(): Promise<NodeInfo[]> {
    try {
      const res = await this.http.get<PveApiResponse<NodeInfo[]>>("/nodes");
      return res.data.data;
    } catch (err) {
      throw this.wrapError("getNodes", err);
    }
  }

  /**
   * Fetch all VMs (QEMU + LXC) for a node.
   * Returns combined list with `type` field injected.
   */
  async getVMs(node: string): Promise<VmListEntry[]> {
    try {
      const [qemuRes, lxcRes] = await Promise.allSettled([
        this.http.get<PveApiResponse<VmListEntry[]>>(`/nodes/${node}/qemu`),
        this.http.get<PveApiResponse<VmListEntry[]>>(`/nodes/${node}/lxc`),
      ]);

      const vms: VmListEntry[] = [];

      if (qemuRes.status === "fulfilled") {
        for (const vm of qemuRes.value.data.data) {
          vms.push({ ...vm, type: "qemu" });
        }
      }
      if (lxcRes.status === "fulfilled") {
        for (const ct of lxcRes.value.data.data) {
          vms.push({ ...ct, type: "lxc" });
        }
      }

      return vms.sort((a, b) => a.vmid - b.vmid);
    } catch (err) {
      throw this.wrapError("getVMs", err);
    }
  }

  /**
   * Execute a power action on a VM or LXC container.
   * Returns the UPID task identifier.
   */
  async vmAction(
    node: string,
    vmType: "qemu" | "lxc",
    vmid: number,
    action: VmAction
  ): Promise<string> {
    try {
      const res = await this.http.post<PveApiResponse<string>>(
        `/nodes/${node}/${vmType}/${vmid}/status/${action}`
      );
      return res.data.data;
    } catch (err) {
      throw this.wrapError(`vmAction(${action})`, err);
    }
  }

  /** Returns a user-friendly error message */
  private wrapError(context: string, err: unknown): Error {
    if (err instanceof AxiosError) {
      if (err.code === "ECONNREFUSED") {
        return new Error(
          `Cannot connect to Proxmox at ${this.settings.host} — connection refused`
        );
      }
      if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT") {
        return new Error(`Proxmox request timed out (${context})`);
      }
      if (err.code === "CERT_HAS_EXPIRED" || err.code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
        return new Error(
          "SSL certificate error — enable 'Allow self-signed certificate' in settings"
        );
      }
      if (err.response?.status === 401) {
        return new Error("Proxmox authentication failed — check your API token");
      }
      if (err.response?.status === 403) {
        return new Error("Proxmox permission denied — token lacks required privileges");
      }
      if (err.response?.status === 500) {
        const msg = (err.response.data as { errors?: Record<string, string> })?.errors;
        return new Error(`Proxmox error: ${JSON.stringify(msg) ?? "internal server error"}`);
      }
      return new Error(
        `Proxmox API error (${context}): ${err.message}`
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
