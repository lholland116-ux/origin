import { BarChart3, FileText, Settings2, ShieldCheck } from "lucide-react";

const BENEFITS = [
  { title: "Reduce Repetitive Work", detail: "Explore ways to simplify routine analysis and documentation.", icon: Settings2 },
  { title: "Surface Patterns", detail: "Help teams identify signals for closer human review.", icon: BarChart3 },
  { title: "Prepare Better Reports", detail: "Keep observations connected to their evidence.", icon: FileText },
  { title: "Keep Humans in Control", detail: "Qualified people decide and approve controlled work.", icon: ShieldCheck },
] as const;

export default function HomepageBenefits() {
  return (
    <section aria-label="Workflow design goals" className="px-4 py-7 sm:px-8 sm:py-9">
      <ul className="mx-auto grid max-w-[1360px] gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {BENEFITS.map(({ title, detail, icon: Icon }) => (
          <li key={title} className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-800 ring-1 ring-blue-100">
              <Icon aria-hidden="true" size={23} />
            </span>
            <span>
              <span className="block text-sm font-bold text-slate-950">{title}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-600">{detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
