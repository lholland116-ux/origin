import {
  APPROVED_POSITIONING,
  futurePlatformCapabilities,
  purposeBuiltAgents,
} from "@/lib/landing-content";

const governanceText =
  "AI Agents may provide advisory analysis, drafting, organization, traceability, gap identification, and decision support. Qualified humans retain authority for controlled decisions, reviews, approvals, dispositions, and regulated records.";

export default function AgentRoadmap() {
  return (
    <section
      id="ai-agents"
      aria-labelledby="ai-agents-heading"
      className="mx-auto max-w-7xl px-6 py-20 sm:py-24"
    >
      <div className="max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">
          Purpose-Built AI Agents
        </p>
        <h2
          id="ai-agents-heading"
          className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl"
        >
          Specialized workflows for quality, engineering, and regulatory work.
        </h2>
        <p className="mt-5 text-lg leading-8 text-zinc-300">
          {APPROVED_POSITIONING}
        </p>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-400">
          {governanceText}
        </p>
      </div>

      <article className="mt-10 rounded-3xl border border-blue-400/30 bg-blue-500/[0.08] p-6 shadow-[0_0_50px_rgba(59,130,246,0.12)] sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-xl font-semibold text-white">
            CAPA AI Agent - Workflow  In Development
          </h3>
          <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">
            In Development
          </span>
        </div>
        <p className="mt-4 max-w-4xl text-sm leading-7 text-zinc-300">
          Controlled workflow capabilities are implemented through
          Implementation Review, including intake, containment and risk,
          investigation, root-cause review, action plans, implementation,
          evidence, and implementation review. Effectiveness verification,
          later approvals, and final closure remain in development.
        </p>
      </article>

      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {purposeBuiltAgents.map((agent) => (
          <article
            key={agent.name}
            className="rounded-3xl border border-white/10 bg-white/[0.04] p-6"
          >
            <h3 className="text-lg font-semibold leading-7 text-white">
              {agent.name}
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              {agent.description}
            </p>
            <ul className="mt-5 space-y-2 text-sm text-zinc-300">
              {agent.examples.map((example) => (
                <li key={example} className="flex gap-2">
                  <span aria-hidden="true" className="text-blue-300">
                    -
                  </span>
                  <span>{example}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="mt-10 rounded-3xl border border-white/10 bg-[#071022] p-6 sm:p-8">
        <h3 className="text-xl font-semibold text-white">
          Other Platform Capabilities - Coming Soon
        </h3>
        <ul className="mt-5 grid gap-3 text-sm text-zinc-300 sm:grid-cols-2">
          {futurePlatformCapabilities.map((capability) => (
            <li key={capability} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              {capability}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
