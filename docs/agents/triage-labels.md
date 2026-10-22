# Triage Labels

The skills speak in terms of canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

## Triage roles

| Label in mattpocock/skills | Label in our tracker | Meaning                                    |
| -------------------------- | -------------------- | ------------------------------------------ |
| `bug`                      | `bug`                | Something is broken (category role)        |
| `enhancement`              | `enhancement`        | New feature or improvement (category role) |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue    |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information   |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent    |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation              |
| `wontfix`                  | `wontfix`            | Will not be actioned                       |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Wayfinder labels

`/wayfinder` labels every ticket with its type; the map itself is a single issue labelled `wayfinder:map`.

| Label                | Meaning                                            |
| -------------------- | -------------------------------------------------- |
| `wayfinder:map`      | The map issue; owns Notes / Decisions-so-far / Fog |
| `wayfinder:research` | Research ticket                                    |
| `wayfinder:prototype`| Prototype ticket                                   |
| `wayfinder:grilling` | Open decision/discussion ticket                    |
| `wayfinder:task`     | Task ticket                                        |

## What is not required

Only these labels gate the skills. The repository's own label taxonomy (`kind/*`, `area/*`, native Issue Type, documented in the root `AGENTS.md`) governs PRs against the harness upstream; it is not a precondition for issues in this tracker.
