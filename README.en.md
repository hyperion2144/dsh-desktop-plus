[中文](README.md) | [English](README.en.md)

# DSH Desktop Plus

DeepSeek Harness as a desktop app — plus a native phone client that connects straight to it.

The official Harness ships as a browser UI only. Plus adds three things: a **desktop shell** (tray, multi-profile, notifications, downloads, logs), a **phone shell** (HarmonyOS / Android / iOS, fully native), and the **remote access** that connects the two.

## Install

One release carries both halves:

| Platform | Artifact |
| --- | --- |
| macOS (Apple Silicon) | `.dmg` / `.zip` |
| Windows (x64) | `.exe` installer |
| Linux (x64) | `.AppImage` / `.tar.gz` |
| Android | `.apk` (fixed signing key, upgrades in place) |
| iOS | `.ipa` (unsigned, re-sign with a sideload tool) |

HarmonyOS HAP is not shipped in releases; build it locally from `mobile/harmony` (see its README).

Builds are unsigned: on macOS right-click → Open the first time; on Windows pick "More info → Run anyway" in SmartScreen.

## Connect a phone to your computer

Open the desktop "Remote access" panel and it shows an address plus a QR code. Scan it once — after that the phone reconnects without a token.

- Works on the LAN, or through a cloudflared / cpolar tunnel from outside.
- The phone talks to the desktop over a single connection: the page carries a signed token straight back to the desktop and compression is terminated there. The phone shell never relays bytes and never performs a second handshake — the same shape as a browser hitting that machine.
- Settings, plugin pages and theming behave the same remotely; plugin assets on other local ports are mapped automatically.
- Drops recover on their own; a reconnecting device replaces its previous connection instead of tripping the "second socket refused" path.

## Desktop

- **Multi-profile** — several isolated instances from one install, each with its own data directory, port and tray entry; they are remembered across restarts.
- **Tray as the control surface** — show / focus, restart the whole tree, quit, delete, plus app-level restart and quit. Single instance by default, isolated copies on demand.
- **Startup choreography** — tray → splash → host → window, with failures explained on the splash instead of a black box.
- **Notifications and focus** — per-scenario toggles for task completion, pending approvals, session errors and finished downloads; quiet hours, full-screen silence, sleep inhibition while tasks run, custom sounds.
- **Downloads** — browser downloads land in one queue with live progress and speed; pause, resume and cancel really work; history survives restarts.
- **Logs and diagnostics** — multi-source log core with level filters, daily/size rotation and gzip archives; one-click diagnostic bundle.
- **Settings** — profiles, notifications, proxy, sleep inhibition, launch at login, developer tools, privacy and telemetry switches.
- **Experimental features** — Computer Use (macOS) and the other official experimental components are available straight from the plugin page.
- 8 installer and in-app locales; the sidebar shows the Plus build version.

## Phone

HarmonyOS / Android / iOS share one capability set, each natively implemented:

- Loads the official page bundle locally — no dependency on a hosted page.
- Host management: mDNS discovery, QR pairing, manual address entry, multi-host switching.
- Connection fallback: retry candidate addresses → silently renew an expired session → only ask to re-pair when the device was removed.
- Biometric unlock with system-PIN fallback; credentials stay in each platform's secure storage and never reach the page.
- Follows the system light/dark theme; on narrow screens the settings page goes full-screen with horizontal navigation, and inputs use readable touch sizes.
- Update notices read the published channel metadata and link straight to the download.

## Versions and updates

Versions are `X.Y.Z[-pre].plus.N` (the official version plus a plus counter), written into the installers and the about page. Update checks point at this repository's GitHub Releases; desktop and phone each read their own channel metadata.

## For maintainers

### Layout

```
dsh-desktop-plus/
├─ upstream/         official DeepSeek Harness source snapshot (byte-identical, the only copy)
├─ packages/plus/    our capability packages
│  ├─ desktop-shell/          shell services: core, tray, notifications, downloads, logs, runtime
│  ├─ desktop-plugin/         desktop settings panel as a dsh plugin (page → shell via shell.invoke)
│  └─ desktop-remote-access/  remote access host: lane reverse proxy, pairing, direct tokens, compression
├─ mobile/           HarmonyOS / Android / iOS native shells
├─ scripts/plus/     generators, patch sets, upstream sync and release scripts
└─ .github/          verification, packaging and release pipelines
```

`main` has an orphan-root history: upstream lives as a snapshot under `upstream/` and every sync commit replays it, so the history never carries upstream's twenty-thousand-plus commits. Our changes to upstream exist only as patches in `scripts/plus/hooks/` (desktop) and `hooks-mobile/` (mobile), replayed at build time. The cost is that the root `pnpm-workspace.yaml`, `pnpm-lock.yaml` and `.gitignore` are owned here and regenerated on sync.

### Common commands

```sh
pnpm run patches:apply        # replay the desktop patch set onto upstream/ (required before building)
pnpm install                  # install
pnpm run typecheck:plus       # typecheck our packages
pnpm run test:plus            # unit tests for our packages
pnpm run build:web:mobile     # mobile page variant (official tree + mobile patch set)
pnpm run verify:patches       # upstream/ matches the official tree and every patch replays
pnpm run sync:upstream        # follow a new upstream release
```

### Packaging and releasing

- **Package Desktop** (manual dispatch) produces unsigned installers for three platforms as workflow artifacts; `linux-x64` is a target upstream does not ship and that we add.
- **Releasing** pushes a tag `v<X.Y.Z[-pre].plus.N>`: `Release Desktop` creates the release and uploads desktop assets, `Release Mobile` appends apk / ipa plus channel metadata to the same release. `scripts/plus/version.mjs` derives and validates the version — do not use `+plus.N` build metadata, `electron-updater` ignores it.
- **Re-cutting** the same tag again covers assets and notes and forces the release back to published; deleting first is no longer needed.
- Release notes come from `CHANGELOG.md`: either its unreleased section or the published section for that version.

### Touching upstream code

Change as little as possible. Anything you must change belongs in a patch under `scripts/plus/hooks/`, and it has to keep replaying under `pnpm run verify:patches` — a patch that stops replaying breaks the sync. Unpatched edits inside `upstream/` vanish silently on the next sync.
