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
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "warn",
      "@typescript-eslint/no-require-imports": "error",

      // await import を禁止
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "Project rule: Avoid dynamic imports (await import). Use static imports instead.",
        },
      ],

      // vscode の直接 import を禁止
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "vscode",
              message:
                "Project rule: Avoid direct imports of 'vscode' module outside of designated files. Use the vscodeWrapper instead.",
            },
          ],
        },
      ],
    },
  },
  {
    // 例外設定
    files: [
      "src/providers/**",
      "src/commands/**",
      "src/extension.ts",
      "src/models/vscodeWrapper.ts",
      "src/models/vscodeTypes.ts",
      "src/models/vscodeTypeConverter.ts",
      "src/test/vscode/**",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
