import {
  ArrowRight,
  BarChart3,
  Database,
  FileText,
  Search,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react";

const STAGES: readonly { title: string; description: string; icon: LucideIcon }[] = [
  { title: "Quality Data", description: "Complaints, deviations, logs, audits, and records", icon: Database },
  { title: "Analyze", description: "Organize information for people to review", icon: Search },
  { title: "Detect Trends", description: "Surface potential issues and patterns", icon: BarChart3 },
  { title: "Generate Intelligence", description: "Prepare evidence-linked reports and insights", icon: FileText },
  { title: "Human Review", description: "Qualified professionals review and validate", icon: UserRound },
  { title: "Initiate Workflow", description: "Move approved findings into controlled follow-up", icon: Settings },
];

export default function HomepageWorkflowStages() {
  return (
    <section aria-labelledby="workflow-stages-heading" className="bg-white px-4 py-10 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-[1360px]">
        <div className="text-center">
          <h2 id="workflow-stages-heading" className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            From scattered information to controlled action
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            An illustrative workflow direction. Qualified people remain responsible for controlled decisions.
          </p>
        </div>
        <ol className="mt-8 grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 xl:grid-cols-6 xl:gap-x-2">
          {STAGES.map(({ title, description, icon: Icon }, index) => (
            <li key={title} className="relative flex flex-col items-center px-1 text-center">
              <div className="relative flex w-full justify-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-800 ring-1 ring-blue-100 sm:h-16 sm:w-16">
                  <Icon aria-hidden="true" size={27} strokeWidth={2.2} />
                </span>
                {index < STAGES.length - 1 ? (
                  <ArrowRight aria-hidden="true" className="absolute left-[calc(100%-0.25rem)] top-1/2 hidden -translate-y-1/2 text-blue-800 xl:block" size={21} />
                ) : null}
              </div>
              <h3 className="mt-3 min-h-10 text-sm font-bold leading-5 text-slate-950 sm:text-base">{index + 1}. {title}</h3>
              <p className="mt-1 max-w-[190px] text-xs leading-5 text-slate-600 sm:text-sm">{description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
