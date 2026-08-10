import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "**/._*", "components/**", "eslint.config.js", "vitest.config.mjs", "deploy/alert-sink/*.mjs", "deploy/handler-runtime/*.mjs", "deploy/scripts/*.mjs", "scripts/check-capability-parity.mjs", "scripts/check-internal-generation-contract.mjs", "scripts/clean-appledouble.mjs", "scripts/external-api-soak.mjs", "scripts/test-generated-component-runtime.mjs"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"]
  })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "no-console": ["error", { "allow": ["warn", "error"] }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/require-await": "off"
    }
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { sourceType: "module" },
    rules: {
      // Runtime modules execute under Node.js and are checked with node --check
      // plus their integration tests; they are intentionally not TypeScript
      // project-service inputs.
      "no-undef": "off",
      "no-console": "off",
      "no-unsafe-finally": "off"
    }
  }
);
