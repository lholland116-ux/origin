export type LandingNavItem =
  | "Product"
  | "AI Agents"
  | "Pricing"
  | "Help"
  | "About";

export type FeatureItem = {
  icon: string;
  title: string;
  description: string;
};

export type UseCaseItem = {
  icon: string;
  title: string;
  description: string;
};

export type AgentRoadmapItem = {
  name: string;
  description: string;
  examples: readonly string[];
};

export type FooterColumn = {
  title: string;
  links: string[];
};

export const APPROVED_POSITIONING =
  "LVTChat combines practical general-purpose AI with purpose-built AI Agents for quality, engineering, and regulatory workflows.";

export const navItems: LandingNavItem[] = [
  "Product",
  "AI Agents",
  "Pricing",
  "Help",
  "About",
];

export const features: FeatureItem[] = [
  {
    icon: "💬",
    title: "Smart Conversations",
    description:
      "Ask questions, get explanations, write, analyze, brainstorm, code, and handle everyday or professional work with practical general-purpose AI.",
  },
  {
    icon: "🔎",
    title: "Web Search - Available Now",
    description:
      "Find current information inside normal LVTChat conversations. Web Search is available to Free and Pro users and uses the existing message allowance.",
  },
  {
    icon: "📄",
    title: "Documents - Available Now",
    description:
      "Analyze TXT, MD, CSV, PDF, DOCX, and XLSX files. Free supports 1 document up to 5 MB per Standard message; Pro supports up to 3 documents up to 10 MB each.",
  },
  {
    icon: "🖼️",
    title: "Images - Available Now",
    description:
      "Upload and analyze images, generate images, edit results, regenerate, and delete generated images. Generate, Regenerate, and Edit share one operation allowance.",
  },
  {
    icon: "🎙️",
    title: "Voice - Available Now",
    description:
      "Use Voice Input and Read Aloud when supported by your device or browser.",
  },
  {
    icon: "📱",
    title: "Mobile - Available Now",
    description:
      "Use LVTChat on Android with Camera, Photos, and Files where supported by the device or browser.",
  },
];

export const useCases: UseCaseItem[] = [
  {
    icon: "🌱",
    title: "Everyday Work",
    description:
      "Get help with questions, explanations, planning, writing, learning, and everyday decisions.",
  },
  {
    icon: "🔬",
    title: "Research and Analysis",
    description:
      "Explore topics, compare information, analyze documents, and use Web Search for current facts.",
  },
  {
    icon: "💼",
    title: "Business and Professional Work",
    description:
      "Draft, organize, brainstorm, and solve practical problems across professional workflows.",
  },
  {
    icon: "💻",
    title: "Coding and Development",
    description:
      "Generate code, troubleshoot issues, explain technical concepts, and plan implementation work.",
  },
  {
    icon: "✅",
    title: "Quality and Engineering",
    description:
      "Support structured thinking, evidence review, traceability, validation, and quality-system work.",
  },
  {
    icon: "⚖️",
    title: "Regulatory Work",
    description:
      "Support medical-device quality and regulatory workflows while qualified humans retain decision authority.",
  },
];

export const purposeBuiltAgents: AgentRoadmapItem[] = [
  {
    name: "NCR AI Agent - Workflow  Coming Soon",
    description:
      "A planned workflow for structured nonconformance support.",
    examples: [
      "Nonconformance intake",
      "Classification",
      "Investigation support",
      "Disposition documentation",
      "Escalation",
      "CAPA linkage",
    ],
  },
  {
    name: "Risk Analysis AI Agent - Workflow  Coming Soon",
    description:
      "A planned workflow for risk-management and traceability support.",
    examples: [
      "Hazard identification",
      "Hazardous situations",
      "Risk estimation and evaluation",
      "Risk controls and residual risk",
      "Benefit-risk support",
      "FMEA/FMECA-type analysis",
      "Traceability",
    ],
  },
  {
    name: "Supplier Quality AI Agent - Workflow  Coming Soon",
    description:
      "A planned workflow for supplier-quality activities.",
    examples: [
      "Supplier qualification",
      "Supplier risk classification",
      "Supplier audits and performance",
      "Incoming quality",
      "Supplier NCR and SCAR",
      "Supplier CAPA",
      "Requalification and change assessment",
    ],
  },
  {
    name: "Gap Analysis AI Agent - Workflow  Coming Soon",
    description:
      "A planned workflow for comparing requirements, procedures, and evidence.",
    examples: [
      "Requirements-to-evidence comparison",
      "Procedure and QMS assessments",
      "Regulatory gap analysis",
      "Missing evidence",
      "Documented findings and actions",
    ],
  },
  {
    name: "Validation AI Agent - Workflow  Coming Soon",
    description:
      "A planned workflow for validation planning and evidence.",
    examples: [
      "Validation planning",
      "Requirements and protocols",
      "Testing and deviations",
      "Evidence and traceability",
      "Validation reports",
    ],
  },
  {
    name: "Design Controls AI Agent - Workflow  Coming Soon",
    description:
      "A planned workflow for design-control planning and change traceability.",
    examples: [
      "User needs",
      "Design inputs and outputs",
      "Design reviews",
      "Verification and validation",
      "Risk linkages",
      "Design-change traceability",
    ],
  },
  {
    name: "Requirements Traceability Matrix (RTM) AI Agent - Workflow  Coming Soon",
    description:
      "A planned workflow for end-to-end requirements and test evidence traceability.",
    examples: [
      "User, system, software, and design requirements",
      "Risks and risk controls",
      "Verification and validation",
      "Test evidence",
    ],
  },
  {
    name: "Regulatory AI Agent - Workflow  Coming Soon",
    description:
      "A planned workflow for regulatory readiness and evidence mapping. This agent and its GSPR workflow do not exist today.",
    examples: [
      "Regulatory requirements mapping",
      "EU MDR and IVDR support",
      "Technical-documentation readiness",
      "Change-impact analysis",
      "Evidence mapping",
      "GSPR applicability assessment",
      "GSPR checklist and requirement-to-evidence mapping",
      "Non-applicability rationale and traceability maintenance",
    ],
  },
  {
    name: "Technical Writer AI Agent - Workflow  Coming Soon",
    description:
      "A planned workflow for controlled-content drafting and revision.",
    examples: [
      "Procedures and work instructions",
      "Protocols and specifications",
      "Reports",
      "Technical documentation",
      "Controlled-content drafting and revision",
    ],
  },
  {
    name: "Research AI Agent - Workflow  Coming Soon",
    description:
      "A planned structured research workflow. Web Search is available now inside normal LVTChat conversations; this dedicated agent has not been built.",
    examples: [
      "Research planning",
      "Source collection and organization",
      "Comparison and synthesis",
      "Evidence management",
      "Cited findings and reports",
    ],
  },
];

export const futurePlatformCapabilities = [
  "Cross-Chat Memory",
  "Reference-image generation",
  "Short-video generation",
  "Full conversational Voice Mode",
  "iPhone app",
] as const;

export const footerColumns: FooterColumn[] = [
  {
    title: "Product",
    links: ["Features", "AI Agents", "Pricing"],
  },
  {
    title: "Company",
    links: ["About", "Blog"],
  },
  {
    title: "Resources",
    links: ["Help Center", "Contact"],
  },
];

export function toId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}
