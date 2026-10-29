# OpenVibeDesk Modules

A module catalog for [OpenVibeDesk](https://github.com/Tiboriuss/OpenVibeDesk). It contains installable packages and their editable source, so teams can build and distribute their own modules through a public or private repository.

OpenVibeDesk is being built for everyday work in small businesses: for example, helping a small auto repair shop deal with customer and supplier email. Familiar windows and controls are central to the app, with an assistant available alongside them. The aim is useful help that people can understand and operate without becoming AI specialists.

Modules let an IT person at a small company or an IT service provider adapt the app to that business. A custom module could connect an existing ERP and make relevant tasks available through both a module window and the assistant. Companies can keep these integrations in private repositories.

Modules contribute tools, views, settings and navigation through OVD's module contract. The interface and Assistant use the same functions. OVD discovers module tools on demand, keeping unused schemas and catalog contents out of the default chat context.

## Add this repository to OVD

Use an OVD build with module repository support, then open **Settings → Modules → Module sources** (currently **Einstellungen → Module → Modulquellen**):

1. Select **Repository hinzufügen** and enter a name.
2. Enter `https://github.com/Tiboriuss/OpenVibeDesk-Modules` as the repository URL.
3. If a repository is private, enter a fine-grained GitHub personal access token restricted to that repository with **Contents: Read-only**. Your account must have repository access; organization approval or SSO may also be required.
4. Save the source and select **Katalog laden**.
5. Choose **Installieren**, then review and approve the module's code before activating it.

The token is stored in the operating system credential store and is not returned to the Assistant. Enter it in OVD's token field, never in the repository URL or a chat message. Public repositories do not require a token.

New or changed module code requires explicit approval, including when **Ohne Abfragen** is enabled for Assistant actions. Approved backend code runs with the user's normal OS permissions; its separate process provides crash isolation, not an OS sandbox.

## Available modules

| Module | ID / version | Functions |
| --- | --- | --- |
| [Notes / Notizen](modules/sample-notes/README.md) | `sample-notes` / `0.1.0` | Add, list and search local notes through its window or the Assistant. |
| [Skill Library / Skill-Bibliothek](modules/skill-library/README.md) | `skill-library` / `0.1.1` | Save, find and edit reusable instructions; attach a selected skill to a chat request alongside mail or files. Requires a host with process reference support. |

Notes is a small working example with no extra dependencies. It currently supports adding and reading/searching notes; editing and deletion are not implemented. For example, ask the Assistant: “Save a note: Prepare the presentation for Friday”, then “Find my notes about the presentation”.

Skill Library lets the Assistant save procedures on user request, using the same functions as its library window. Drag a saved skill into chat or choose **Im Chat verwenden**, then add the task and any mail/file references. The skill applies only to that submitted request. Its `snapshotTool` and `usage` manifest fields require a host build containing the new process reference contract; older API-1 hosts do not accept those fields. See its [compatibility and usage guide](modules/skill-library/README.md).

## Repository layout

```text
ovd-modules.json                 # Current catalog, including per-file SHA-256 hashes
modules/<module-id>/            # Editable module source
packages/<module-id>/<version>/ # Published, immutable installable package
```

OVD reads `ovd-modules.json` from the default branch. It downloads the package files listed there, validates their hashes and manifest, and installs the selected version. Packages already contain runnable code; OVD does not install dependencies or run build hooks.

To update a module, publish a new version and refresh the catalog in OVD. Updates preserve the module's data and require approval of the new code before execution. Removing this source from OVD keeps installed modules and their data.

## Build and publish your own module

Start with the Notes source and follow [Contributing](CONTRIBUTING.md). Build dependencies before packaging, increment the version in `module.json`, and generate a new package and catalog entry with OVD's helper. With the two repositories checked out side by side, run from this repository:

```sh
pnpm --dir ../OpenVibeDesk build
node ../OpenVibeDesk/scripts/prepare-module-repository.cjs modules/<module-id> .
```

The OVD checkout requires **Node.js 22.13+** and **pnpm 11.25.0**. Install its dependencies following the [OVD setup guide](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/docs/getting-started.md) before the first build. Replace `<module-id>` with your source folder. The helper validates without executing module code, creates `packages/<module-id>/<version>/`, and calculates the catalog hashes.

Review and commit the source, new package directory and catalog together. Published package directories must never be edited or overwritten; increment the version for every release. The helper performs no Git operations.

See the upstream [module authoring contract](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/CONTRIBUTING.md#building-modules) and [repository format and lifecycle guide](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/docs/module-repositories.md) for the complete contract and current limits.

## License

[MIT](LICENSE). Keep the license notices with redistributed module packages.
