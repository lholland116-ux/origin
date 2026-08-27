import {
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
  CapaAiOutputReviewService,
} from "../../lib/capa/application/capa-ai-output-review-runtime-factory";

import type {
  CapaRequestContext,
  SupabaseCapaContextResolver,
} from "../../lib/security/supabase-capa-context";

const mocks = vi.hoisted(
  () => ({
    select_runtime:
      vi.fn(),

    create_server_supabase:
      vi.fn(),
  }),
);

vi.mock(
  "@/lib/capa/application/capa-runtime-selection",
  () => ({
    selectCapaRuntime:
      mocks.select_runtime,
  }),
);

vi.mock(
  "@/lib/supabase/server",
  () => ({
    createServerSupabaseClient:
      mocks.create_server_supabase,
  }),
);

import {
  createCapaAiOutputReviewApiDependencies,
} from "../../app/api/capa/capa-next-route-dependencies";

const USER_ID =
  "10000000-0000-4000-8000-000000000001";

const ORG_ID =
  "20000000-0000-4000-8000-000000000001";

function requestContext():
  CapaRequestContext {
  return {
    owner_user_id:
      USER_ID,

    authentication: {
      principal: {
        principal_type:
          "human",

        user_id:
          USER_ID,
      },
    },

    tenant: {
      organization_id:
        ORG_ID,
    },
  } as unknown as CapaRequestContext;
}

beforeEach(() => {
  mocks.select_runtime
    .mockReset();

  mocks.create_server_supabase
    .mockReset();
});

describe(
  "CAPA AI-output review Next-route dependency bridge",
  () => {
    it(
      "uses the review-service factory exposed by the selected runtime",
      () => {
        const context =
          requestContext();

        const service = {
          review:
            vi.fn(),
        } as unknown as
          CapaAiOutputReviewService;

        const createReviewService =
          vi.fn(
            (
              receivedContext:
                CapaRequestContext,
            ) => {
              expect(
                receivedContext,
              ).toBe(
                context,
              );

              return service;
            },
          );

        const resolveContext =
          vi.fn() as unknown as
            SupabaseCapaContextResolver;

        const runtime = {
          create_ai_output_review_service:
            createReviewService,
        } as unknown as
          CapaRuntime;

        mocks.select_runtime
          .mockReturnValue({
            mode:
              "durable",

            runtime,

            resolve_context:
              resolveContext,
          });

        const dependencies =
          createCapaAiOutputReviewApiDependencies();

        expect(
          dependencies
            .resolve_context,
        ).toBe(
          resolveContext,
        );

        const resolvedService =
          dependencies
            .create_review_service(
              context,
            );

        expect(
          resolvedService,
        ).toBe(
          service,
        );

        expect(
          createReviewService,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createReviewService,
        ).toHaveBeenCalledWith(
          context,
        );

        expect(
          mocks.select_runtime,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "fails closed when the selected runtime has no durable AI-output review capability",
      () => {
        const context =
          requestContext();

        const resolveContext =
          vi.fn() as unknown as
            SupabaseCapaContextResolver;

        const runtime =
          {} as CapaRuntime;

        mocks.select_runtime
          .mockReturnValue({
            mode:
              "development",

            runtime,

            resolve_context:
              resolveContext,
          });

        const dependencies =
          createCapaAiOutputReviewApiDependencies();

        expect(
          () =>
            dependencies
              .create_review_service(
                context,
              ),
        ).toThrow(
          "CAPA AI-output review is not configured.",
        );

        expect(
          mocks.select_runtime,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
