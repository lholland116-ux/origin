import { BRAND } from "@/lib/branding";

export const BRAND_NAME = BRAND.name;

export type FaqCategory =
  | "Getting Started"
  | "Modes"
  | "Documents"
  | "Images"
  | "Voice"
  | "Plans and Limits"
  | "Mobile"
  | "AI Agents";

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
    answer:
      "LVTChat is a practical general-purpose AI assistant for everyday questions, work, writing, analysis, brainstorming, coding, research, documents, images, and decision support.",
    keywords: ["lvtchat", "assistant", "chatbot", "ai"],
  },
  {
    category: "Plans and Limits",
    question: "What is included in Free and Pro?",
    answer:
      "Free includes 20 messages per day, Standard AI, Web Search, history, documents, image upload and analysis, image generation, image editing, Voice Input, Read Aloud, and Android access. Pro includes 300 messages per day, higher document and image-attachment limits, and 20 daily/200 monthly shared image operations.",
    keywords: ["free", "pro", "plans", "pricing"],
  },
  {
    category: "Modes",
    question: "What is Standard mode?",
    answer:
      "Standard mode is the general-purpose conversation mode for writing, explanations, brainstorming, coding, analysis, documents, image analysis, and everyday or professional work.",
    keywords: ["standard", "mode", "general"],
  },
  {
    category: "Modes",
    question: "What is Web Search mode?",
    answer:
      "Web Search is available now to both Free and Pro users inside normal LVTChat conversations. It is useful for current or time-sensitive information and uses the existing message allowance rather than a separate research quota.",
    keywords: ["web search", "current", "research", "latest"],
  },
  {
    category: "Documents",
    question: "Which document formats are supported?",
    answer:
      "LVTChat currently supports TXT, MD, CSV, PDF, DOCX, and XLSX files.",
    keywords: ["documents", "files", "pdf", "docx", "xlsx", "csv"],
  },
  {
    category: "Documents",
    question: "What are the Free document limits?",
    answer:
      "Free users can upload 1 document per Standard-mode message, up to 5 MB. Document uploads count against the existing Free message allowance and do not have a separate document quota.",
    keywords: ["free documents", "5 mb", "one document"],
  },
  {
    category: "Documents",
    question: "What are the Pro document limits?",
    answer:
      "Pro users can upload up to 3 documents per Standard-mode message, with a maximum of 10 MB per document. Supported formats are the same as Free.",
    keywords: ["pro documents", "10 mb", "three documents"],
  },
  {
    category: "Images",
    question: "What are the image attachment limits?",
    answer:
      "Free supports 1 image attachment per Standard-mode message. Pro supports up to 3 image attachments per Standard-mode message. Uploading an image for analysis does not consume an image operation.",
    keywords: ["image attachment", "upload", "image analysis"],
  },
  {
    category: "Images",
    question: "How do image generation and editing work?",
    answer:
      "LVTChat can generate images, regenerate a generated result, and edit uploaded or generated images. Generate, Regenerate, and Edit each consume 1 operation from the same shared image-operation allowance.",
    keywords: ["image generation", "image editing", "regenerate"],
  },
  {
    category: "Plans and Limits",
    question: "What is the shared image-operation allowance?",
    answer:
      "Free has 3 shared image operations per day and 21 per month. Pro has 20 per day and 200 per month. Generate, Regenerate, and Edit share both limits. Failed operations are released, while successful operations consume the allowance.",
    keywords: ["image quota", "image operations", "daily", "monthly"],
  },
  {
    category: "Images",
    question: "Do download or delete actions consume image operations?",
    answer:
      "No. Download and Delete are non-consuming actions. Deleting an image does not restore or refund an image operation, and downloaded images do not include a watermark.",
    keywords: ["download", "delete", "refund", "watermark"],
  },
  {
    category: "Voice",
    question: "Can I use Voice Input and Read Aloud?",
    answer:
      "Yes. Voice Input lets you speak a message when supported by your device or browser. Read Aloud uses native device/browser speech support to read assistant messages. Full conversational Voice Mode is not currently available.",
    keywords: ["voice", "microphone", "read aloud", "speech"],
  },
  {
    category: "Mobile",
    question: "Is LVTChat available on Android?",
    answer:
      "Yes. The Android app is available for Free and Pro users. Camera, Photos, and Files are available where supported by the device or browser. An iPhone app is coming soon.",
    keywords: ["android", "camera", "photos", "files", "iphone"],
  },
  {
    category: "Getting Started",
    question: "What happens with a very large pasted message?",
    answer:
      "When needed, oversized pasted text can be converted into an attachment so the content can be handled safely. LVTChat does not silently truncate large pasted text.",
    keywords: ["large paste", "pasted text", "attachment"],
  },
  {
    category: "AI Agents",
    question: "What is available today and what is coming soon?",
    answer:
      "General-purpose LVTChat, Web Search, documents, images, Voice Input, Read Aloud, and Android are available today. Purpose-built AI Agent workflows are being developed separately. A dedicated Research AI Agent has not been built; Web Search is the current research-related capability.",
    keywords: ["roadmap", "coming soon", "available", "agents"],
  },
  {
    category: "AI Agents",
    question: "What is the CAPA AI Agent?",
    answer:
      "CAPA AI Agent - Workflow  In Development is the first major specialized regulated workflow being built on LVTChat. Controlled capabilities are implemented through Implementation Review across intake, containment/risk, investigation, root-cause review, action plans, implementation, evidence, and implementation review. Effectiveness verification, later approvals, and final closure remain in development.",
    keywords: ["capa", "quality", "regulated", "medical device"],
  },
  {
    category: "AI Agents",
    question: "What purpose-built AI Agents are planned?",
    answer:
      "The roadmap includes NCR AI Agent - Workflow  Coming Soon; Risk Analysis AI Agent - Workflow  Coming Soon; Supplier Quality AI Agent - Workflow  Coming Soon; Gap Analysis AI Agent - Workflow  Coming Soon; Validation AI Agent - Workflow  Coming Soon; Design Controls AI Agent - Workflow  Coming Soon; Requirements Traceability Matrix (RTM) AI Agent - Workflow  Coming Soon; Regulatory AI Agent - Workflow  Coming Soon; Technical Writer AI Agent - Workflow  Coming Soon; and Research AI Agent - Workflow  Coming Soon. These are planned workflows, not currently released agents.",
    keywords: ["agent roadmap", "ncr", "regulatory", "gspr"],
  },
  {
    category: "AI Agents",
    question: "How are regulated AI Agent workflows governed?",
    answer:
      "AI may provide advisory analysis, drafting, organization, traceability, gap identification, and decision support. Qualified humans retain authority for controlled decisions, reviews, approvals, dispositions, and regulated records.",
    keywords: ["governance", "human review", "approval", "regulated"],
  },
];
