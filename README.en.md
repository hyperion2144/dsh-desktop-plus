[中文](README.md) | [English](README.en.md)

# DSH Desktop Plus

A capability-enhanced distribution built on the official DeepSeek Harness desktop shell: it wraps the DSH Web GUI into a macOS / Windows / Linux desktop app and adds the desktop integrations the official build does not ship — multi-profile, tray residency, system notifications, download management, logging & diagnostics, and remote access.

The official desktop app is a minimal shell locked to a single profile: one window, one DSH, updates by full-package replacement. Plus adds those desktop capabilities without changing official product behavior.

## Install

Download the installer for your platform from [GitHub Releases](https://github.com/hyperion2144/dsh-desktop-plus/releases/latest):

| Platform | Artifacts |
| --- | --- |
| macOS (Apple Silicon) | `.dmg` / `.zip` |
| Windows (x64) | `.exe` installer |
| Linux (x64) | `.AppImage` / `.tar.gz` |

Current releases are unsigned builds: on macOS, right-click the app and choose "Open" the first time; on Windows, choose "Run anyway" when SmartScreen appears.

## Features

### Multi-profile

- Run multiple isolated profiles (independent data directories) side by side in one installation.
- Create / delete / start / restart / quit entirely from the tray; open profiles are remembered across app restarts.

### Tray residency

- The tray's first-level menu is profile management: show / focus, full-tree restart (with splash transition), quit, delete; plus app-level restart and quit.
- Single-instance by default; launch isolated copies when you need several instances at once.

### Cold-start orchestration

- Tray → splash → host → window: every startup stage is visible.
- Failed startups stop at the splash with the reason, instead of waiting in a black box.

### Quit semantics

- Four quit tiers: confirm-quit, skip-confirmation quit, unconditional quit after host teardown, and scheduled restart.
- A desktop profile's quit is a real quit: stop the process tree and destroy the window, with tray state updated instantly.

### Notifications & focus

- System notifications for task completion, pending approvals, session errors and finished downloads, toggleable per scenario.
- Do-not-disturb hours and fullscreen silence; no duplicate notifications while a window is focused.
- Sleep prevention while an active task is running, released automatically when it ends.
- Custom alert sounds (wav / mp3 / ogg with format and size validation) or the system default, previewable in settings.

### Download management

- Browser downloads are intercepted into one queue: live progress and speed, working pause / resume / cancel.
- History persists across restarts; jump straight to the file or its folder when done.

### Logging & diagnostics

- Modular logging kernel: multi-sink writes, level filtering, daily and size-based rotation, gzip archiving, retention cleanup.
- One-click diagnostics export (tar.gz); "Open log folder" jumps to the file manager.
- Profile output lands in the unified log with a name prefix; page alerts and renderer crashes are recorded too.

### Settings panel

- Two-column layout: profiles (create / delete / port), notifications, proxy, sleep prevention, login launch, developer tools, and one-click privacy & telemetry opt-out.

### Runtime management

- Lists built-in and downloaded DSH runtimes; download, switch (applies after restart) and uninstall.

### Remote access

- Add a remote DSH lane address (shaped like `http://<host>:<port>/pair?token=…`) to the service addresses and it becomes a remote profile: the window connects straight to the remote origin and no local DSH host is started.
- A one-time token completes pairing; pairing state persists — remote or local restarts reconnect without a token, and expired pairing credentials renew automatically.
- Remote profiles can restart the remote desktop from the tray: the local splash waits for the remote to come back, then rebuilds the window.
- Clicking quit in a remote window only destroys that window and disconnects — the remote desktop itself keeps running.
- Lane ports are pinned per profile and survive restarts.

### Experimental

- Computer Use (macOS): the official experimental component is listed by default and can be enabled on the plugins page; the native helper ships with the package.
- NodeJS diagnostics, session-data diagnostics and other official experimental components are optional.

### Branding & localization

- The sidebar shows the DSH Desktop Plus brand with the plus build-version badge.
- Installer and in-app copy in 8 languages; tray language follows the system.

### Versioning & updates

- Version format `X.Y.Z[-pre].plus.N` (official version + plus number), written into installers, Info.plist and the About page.
- In-app update checks point at this repository's GitHub Releases, supporting the latest and nightly channels.

---

## For maintainers

### Repository layout

```
dsh-desktop-plus/
├─ upstream/        Verbatim snapshot of the official DeepSeek Harness tree (single source of truth)
├─ packages/plus/   This project's own capability packages
├─ scripts/plus/    Generators and the upstream sync driver
├─ .github/         CI, packaging and release pipelines
└─ pnpm-workspace.yaml   Generated from upstream/pnpm-workspace.yaml — do not hand-edit
```

The plus layer has two parts: `packages/plus/desktop-shell` (shell-side services: shell kernel, startup orchestration, tray, downloads, notifications, logging, runtimes, local and remote profiles) and `packages/plus/desktop-plugin` (the desktop settings panel as a dsh plugin, mounted through the official plugin mechanism, talking to shell services via the official `/api/shell.invoke` route).

### Why the official code lives in `upstream/`

`main` is an orphan-root history: it contains no upstream commits. Upstream code lands as a snapshot under `upstream/`, replayed once per sync commit. Our history stays clean — no burden of twenty-thousand-plus upstream commits — and patches always float on top of the newest upstream instead of drifting into a fork. The cost: root `pnpm-workspace.yaml`, `pnpm-lock.yaml` and `.gitignore` ("there must be exactly one" files) are taken over by this repo and regenerated on every sync.

### Common commands

```sh
pnpm install                 # Install (root pnpm-workspace.yaml is generated)
pnpm run gen:workspace:check # Verify generated files match upstream
pnpm run typecheck           # Official typecheck gates
pnpm run typecheck:plus      # Typecheck for this project's packages
pnpm run sync:upstream       # Follow new upstream commits
```

### Packaging & releases

Packaging runs in the GitHub Actions **Package Desktop** workflow (manual trigger); artifacts are unsigned installers for three platforms, downloadable as workflow artifacts. `linux-x64` is a packaging target upstream does not have, added by this repo.

```sh
gh workflow run package-desktop.yml --repo hyperion2144/dsh-desktop-plus --ref main
```

Releases are tag-driven: push a `v<X.Y.Z[-pre].plus.N>` tag and the pipeline validates the version (derived by `scripts/plus/version.mjs` from the upstream version and the CHANGELOG's unreleased section), packages all three platforms, and publishes a GitHub Release whose notes come from the CHANGELOG's unreleased section. Do not use the `+plus.N` build-metadata form: `electron-updater` ignores it and version comparison would treat two builds as the same one.

### Rules for changing upstream code

Avoid it when possible. Necessary changes live as patches in `scripts/plus/hooks/` and must pass the sync replay check — once a patch no longer replays, syncing breaks; this is the easiest way to break this repository. Any `upstream/` change not captured in a patch silently disappears at the next sync.
