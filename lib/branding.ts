export const BRAND = {
  // Core identity
  name: "LVTChat",
  shortName: "LVT",
  legalName: "LVTChat LLC",

  // Domain and canonical URL
  domain: "lvtchat.com",
  url: "https://lvtchat.com",

  // Centralized application routes
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

  // Core messaging
  slogan: "Practical AI you can actually use.",
  headline: "Clear answers. Better decisions.",
  subheadline:
    "LVTChat helps individuals and businesses solve problems faster, think more clearly, and move forward with confidence.",
  tagline: "Smart AI help for work, research, and everyday tasks",

  // Public launch configuration
  launch: {
    isLive: true,
    name: "LVTChat Android Launch",
    date: "July 13, 2026",
    message:
      "🎉 LVTChat is now available on Google Play — practical AI you can actually use.",
    highlight: "Clear answers. Better decisions. Less time wasted.",
    promoCode: "",
    promoEnds: "",
    pricing: {
      original: 15,
      discounted: 5.99,
      discountAmount: 9.01,
    },
  },

  // Reusable promotion metadata
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
      note:
        "Future subscribers may pay higher rates as new features are released. Early adopters keep their discounted rate while their subscription remains active.",
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

  // Mobile application availability and messaging
  mobile: {
    androidAvailable: true,
    androidComingSoon: false,
    iosAvailable: false,
    iosComingSoon: true,

    androidPlayStoreUrl:
      "https://play.google.com/store/apps/details?id=com.lvtchat.app",

    message:
      "The LVTChat Android app is available now on Google Play for Free and Pro users. The iPhone app is coming soon.",

    pricingFeature:
      "Android app available now • iPhone app coming soon",

    availabilityLabel: "Available for Free and Pro users",

    proMessage:
      "The Android app is available now for both Free and Pro users. The iPhone app and Custom AI Agents are coming soon.",

    downloadLabel: "Download on Google Play",
  },

  // Founder and professional authority
  creator: "Levi Holland",
  creatorTitle: "AI Engineer",
  creatorSecondaryTitle: "Scientist",
  creatorExperience:
    "25+ years of experience in pharmaceutical, biotech, cosmetic, and medical device industries",

  // Contact information
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

  // Primary interface labels
  ctaPrimary: "Try LVTChat Free",
  ctaSecondary: "See How It Works",

  // Pricing defaults
  pricing: {
    currencySymbol: "$",
    freePlanName: "Free",
    proPlanName: "Pro Early Adopter",
    proMonthlyPrice: 5.99,
    standardProMonthlyPrice: 15,
    freeDailyMessageLimit: 20,
    proDailyMessageLimit: 300,
  },

  // Default search-engine metadata
  seo: {
    title: "LVTChat – Practical AI you can actually use",
    description:
      "Clear answers. Better decisions. LVTChat is an AI assistant for work, research, business, and everyday tasks, available on the web and Google Play.",
    keywords: [
      "AI assistant",
      "Android AI app",
      "AI chatbot",
      "AI productivity",
      "document analysis",
      "web search AI",
      "business AI tools",
      "AI for decision making",
      "LVTChat",
    ] as const,
  },

  // Social and Open Graph defaults
  social: {
    ogImage: "/logos/logo-primary.svg",
    twitterHandle: "@lvtchat",
  },

  // Legal and compliance information
  legal: {
    company: "LVTChat LLC",
    jurisdiction: "Georgia, United States",
    rightsText: "All rights reserved.",
    privacyPath: "/privacy",
    termsPath: "/terms",
  },

  // Product metadata
  product: {
    category: "AI Assistant",
    availability: "Web and Android",
    platforms: {
      web: true,
      android: true,
      ios: false,
    },
  },

  // Product feature flags
  features: {
    enableWebSearch: true,
    enableUploads: true,
  },
} as const;

export type Brand = typeof BRAND;