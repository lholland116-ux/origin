import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Free, Pro, and Workflow Early Access Pricing",
  description: "Compare current LVTChat Free and Pro subscriptions and request a discussion about Workflow Automation early access.",
  alternates: { canonical: "/pricing" },
};

export default function PricingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
