import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const baseDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      ".tools/**",
      "public/data/**",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    files: ["public/**/*.{js,mjs}"],
    rules: {
      "import/named": "error",
      "import/no-unresolved": "error",
    },
  },
];

export default config;
