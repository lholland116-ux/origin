export type LandingNavItem =
  | "Features"
  | "Use Cases"
  | "Pricing"
  | "About"
  | "Blog";

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

export type FooterColumn = {
  title: string;
  links: string[];
};

export const navItems: LandingNavItem[] = [
  "Features",
  "Use Cases",
  "Pricing",
  "About",
  "Blog",
];

export const features: FeatureItem[] = [
  {
    icon: "💬",
    title: "Smart Conversations",
    description:
      "Get clear, helpful answers in real time for work, research, and daily tasks.",
  },
  {
    icon: "🧠",
    title: "Problem Solving",
    description:
      "Break down complex topics, explore options, and move forward with confidence.",
  },
  {
    icon: "⚡",
    title: "Actionable Insights",
    description:
      "Turn ideas into practical next steps you can use right away.",
  },
  {
    icon: "🔄",
    title: "Flexible AI Support",
    description:
      "Use LVTChat across different goals, workflows, and everyday needs.",
  },
];

export const useCases: UseCaseItem[] = [
  {
    icon: "👤",
    title: "For Individuals",
    description:
      "Get help with questions, learning, planning, and everyday decision-making.",
  },
  {
    icon: "💼",
    title: "For Professionals",
    description:
      "Write faster, think more clearly, and solve problems with practical AI support.",
  },
  {
    icon: "🏢",
    title: "For Businesses",
    description:
      "Support workflows, improve productivity, and make smarter decisions with AI.",
  },
  {
    icon: "💻",
    title: "For Developers",
    description:
      "Generate code, troubleshoot issues, and build faster with AI by your side.",
  },
];

export const footerColumns: FooterColumn[] = [
  {
    title: "Product",
    links: ["Features", "Pricing"],
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