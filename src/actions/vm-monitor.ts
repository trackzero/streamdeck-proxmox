import streamDeck, {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  KeyUpEvent,
  SendToPluginEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import type { KeyAction } from "@elgato/streamdeck";
import { ProxmoxClient } from "../proxmox/client.js";
import type { ClusterResource, VmMonitorSettings } from "../proxmox/types.js";
import { pollingManager } from "../utils/polling.js";
import {
  buildKeyImage,
  buildUnconfiguredImage,
  type KeyDisplayState,
} from "../utils/canvas.js";

const logger = streamDeck.logger.createScope("VmMonitor");

/** Per-instance runtime state (not persisted to settings) */
interface InstanceState {
  actionRef: KeyAction<VmMonitorSettings> | null;
  keyDownAt: number | null;
  holdTimer: ReturnType<typeof setTimeout> | null;
  confirmState: "none" | "confirm-stop" | "confirm-start" | "confirm-reboot";
  confirmTimer: ReturnType<typeof setTimeout> | null;
  lastResource: ClusterResource | null;
  listenerBound: boolean;
  /** Remember connection settings so we can unsubscribe even after settings change */
  boundSettings: VmMonitorSettings | null;
}

function defaultInstanceState(): InstanceState {
  return {
    actionRef: null,
    keyDownAt: null,
    holdTimer: null,
    confirmState: "none",
    confirmTimer: null,
    lastResource: null,
    listenerBound: false,
    boundSettings: null,
  };
}

function isConfigured(
  s: Partial<VmMonitorSettings>
): s is VmMonitorSettings {
  return !!(
    s.host?.trim() &&
    s.apiToken?.trim() &&
    s.node?.trim() &&
    s.vmType &&
    s.vmid != null &&
    !isNaN(Number(s.vmid))
  );
}

@action({ UUID: "com.trackzero.proxmox.vm-monitor" })
export class VmMonitorAction extends SingletonAction<VmMonitorSettings> {
  private state = new Map<string, InstanceState>();

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  override async onWillAppear(
    ev: WillAppearEvent<VmMonitorSettings>
  ): Promise<void> {
    if (!ev.action.isKey()) return;
    const id = ev.action.id;

    if (!this.state.has(id)) {
      this.state.set(id, defaultInstanceState());
    }
    const st = this.state.get(id)!;
    st.actionRef = ev.action;

    const settings = ev.payload.settings;
    if (!isConfigured(settings)) {
      await ev.action.setImage(buildUnconfiguredImage());
      return;
    }

    this.startListening(id, ev.action, settings);
  }

  override onWillDisappear(
    ev: WillDisappearEvent<VmMonitorSettings>
  ): void {
    const id = ev.action.id;
    const st = this.state.get(id);
    if (st) {
      this.clearTimers(st);
      if (st.listenerBound && st.boundSettings) {
        pollingManager.unsubscribe(st.boundSettings, id);
        st.listenerBound = false;
      }
    }
    this.state.delete(id);
  }

  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<VmMonitorSettings>
  ): Promise<void> {
    if (!ev.action.isKey()) return;
    const id = ev.action.id;

    if (!this.state.has(id)) {
      this.state.set(id, defaultInstanceState());
    }
    const st = this.state.get(id)!;
    st.actionRef = ev.action;

    // Unsubscribe old listener if settings changed
    if (st.listenerBound && st.boundSettings) {
      pollingManager.unsubscribe(st.boundSettings, id);
      st.listenerBound = false;
      st.boundSettings = null;
    }

    const settings = ev.payload.settings;
    if (!isConfigured(settings)) {
      await ev.action.setImage(buildUnconfiguredImage());
      return;
    }

    this.startListening(id, ev.action, settings);
  }

  // ── Key events ─────────────────────────────────────────────────────────────

  override async onKeyDown(
    ev: KeyDownEvent<VmMonitorSettings>
  ): Promise<void> {
    const id = ev.action.id;
    const st = this.state.get(id);
    if (!st) return;

    const settings = ev.payload.settings;
    if (!isConfigured(settings)) return;

    st.keyDownAt = Date.now();
    const longPressMs = settings.longPressMs ?? 500;

    // Start hold-timer; fires if key is still held at threshold
    st.holdTimer = setTimeout(async () => {
      st.holdTimer = null;
      if (!ev.action.isKey()) return;
      await this.triggerReboot(id, ev.action, settings, st);
    }, longPressMs);
  }

  override async onKeyUp(
    ev: KeyUpEvent<VmMonitorSettings>
  ): Promise<void> {
    const id = ev.action.id;
    const st = this.state.get(id);
    if (!st) return;

    const settings = ev.payload.settings;
    if (!isConfigured(settings)) return;

    const elapsed = st.keyDownAt != null ? Date.now() - st.keyDownAt : 0;
    st.keyDownAt = null;

    const longPressMs = settings.longPressMs ?? 500;

    // Hold-timer already fired → reboot already triggered; nothing to do
    if (!st.holdTimer && elapsed >= longPressMs) {
      return;
    }

    // Cancel hold-timer → treat as short press
    if (st.holdTimer) {
      clearTimeout(st.holdTimer);
      st.holdTimer = null;
    }

    if (!ev.action.isKey()) return;

    // Handle confirmation second-press for toggle actions
    if (
      st.confirmState === "confirm-stop" ||
      st.confirmState === "confirm-start"
    ) {
      await this.executeConfirmedToggle(id, ev.action, settings, st);
      return;
    }

    // Handle confirmation second-press for reboot (via short press after long-press confirm prompt)
    if (st.confirmState === "confirm-reboot") {
      this.clearConfirmTimer(st);
      st.confirmState = "none";
      const rebootAction = settings.vmType === "lxc" ? "restart" : "reboot";
      await this.executeVmAction(id, ev.action, settings, st, rebootAction);
      return;
    }

    await this.triggerToggle(id, ev.action, settings, st);
  }

  // ── Property Inspector messages ─────────────────────────────────────────────

  override async onSendToPlugin(
    ev: SendToPluginEvent<JsonValue, VmMonitorSettings>
  ): Promise<void> {
    const payload = ev.payload as Record<string, unknown>;
    if (payload.event === "testConnection") {
      await this.handleTestConnection(payload);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private startListening(
    id: string,
    actionRef: KeyAction<VmMonitorSettings>,
    settings: VmMonitorSettings
  ): void {
    const st = this.state.get(id)!;

    pollingManager.subscribe(
      settings,
      settings.vmid,
      settings.vmType,
      id,
      async (resource, error) => {
        const currentSt = this.state.get(id);
        if (!currentSt?.actionRef) return;

        if (error) {
          currentSt.lastResource = null;
          const img = buildKeyImage(null, "error", shortErrorMsg(error.message));
          await currentSt.actionRef.setImage(img).catch(() => {});
          return;
        }

        currentSt.lastResource = resource;

        // Don't overwrite confirmation/actioning states mid-confirmation
        if (currentSt.confirmState !== "none") return;

        const img = buildKeyImage(resource, "normal");
        await currentSt.actionRef.setImage(img).catch(() => {});
      }
    );

    st.listenerBound = true;
    st.boundSettings = settings;

    // Show loading state immediately while first poll fires
    actionRef.setImage(buildKeyImage(null, "loading")).catch(() => {});
  }

  private async triggerToggle(
    id: string,
    actionRef: KeyAction<VmMonitorSettings>,
    settings: VmMonitorSettings,
    st: InstanceState
  ): Promise<void> {
    const resource = st.lastResource;
    const isRunning = resource?.status === "running";
    const targetAction = isRunning ? "stop" : "start";
    const confirmNeeded: InstanceState["confirmState"] = isRunning
      ? "confirm-stop"
      : "confirm-start";

    if (settings.requireConfirmation) {
      st.confirmState = confirmNeeded;
      await actionRef.setImage(
        buildKeyImage(resource, confirmNeeded as KeyDisplayState)
      );

      st.confirmTimer = setTimeout(async () => {
        const currentSt = this.state.get(id);
        if (!currentSt) return;
        currentSt.confirmState = "none";
        currentSt.confirmTimer = null;
        await actionRef
          .setImage(buildKeyImage(currentSt.lastResource, "normal"))
          .catch(() => {});
      }, 3_000);
      return;
    }

    await this.executeVmAction(id, actionRef, settings, st, targetAction);
  }

  private async executeConfirmedToggle(
    id: string,
    actionRef: KeyAction<VmMonitorSettings>,
    settings: VmMonitorSettings,
    st: InstanceState
  ): Promise<void> {
    const resource = st.lastResource;
    const isRunning = resource?.status === "running";
    const targetAction = isRunning ? "stop" : "start";

    this.clearConfirmTimer(st);
    st.confirmState = "none";

    await this.executeVmAction(id, actionRef, settings, st, targetAction);
  }

  private async triggerReboot(
    id: string,
    actionRef: KeyAction<VmMonitorSettings>,
    settings: VmMonitorSettings,
    st: InstanceState
  ): Promise<void> {
    const resource = st.lastResource;

    if (settings.requireConfirmation && st.confirmState === "none") {
      st.confirmState = "confirm-reboot";
      await actionRef.setImage(buildKeyImage(resource, "confirm-reboot"));

      st.confirmTimer = setTimeout(async () => {
        const currentSt = this.state.get(id);
        if (!currentSt) return;
        currentSt.confirmState = "none";
        currentSt.confirmTimer = null;
        await actionRef
          .setImage(buildKeyImage(currentSt.lastResource, "normal"))
          .catch(() => {});
      }, 3_000);
      return;
    }

    const rebootAction = settings.vmType === "lxc" ? "restart" : "reboot";
    await this.executeVmAction(id, actionRef, settings, st, rebootAction);
  }

  private async executeVmAction(
    id: string,
    actionRef: KeyAction<VmMonitorSettings>,
    settings: VmMonitorSettings,
    st: InstanceState,
    vmAction: string
  ): Promise<void> {
    await actionRef.setImage(buildKeyImage(st.lastResource, "actioning"));

    try {
      const client = new ProxmoxClient(settings);
      await client.vmAction(
        settings.node,
        settings.vmType,
        settings.vmid,
        vmAction as import("../proxmox/types.js").VmAction
      );
      await actionRef.showOk();
      pollingManager.refresh(settings).catch((err) => {
        logger.error("Refresh after action failed:", err);
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`vmAction(${vmAction}) failed:`, err);
      await actionRef
        .setImage(buildKeyImage(st.lastResource, "error", shortErrorMsg(errMsg)))
        .catch(() => {});
    }
  }

  private async handleTestConnection(
    payload: Record<string, unknown>
  ): Promise<void> {
    const { host, apiToken, allowSelfSigned } = payload as {
      host: string;
      apiToken: string;
      allowSelfSigned: boolean;
    };

    if (!host || !apiToken) {
      await streamDeck.ui.sendToPropertyInspector({
        event: "connectionResult",
        success: false,
        error: "Host and API token are required",
      });
      return;
    }

    try {
      const client = new ProxmoxClient({
        host,
        apiToken,
        allowSelfSigned: allowSelfSigned ?? true,
      });
      const nodes = await client.getNodes();

      const nodeVms = await Promise.allSettled(
        nodes.map(async (n) => ({
          node: n.node,
          vms: await client.getVMs(n.node),
        }))
      );

      const vmList: Array<{
        vmid: number;
        name: string;
        type: string;
        node: string;
        status: string;
      }> = [];

      for (const result of nodeVms) {
        if (result.status === "fulfilled") {
          for (const vm of result.value.vms) {
            vmList.push({
              vmid: vm.vmid,
              name: vm.name,
              type: vm.type,
              node: result.value.node,
              status: vm.status,
            });
          }
        }
      }

      await streamDeck.ui.sendToPropertyInspector({
        event: "connectionResult",
        success: true,
        nodes: nodes.map((n) => n.node),
        vms: vmList,
      });
    } catch (err) {
      await streamDeck.ui.sendToPropertyInspector({
        event: "connectionResult",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private clearTimers(st: InstanceState): void {
    if (st.holdTimer) {
      clearTimeout(st.holdTimer);
      st.holdTimer = null;
    }
    this.clearConfirmTimer(st);
  }

  private clearConfirmTimer(st: InstanceState): void {
    if (st.confirmTimer) {
      clearTimeout(st.confirmTimer);
      st.confirmTimer = null;
    }
  }
}

function shortErrorMsg(msg: string): string {
  const match = msg.match(/^([^–—(]+)/);
  return (match?.[1] ?? msg).trim().slice(0, 20);
}
