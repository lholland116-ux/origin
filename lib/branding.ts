export const BRAND = {
  // Core Identity
  name: "LVTChat",
  shortName: "LVT",
  legalName: "LVTChat LLC",

  // Domain / URLs
  domain: "lvtchat.com",
  url: "https://lvtchat.com",
  loginPath: "/login",
  appPath: "/chat",

  // Messaging (Marketing + SEO)
  slogan: "Practical AI you can actually use.",
  headline: "Clear answers. Better decisions.",
  subheadline:
    "LVTChat helps individuals and businesses solve problems faster, think more clearly, and move forward with confidence.",
  tagline: "Smart AI help for work, research, and everyday tasks",

  // Creator / Authority
  creator: "Levi Holland",
  creatorTitle: "AI Engineer",

  // Contact / Support
  supportEmail: "support@lvtchat.com",

  // UI Labels
  ctaPrimary: "Try LVTChat Free",
  ctaSecondary: "See How It Works",

  // SEO Defaults
  seo: {
    title: "LVTChat – Practical AI you can actually use",
    description:
      "Clear answers. Better decisions. LVTChat is an AI assistant designed to help individuals and businesses solve problems faster with practical, real-world intelligence.",
    keywords: [
      "AI assistant",
      "chatbot",
      "AI productivity",
      "business AI tools",
      "AI for decision making",
      "LVTChat",
    ] as const,
  },

  // Social / OpenGraph
  social: {
    ogImage: "/logos/logo-primary.svg",
    twitterHandle: "@lvtchat",
  },

  // Legal / Compliance
  legal: {
    company: "LVTChat LLC",
    jurisdiction: "Georgia, United States",
    rightsText: "All rights reserved.",
  },

  // Product / App metadata
  product: {
    category: "AI Assistant",
    availability: "Web",
  },

  // Feature Flags
  features: {
    enableWebSearch: true,
    enableUploads: true,
  },
} as const;

export type Brand = typeof BRAND;