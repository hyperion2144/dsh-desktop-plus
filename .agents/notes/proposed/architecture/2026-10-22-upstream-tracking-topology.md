# Agent Note: Upstream tracking topologies for the desktop-plus fork

Status: proposed

## Problem

The desktop-plus product builds on the `deepseek-harness` monorepo and must change a small number of upstream-owned files in place: an install hook in `apps/desktop/src/main.ts`, one workspace dependency in `apps/desktop/package.json`, one workspace member in the root `tsdown.config.ts`, and one project reference each in `tsconfig.host.json` and `apps/desktop/tsconfig.host.json`. Everything else of ours belongs in a new `apps/desktop-plus/` that links upstream packages through pnpm `workspace:*`.

The current arrangement is a GitHub fork: `origin` is `hyperion2144/dsh-desktop-plus` and `upstream` is `deepseek-ai/deepseek-harness`. The question this note answers is whether the fork can be dropped in favor of keeping upstream as a subdirectory of our repository — still carrying a git reference to upstream so that upstream updates can still be pulled — while keeping the ability to edit upstream source in place.

The repository facts that bear on the answer were measured on 2026-10-22 with node v26.5.0, pnpm 11.28.5, and git 2.54.0 (Apple Git-157): the fork currently has no commits of its own (`git rev-list --count origin/master..HEAD` is 0) and carries upstream's full 22,395 commits, 16,297 tracked paths, and a 308 MiB object store (300.31 MiB packed). Upstream's root `pnpm-workspace.yaml` carries install policy, not just package globs: three `overrides` (two of them path-relative `link:vendor/…` entries), `peerDependencyRules.allowedVersions`, eleven `allowBuilds` entries under `strictDepBuilds`, thirty-seven `minimumReleaseAgeExclude` entries, and seven `patchedDependencies` patch files. `tsconfig.base.json` holds 512 `paths` entries, all relative to the repository root, and `tsdown.config.ts` globs `vendor/*/package.json` and `packages/*/*/package.json` relative to `import.meta.dirname`.

Four topologies can express "track upstream, change upstream source": a fork with an `upstream` remote, `git subtree`, `git submodule`, and a pristine upstream checkout with a patch queue. Each is assessed below on how an upstream update arrives, how an in-place edit to upstream source is stored and kept following upstream, how conflict and drift show up, what it costs in CI and for a new clone, and whether "which lines of upstream did we change" is enumerable.

## Proposal

Keep the fork topology as the shipping topology. The product's need to edit upstream files in place, plus the size of upstream's install and project-reference configuration, make every other topology either lossy for those edits or expensive to re-root.

If a subdirectory layout is nevertheless required, the closest feasible topology is `git subtree` with `--squash`, combined with one rule that the outer repository is the only pnpm install authority: the outer `pnpm-workspace.yaml` re-globs upstream's package directories, and upstream's install policy is hoisted into it and re-synced by script. Under that topology our in-place upstream edits are ordinary commits under `harness/`, `workspace:*` links into the subdirectory keep working (measured — see the pnpm findings below), and the audit becomes `git diff <last-squash-commit>..HEAD -- harness/`.

The patch queue remains the third option, and the only one whose audit artifact is the enumeration of our changes by construction. It is not recommended as the shipping arrangement because the upstream tree becomes a build artifact that every developer and every CI job must reconstruct.

### Topology 1 — fork with an `upstream` remote (current)

**Upstream update.** `git fetch upstream` (refspec `+refs/heads/*:refs/remotes/upstream/*`), then `git merge upstream/master`, or rebase our commits onto it. Upstream's objects are already in our store, so a sync costs a merge, not a re-import.

**In-place edits.** Our changes to `apps/desktop/src/main.ts` and the other four upstream-owned files are ordinary commits on our branch. They follow upstream because a later merge reconciles them with upstream's own changes to the same lines through the ordinary three-way merge.

**Conflict and drift.** Conflicts appear at exactly the lines we touched, in the ordinary merge-conflict form. Drift is visible as two log ranges: `git log upstream/master..HEAD` lists our commits, `git log HEAD..upstream/master` lists upstream commits we have not taken.

