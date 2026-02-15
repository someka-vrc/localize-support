import typescriptEslint from "typescript-eslint";

export default [
  {
    files: ["**/*.ts"],
  },
  {
    plugins: {
      "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
    },

    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],
      "@typescript-eslint/no-require-imports": "error",
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "warn",
      // 禁止ルール: `vscode` の直接 import をプロジェクト全体で禁止（特定ファイルは除外）
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "vscode",
              message:
                "User defined rule: Avoid direct imports of 'vscode' module outside of designated files. Use the vscodeWrapper instead for better testability.",
            },
          ],
        },
      ],
    },
  },
  {
    // 例外: provider・extension・wrapper・統合テストでは `vscode` の import を許可
    files: [
      "src/providers/**",
      "src/extension.ts",
      "src/models/vscodeWrapper.ts",
      "src/models/vscodeTypes.ts",
      "src/test/vscode/**",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
