# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout: single-context

This repo is **single-context**: one `GLOSSARY.md` at the repo root and one `docs/adr/` tree cover the whole repository. There is no `GLOSSARY-MAP.md`, and no subproject carries its own `GLOSSARY.md`.

Neither exists yet. Both are created lazily, by the first term or the first hard-to-reverse decision `/domain-modeling` actually records — never as empty scaffolding.

`docs/glossary.md` is a different, already-published document: the harness product glossary. It does not replace the skills' `GLOSSARY.md`, but read it before coining a term the product already defines.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root, once it exists.
- **`docs/adr/`**: the ADRs that touch the area you're about to work in.
- **`.agents/notes/`**: this repo's existing rationale home; read the note for an area before changing its design.

If a file doesn't exist yet, **proceed silently**: don't flag its absence, and don't propose creating it up front.

## File structure

```
/
├── GLOSSARY.md
├── docs/
│   ├── adr/
│   └── agents/
├── packages/
└── apps/
```

## Use the glossary's vocabulary

When your output names a domain concept — an issue title, a refactor proposal, a hypothesis, a test name — use the term as `GLOSSARY.md` defines it, and don't drift to synonyms it avoids. If the concept isn't there yet, that is a signal: either you're inventing language the project doesn't use (reconsider), or there is a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it rather than silently overriding it:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
