# Notes module

[Module catalog](https://github.com/Tiboriuss/OpenVibeDesk-Modules) · [Contributing](https://github.com/Tiboriuss/OpenVibeDesk-Modules/blob/main/CONTRIBUTING.md) · [OVD module contract](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/CONTRIBUTING.md#building-modules)

A self-contained local notes module for OpenVibeDesk. Its interface is currently German (**Notizen**); documentation is in English. Version **0.1.0** supports adding, listing and searching notes. It requires OVD module API version 1 and has no external dependencies.

## Install

Add `https://github.com/Tiboriuss/OpenVibeDesk-Modules` under **Einstellungen → Module → Modulquellen**. If the repository is private, enter a repository-scoped token with **Contents: Read-only**. Save, load the catalog and install **Notizen**. Approve the module's local code before activating it, then open **Notizen** from the OVD dock.

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

Adapted from the [OVD Notes example at commit 01940be](https://github.com/Tiboriuss/OpenVibeDesk/tree/01940be35b89b84fba6f0ad40d3690196f525179/examples/notes-module). Runtime and UI code are unchanged; this README and the included license make the published package self-contained. Distributed under the [MIT License](LICENSE).
