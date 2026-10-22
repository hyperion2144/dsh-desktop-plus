# AGENTS.md — dsh-desktop-plus

This repository packages **DSH Desktop Plus**: the official DeepSeek Harness GUI
with desktop capabilities the official build does not ship (portable runtime,
bundled runtimes, multi-instance, tray, notifications, installers).

## Layout

```
upstream/            Official deepseek-harness tree, vendored verbatim.
packages/plus/       Our packages (@deepseek-ai/dsh-desktop-plus-*).
scripts/plus/        Our generators and the upstream sync driver.
.plus/upstream-base  SHA of the official commit upstream/ was taken from.
```

Only two kinds of edits are allowed here:

1. **Anything outside `upstream/`** — ours, normal code changes.
2. **Inside `upstream/`** — only the contact points listed in
   `scripts/plus/hooks/`. Right now that is the two-line hook in
   `upstream/apps/desktop/src/main.ts` that hands the Electron `app` object to
   `@deepseek-ai/dsh-desktop-plus-shell` before the official code registers its
   `app.whenReady()` handler.

Nothing else inside `upstream/` may change. Upstream is *replaced* on every
sync, so an edit there survives only if it is expressed as a patch file.

## Why `upstream/` is a plain directory, not a submodule or a fork

- **No official commits in our history.** `main` starts at an orphan root
  authored by us; official SHAs appear only in `.plus/upstream-base` and commit
  messages, never in the ancestry chain.
- **Submodules cannot carry the hook.** A modification inside a submodule is
  recorded as a gitlink, so a fresh clone silently gets the unpatched tree.
- **`NODE_OPTIONS` preload cannot replace the hook.** Electron discards every
  `NODE_OPTIONS` entry in packaged apps except `--max-http-header-size` and
  `--http-parser`, and on macOS it drops the variable entirely when the parent
  process signature differs from the app's.

## Workspace configuration is generated

pnpm reads workspace settings only from the workspace root. Since the official
settings live in `upstream/pnpm-workspace.yaml`, the root `pnpm-workspace.yaml`
is **generated** by `scripts/plus/gen-workspace.mjs`: package globs are
re-rooted, and `overrides`, `allowBuilds`, `minimumReleaseAgeExclude`, and
`patchedDependencies` are restated with their paths prefixed. It also pins every
patched dependency to the exact version its patch targets — without the official
lockfile pnpm re-resolves the graph and drifts past it, which pnpm rejects as
`ERR_PNPM_UNUSED_PATCH`.

Never hand-edit the root `pnpm-workspace.yaml`: change the generator, or change
`upstream/pnpm-workspace.yaml` by syncing a newer upstream.

## Commands

```sh
pnpm install                 # installs the whole tree (ours + upstream/)
pnpm run gen:workspace       # regenerate the root pnpm-workspace.yaml
pnpm run gen:workspace:check # fail if the generated file is stale
pnpm run sync:upstream       # pull a newer official tree into upstream/
pnpm run typecheck           # official typecheck gates, run inside upstream/
pnpm run typecheck:plus      # typecheck our packages
```

Our packages extend `upstream/tsconfig.base.json` directly. TypeScript resolves
`paths` relative to the file that declares them, so the official mappings keep
pointing at `upstream/packages/*/src` without a single edit. A package that
depends on an upstream package lists it in `references`, exactly like an
official package would.

## Syncing upstream

`scripts/plus/sync-upstream.mjs` replaces `upstream/` with a fresh official tree,
re-applies the hook patches, removes files superseded by our root configuration,
regenerates `pnpm-workspace.yaml`, and records the new SHA. A conflict in a hook
patch fails the sync loudly — it never leaves a half-applied tree.

Review the generated `pnpm-workspace.yaml` diff after every sync: it is the
shortest readable summary of what upstream changed about dependencies.

## Official documentation

The official repository's rules still apply to everything under `upstream/`:
see [upstream/AGENTS.md](upstream/AGENTS.md). Repository-level issue tracking,
triage labels, and domain docs live in `docs/agents/`.
