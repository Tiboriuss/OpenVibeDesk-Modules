# Skill Library module

[Module catalog](https://github.com/Tiboriuss/OpenVibeDesk-Modules) · [Contributing](https://github.com/Tiboriuss/OpenVibeDesk-Modules/blob/main/CONTRIBUTING.md) · [OVD module contract](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/CONTRIBUTING.md#resource-references)

Skill Library stores reusable working instructions locally and lets the user attach a selected skill to a chat request. For example, a skill can describe how to summarize supplier mail, extract information from a file, or draft an answer in a company's preferred style. Its German interface is called **Skill-Bibliothek**. Version **0.1.1** is a dependency-free process module using OVD module API 1.

## Host compatibility and installation

This module requires an OVD host build with process reference support: `referenceTypes.snapshotTool`, `referenceTypes.usage` and the `ovd:reference` HTML bridge. These additions are implemented in the adjacent `OpenVibeDesk` checkout. Build and use that host before installing this package. Older OVD builds that validate the earlier API-1 manifest reject the new reference fields; API version 1 alone does not establish compatibility.

Add `https://github.com/Tiboriuss/OpenVibeDesk-Modules` under **Einstellungen → Module → Modulquellen**, save the source, load the catalog and install **Skill-Bibliothek**. For a private repository, use the repository token field with **Contents: Read-only** access. Review and explicitly approve the module's local code before activation. Open **Skills** from the OVD dock. Changed code requires renewed approval.

## Save and manage skills

Ask the Assistant to store a reusable procedure, for example:

> Save this way of working as a skill called “Answer customer mail”: briefly summarize the customer's concern, list missing information, and draft a friendly reply without promising dates or prices.

The Assistant discovers the library's functions on demand and saves skills only in response to a user request. It can search, read, create, update and delete through the same functions as the library window. Saving or reading a skill does not apply it to the current conversation.

The window uses a compact toolbar without introductory or footer banners. On narrow windows, the list and editor occupy separate panels; use **Alle Skills** to return to the list.

In the window, choose **Neuer Skill**, enter its title, short description, optional comma-separated tags and working instructions, then choose **Speichern**. Search matches titles, descriptions and tags; **Weitere Skills laden** retrieves another page. Select a skill to read or edit it. **Löschen** removes it from the library. Save and delete use the host's action confirmation flow; the user's saved **Ohne Abfragen** setting governs individual action prompts while code approval remains separate.

Unsaved edits remain available while searching or switching skills in the same open window. They are not persistent drafts and are lost when the window closes. Save before applying a changed skill. Updates and deletion require the current revision, so a concurrent Assistant or window edit cannot silently overwrite a newer version. On a revision conflict, read and review the current saved content before making another change.

## Apply a skill to a request

1. Drag a saved skill from the list or its detail view into the chat reference area. Alternatively, open it and choose **Im Chat verwenden**.
2. Add the question or task to the chat. A mail or file may be attached alongside the skill.
3. Check the selected references and send the request. For example, attach a customer mail and the saved reply skill, then ask: “Draft an answer to this mail using the attached skill.”

The skill supplies instructions for that submitted request. It is not permanently enabled for the chat or future requests, and selecting it does not send the request or execute actions. An attached mail or file remains source material. The skill grants no additional permissions and does not bypass confirmations or higher-priority host instructions.

The drag payload contains only `{moduleId, type, id}`. The approved owning backend resolves the current complete instruction text; the host assigns its instruction role from the approved manifest. An unavailable, deleted or disabled skill cannot silently be applied from an old chat snapshot. Already sent snapshots remain in local chat history as records. When sending, the selected skill's text is sent to the configured AI provider and stored with the chat, just like other selected reference content.

## Data and limits

Skills and bounded operation receipts are stored in `skills.json` under the host-provided `dataDirectory`, normally `<userData>/module-data/skill-library/`. Installation files and user data are separate. Module updates, disabling the module and removing its repository source preserve this data. The module does not read mail or files itself, access a network service, install dependencies or execute saved instruction text as code.

- At most **500 skills**.
- Instructions: at most **6,000 characters** and **8,192 UTF-8 bytes** per skill.
- Title: 120 characters; description: 400 characters; up to 12 tags of 40 characters each.
- Lists return metadata only, with a default page of 20 and a maximum of 50. Long results may use a smaller page to stay within the result budget.
- Reading instructions is paged, at most 4,000 characters per call; the Assistant follows `nextOffset` until complete. A selected chat reference contains the complete bounded instruction text.

The serialized save request also has a 16,000-byte budget, so heavily escaped content or long metadata may require shorter text. Storage writes are serialized and use atomic file replacement. Unknown or invalid storage formats produce a visible error and are not replaced with an empty library.

After a timeout or uncertain write result, inspect the saved library or operation status before another deliberate save or delete. The module never automatically repeats an uncertain mutation. Journalled Assistant writes can reconcile a completed action from a receipt saved atomically with its data; absence of a receipt is not proof that an earlier action did not occur. The receipt store is bounded to 1,000 entries and refuses further journalled mutations when full instead of dropping execution evidence.

The declared `storage.module-data` permission describes intended access. Like other approved OVD process modules, the backend runs with the user's OS rights; its separate process provides crash isolation rather than an OS sandbox.

## Implementation

[`module.json`](module.json) declares tools, a library view, settings and the `skill` reference type. [`backend.cjs`](backend.cjs) supplies the shared validated implementation; [`library.html`](library.html) and [`settings.html`](settings.html) use the isolated host bridge.

| Tool | Arguments | Behavior |
| --- | --- | --- |
| `skill-library.list` | Optional `query`, `offset`, `limit` | Search metadata; returns an exact match count, scope, observation time and continuation. |
| `skill-library.read` | `id`; optional `offset`, `limit` | Read metadata, revision and a resumable instruction page. |
| `skill-library.save` | `title`, `description`, `instructions`; optional `tags`, `id`, `expectedRevision` | Create a skill or replace a skill at its expected revision, on user request. |
| `skill-library.delete` | `id`, `expectedRevision` | Delete the specified current revision, on user request. |
| `skill-library.reference` | `id` | Resolve the complete current instruction snapshot for an explicitly selected reference. |

The backend also provides the host's optional `prepareOperation` and `reconcile` hooks. These bind stable targets and inspect durable action receipts; they do not repeat the domain action during status checks. Published package versions remain immutable; create a new version with the upstream packaging helper for every release.

## License

Distributed under the [MIT License](LICENSE), following the process-module pattern from the [OVD Notes example](https://github.com/Tiboriuss/OpenVibeDesk/tree/main/examples/notes-module).
