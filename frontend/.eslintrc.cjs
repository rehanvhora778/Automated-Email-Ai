/**
 * ESLint 8 legacy config (`.cjs` because package.json sets `"type": "module"`).
 *
 * The four lint packages were in devDependencies with no config to use them,
 * so `npm run lint` could not parse a single file — it had no TypeScript
 * parser, and its --ext only covered js/jsx in a source tree that is entirely
 * .ts/.tsx. Both are fixed here and in the lint script.
 */
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    // Switches off the rules that assume the old JSX transform, matching
    // tsconfig's "jsx": "react-jsx" — no file needs to import React.
    "plugin:react/jsx-runtime",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", "node_modules", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  plugins: ["react-refresh"],
  settings: { react: { version: "detect" } },
  rules: {
    // Fast Refresh can only patch a module that exports components alone; a
    // component file that also exports a helper falls back to a full reload.
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    // TypeScript already checks prop types; duplicating that in propTypes is
    // noise in a codebase with no PropTypes anywhere.
    "react/prop-types": "off",
    // `while (true) { ... break }` is how you drain a ReadableStream. ESLint 9
    // made this the default; on 8 it has to be asked for.
    "no-constant-condition": ["error", { checkLoops: false }],
    // Keep the half of this rule that catches real mistakes — a stray `>` or
    // `}` in JSX renders wrong. An apostrophe in prose does not.
    "react/no-unescaped-entities": ["error", { forbid: [">", "}"] }],
    // Reported, not enforced. Every current instance is an axios error handler
    // reaching for `error.response.data.detail`; typing those properly is a
    // change to application code, not something adding a linter should do
    // silently. Left visible so they get fixed deliberately.
    "@typescript-eslint/no-explicit-any": "warn",
  },
  overrides: [
    {
      // Build-time config read by Node, not shipped to the browser.
      files: ["*.config.js", "*.config.ts", "vite.config.ts"],
      env: { node: true, browser: false },
    },
  ],
};
