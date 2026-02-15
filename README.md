# localize-support — localization helper

[日本語版](README_ja.md)

## Overview

**localize-support** is a VS Code extension that connects source code with translation files (for example, `.po`) and helps localization workflows by providing go-to-definition, find references, hover previews, rename integration, and diagnostics. It uses tree-sitter internally for fast code parsing and provides PO parsing and editing support.

## Supported languages & formats

- Code languages: JavaScript, TypeScript, Python, C#
- Translation format: GNU Gettext PO files(`.po`)

## Key features

- Go to definition `F12`: jump from locale keys in code to translation files
- Find references `Shift+F12`: list locations where a translation key is used
- Hover translation preview: instant preview of translated strings
- IntelliSense / completion `Ctrl+Space`: suggest localization keys and show translation previews while typing inside localization function arguments
- Rename integration `F2`: propagate locale key name changes to code and translation files
- Diagnostics: warnings for missing translations or unused keys

## Usage

Install `localize-support` and configure it.

## Configuration

`settings.json`:

```json
{
  "localize-support.targets": [
    {
      "codeLanguages": ["javascript", "typescript"],
      "codeDirs": ["src"],
      "l10nFormat": "po",
      "l10nDirs": ["locales"],
      "l10nExtension": ".po",
      "l10nFuncNames": ["t", "_"]
    }
  ],
  "localize-support.wasmCdnBaseUrl": "https://unpkg.com/tree-sitter-wasms@{version}/out/"
}
```

- `codeLanguages`: target code languages (`javascript`, `typescript`, `python`, `csharp`, `java`)
- `codeDirs`: root directories for source code (relative to workspace root)
- `l10nFormat`: localization file format (currently `po` only)
- `l10nDirs`: root directories for localization files (relative to workspace root)
- `l10nExtension`: localization file extension
- `l10nFuncNames`: names of localization functions (e.g. for `t("key")`, use `"t"`)
- `localize-support.wasmCdnBaseUrl`: base URL for tree-sitter wasm CDN (use `{version}` placeholder)

To configure different targets within the workspace, place a `localize-support.json` file in the desired folder:

```json
{
  "targets": [
    {
      "codeLanguages": ["javascript", "typescript"],
      "codeDirs": ["src"],
      "l10nFormat": "po",
      "l10nDirs": ["locales"],
      "l10nExtension": ".po",
      "l10nFuncNames": ["t", "_"]
    }
  ]
}
```

- `codeLanguages`: target code languages (`javascript`, `typescript`, `python`, `csharp`, `java`)
- `codeDirs`: root directories for source code (relative to the JSON file)
- `l10nFormat`: localization file format (currently `po` only)
- `l10nDirs`: root directories for localization files (relative to the JSON file)
- `l10nExtension`: localization file extension
- `l10nFuncNames`: names of localization functions (e.g. `"t"` for `t("key")`)

## Development & testing

- Build: `yarn compile`
- Dev watch: `yarn watch` (TypeScript watch)
- Lint: `yarn lint`
- Unit tests: `yarn test:unit`
- Integration tests: `yarn test:integration`
- All tests: `yarn test`

## Contributing

1. Open an issue or fork and create a branch
2. Run `yarn lint` and `yarn test:unit`
3. Submit a PR with description and tests

## Troubleshooting

- If wasm download fails, verify `localize-support.wasmCdnBaseUrl`.

## License

MIT

## Release notes

- 0.0.1 — Initial implementation: go-to-definition, references, hover, rename, completion, PO parsing, Tree‑sitter integration

## Feedback

Report bugs or feature requests via [GitHub Issues](https://github.com/your-repo/issues).

