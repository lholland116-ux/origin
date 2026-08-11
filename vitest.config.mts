import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    passWithNoTests: false,

    /**
     * Prevent mock state from leaking between controlled test cases.
     */
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,

    /**
     * Fail tests that exceed the controlled execution limit.
     */
    testTimeout: 10_000,
    hookTimeout: 10_000,

    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/capa",
      reporter: ["text", "json", "html", "lcov"],

      /**
       * Include executable CAPA and security modules.
       *
       * Provider interfaces under lib/database contain no runtime code and
       * are verified by TypeScript compilation and adapter integration
       * tests rather than executable line coverage.
       */
      include: [
        "lib/capa/**/*.ts",
        "lib/security/**/*.ts",
      ],

      /**
       * Exclude compile-time-only declarations and provider contracts that
       * contain no executable statements.
       */
      exclude: [
        "lib/capa/**/*.d.ts",
        "lib/capa/domain/capa-types.ts",
        "lib/capa/authorization/capa-policy.ts",
      ],

      /**
       * Release-blocking coverage thresholds for the current controlled
       * CAPA and security implementation.
       */
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});