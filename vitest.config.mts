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
     * Fail tests and hooks that exceed the controlled execution limit.
     */
    testTimeout: 10_000,
    hookTimeout: 10_000,

    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/capa",
      reporter: ["text", "json", "html", "lcov"],
      clean: true,

        /**
         * Measure executable CAPA, security, in-memory persistence and durable
         * Supabase persistence code.
         *
         * Both persistence adapters are controlled implementations. Their
         * transaction, rollback, isolation, concurrency and integrity behavior
         * must remain covered by release-blocking tests.
         */
        include: [
          "lib/capa/**/*.ts",
          "lib/security/**/*.ts",
          "lib/database/in-memory/**/*.ts",
          "lib/database/supabase/**/*.ts",
        ],

      /**
       * Exclude compile-time declarations and provider-neutral contracts
       * that contain no executable runtime behavior.
       */
      exclude: [
        "lib/**/*.d.ts",
        "lib/capa/domain/capa-types.ts",
        "lib/capa/authorization/capa-policy.ts",
      ],

      /**
       * Release-blocking thresholds for executable controlled modules.
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