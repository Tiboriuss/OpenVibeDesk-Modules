# Repository rules

- This repository publishes prebuilt OpenVibeDesk modules through `ovd-modules.json`. Source modules live under `modules/`; immutable distributable versions live under `packages/<id>/<version>/`.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) and the upstream [module contract](https://github.com/Tiboriuss/OpenVibeDesk/blob/main/CONTRIBUTING.md#building-modules) before implementation. Current catalogs and capabilities must match the supported host contract.
- UI and OVD Assistant must use the same typed, validated module functions. Include narrow discovery descriptions, bounded results, pagination and cancellation. Do not fill the default AI context with entire catalogs or user data.
- Bundle dependencies before publication. Runtime installation must not execute package-manager, build or installer hooks.
- Never edit an existing published version under `packages/`. Increment the source manifest version, generate a new package and publish its files and catalog update together. Use the upstream publishing helper to validate and generate SHA-256 checksums.
- Preserve local module data across updates. New or changed code requires explicit host approval. A separate backend process is not an OS sandbox; declared permissions are not OS access controls.
- Keep credentials out of Git, catalogs, module metadata and assistant results. Use the host's supported credential facilities. Private repository tokens are entered in OVD settings and stored in the OS credential store.
- Keep documentation in English and relative links valid. User-facing UI may follow the host's current German labels. State implemented behavior accurately.
- Validate the affected workflow practically in an isolated OVD profile, including the equivalent assistant task and update/data preservation where applicable. Never use real personal data or send real mail for checks. Do not routinely add automated tests or GitHub Actions.
- Preserve source licenses and module attribution. Do not commit local profiles, data files, secrets, scratch reports or build dependencies.