**CI and new clone.** One clone, one install, one lockfile. Upstream's own CI already runs `pnpm install --frozen-lockfile` in fifteen job steps across `.github/workflows/ci.yml` and `.github/workflows/ci-master.yml`; ours adds gates on top of that and inherits the flag unchanged.

**Auditability.** `git diff upstream/master...HEAD` enumerates our delta against upstream, and `git log --oneline upstream/master..HEAD` enumerates the commits that produced it. Because the fork shares upstream's object store, upstream commits stay addressable by SHA.

### Topology 2 — `git subtree`

**Upstream update.** `git subtree add --prefix=harness --squash upstream master` for the import, `git subtree pull --prefix=harness --squash upstream master` for each subsequent sync. `git subtree` is a contrib script, so a sync is always a manual command; nothing pulls it automatically.

**In-place edits.** Edits under `harness/` are ordinary commits in our repository, so they survive upstream pulls and are reconciled by the same three-way merge as the fork's. Measured: an edit under `harness/` committed normally and appeared in `git diff <squash-commit>..HEAD -- harness/` as exactly our delta.

**Conflict and drift.** A pull is a real merge inside our repository. Measured on a conflicting line: `git subtree pull` printed `Auto-merging harness/apps/desktop/src/main.ts`, `CONFLICT (content): Merge conflict in harness/apps/desktop/src/main.ts`, and `Automatic merge failed; fix conflicts and then commit the result.`; the file carried `<<<<<<< HEAD` / `=======` / `>>>>>>> 6b75f01…` markers, `git status --short` reported `UU harness/apps/desktop/src/main.ts`, and `git rev-parse --verify MERGE_HEAD` returned `6b75f017760550e02bee5b2c322f7c3c693841e6` — the sync is not recorded until the conflict is resolved and the merge is committed. Drift in upstream's own history is invisible: our repository holds a tree, not upstream's commit sequence.

**CI and new clone.** One clone and one install, but the pnpm workspace must be re-rooted (below) and the inner `harness/pnpm-lock.yaml` is never refreshed by the outer install, so upstream's `--frozen-lockfile` CI cannot be reused verbatim.

