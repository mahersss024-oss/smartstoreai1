import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // The native application maintains its own lint configuration.
    "AI/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "**/.next/**",
    "**/.next-mobile/**",
    // Runtime data and downloaded browser/tool caches are not project source.
    ".data/**",
    ".patch-work/**",
    "out/**",
    "build/**",
    "coverage/**",
    "screenshots/**",
    "**/screenshots/**",
    "test-results/**",
    "playwright-report/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
