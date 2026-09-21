import js from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "output/**",
      "pi/**",
      "public/**",
    ],
  },
  {
    ...js.configs.recommended,
    files: ["server/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      sonarjs,
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-control-regex": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
      "preserve-caught-error": "off",
      "sonarjs/cognitive-complexity": ["error", 30],
      "sonarjs/cyclomatic-complexity": ["error", { threshold: 20 }],
      "sonarjs/nested-control-flow": ["error", { maximumNestingLevel: 4 }],
    },
  },
];
