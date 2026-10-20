import Link from "next/link";
import {
  ArrowRight,
  FileOutput,
  FileText,
  Image as ImageIcon,
  Search,
  Smartphone,
  Volume2,
  Check,
} from "lucide-react";
import { BRAND } from "@/lib/branding";

const AVAILABLE_TOOLS = [
  { title: "Web Search", description: "Real-time information", icon: Search },
  { title: "Document Analysis", description: "Upload and analyze files", icon: FileText },
  { title: "Document Generation", description: "Create and export", icon: FileOutput },
  { title: "Image Tools", description: "Generate and edit", icon: ImageIcon },
  { title: "Voice / Read Aloud", description: "Listen and respond", icon: Volume2 },
  { title: "Android App", description: "Access on the go", icon: Smartphone },
] as const;

const WORKFLOW_STATUS = [
  "CAPA workflow automation (in development)",
  "Specialized quality and regulatory workflows (in development)",
  "Connections to your systems (planned)",
  "Business-specific scope and pricing",
] as const;

export default function HomepageProductPanels() {
  return (
    <section aria-label="Available AI tools and developing workflow automation" className="px-4 py-4 sm:px-8">
      <div className="mx-auto grid max-w-[1360px] gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-sky-50 p-5 sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-800">Available now</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-blue-800 sm:text-[1.75rem]">LVTChat AI Assistant</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-700">Get practical AI assistance for work, research, documents, and everyday productivity.</p>
          <ul className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
            {AVAILABLE_TOOLS.map(({ title, description, icon: Icon }) => (
              <li key={title} className="flex min-w-0 items-start gap-2 border-b border-blue-100/80 pb-3 sm:border-0 sm:pb-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-800">
                  <Icon aria-hidden="true" size={19} />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold leading-4 text-slate-950">{title}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-slate-600">{description}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-blue-200/80 pt-4">
            <Link href={BRAND.routes.login} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2">
              <span className="text-white">Try LVTChat Free</span> <ArrowRight aria-hidden="true" className="text-white" size={16} />
            </Link>
            <p className="text-xs leading-5 text-slate-700">Free: $0 · Pro Early Adopter: $5.99/month</p>
          </div>
        </article>

        <article className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-green-50 p-5 sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">Early access</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-emerald-900 sm:text-[1.75rem]">Workflow Automation</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-700">Human-reviewed workflows for quality, manufacturing, regulatory, and other business processes are in development.</p>
          <ul className="mt-5 space-y-3">
            {WORKFLOW_STATUS.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm leading-5 text-slate-700">
                <Check aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-700" size={18} strokeWidth={2.5} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-3 border-t border-emerald-200/80 pt-4">
            <Link href="/request?interest=demo&source=homepage" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2">
              <span className="text-white">Request a Demo</span> <ArrowRight aria-hidden="true" className="text-white" size={16} />
            </Link>
            <Link href="/request?interest=early_access&source=homepage" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-emerald-700/50 bg-white/80 px-4 py-2.5 text-sm font-bold text-emerald-900 hover:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2">
              <span className="text-emerald-900">Request Early Access</span>
            </Link>
          </div>
        </article>
      </div>
    </section>
  );
}
