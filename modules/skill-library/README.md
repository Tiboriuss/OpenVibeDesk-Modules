# Skill Library module

[Module catalog](https://github.com/Tiboriuss/OpenVibeDesk-Modules) · [Contributing](https://github.com/Tiboriuss/OpenVibeDesk-Modules/blob/main/CONTRIBUTING.md) · [OVD module contract](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/CONTRIBUTING.md#building-modules)

Skill Library stores reusable working instructions locally. Version **0.2.0** presents skills as tiles, organizes them into categories and favorites, and edits them in a modal dialog. The German interface is called **Skill-Bibliothek**. It is a dependency-free process module using OVD module API 1.

## Host compatibility and installation

The module requires process reference support (`referenceTypes.snapshotTool`, `referenceTypes.usage` and the `ovd:reference` bridge). The editor is an HTML dialog inside the module and requires no additional host window interface. Module API 1 alone does not establish compatibility. Host changes require explicit prior agreement with the user.

Add this repository under **Einstellungen → Module → Modulquellen**, load the catalog and install **Skill-Bibliothek**. Review and explicitly approve the module's code before activation. Open **Skills** from the dock. Changed code requires renewed approval. Published packages remain immutable.

## Tiles, favorites and categories

Each tile shows a skill's title, description and tags. Drag the tile to chat, or choose **Im Chat verwenden**. The star button adds or removes the favorite mark. The pencil opens the editor dialog; the tile grid contains no inline editing form.

The category navigation always contains **Alle** and **Favoriten**. **Alle** includes every skill; **Favoriten** includes every starred skill regardless of its category. Custom categories appear as skills are assigned to them. **Ohne Kategorie** appears when applicable. The narrow layout keeps category navigation compact above the responsive tile grid.

Search matches title, description, category and tags within the selected view. **Weitere Skills laden** retrieves another bounded page. Counts in the category navigation refer to the whole local library, while the grid count reflects the active search and category filter.

In the editor, enter a category to assign the skill or create a category name. Leave it empty for no category. Names are limited to 60 characters; **Alle** and **Favoriten** are reserved views. Category matching is case-insensitive. There is no separate category deletion operation: a category disappears when no skill belongs to it.

## Edit in a dialog

Choose **Neuer Skill** or a tile's pencil. The editor contains title, optional description, tags, category, favorite mark and working instructions. Save and delete use the existing host confirmation flow; the saved **Ohne Abfragen** setting governs individual Assistant action prompts while code approval remains separate.

The editor opens above the grid and keeps the category navigation in place behind it. Closing with the close button or Escape requires an explicit choice to save, discard or keep editing a dirty draft. Drafts live in the open module window; save before closing the entire library window. An uncertain mutation must first be checked. Successful saves refresh the grid and category counts and keep the dialog open. Deleting closes it. The dialog returns focus to the control that opened it.

Updates, favorite changes and deletion use the current revision. A concurrent Assistant or editor change cannot silently overwrite a newer skill. On a revision conflict, keep the draft and review the current saved content before another deliberate mutation.

## Use with the Assistant

Ask, for example:

> Save this way of working as a skill called “Answer customer mail”, in category “Customer service”: summarize the customer's concern, list missing information, and draft a friendly reply without inventing dates or prices.

The Assistant can search, read, create, update, categorize, favorite and delete through the same validated functions as the interface. Saving, favoriting or reading a skill does not activate its instructions.

To apply a skill, attach it to the chat, add the task and optionally a mail or file, then send. It applies only to that submitted request. Attached mail and files remain source material; the skill grants no additional permissions or action authorization. Selecting a skill alone does not send the request.

Drag payloads contain only `{moduleId, type, id}`. The approved owning backend resolves the complete current instructions, and the host assigns their role from the approved manifest. Deleted, disabled or unavailable skills cannot silently activate an old snapshot. When sending, the selected instructions are sent to the configured AI provider and saved with the local chat.

## Data, upgrades and limits

Skills and durable operation receipts live in `skills.json` under the host's `dataDirectory`, normally `<userData>/module-data/skill-library/`. Updates, disabling and source removal preserve this directory. The module does not access mail or files itself, use a network service or execute saved instructions as code.

Versions before 0.2 use storage schema 1. These files remain readable without an immediate rewrite; existing skills default to no category and not favorited. The next successful mutation atomically writes schema 2 while preserving existing skill IDs, content and operation receipts. Older module versions cannot read schema 2; downgrading is not a supported recovery path. Corrupt or unknown storage is reported and never replaced with an empty library.

- At most **500 skills**.
- Instructions: at most **6,000 characters** and **8,192 UTF-8 bytes**.
- Title: 120 characters; description: 400; category: 60; up to 12 tags of 40 characters each.
- List and category results are paginated, with at most 50 items per call and smaller pages when needed for the result budget.
- Instruction reading is paged at 4,000 characters per call. An attached reference contains the complete bounded instruction text.
- Save arguments also have a 16,000-byte JSON budget; heavily escaped text may require shorter content.

Writes are serialized and use atomic replacement. After a timeout or uncertain result, inspect the saved state before another deliberate mutation. Journalled mutations store matching receipts atomically with their data. Missing receipts are not proof that an earlier action did not happen. The receipt store refuses further journalled mutations after 1,000 receipts rather than discarding execution evidence.

## Shared functions

| Tool | Behavior |
| --- | --- |
| `skill-library.list` | Search/page through metadata with optional category and favorites filters. |
| `skill-library.categories` | Page through category names/counts and read global All/Favorites/uncategorized counts. |
| `skill-library.read` | Read a skill's metadata, current revision and resumable instruction text. |
| `skill-library.save` | Create or replace on user request; omitted category/favorite fields preserve existing values on update. |
| `skill-library.set_favorite` | Set the requested favorite state at its expected revision. |
| `skill-library.delete` | Delete the specified current revision on user request. |
| `skill-library.reference` | Resolve a selected skill's complete current snapshot. |

The backend also implements optional `prepareOperation` and `reconcile` hooks for stable action targets and authoritative receipt checks. The declared `storage.module-data` permission describes intended access. The approved backend runs with the user's normal OS rights; its separate process provides crash isolation rather than an OS sandbox.

## License

[MIT](LICENSE), following the process-module pattern from the [OVD Notes example](https://github.com/Tiboriuss/OpenVibeDesk/tree/main/examples/notes-module).
