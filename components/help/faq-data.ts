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

export const FAQ_ITEMS: FaqItem[] = [
  {
    category: "Getting Started",
    question: `What is ${BRAND_NAME}?`,
    answer: `${BRAND_NAME} is an AI assistant designed to help users write, learn, research, brainstorm, and solve problems through natural conversation.`,
    keywords: ["what is lvtchat", "about", "assistant", "ai"],
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
    keywords: ["standard", "mode", "writing", "brainstorming"],
  },
  {
    category: "Modes",
    question: "What is Web Search mode used for?",
    answer:
      "Web Search mode is best for current or time-sensitive information such as recent news, live facts, trends, current events, and up-to-date research.",
    keywords: ["web search", "current", "latest", "recent"],
  },
  {
    category: "Tips",
    question: "How do I get better answers?",
    answer:
      "Be specific, include useful context, and ask follow-up questions. For example, instead of saying 'help me with business,' say 'help me write a business plan for an AI chatbot startup in Georgia.'",
    keywords: ["better answers", "prompt tips", "specific", "context"],
  },
  {
    category: "Voice",
    question: "Can I use voice input?",
    answer:
      "Yes. Tap the microphone button to speak instead of typing. Voice input is useful for asking questions quickly, giving instructions, or using the app hands-free when supported by your device and browser.",
    keywords: ["voice", "microphone", "speech", "dictation"],
  },
  {
    category: "Usage Limits",
    question: "Why did I hit a usage limit?",
    answer:
      "Your account may have a daily message limit to support fair use, system reliability, and overall performance. Your usage limit resets automatically.",
    keywords: ["limit", "usage", "daily messages", "quota"],
  },
  {
    category: "Usage Limits",
    question: "What is the daily message limit?",
    answer:
      "Users may have a daily message limit depending on the app configuration. This helps maintain performance and availability for all users. Daily usage resets automatically.",
    keywords: ["daily limit", "message limit", "quota", "reset"],
  },
  {
    category: "Privacy",
    question: "Are my conversations saved?",
    answer:
      "Conversation history may be stored to improve your experience and allow you to revisit past chats, depending on your account settings and app configuration.",
    keywords: ["saved", "history", "stored", "conversations"],
  },
  {
    category: "Troubleshooting",
    question: "What should I do if the app is not responding?",
    answer:
      "Try refreshing the page, checking your internet connection, or signing out and back in. If the issue continues, try again in a supported browser or return later.",
    keywords: ["not responding", "troubleshooting", "refresh", "browser"],
  },
  {
    category: "Getting Started",
    question: "How should I start a new chat?",
    answer:
      "Start with a clear goal. For example: 'Help me create a marketing plan,' 'Summarize this text,' or 'Research current pricing for laptops.' The clearer your request, the better the result.",
    keywords: ["new chat", "start", "prompt", "first message"],
  },
  {
    category: "Product",
    question: `Who is ${BRAND_NAME} for?`,
    answer:
      `${BRAND_NAME} is built for everyday users, professionals, students, founders, and anyone who wants faster help with thinking, writing, research, and productivity.`,
    keywords: ["who is it for", "users", "professionals", "students"],
  },
  {
    category: "Product",
    question: "What features are coming next?",
    answer:
      "Upcoming features may include document uploads, expanded AI tools, specialized assistants, and enhanced business productivity features as the platform continues to grow.",
    keywords: ["coming next", "roadmap", "future features", "updates"],
  },
];