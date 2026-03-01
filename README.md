# streamdeck-proxmox

A Stream Deck plugin for monitoring and controlling [Proxmox VE](https://www.proxmox.com/) virtual machines and LXC containers.

## Features

- **Live status display** — each key shows a VM's current state (running/stopped/paused) as a color-coded background
- **CPU & RAM metrics** — usage percentages with progress bars, updated every 5 seconds
- **Short press** — toggle start/stop
- **Hold to reboot** — press and hold (≥500ms) to trigger a reboot (or `restart` for LXC)
- **Optional confirmation** — enable a confirmation prompt per key; first press shows `STOP?`/`REBOOT?`, second press within 3s executes
- **Self-signed cert support** — works with Proxmox's default TLS setup out of the box
- **Efficient polling** — multiple keys sharing the same host reuse a single API poll

## Requirements

- [Stream Deck](https://www.elgato.com/stream-deck) (any model) or Stream Deck+
- [Stream Deck app](https://www.elgato.com/downloads) 6.4+
- Proxmox VE 7.x or 8.x
- Node.js 20+ (for development/building)

## Installation

### From release

1. Download the latest `com.trackzero.proxmox.streamDeckPlugin` from the [Releases](../../releases) page
2. Double-click the file — the Stream Deck app will install it automatically

### From source

```bash
git clone https://github.com/trackzero/streamdeck-proxmox.git
cd streamdeck-proxmox
npm install
npm run build
npm run package
```

Then double-click the generated `com.trackzero.proxmox.streamDeckPlugin`.

## Setup

### 1. Create a Proxmox API token

In the Proxmox web UI:

1. Go to **Datacenter → Permissions → API Tokens**
2. Click **Add**, choose a user (e.g. `root@pam`), give the token an ID (e.g. `streamdeck`), and uncheck **Privilege Separation** (or assign explicit roles)
3. Copy the displayed secret — you won't see it again

The token string used in the plugin has the format:

```
user@realm!tokenid=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**Minimum required privileges:** `VM.PowerMgmt`, `VM.Monitor` on the relevant VMs (or `PVEVMAdmin` for convenience).

### 2. Configure a key

1. Drag the **VM Monitor** action onto any Stream Deck key
2. Open the key's settings (Property Inspector)
3. Enter your **Proxmox Host** (e.g. `192.168.1.10:8006`)
4. Paste your **API Token**
5. Leave **Allow self-signed certificate** checked (Proxmox uses a self-signed cert by default)
6. Click **Test Connection & Load VMs** — nodes and VMs will populate automatically
7. Select the **Node** and **VM / Container**
8. Optionally enable **Require confirmation** and adjust the **Hold duration**

## Key display

| Color | Status |
|---|---|
| Green | Running |
| Red | Stopped |
| Amber | Paused / suspended |
| Gray | Unknown / error |

Each key shows the VM name, a status indicator, CPU%, and RAM% with mini progress bars. Error states display a warning icon with a short message.

## Controls

| Input | Action |
|---|---|
| Short press | Toggle start / stop |
| Hold (≥500ms) | Reboot (VM) or Restart (LXC) |
| Short press × 2 (with confirmation) | Confirm start/stop |

## Development

```bash
npm install        # install dependencies
npm run build      # build once
npm run watch      # rebuild on file changes
npm run package    # package as .streamDeckPlugin
```

Source layout:

```
src/
  plugin.ts                  # entry point
  actions/
    vm-monitor.ts            # VM Monitor key action
  proxmox/
    client.ts                # Proxmox REST API client
    types.ts                 # TypeScript types
  utils/
    canvas.ts                # SVG key image generator
    polling.ts               # shared polling manager
com.trackzero.proxmox.sdPlugin/
  manifest.json
  imgs/                      # icons
  ui/
    vm-monitor.html          # Property Inspector
```

## License

MIT
