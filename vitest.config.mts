import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    passWithNoTests: false,

    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/capa",
      reporter: ["text", "json", "html", "lcov"],

      /**
       * capa-types.ts contains compile-time-only declarations and therefore
       * has no executable runtime statements to measure.
       */
      include: [
        "lib/capa/**/*.ts",
        "lib/security/**/*.ts",
      ],
      exclude: [
        "lib/capa/**/*.d.ts",
        "lib/capa/domain/capa-types.ts",
      ],

      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
