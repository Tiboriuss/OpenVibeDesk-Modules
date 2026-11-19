# Notes module

[Module catalog](https://github.com/Tiboriuss/OpenVibeDesk-Modules) · [Contributing](https://github.com/Tiboriuss/OpenVibeDesk-Modules/blob/main/CONTRIBUTING.md) · [OVD module contract](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/CONTRIBUTING.md#building-modules)

A self-contained local notes module for OpenVibeDesk. Version **0.2.0** follows the host’s English or German interface language for the Notes window, settings and Assistant discovery. Switching languages preserves the current draft, search and saved notes.

## Install

Use a host with the [module localization contract](https://github.com/Tiboriuss/OpenVibeDesk/blob/5108227/docs/localization.md). Earlier hosts with strict API-1 manifests reject the `locales` field. Version **0.1.0** is the previous German-only package.

Add `https://github.com/Tiboriuss/OpenVibeDesk-Modules` under **Settings → Modules → Module sources**. If the repository is private, enter a repository-scoped token with **Contents: Read-only**. Save, load the catalog and install Notes (**Notizen** in the repository listing). Approve the module's local code before activating it, then open Notes from the OVD dock.

The same functions are available to the OVD Assistant after approval. Try “Save a note: Prepare the presentation for Friday” or “Find notes about the presentation”. Discovery remains lazy; the complete tool catalog is not added to every chat request.

## Implementation

[`module.json`](module.json) describes metadata, tools and UI contributions. [`backend.cjs`](backend.cjs) exports `activate({ moduleId, dataDirectory })`; the host runs it in a separate process and provides a stable local module data directory. [`notes.html`](notes.html) and [`settings.html`](settings.html) use the host's isolated module view bridge. UI and Assistant call the same validated functions.

| Tool | Arguments | Behavior |
| --- | --- | --- |
| `sample-notes.list` | Optional `query`, `offset`, `limit` | Search/list notes, with `hasMore` and `nextOffset`. Default limit 20, maximum 50. |
| `sample-notes.add` | `text` | Add one note of up to 2,000 characters. |

The module stores up to 500 notes in `notes.json`, serializes changes, writes atomically, and honors cancellation. A listed page contains at most 24 KiB of note data. Editing and deletion are not implemented in this starter. Disabling the module preserves its data.

The declared `storage.module-data` permission describes intended use. The backend still runs with the current user's OS rights; the separate process is not an OS sandbox.

## Provenance and license

Adapted from the [OVD Notes example](https://github.com/Tiboriuss/OpenVibeDesk/tree/5108227/examples/notes-module), including its bilingual interface. Distributed under the [MIT License](LICENSE).
