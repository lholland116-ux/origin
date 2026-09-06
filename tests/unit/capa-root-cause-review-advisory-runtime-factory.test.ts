import { describe, expect, it, vi } from "vitest";
import { createRequestScopedCapaRootCauseReviewAdvisoryService } from "../../lib/capa/application/capa-root-cause-review-advisory-runtime-factory";
import { RepositoryCapaRootCauseReviewAdvisoryContextResolver } from "../../lib/capa/ai/repository-capa-root-cause-review-advisory-context-resolver";
import { PolicyBackedCapaRootCauseReviewAdvisoryAuthorizer } from "../../lib/capa/authorization/capa-root-cause-review-advisory-authorizer";

const context = {
  authentication: { principal: { principal_type: "human", user_id: "60000000-0000-4000-8000-000000000001" } },
  tenant: { organization_id: "10000000-0000-4000-8000-000000000001" },
} as any;

describe("S50 root-cause review advisory runtime factory", () => {
  it("composes the request-scoped resolver, authorizer, gate, generator, and repository service", () => {
    const outputRepository = {} as any;
    const transactionManager = {} as any;
    const activationService = { evaluate: vi.fn() } as any;
    const modelClient = { generateStructured: vi.fn() } as any;
    const service = createRequestScopedCapaRootCauseReviewAdvisoryService({
      request_context: context,
      capa_repository: {} as any,
      authorization_policy: { evaluate: vi.fn() } as any,
      agent_activation_service: activationService,
      structured_model_client: modelClient,
      output_repository: outputRepository,
      transaction_manager: transactionManager,
      now: () => new Date("2026-09-06T00:00:00.000Z"),
      generate_uuid: () => "70000000-0000-4000-8000-000000000001",
    });

    const dependencies = (service as any).dependencies;
    expect(service.execute).toEqual(expect.any(Function));
    expect(dependencies.context_resolver).toBeInstanceOf(RepositoryCapaRootCauseReviewAdvisoryContextResolver);
    expect(dependencies.authorizer).toBeInstanceOf(PolicyBackedCapaRootCauseReviewAdvisoryAuthorizer);
    expect(dependencies.agent_gate).toEqual(expect.objectContaining({ activation_service: activationService }));
    expect(dependencies.generator).toEqual(expect.objectContaining({ dependencies: expect.objectContaining({ model_client: modelClient }) }));
    expect(dependencies.output_repository).toBe(outputRepository);
    expect(dependencies.transaction_manager).toBe(transactionManager);
  });
});
