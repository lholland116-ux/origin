import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CapaRuntime,
} from "../../lib/capa/application/capa-runtime";

import type {
  CapaProductionRuntime,
} from "../../lib/capa/application/capa-production-runtime";

import type {
  SupabaseCapaContextResolver,
} from "../../lib/security/supabase-capa-context";

const mocks = vi.hoisted(
  () => ({
    get_development_runtime:
      vi.fn(),

    get_production_runtime:
      vi.fn(),

    resolve_development_context:
      vi.fn(),
  }),
);

vi.mock(
  "../../lib/capa/application/capa-development-runtime",
  () => ({
    getCapaDevelopmentRuntime:
      mocks.get_development_runtime,
  }),
);

vi.mock(
  "../../lib/capa/application/capa-production-runtime",
  () => ({
    getCapaProductionRuntime:
      mocks.get_production_runtime,
  }),
);

vi.mock(
  "../../lib/security/supabase-capa-context",
  () => ({
    resolveDevelopmentCapaRequestContext:
      mocks.resolve_development_context,
  }),
);

import {
  CapaRuntimeSelectionError,
  selectCapaRuntime,
} from "../../lib/capa/application/capa-runtime-selection";

const ORIGINAL_RUNTIME_MODE =
  process.env.CAPA_RUNTIME_MODE;

const DEVELOPMENT_RUNTIME =
  {} as CapaRuntime;

const DEVELOPMENT_RESOLVER =
  mocks.resolve_development_context as
    unknown as SupabaseCapaContextResolver;

const DURABLE_RESOLVER =
  vi.fn() as unknown as
    SupabaseCapaContextResolver;

const PRODUCTION_RUNTIME = {
  resolve_context:
    DURABLE_RESOLVER,
} as CapaProductionRuntime;

function restoreRuntimeMode():
  void {
  if (
    ORIGINAL_RUNTIME_MODE ===
    undefined
  ) {
    delete process.env
      .CAPA_RUNTIME_MODE;

    return;
  }

  process.env.CAPA_RUNTIME_MODE =
    ORIGINAL_RUNTIME_MODE;
}

beforeEach(() => {
  delete process.env
    .CAPA_RUNTIME_MODE;

  mocks.get_development_runtime
    .mockReset()
    .mockReturnValue(
      DEVELOPMENT_RUNTIME,
    );

  mocks.get_production_runtime
    .mockReset()
    .mockReturnValue(
      PRODUCTION_RUNTIME,
    );

  mocks.resolve_development_context
    .mockReset();
});

afterAll(() => {
  restoreRuntimeMode();
});

describe(
  "selectCapaRuntime",
  () => {
    it(
      "selects durable persistence by default in production",
      () => {
        const selection =
          selectCapaRuntime({
            environment:
              "production",
          });

        expect(selection).toEqual({
          mode: "durable",

          runtime:
            PRODUCTION_RUNTIME,

          resolve_context:
            DURABLE_RESOLVER,
        });

        expect(
          mocks.get_production_runtime,
        ).toHaveBeenCalledTimes(1);

        expect(
          mocks.get_development_runtime,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "selects durable persistence explicitly outside production",
      () => {
        const selection =
          selectCapaRuntime({
            environment:
              "test",

            configured_mode:
              "durable",
          });

        expect(selection.mode).toBe(
          "durable",
        );

        expect(selection.runtime).toBe(
          PRODUCTION_RUNTIME,
        );

        expect(
          selection.resolve_context,
        ).toBe(
          DURABLE_RESOLVER,
        );
      },
    );

    it(
      "selects development dependencies by default outside production",
      () => {
        const selection =
          selectCapaRuntime({
            environment:
              "test",
          });

        expect(selection).toEqual({
          mode: "development",

          runtime:
            DEVELOPMENT_RUNTIME,

          resolve_context:
            DEVELOPMENT_RESOLVER,
        });

        expect(
          mocks.get_development_runtime,
        ).toHaveBeenCalledTimes(1);

        expect(
          mocks.get_production_runtime,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "accepts injected development dependencies",
      () => {
        const runtime =
          {} as CapaRuntime;

        const resolver =
          vi.fn() as unknown as
            SupabaseCapaContextResolver;

        const getRuntime =
          vi.fn(
            () => runtime,
          );

        const selection =
          selectCapaRuntime({
            environment:
              "development",

            configured_mode:
              "development",

            get_development_runtime:
              getRuntime,

            resolve_development_context:
              resolver,
          });

        expect(selection.runtime).toBe(
          runtime,
        );

        expect(
          selection.resolve_context,
        ).toBe(resolver);

        expect(
          getRuntime,
        ).toHaveBeenCalledTimes(1);

        expect(
          mocks.get_development_runtime,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "accepts an injected durable runtime",
      () => {
        const resolver =
          vi.fn() as unknown as
            SupabaseCapaContextResolver;

        const runtime = {
          resolve_context:
            resolver,
        } as CapaProductionRuntime;

        const getRuntime =
          vi.fn(
            () => runtime,
          );

        const selection =
          selectCapaRuntime({
            environment:
              "test",

            configured_mode:
              "durable",

            get_production_runtime:
              getRuntime,
          });

        expect(selection.runtime).toBe(
          runtime,
        );

        expect(
          selection.resolve_context,
        ).toBe(resolver);

        expect(
          getRuntime,
        ).toHaveBeenCalledTimes(1);

        expect(
          mocks.get_production_runtime,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "reads an explicit durable mode from the server environment",
      () => {
        process.env.CAPA_RUNTIME_MODE =
          "durable";

        const selection =
          selectCapaRuntime({
            environment:
              "development",
          });

        expect(selection.mode).toBe(
          "durable",
        );

        expect(selection.runtime).toBe(
          PRODUCTION_RUNTIME,
        );
      },
    );

    it(
      "uses NODE_ENV when no environment override is supplied",
      () => {
        const selection =
          selectCapaRuntime({
            configured_mode:
              "development",
          });

        expect(selection.mode).toBe(
          "development",
        );

        expect(selection.runtime).toBe(
          DEVELOPMENT_RUNTIME,
        );
      },
    );

    it(
      "prohibits the development runtime in production",
      () => {
        expect(
          () =>
            selectCapaRuntime({
              environment:
                "production",

              configured_mode:
                "development",
            }),
        ).toThrow(
          CapaRuntimeSelectionError,
        );

        expect(
          mocks.get_development_runtime,
        ).not.toHaveBeenCalled();

        expect(
          mocks.get_production_runtime,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      "",
      "production",
      "DURABLE",
      " durable",
      "development ",
    ])(
      "rejects invalid runtime mode '%s'",
      (configuredMode) => {
        expect(
          () =>
            selectCapaRuntime({
              environment:
                "test",

              configured_mode:
                configuredMode,
            }),
        ).toThrow(
          CapaRuntimeSelectionError,
        );
      },
    );

    it(
      "uses a stable named selection error",
      () => {
        const error =
          new CapaRuntimeSelectionError(
            "Invalid CAPA runtime selection.",
          );

        expect(error).toMatchObject({
          name:
            "CapaRuntimeSelectionError",

          message:
            "Invalid CAPA runtime selection.",
        });
      },
    );
  },
);