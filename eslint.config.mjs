import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/out/**", "**/node_modules/**", "apps/*/public/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["**/*.ts", "**/*.tsx"], rules: { "@typescript-eslint/no-explicit-any": "error" } },
  // Build scripts inside an app run in Node.
  { files: ["apps/*/scripts/**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } } },
);