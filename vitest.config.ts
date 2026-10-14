import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // loadEnv("", ...) reads .env + .env.local; prefix "" exposes all keys
    // (tests need server-only vars like DATABASE_URL, not just NEXT_PUBLIC_*)
    env: loadEnv("", process.cwd(), ""),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // The real `server-only` module throws outside a React Server
      // Components bundle; vitest runs in plain node (no react-server
      // resolution condition), so alias it to an empty stub.
      "server-only": path.resolve(__dirname, "src/test/stubs/server-only.ts"),
    },
  },
});
