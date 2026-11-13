# Project identity

- Preserve the Chrome Web Store item and extension ID `cmaijknliglhgokkmijggladebokgafl`, established from the v0.1.5 store draft.
- `config/extension-identity.json` and `public/manifest.json` contain the verified identity contract. Do not generate a replacement key, remove `manifest.key`, or create a replacement store item for ordinary updates.
- Increase release versions normally; keep package name, identity key, extension ID and existing storage identifiers stable. Update the existing store item.
- Preserve `ott-switch-library`, existing store/record IDs and backup compatibility. Schema changes require explicit migrations and compatibility tests; do not change the database name to simulate a migration.
- Run `npm run check:identity` and appropriate tests when modifying manifests, build or packaging scripts. Keep source and built manifests consistent.
- Read `docs/extension-identity.md` before changing identity, release or storage behavior. Original unkeyed v0.1.5 installations may require one JSON backup/import when moving to the fixed store ID; do not claim an automatic cross-ID migration.