**Auditability.** Against the last squash commit, our delta is enumerable. Against an upstream tag it is not: `git subtree add` imports no tags. Measured: the parent repository had zero tags, and `git diff v1.0.0 HEAD -- harness` failed with `fatal: bad revision 'v1.0.0'`. History and size differ sharply between squash modes: with `--squash` the parent had three commits in total and exactly one commit reachable under `harness/` (upstream's twelve commits were unreachable), with a 448 KiB object store; without `--squash` the parent had fourteen commits, because upstream's history was copied in. Each subsequent squashed sync adds a new tree snapshot of `harness/` to the parent store — git content-addresses trees, so unchanged subtrees are stored once, but changed paths add new tree objects and new blobs — so the parent pack grows monotonically with every sync.

### Topology 3 — `git submodule`

**Upstream update.** `git submodule update --init --recursive` checks out the commit recorded in the parent; `git submodule update --remote` instead follows the submodule's remote-tracking branch (git-submodule(1)). Either way the parent decides the SHA; the submodule's own remote is only consulted to obtain that SHA.

**In-place edits.** An in-place edit inside the submodule cannot be committed to the parent as content. Measured: editing `harness/apps/desktop/src/main.ts` inside the submodule and committing there (submodule HEAD `a116bf9`) left the parent showing only ` M harness`; `git add harness` followed by `git diff --cached` showed only `index f665b2b..a116bf9 160000` with the two `Subproject commit` lines — a gitlink SHA change, the mode `160000` that `git ls-files -s` reports for the path. The parent stores no file content, so the edit lives only in the submodule's own repository, which is a second remote we must also push to. Pro Git 7.11 states the same consequence: "If we commit in the main project and push it up without pushing the submodule changes up as well, other people who try to check out our changes are going to be in trouble since they will have no way to get the submodule changes that are depended on. Those changes will only exist on our local copy."

**Conflict and drift.** The failure is silent for the newcomer. Measured with `git clone --recurse-submodules file:///…/parent-sub fresh-sub`: the clone printed `fatal: git upload-pack: not our ref a116bf954dfcbf468573a74d0e3d7ed55dd5997c` and `fatal: Fetched in submodule path 'harness', but it did not contain a116bf954dfcbf468573a74d0e3d7ed55dd5997c. Direct fetching of that commit failed.`; the fresh clone's `git submodule status` reported `+f665b2b276cdaab1636353b2c273a1b288f043e6 harness (v1.0.0)` — the `+` marks a checked-out commit that differs from the recorded one — and the file in the fresh clone held the unpatched upstream content. The parent's recorded SHA was unreachable from the submodule's remote, so a new cloner receives upstream's tree without our edit, and the parent's history shows only "the submodule moved".

**CI and new clone.** Two remotes and two pushes (our fork, plus a fork of upstream that carries the patch). A clone needs `--recurse-submodules` or an extra `git submodule update --init --recursive` step, and `git push --recurse-submodules=check` fails the push when submodule commits are not on a remote.

**Auditability.** The parent can enumerate that the submodule is at SHA X, and `git diff --submodule=log` surfaces the submodule's commit subjects — measured output: `Submodule harness f665b2b..a116bf9: > our local patch to an upstream file`. The changed lines live in the submodule's own history; the parent's history holds no patch, so a reviewer of the parent repository alone cannot see the diff.

### Topology 4 — pristine upstream checkout plus a patch queue

**Upstream update.** Fetch upstream into the checkout, move it to the pinned commit, and re-apply the queue.

**In-place edits.** The edits exist only as patch files; the checkout itself stays pristine. Measured: `git format-patch --stdout <base>..HEAD -- harness > queue.patch` produced patches whose paths carry the `harness/` prefix (`--- a/harness/apps/desktop/src/main.ts`); `git am queue.patch` against a pristine upstream checkout failed with `Patch failed at 0001 our change to an upstream file` and left the file at upstream content, while `git am -p2 queue.patch` succeeded with `Applying: our change to an upstream file` and produced the patched file. Path-prefix stripping is therefore mandatory, not optional.

**Conflict and drift.** A patch that no longer applies is a hard stop. Repairing it means editing the patch, which is a manual rebase of a file, and the result is invisible in the repository's history until the queue is committed again. Upstream's own churn is never visible, only its effect on our five files.

**CI and new clone.** Every developer and every CI job must run "check out upstream at the pinned SHA, apply the queue, install". The upstream tree is a generated artifact rather than source, so a review of the repository shows the patch queue and not the code it patches.

**Auditability.** The strongest of the four: the queue is the enumeration of our changes, one file per upstream file touched, and `git format-patch` output is directly reviewable.

### Cost comparison

| Topology | Upstream update path | In-place upstream edits | Conflict / drift signal | New clone and CI | Auditability | Measured evidence |
|---|---|---|---|---|---|---|
| Fork + `upstream` remote | `git fetch upstream` + merge/rebase; objects already local | Ordinary commits; reconciled by the three-way merge | Merge conflicts at touched lines; `git log HEAD..upstream/master` | One clone, one install, upstream's `--frozen-lockfile` CI reused | `git diff upstream/master...HEAD` | 0 own commits today, 22,395 upstream commits, 308 MiB store |
| `git subtree` (`--squash`) | `git subtree pull --prefix=harness --squash upstream master`; manual, contrib script | Ordinary commits under `harness/` | Ordinary merge conflicts inside `harness/`; `MERGE_HEAD` present until resolved | One clone, one install; upstream CI not reusable (inner lockfile stale) | `git diff <last-squash>..HEAD -- harness/`; no upstream tags | 3 commits and 1 reachable under `harness/` with squash vs 14 without |
| `git submodule` | `git submodule update --init --remote`; parent pins the SHA | Impossible to commit as content — parent stores a `160000` gitlink | Fresh clone fails to fetch the pinned SHA and silently shows unpatched upstream | Two remotes, two pushes, `--recurse-submodules` on every clone | Commit subjects only (`git diff --submodule=log`); lines live in the submodule's repo | `fatal: Fetched in submodule path 'harness', but it did not contain a116bf95…` |
| Pristine checkout + patch queue | Fetch upstream, move to pinned SHA, re-apply queue | Patch files only; checkout stays pristine | `git am` rejection per patch; manual patch rebase | "Checkout + apply + install" on every developer machine and CI job | The queue itself | `git am` failed without `-p2`, succeeded with it |

### pnpm nested-workspace findings (measured)

The question behind this section: does pnpm support a nested workspace — an outer repository root with its own `pnpm-workspace.yaml` and a subdirectory such as `harness/` that has its own `pnpm-workspace.yaml` — and can the outer workspace link to packages inside the subdirectory with `workspace:*`?

The experiment ran on 2026-10-22 under `/tmp/pnpm-nested-ws/lab2` with pnpm 11.28.5 (the `packageManager` field in the lab's root `package.json` selects the version). The outer root declared `packages: ['packages/*', 'harness/packages/*']`; `harness/` declared its own `pnpm-workspace.yaml` with `packages: ['packages/*']`; the two packages were `@outer/app` (depending on `"@harness/core": "workspace:*"`) and `@harness/core`.

**Membership is owned by the outer workspace.** `pnpm list --depth -1 -r` at the outer root listed three workspace projects, including `@harness/core` at `harness/packages/core`, and the outer lockfile gained the importer `harness/packages/core: {}`. The inner `pnpm-workspace.yaml` did not make that package a member; the outer glob did.

**`workspace:*` across the directory boundary works.** The outer lockfile recorded `packages/app → dependencies: '@harness/core': specifier: workspace:* / version: link:../../harness/packages/core`, and `pnpm run check` inside the outer app printed `RESOLVED: hello from harness core`. The outer root's `node_modules` linked into the subdirectory exactly as it does for a sibling package.

**The outer glob must cover every upstream package directory.** When the outer `pnpm-workspace.yaml` did not glob `harness/packages/*`, the outer install failed: `[ERR_PNPM_WORKSPACE_PKG_NOT_FOUND] In packages/app: "@harness/core@workspace:*" is in the dependencies but no package named "@harness/core" is present in the workspace`, exit status 1.

**The inner `pnpm-workspace.yaml` is not read by an outer install.** With the inner declaring `catalogs: {default: {is-odd: 3.0.1}}` and the inner package depending on `is-odd: catalog:`, an inner `pnpm install` resolved the catalog, but the outer install failed with `[ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC] No catalog entry 'is-odd' was found for catalog 'default'`, exit status 1. An inner `packages: ['!**']` exclusion was likewise ignored: the outer install still listed `@harness/core` as a workspace project. The mechanism is documented upstream: pnpm resolves the workspace root by walking up to the first `pnpm-workspace.yaml` and then discovers packages by globbing `package.{json,yaml,json5}` without inspecting a discovered directory for its own `pnpm-workspace.yaml`, so the inner manifest is never opened during an outer install (pnpm/pnpm#11724; fix proposed in pnpm/pnpm#15566). The affected settings are exactly the install-policy ones — `patchedDependencies`, `overrides`, `packageExtensions`, `ignoredOptionalDependencies` — and catalogs behave the same way in practice.

**Two lockfiles.** The outer install writes only the outer `pnpm-lock.yaml`. The inner `harness/pnpm-lock.yaml` is neither created nor refreshed by it, and a standalone inner install creates a second lockfile — two sources of truth for the same dependency graph.

**Outer recursion covers the inner packages.** `pnpm -r exec` at the outer root executed inside `harness/packages/core` as well as inside `packages/app`, because inner packages are outer workspace members.

**Conclusion.** pnpm supports the shape — one workspace whose members may sit at any depth — but not two nested workspaces. There is exactly one install authority per command, and it is the outermost `pnpm-workspace.yaml` the command resolves to. A subdirectory layout therefore works, but only if the outer root takes over all install policy and re-globs all upstream package directories.

### What a subdirectory layout costs in this repository

The measured repository facts translate into a concrete bill for the subtree-in-a-subdirectory option.

- The outer `pnpm-workspace.yaml` must re-glob every upstream package directory — `vendor/*`, `packages/*/*`, `native/system`, `native/system/packages/*`, `apps/*`, `benchmarks`, `website`, `python/sdk-runtime` — each prefixed with the subdirectory. The root `package.json` also carries a `workspaces` field duplicating those globs (without `benchmarks` and `python/sdk-runtime`), which must be updated in step or left to diverge from the YAML.
- Upstream's install policy must be hoisted to the outer root, because the inner file is not read by the outer install: the three `overrides` (the two path-relative `link:vendor/cosmokit` and `link:vendor/schemastery` entries must become `link:harness/vendor/…`), `peerDependencyRules.allowedVersions`, the eleven `allowBuilds` entries, the thirty-seven `minimumReleaseAgeExclude` entries, and the seven `patchedDependencies` patch files (whose paths must become `harness/patches/…`).
- The TypeScript project graph must be re-rooted: 512 root-relative `paths` entries in `tsconfig.base.json` and the `vendor/*/package.json` and `packages/*/*/package.json` globs in `tsdown.config.ts`. Both files are upstream-owned, so every upstream sync would have to re-apply the rewrite — the "five in-place edits" cost becomes a rewrite of hundreds of path entries.
- Upstream's CI cannot be reused verbatim: its fifteen `--frozen-lockfile` job steps run against `harness/pnpm-lock.yaml`, which the outer install never refreshes.
- The supply-chain review surface grows: `strictDepBuilds` makes an unlisted build script a hard install error, and `minimumReleaseAgeExclude` is a list of reviewed exact versions. Both live at the install authority, so each upstream sync requires re-reviewing upstream's additions at the outer root.

### Triggers for changing the topology

- **Reconsider the subtree option** when upstream merges into the fork conflict in the same files in three or more of six consecutive upstream syncs, or when an upstream sync blocks a product release for more than five working days within a quarter. Below that threshold the fork's merge cost is cheaper than the subtree's re-rooting and lockfile split.
- **Reconsider the patch queue** when the in-place upstream edits exceed roughly ten files, or when any queued patch fails to apply cleanly. Each `git am` rejection is a manual patch rebase whose result is invisible until the queue is re-committed.
- **Stay on the fork** while upstream's release train lets us take upstream commits without cherry-picking and our delta stays under roughly five hundred lines: `git diff upstream/master...HEAD` remains a complete audit and the delta is small enough to re-apply by hand if the fork ever has to be abandoned.
- **Reconsider the topology in either direction** when a published artifact must exclude upstream's test and fixture code, or when a legal or security review requires the shipped product to name its upstream provenance per file: a subtree can exclude paths at the import boundary, and a patch queue names every modified file, while a fork's diff is the only artifact that does neither.

## Alternatives considered

**Adopt `git subtree` as the shipping topology.** It keeps the "subdirectory plus upstream reference" shape and our in-place edits, but it turns upstream into a vendored copy: the pnpm and TypeScript project graphs must be re-rooted, upstream's install policy must be duplicated at the outer root, the inner lockfile becomes a second source of truth, and upstream's CI cannot be reused. Rejected as the default because the re-rooting cost is paid on every upstream sync while the fork pays it once.

**Adopt `git submodule` as the shipping topology.** Measured, an in-place upstream edit cannot reach the parent repository as content, so the patch must live in a second repository and a fresh clone silently receives the unpatched upstream tree. Rejected: it fails the product's central requirement.

**Adopt the patch queue as the shipping topology.** The audit is the best of the four, but the upstream tree becomes a build artifact that every developer and CI job reconstructs, and a patch that no longer applies is a manual rebase. Rejected as the default; retained as the fallback when the fork's merge cost becomes the binding constraint and the delta is small.

**Vendor the upstream packages we need, following the repository's existing `vendor/` pattern.** `vendor/README.md` already tracks upstream code with local modifications through a manifest table of upstream SHAs, an exhaustive local-modification log, and a manual sync procedure. Rejected for this product: that pattern suits third-party libraries with a small surface, not the sixty-plus package monorepo the desktop app builds against, and the manifest-plus-log cost scales with the number of vendored packages.

**Keep the fork but stop tracking upstream, copying the five touched files into our own tree.** Rejected: it reintroduces a fork of upstream source inside a fork, and the copies would silently drift from upstream with no signal.

## Acceptance criteria

- The topology decision is recorded before any change: the desktop-plus repository keeps `origin` (the fork) and `upstream` (`deepseek-ai/deepseek-harness`) as its two remotes.
- The in-place upstream edits are enumerated in one tracked place, naming each touched upstream file and the reason for the change, and `git diff upstream/master...HEAD` stays the authoritative audit of our delta.
- Every upstream sync is rehearsed on a clean clone before it is merged, so "a new cloner gets the right tree" is a checked property rather than an assumption.
- If a topology change is ever executed, it lands as a dedicated pull request carrying the new clone procedure, the CI change, the lockfile change, and a recorded rehearsal of the update command (`git subtree pull`, `git submodule update --init --remote`, or `git am`) from a clean clone.
- The pnpm workspace and the TypeScript project graph stay in one root. Any proposal to split them states where the install authority lives and which settings move with it.

## Risks

- Upstream's pace can raise the fork's merge cost over time. The drift signal is `git log HEAD..upstream/master` and the audit is `git diff upstream/master...HEAD`; both must be run as part of the sync routine, not on demand.
- The fork's CI cost is upstream's CI cost plus ours: every upstream sync runs the full suite, so a sync in a release week competes with product work for the same runners.
- A subtree migration is not cheaply reversible. The parent keeps one tree snapshot per squashed sync, and removing the pre-migration history requires rewriting shared history.
- The subtree layout turns upstream's install policy into a supply-chain review surface at the outer root: an unlisted build script or a pinned version outside the release-age window fails the install rather than warning, and each upstream sync requires re-reviewing those lists.
- The `vendor/` precedent shows the true cost of "track upstream and modify in place": the local-modification log in `vendor/README.md` already carries twenty-four entries that must be re-applied by hand on every upstream sync, and the fork's equivalent list is the set of upstream-owned files we touch.

## Sources

- `git-submodule(1)` — gitlink mode `160000`, `git submodule status` prefixes, `update --init/--remote/--merge/--rebase`, `.gitmodules` semantics: https://git-scm.com/docs/git-submodule.html
- Pro Git 7.11, "Submodules" — the quoted consequence of committing in the superproject without pushing submodule commits, `git push --recurse-submodules=check`, `git diff --submodule=log`, clone with `--recurse-submodules`: https://git-scm.com/book/en/v2/Git-Tools-Submodules
- Pro Git 7.8, "Subtree Merging" — `git read-tree --prefix=…`, `git merge --squash -s recursive -Xsubtree=…`, `git diff-tree -p` for comparing a subtree directory against the upstream branch: https://git-scm.com/book/en/v2/Git-Tools-Advanced-Merging
- `git-read-tree(1)`, `git-format-patch(1)`, `git-am(1)` — the patch-queue primitives: https://git-scm.com/docs/git-read-tree.html, https://git-scm.com/docs/git-format-patch.html, https://git-scm.com/docs/git-am.html
- `git subtree` is a contrib script rather than a core command; its usage was read from `git subtree -h` on git 2.54.0, and the source lives at https://github.com/git/git/tree/master/contrib/subtree
- pnpm workspaces and settings — one workspace root per install, `pnpm-workspace.yaml` as the settings file: https://pnpm.io/workspaces, https://pnpm.io/settings
- pnpm/pnpm#11724 — nested workspace `pnpm-workspace.yaml` ignored by an outer install, with the `findUp` root resolution and the `findPackages` globbing that cause it: https://github.com/pnpm/pnpm/issues/11724
- pnpm/pnpm#15566 — proposed fix for the nested-workspace override: https://github.com/pnpm/pnpm/pull/15566
- Repository sources read for this note: [`pnpm-workspace.yaml`](../../../../pnpm-workspace.yaml), [`tsconfig.base.json`](../../../../tsconfig.base.json), [`tsdown.config.ts`](../../../../tsdown.config.ts), [`vendor/README.md`](../../../../vendor/README.md), [`.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml), and the [Agent Note format rules](../../README.md)
- Local measurements, 2026-10-22: `git rev-list --count HEAD` (22,395), `git rev-list --count origin/master..HEAD` (0), `git ls-tree -r origin/master --name-only | wc -l` (16,297), `git count-objects -vH` (300.31 MiB packed), `pnpm list --depth -1 -r`, `pnpm install` at the outer and inner roots of the `/tmp/pnpm-nested-ws/lab2` fixture, `git submodule add`, `git clone --recurse-submodules`, `git subtree add/pull --squash` and without `--squash`, `git format-patch --stdout` and `git am` with and without `-p2`
