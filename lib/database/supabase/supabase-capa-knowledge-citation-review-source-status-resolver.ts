import type postgres from "postgres";

import type {
  CapaKnowledgeCitationReviewSourceStatusResolver,
} from "../../capa/knowledge/capa-knowledge-citation-review-service";

import {
  CAPA_KNOWLEDGE_SOURCE_STATUSES,
  type CapaKnowledgeSourceStatus,
} from "../../capa/knowledge/capa-knowledge-contract";

interface StatusRow extends postgres.Row {
  readonly status: string;
}

const SOURCE_STATUSES = new Set<string>(CAPA_KNOWLEDGE_SOURCE_STATUSES);

export class SupabaseCapaKnowledgeCitationReviewSourceStatusResolver
  implements CapaKnowledgeCitationReviewSourceStatusResolver {
  constructor(private readonly sql: postgres.Sql) {}

  async resolveSourceStatus(
    input: Parameters<
      CapaKnowledgeCitationReviewSourceStatusResolver["resolveSourceStatus"]
    >[0],
  ): Promise<CapaKnowledgeSourceStatus | null> {
    const rows = await this.sql<StatusRow[]>`
      select version.status
      from public.capa_knowledge_sources as source
      join public.capa_knowledge_source_versions as version
        on version.source_id = source.source_id
      where source.source_id = ${input.source_id}
        and version.source_version_id = ${input.source_version_id}
        and (
          (
            source.visibility = 'organization'
            and source.organization_id = ${input.organization_id}
            and version.organization_id = ${input.organization_id}
          )
          or (
            source.visibility = 'approved_global'
            and source.organization_id is null
            and version.organization_id is null
          )
        )
      limit 2
    `;

    if (rows.length !== 1) {
      return null;
    }
    const status = rows[0]?.status;
    return typeof status === "string" && SOURCE_STATUSES.has(status)
      ? status as CapaKnowledgeSourceStatus
      : null;
  }
}
