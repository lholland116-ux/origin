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

  // Launch Configuration
  launch: {
    isLive: true,
    name: "LVTChat Launch",
    date: "May 1, 2026",
    message: "🎉 LVTChat is officially live — practical AI you can actually use.",
    highlight: "Clear answers. Better decisions. Less time wasted.",
    promoCode: "",
    promoEnds: "",
    pricing: {
      original: 15,
      discounted: 5.99,
      discountAmount: 9.01,
    },
  },

  // Reusable Promotion Metadata
  promotions: {
    earlyAdopter: {
      enabled: true,
      name: "Early Adopter Pricing",
      price: 5.99,
      standardPrice: 15,
      headline: "Early Adopter Pricing",
      subheadline:
        "Lock in LVTChat Pro for $5.99/month before future price increases.",
      ctaLabel: "Get Pro for $5.99/month",
      note: "Future subscribers will pay higher rates as new features are released. Early adopters keep their discounted rate.",
    },

    memorialDay: {
      enabled: false,
      name: "Memorial Day Early Access Special",
      promoCode: "MEMORIALDAY",
      startsAt: "2026-05-21T00:00:00-04:00",
      endsAt: "2026-05-31T23:59:59-04:00",
      originalPrice: 15,
      discountedPrice: 10,
      headline: "Memorial Day Early Access Special",
      subheadline:
        "Upgrade to LVTChat Pro for $10/month and get practical AI support for work, research, planning, and everyday decisions.",
      ctaLabel: "Get Pro for $10/month",
    },
  },

  // Mobile App Messaging
  mobile: {
    androidComingSoon: true,
    iosComingSoon: true,
    message:
      "Android & iPhone apps coming soon. Available for Free and Pro users.",
    pricingFeature: "Android & iPhone apps coming soon",
    availabilityLabel: "Available for Free and Pro",
    proMessage:
      "Mobile apps will be available for both Free and Pro users as they roll out.",
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
    proPlanName: "Pro Early Adopter",
    proMonthlyPrice: 5.99,
    standardProMonthlyPrice: 15,
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