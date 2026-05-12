import { BRAND } from "@/lib/branding";

export const BRAND_NAME = BRAND.name;

export type FaqCategory =
  | "Getting Started"
  | "Modes"
  | "Voice"
  | "Usage Limits"
  | "Privacy"
  | "Troubleshooting"
  | "Tips"
  | "Product";

export type FaqItem = {
  question: string;
  answer: string;
  category: FaqCategory;
  keywords?: string[];
};

const FAQ_SEARCH_KEYWORDS = {
  brand: ["lvtchat", "chatbot", "assistant", "ai"],
  standardMode: ["standard", "mode", "writing", "brainstorming"],
  webSearchMode: ["web search", "current", "latest", "recent"],
  prompts: ["better answers", "prompt tips", "specific", "context"],
  voice: ["voice", "microphone", "speech", "dictation"],
  usage: ["limit", "usage", "daily messages", "quota", "reset"],
  privacy: ["saved", "history", "stored", "conversations"],
  troubleshooting: ["not responding", "troubleshooting", "refresh", "browser"],
  gettingStarted: ["new chat", "start", "prompt", "first message"],
  audience: ["who is it for", "users", "professionals", "students"],
  roadmap: ["coming next", "roadmap", "future features", "updates"],
} as const;

export const FAQ_ITEMS: FaqItem[] = [
  {
    category: "Getting Started",
    question: `What is ${BRAND_NAME}?`,
    answer: `${BRAND_NAME} is an AI assistant designed to help users write, learn, research, brainstorm, and solve problems through natural conversation.`,
    keywords: [...FAQ_SEARCH_KEYWORDS.brand, "about"],
  },
  {
    category: "Product",
    question: `What makes ${BRAND_NAME} different?`,
    answer: `${BRAND_NAME} combines AI chat, voice input, Standard mode, Web Search mode, and conversation history in one streamlined experience built for real-world productivity.`,
    keywords: ["different", "features", "why use", "benefits"],
  },
  {
    category: "Modes",
    question: "What is Standard mode used for?",
    answer:
      "Standard mode is best for everyday tasks such as writing, summarizing, brainstorming, planning, coding, and general problem-solving.",
    keywords: [...FAQ_SEARCH_KEYWORDS.standardMode],
  },
  {
    category: "Modes",
    question: "What is Web Search mode used for?",
    answer:
      "Web Search mode is best for current or time-sensitive information such as recent news, live facts, trends, current events, and up-to-date research.",
    keywords: [...FAQ_SEARCH_KEYWORDS.webSearchMode],
  },
  {
    category: "Tips",
    question: "How do I get better answers?",
    answer:
      "Be specific, include useful context, and ask follow-up questions. For example, instead of saying 'help me with business,' say 'help me write a business plan for a Home Healthcare startup in Georgia.'",
    keywords: [...FAQ_SEARCH_KEYWORDS.prompts],
  },
  {
    category: "Voice",
    question: "Can I use voice input?",
    answer:
      "Yes. Tap the microphone button to speak instead of typing. Voice input is useful for asking questions quickly, giving instructions, or using the app hands-free when supported by your device and browser.",
    keywords: [...FAQ_SEARCH_KEYWORDS.voice],
  },
  {
    category: "Usage Limits",
    question: "Why did I hit a usage limit?",
    answer:
      "Your account may have a daily message limit to support fair use, system reliability, and overall performance. Your usage limit resets automatically.",
    keywords: [...FAQ_SEARCH_KEYWORDS.usage],
  },
  {
    category: "Usage Limits",
    question: "What is the daily message limit?",
    answer:
      "Users may have a daily message limit depending on the app configuration. This helps maintain performance and availability for all users. Daily usage resets automatically.",
    keywords: [...FAQ_SEARCH_KEYWORDS.usage, "daily limit", "message limit"],
  },
  {
    category: "Privacy",
    question: "Are my conversations saved?",
    answer:
      "Conversation history may be stored to improve your experience and allow you to revisit past chats, depending on your account settings and app configuration.",
    keywords: [...FAQ_SEARCH_KEYWORDS.privacy],
  },
  {
    category: "Troubleshooting",
    question: "What should I do if the app is not responding?",
    answer:
      "Try refreshing the page, checking your internet connection, or signing out and back in. If the issue continues, try again in a supported browser or return later.",
    keywords: [...FAQ_SEARCH_KEYWORDS.troubleshooting],
  },
  {
    category: "Getting Started",
    question: "How should I start a new chat?",
    answer:
      "Start with a clear goal. For example: 'Help me create a marketing plan,' 'Summarize this text,' or 'Research current pricing for laptops.' The clearer your request, the better the result.",
    keywords: [...FAQ_SEARCH_KEYWORDS.gettingStarted],
  },
  {
    category: "Product",
    question: `Who is ${BRAND_NAME} for?`,
    answer:
      `${BRAND_NAME} is built for everyday users, professionals, students, founders, and anyone who wants faster help with thinking, writing, research, and productivity.`,
    keywords: [...FAQ_SEARCH_KEYWORDS.audience],
  },
  {
    category: "Product",
    question: "What features are coming next?",
    answer:
      "Upcoming features may include document uploads, expanded AI tools, specialized assistants, and enhanced business productivity features as the platform continues to grow.",
    keywords: [...FAQ_SEARCH_KEYWORDS.roadmap],
  },
];