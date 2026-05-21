export const BRAND = {
  // Core Identity
  name: "LVTChat",
  shortName: "LVT",
  legalName: "LVTChat LLC",

  // Domain / URLs
  domain: "lvtchat.com",
  url: "https://lvtchat.com",

  // Centralized routes
  routes: {
    home: "/",
    login: "/login",
    app: "/chat",
    pricing: "/pricing",
    about: "/about",
    blog: "/blog",
    help: "/help",
    privacy: "/privacy",
    terms: "/terms",
  },

  // Backward-compatible route fields
  loginPath: "/login",
  appPath: "/chat",

  // Messaging
  slogan: "Practical AI you can actually use.",
  headline: "Clear answers. Better decisions.",
  subheadline:
    "LVTChat helps individuals and businesses solve problems faster, think more clearly, and move forward with confidence.",
  tagline: "Smart AI help for work, research, and everyday tasks",

  // Launch / Active Promotion Configuration
  launch: {
    isLive: true,
    name: "Memorial Day Early Access Special",
    date: "May 21, 2026",
    message:
      "Memorial Day Early Access Special — get LVTChat Pro for $10/month for a limited time.",
    highlight: "Clear answers. Better decisions. Practical AI for work, research, and everyday tasks.",
    promoCode: "MEMORIALDAY",
    promoEnds: "2026-05-25T23:59:59-04:00",
    pricing: {
      original: 15,
      discounted: 10,
      discountAmount: 5,
    },
  },

  // Reusable Promotion Metadata
  promotions: {
    memorialDay: {
      enabled: true,
      name: "Memorial Day Early Access Special",
      promoCode: "MEMORIALDAY",
      startsAt: "2026-05-21T00:00:00-04:00",
      endsAt: "2026-05-25T23:59:59-04:00",
      originalPrice: 15,
      discountedPrice: 10,
      headline: "Memorial Day Early Access Special",
      subheadline:
        "Upgrade to LVTChat Pro for $10/month and get practical AI support for work, research, planning, and everyday decisions.",
      ctaLabel: "Get Pro for $10/month",
    },
  },

  // Founder / Authority
  creator: "Levi Holland",
  creatorTitle: "AI Engineer",
  creatorSecondaryTitle: "Scientist",
  creatorExperience:
    "25+ years of experience in pharmaceutical, biotech, cosmetic, and medical device industries",

  // Contact
  supportEmail: "support@lvtchat.com",
  contact: {
    email: "support@lvtchat.com",
    address: {
      line1: "1101 Hillcrest Pkwy",
      line2: "Ste L PMB 1041",
      city: "Dublin",
      state: "GA",
      postalCode: "31021",
      country: "United States",
    },
  },

  // UI Labels
  ctaPrimary: "Try LVTChat Free",
  ctaSecondary: "See How It Works",

  // Pricing Defaults
  pricing: {
    currencySymbol: "$",
    freePlanName: "Free",
    proPlanName: "Pro",
    proMonthlyPrice: 15,
    freeDailyMessageLimit: 20,
    proDailyMessageLimit: 300,
  },

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

  // Social / Open Graph
  social: {
    ogImage: "/logos/logo-primary.svg",
    twitterHandle: "@lvtchat",
  },

  // Legal / Compliance
  legal: {
    company: "LVTChat LLC",
    jurisdiction: "Georgia, United States",
    rightsText: "All rights reserved.",
    privacyPath: "/privacy",
    termsPath: "/terms",
  },

  // Product Metadata
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