# AGENTS.md — dsh-desktop-plus

This repository packages **DSH Desktop Plus**: the official DeepSeek Harness GUI
with desktop capabilities the official build does not ship (portable runtime,
bundled runtimes, multi-instance, tray, notifications, installers).

## Layout

```
upstream/                   Official deepseek-harness tree, vendored verbatim.
packages/plus/              Our packages (@deepseek-ai/dsh-desktop-plus-*).
scripts/plus/               Our generators, the patch sets and the upstream sync driver.
scripts/plus/hooks/         The desktop patch set: our changes to upstream/.
scripts/plus/hooks-mobile/  The mobile patch set: the mobile variant's changes to upstream/.
.plus/upstream-base         SHA of the official commit upstream/ was taken from.
.plus/upstream-tree         Git tree id of that commit's tree — upstream/ must equal it.
```

Only two kinds of edits are allowed here:

1. **Anything outside `upstream/`** — ours, normal code changes.
2. **Inside `upstream/`** — nothing. `upstream/` is the official tree,
   byte for byte; our changes to it live in a patch set.

A build puts the two together: `pnpm run patches:apply` replays the desktop
patch set onto `upstream/`, and only then are the dependencies installed and
the app built. The patch set — not the tree — is the source of truth.

## Iron rules

These three rules are not style preferences; each one has a gate behind it,
and breaking one breaks a build or loses a change.

1. **`upstream/` stays the official code, byte for byte.** It is the official
   tree of the commit in `.plus/upstream-base`, and its git tree id is pinned
   in `.plus/upstream-tree`. `pnpm run verify:patches` fails when the committed
   tree id differs, when the working tree drifts from the commit, or when the
   patch set no longer replays onto it. Never edit `upstream/` to make
   something work: express the change as a patch.

2. **Every change inside `upstream/` becomes a patch before it is committed.**
   Work in `upstream/` only while the patch set is applied, then run
   `pnpm run patches:extract`: it re-records the patch files from the tree and
   puts the official tree back. The commit carries the patch, never the
   modified tree. `pnpm run patches:revert` undoes a tree that was left dirty.

3. **The desktop patch set and the mobile patch set are physically separate.**
   The desktop set is `scripts/plus/hooks/`; the mobile set is
   `scripts/plus/hooks-mobile/`. A patch file belongs to exactly one set, and
   a build applies exactly one set: the desktop build never applies a mobile
   patch, and a mobile build never applies a desktop patch. `scripts/plus/`
   names the sets in `PATCH_SETS` (`scripts/plus/patch-set.mjs`). A mobile
   build materializes its tree in a scratch directory and never writes
   `upstream/`, so neither build can contaminate the other.

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
the patch that carries our change to `upstream/pnpm-workspace.yaml`.

## Commands

```sh
pnpm run patches:apply        # replay the desktop patch set onto upstream/ (builds do this)
pnpm run patches:revert       # restore upstream/ to the official tree
pnpm run patches:extract      # re-record the patch set from upstream/, then restore it
pnpm install                  # installs the whole tree (ours + upstream/)
pnpm run gen:workspace        # regenerate the root pnpm-workspace.yaml
pnpm run gen:workspace:check  # fail if the generated file is stale
pnpm run sync:upstream        # pull a newer official tree into upstream/
pnpm run verify:patches       # upstream/ is the official tree; the patch set replays
pnpm run verify:separation    # prove the build still consumes the pre-separation tree
pnpm run verify:patch-sets    # the desktop and mobile patch sets own disjoint paths
pnpm run build:web:mobile     # build the mobile variant dist (official tree + mobile patch set)
pnpm run build:web:official   # build the official dist (official tree, no patch set)
pnpm run verify:web:baseline  # an empty patch set must build the official dist, byte for byte
pnpm run typecheck            # official typecheck gates, run inside upstream/
pnpm run typecheck:plus       # typecheck our packages
```

Install *after* `patches:apply`: the root `pnpm-lock.yaml` describes the
patched tree (our patch adds the plus packages to `upstream/apps/cli`), so on
the committed tree pnpm would re-resolve the graph and rewrite the lockfile.
The generated root `pnpm-workspace.yaml` turns pnpm's implicit pre-run install
off for the same reason: a gate must not rewrite what it checks.

Our packages extend `upstream/tsconfig.base.json` directly. TypeScript resolves
`paths` relative to the file that declares them, so the official mappings keep
pointing at `upstream/packages/*/src` without a single edit. A package that
depends on an upstream package lists it in `references`, exactly like an
official package would.

## Variant builds

A *variant* is the official tree plus exactly one patch set, built with the
official build command. The desktop build consumes `official + desktop`;
the mobile build consumes `official + mobile`.

`scripts/plus/build-web-variant.mjs` materializes a variant in a scratch
directory from `HEAD:upstream` — the committed official tree — and runs the
official artifact build there. It never writes `upstream/`, so `upstream/`
keeps its official bytes even when the build fails, and the desktop
workflow is untouched. The variant installs its own dependencies, so a
desktop build and a variant build can run at the same time.

`pnpm run verify:web:baseline` builds the official variant and the mobile
variant and compares the two dists file by file: with an empty mobile patch
set they must be byte-identical. The mobile patch set's placement convention
lives in [scripts/plus/hooks-mobile/README.md](scripts/plus/hooks-mobile/README.md);
the mechanism is documented in [scripts/plus/README.md](scripts/plus/README.md).

## Syncing upstream

`scripts/plus/sync-upstream.mjs` upgrades `upstream/` through a 3-way merge in
a throwaway git repository (`.plus/tmp/sync`): `base` is the tree recorded in
`.plus/upstream-base`, `plus` is that baseline with our patch set applied, and
`official` is the new release. `--dry` runs that merge and reports the real
conflict list; after the conflicts are resolved in the scratch repo, `--finish`
regenerates every patch from `git diff official HEAD`, puts the new official
tree back into `upstream/`, and records the new SHA and tree id. The patch
files, not the tree, are the replayable source of truth.

`--regen` (also `pnpm run patches:extract`) re-records the patch set from the
live `upstream/` tree and restores the official tree — that is how a change made
inside `upstream/` rejoins the patch set. `--adopt` names the patch that takes
over a path no patch owns yet, taking `<patch>=<path,...>`.

Review the generated `pnpm-workspace.yaml` diff after every sync: it is the
shortest readable summary of what upstream changed about dependencies.

## Official documentation

The official repository's rules still apply to everything under `upstream/`:
see [upstream/AGENTS.md](upstream/AGENTS.md). Repository-level issue tracking,
triage labels, and domain docs live in `docs/agents/`.
