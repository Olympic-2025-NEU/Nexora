// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "apps/dx-lab/.next/**",
    "out/**",
    "build/**",
    "worker/dist/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
