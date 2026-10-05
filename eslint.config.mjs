import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// Type-aware: in a CLI that signs orders, a dropped promise is a silent failure.
export default defineConfig(
  { ignores: ["dist/**", "coverage/**"] },
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // The same view of the SDK as `npm run typecheck` (tsconfig.check.json).
        project: ["./tsconfig.check.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { files: ["**/*.mjs"], ...tseslint.configs.disableTypeChecked }
);
