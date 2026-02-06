export const LanguageWasmMap: { [languageId: string]: { wasmName: string; query: string } } = {
  csharp: {
    wasmName: "tree-sitter-c_sharp.wasm",
    query: `
      (invocation_expression
        function: (identifier) @func-name
        arguments: (argument_list) @args)
    `,
  },
};
