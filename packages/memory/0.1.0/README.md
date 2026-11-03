# Memory module

[Module catalog](https://github.com/Tiboriuss/OpenVibeDesk-Modules) · [Contributing](https://github.com/Tiboriuss/OpenVibeDesk-Modules/blob/main/CONTRIBUTING.md) · [Host memory contract](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/docs/module-memory.md) · [Host event contract](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/docs/module-events.md)

Memory stores sourced facts locally and supplies relevant confirmed entries before a new Assistant request. The German interface is **Gedächtnis**. Version **0.1.0** is a dependency-free API-1 process module with explicit storage tools, automatic read-only retrieval and an optional review inbox for future chat observations.

## Host compatibility and installation

Use an OVD development build with `contributions.memory.retrieveTool`, `contributions.events.subscriptions`, `onEvent`, process reference snapshots and the `ovd:reference` bridge. Released OVD **v0.1.3** predates these extensions. API version 1 alone does not establish compatibility, and the module catalog does not negotiate a minimum host version. This module requires no additional host modifications.

Load this repository under **Settings → Modules → Module sources**, install **Gedächtnis**, and explicitly approve its code. Open **Gedächtnis** from the dock. Changed code requires renewed approval; changed packages also require fresh event-source selection. Module data lives separately from its installed package and survives updates or disabling.

## Save, inspect and correct memories

Create a memory in the module window or ask the Assistant, for example:

> Remember that our workshop opens at 09:00 on Saturdays. Use “Workshop” as the scope and “Opening hours confirmed by me” as the source.

Each entry has a title, text, scope, source, revision, creation/update times and an optional expiry date. A source URL is optional. Scope is a user-maintained label for a project, business or person; it is not a permission boundary. Inspect and edit entries in a dialog. Saving a candidate after reviewing its text confirms it. The dedicated confirmation action can accept an unchanged candidate. Search, filters and pagination use the same backend functions as the Assistant.

Updates, confirmations and deletion require the current revision, so a concurrent change cannot silently overwrite an older draft. Keep a draft when a revision conflict occurs and inspect the current saved record. After an uncertain write, inspect current state or the host action status before another deliberate mutation. Acknowledged writes and action receipts are stored together.

Confirmed memories can be dragged into chat or selected with **Im Chat verwenden**. Drag payloads contain only `{moduleId, type, id}`. The owning backend resolves the current entry as ordinary context, not working instructions. Saving, confirming or attaching an entry does not execute its contents or grant permissions. Use Skill Library for deliberately selected working instructions.

Deletion removes the module's current entry. Existing chat snapshots and already recorded processing evidence remain historical records. This is not a complete erasure function for past chats.

## Automatic retrieval

The manifest declares `memory.recall` through `contributions.memory.retrieveTool`. With Workspace tools enabled, the host calls it before a new request without relying on model discovery. It reads existing confirmed, unexpired entries only. It never learns from the question or writes during activation or retrieval.

Retrieval uses local Unicode-aware lexical matching over title, text and scope, with relevance ranking and source/session context where available. It does not use an embedding service or language model and cannot promise semantic matches for unrelated wording. An empty match returns an empty memory array. The module ranks a bounded selection and truthfully reports additional relevant entries through `hasMore`.

The callback receives the current question, an opaque chat ID, host time and result budgets. It receives no earlier chat history, attachment contents or credentials. Short follow-ups without identifying words can therefore miss relevant facts. The host accepts at most 20 memories and 8,000 serialized characters across providers, under a shared five-second deadline. It validates sources, expiry and bounds, records failures and saves the exact supplied snapshot with the answer. The chat's **Gedächtnis** disclosure shows the used facts. Explicit continuation and answer reformulation reuse the saved snapshot rather than performing a new automatic lookup.

## Optional chat observations

All host event subscriptions start off. Under **Settings → Modules → Gedächtnis → Ereignisse empfangen**, select the desired sources. The same host controls are available to the Assistant through `modules.events_status` and `modules.events_subscribe`; the module's own settings explain them but cannot change host subscriptions through its isolated iframe.

The module declares:

- `chat.request.committed`: eligible future user text becomes a **Zu prüfen** candidate, with its source event and chat/message identity. This is the user's recorded statement, not a model-extracted or verified fact. Simple filtering skips empty, short or clearly interrogative/transient requests; it is a heuristic and does not understand every quotation or command.
- `chat.turn.finished`: links available completion status to the corresponding observation. Assistant prose is never promoted to a fact, and action counts do not prove a sentence correct.

Candidates never enter automatic recall. Review the statement, remove transient or quoted material, choose a useful title and scope, and confirm only what should remain available. Explicit storage requests beginning with “Merke dir”, “Merk dir” or “Remember” are left to the ordinary Assistant save tool rather than creating a second inbox entry. The module does not call an AI provider, infer structured facts from free text or automatically merge contradictory statements. Correct or replace confirmed entries deliberately; inspect overlapping entries when facts change. Revisions and timestamps identify changes; the module does not provide a complete history of previous entry texts.

Events contain bounded excerpts without mail/file contents, raw tool results or credentials. The host does not replay old chats for a newly selected source or backfill activity produced while Workspace tools were off. Event handling is asynchronous, so a new question can precede processing of the previous observation. Explicit Assistant saves complete synchronously through the ordinary save tool.

Host delivery is at least once. The module commits an event's local update or deliberate ignore decision together with a receipt keyed by source module and event ID before acknowledging. Redelivery therefore cannot duplicate an entry or recreate a deleted candidate. Conflicting reuse of an event identity is rejected. Processing never replays the originating task or invokes actions mentioned in the event. The module does not publish feedback events.

## Storage and recovery

The store is `memories.json` under the host-provided `dataDirectory`, normally `<userData>/module-data/memory/`. The module uses serialized access and atomic file replacement with durability acknowledgements. Read-only calls do not create an empty store. Invalid, corrupt or unknown data is reported and never replaced with an empty collection. Back up the data directory with OVD stopped before manual recovery; do not edit a live store.

Version 0.1.0 permits 2,000 entries, 10,000 event receipts, 2,000 journalled action receipts and a store file of at most 24 MiB. These bounds apply together; a large store may reach its byte limit before its entry limit. Receipts are not silently evicted to make space: capacity exhaustion is visible and further affected writes stop. The settings/status view exposes entry and receipt counts and limits. Deleting an entry does not discard its processing receipt or free receipt capacity.

Memory text is limited to 2,000 characters, titles to 120, scopes to 120, source labels to 300 and source URLs to 1,000. Sources accept HTTP(S) URLs without embedded credentials. List pages request at most 50 entries and may return fewer to respect the transport budget. Use `hasMore` and `nextOffset` rather than inferring completeness from a displayed page.

This module does not encrypt the OVD profile, access other modules' private files, use external services or execute stored content. The declared storage permission describes intended access; approved process code runs with normal OS user rights, not an OS sandbox. Event and action receipts retain processing evidence separately from the current memory collection.

## Shared functions

| Tool | Behavior |
| --- | --- |
| `memory.list` | Search and page through confirmed entries, candidates or all entries, optionally within an exact scope. |
| `memory.read` | Read one current full entry and its revision. |
| `memory.save` | Explicitly create or replace a confirmed memory after user review; omitted optional fields preserve existing values on update. |
| `memory.confirm` | Confirm a reviewed candidate at its current revision. |
| `memory.delete` | Delete one entry at its current revision. |
| `memory.recall` | Read and rank existing confirmed facts for the host's automatic context. |
| `memory.reference` | Resolve the current confirmed entry as ordinary chat context. |
| `memory.status` | Inspect counts, limits, scopes and event-processing metadata without changing data. |

The backend implements `prepareOperation` and `reconcile` for stable action targets and authoritative action-receipt checks. Ordinary module tools remain lazily discovered; no catalog or complete store enters the initial AI context.

## License

[MIT](LICENSE), following OVD's process-module contract and the module repository's existing patterns.
