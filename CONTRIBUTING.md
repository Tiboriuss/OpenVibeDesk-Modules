# Contributing modules

[Repository overview](README.md) · [OVD module contract](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/CONTRIBUTING.md#building-modules)

This repository distributes prebuilt OVD modules. Keep editable source under `modules/<module-id>/`, published releases under `packages/<module-id>/<version>/`, and the current listings in `ovd-modules.json`. Documentation is maintained in English; existing German interface labels can remain where they identify actual controls.

## Create a module

Use [sample-notes](modules/sample-notes/) as a dependency-free starting point. Choose a unique module ID and update every matching tool name and backend identity check when adapting it. Third-party modules cannot use the reserved `ovd-` prefix, mark themselves required, or use internal host adapters.

A module needs `module.json` with `apiVersion: 1`, a semantic version, a short description, discovery keywords, and a process runtime entry such as `backend.cjs`. List the same tool names in `capabilities` and `tools`; every tool name begins with the module ID. Declare local HTML views/settings and navigation through the manifest.

Implement each domain action once and expose it to both the module interface and Assistant through the same tool. Validate inputs in the backend, return bounded results with truthful errors and completeness, support pagination where needed, and respect cancellation. Descriptions should explain prerequisites and confirmations without including entire data sets or unrelated tool catalogs. Follow the upstream [module authoring contract](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/CONTRIBUTING.md#building-modules) for lifecycle, confirmation, attention indicators and isolated HTML messaging.

Persist module data in the host-provided `dataDirectory`, separately from its installed package. Handle upgrades without deleting existing data. An uncertain external action must not be repeated automatically. Keep credentials out of arguments, results, module packages and chat context.

OVD's separate module process is not an OS sandbox. Declared permissions document intended access; they do not restrict filesystem or network access at the operating system level. Bundle dependencies beforehand. Installing a package does not run package-manager commands, setup scripts or build hooks.

## Prepare a release

1. Finish the runnable source under `modules/<module-id>/`, including all HTML assets, bundled dependencies and applicable license notices.
2. Increment `module.json`'s version. Never reuse or modify a version directory already published under `packages/`.
3. Build the adjacent OVD checkout and run its packaging helper from this repository:

   ```sh
   pnpm --dir ../OpenVibeDesk build
   node ../OpenVibeDesk/scripts/prepare-module-repository.cjs modules/<module-id> .
   ```

   OVD requires Node.js 22.13+ and pnpm 11.25.0; install its dependencies before the first build. Adjust `../OpenVibeDesk` if your checkout is elsewhere. For the included example, use `modules/sample-notes` after incrementing its version.

4. Inspect the generated package and `ovd-modules.json`. The module ID, version and API version must match the manifest. The helper lists every package file and records its SHA-256 hash.
5. Validate the workflow below, then commit the source, new package and catalog in one commit. Push only when the release is ready for users.

The catalog advertises one current release per module ID. Keep older package directories for existing references; the helper updates the listing while preserving earlier releases. Do not edit generated packages by hand.

Packages currently allow at most 200 files and 16 MiB, with a 64 KiB manifest. Paths must be portable relative paths: no symlinks, traversal, hidden files, URL components, Windows reserved names or case-insensitive collisions. Full validation lives in OVD's [manifest schema](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/electron/modules.ts) and [catalog schema](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/shared/module-repositories.ts).

## Validate the user workflow

Use an isolated OVD profile and synthetic content. Exercise catalog loading, installation, explicit code approval, the module's window/settings, and the equivalent concrete Assistant request. Check restart, cancellation, disabling and a version update that retains existing module data. Confirm that failures have an accurate visible result and that new code waits for approval before execution.

Keep validation local and proportionate. Do not add routine automated test suites or GitHub Actions. Never use real mail, company data, normal user profiles or production credentials for validation.

Before committing, check documentation links, manifest/catalog consistency, package hashes and the changed file list. Do not commit credentials, `.env` files, local note stores, databases, dependency folders, OVD profiles or scratch output. Retain the [MIT license](LICENSE) and any bundled third-party notices.
