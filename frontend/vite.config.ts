import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The project built without this file for a long time: Vite transpiles `.tsx`
 * on its own, so production output was always fine. What was missing is the
 * React plugin, and with it Fast Refresh — editing a component in `npm run dev`
 * reloaded the whole page and threw away application state (which route you
 * were on, a half-typed email, an open modal).
 *
 * `tsconfig.json` sets `"jsx": "react-jsx"`, and the plugin defaults to the
 * same automatic runtime, so the two agree and no component needs to import
 * React to use JSX.
 */
export default defineConfig({
  plugins: [react()],
});
