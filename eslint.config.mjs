import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// Type-aware: in a CLI that signs orders, a dropped promise is a silent failure.
export default defineConfig(
  { ignores: ["dist/**", "coverage/**"] },
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { files: ["**/*.mjs"], ...tseslint.configs.disableTypeChecked }
);
