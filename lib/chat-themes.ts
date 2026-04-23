export type ChatTheme = {
  id: string;
  label: string;
  pageBg: string;
  panelBg: string;
  panelBorder: string;
  sidebarBg: string;
  sidebarBorder: string;
  inputBg: string;
  inputBorder: string;
  inputText: string;
  mutedText: string;
  titleText: string;
  userBubble: string;
  assistantBubble: string;
  assistantText: string;
  userText: string;
  buttonPrimary: string;
  buttonSecondary: string;
  badge: string;
};

export const DEFAULT_CHAT_THEME_ID = "default-dark";

export const CHAT_THEMES: ChatTheme[] = [
  {
    id: "default-dark",
    label: "Default Dark",
    pageBg: "bg-zinc-950",
    panelBg: "bg-zinc-900/95",
    panelBorder: "border-zinc-800",
    sidebarBg: "bg-zinc-950/95",
    sidebarBorder: "border-zinc-800",
    inputBg: "bg-zinc-950",
    inputBorder: "border-zinc-700",
    inputText: "text-zinc-100",
    mutedText: "text-zinc-400",
    titleText: "text-white",
    userBubble: "bg-blue-600",
    assistantBubble: "bg-zinc-800",
    assistantText: "text-zinc-100",
    userText: "text-white",
    buttonPrimary: "bg-blue-600 text-white hover:bg-blue-500",
    buttonSecondary:
      "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700",
    badge: "bg-blue-500/15 text-blue-300 border border-blue-500/20",
  },
  {
    id: "midnight-blue",
    label: "Midnight Blue",
    pageBg: "bg-slate-950",
    panelBg: "bg-slate-900/95",
    panelBorder: "border-slate-700",
    sidebarBg: "bg-slate-950/95",
    sidebarBorder: "border-slate-700",
    inputBg: "bg-slate-950",
    inputBorder: "border-slate-600",
    inputText: "text-slate-100",
    mutedText: "text-slate-400",
    titleText: "text-white",
    userBubble: "bg-cyan-600",
    assistantBubble: "bg-slate-800",
    assistantText: "text-slate-100",
    userText: "text-white",
    buttonPrimary: "bg-cyan-600 text-white hover:bg-cyan-500",
    buttonSecondary:
      "bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-600",
    badge: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/20",
  },
  {
    id: "emerald",
    label: "Emerald",
    pageBg: "bg-emerald-950",
    panelBg: "bg-emerald-900/35",
    panelBorder: "border-emerald-800",
    sidebarBg: "bg-emerald-950/95",
    sidebarBorder: "border-emerald-800",
    inputBg: "bg-emerald-950/80",
    inputBorder: "border-emerald-700",
    inputText: "text-emerald-50",
    mutedText: "text-emerald-200/70",
    titleText: "text-white",
    userBubble: "bg-emerald-600",
    assistantBubble: "bg-emerald-800/70",
    assistantText: "text-emerald-50",
    userText: "text-white",
    buttonPrimary: "bg-emerald-600 text-white hover:bg-emerald-500",
    buttonSecondary:
      "bg-emerald-900/60 text-emerald-50 hover:bg-emerald-800 border border-emerald-700",
    badge:
      "bg-emerald-500/15 text-emerald-200 border border-emerald-500/20",
  },
  {
    id: "purple",
    label: "Purple",
    pageBg: "bg-violet-950",
    panelBg: "bg-violet-900/30",
    panelBorder: "border-violet-800",
    sidebarBg: "bg-violet-950/95",
    sidebarBorder: "border-violet-800",
    inputBg: "bg-violet-950/80",
    inputBorder: "border-violet-700",
    inputText: "text-violet-50",
    mutedText: "text-violet-200/70",
    titleText: "text-white",
    userBubble: "bg-violet-600",
    assistantBubble: "bg-violet-800/70",
    assistantText: "text-violet-50",
    userText: "text-white",
    buttonPrimary: "bg-violet-600 text-white hover:bg-violet-500",
    buttonSecondary:
      "bg-violet-900/60 text-violet-50 hover:bg-violet-800 border border-violet-700",
    badge: "bg-violet-500/15 text-violet-200 border border-violet-500/20",
  },
  {
    id: "warm-gray",
    label: "Warm Gray",
    pageBg: "bg-stone-950",
    panelBg: "bg-stone-900/95",
    panelBorder: "border-stone-700",
    sidebarBg: "bg-stone-950/95",
    sidebarBorder: "border-stone-700",
    inputBg: "bg-stone-950",
    inputBorder: "border-stone-600",
    inputText: "text-stone-100",
    mutedText: "text-stone-400",
    titleText: "text-white",
    userBubble: "bg-amber-700",
    assistantBubble: "bg-stone-800",
    assistantText: "text-stone-100",
    userText: "text-white",
    buttonPrimary: "bg-amber-700 text-white hover:bg-amber-600",
    buttonSecondary:
      "bg-stone-800 text-stone-100 hover:bg-stone-700 border border-stone-600",
    badge: "bg-amber-500/15 text-amber-300 border border-amber-500/20",
  },
];

export function getChatThemeById(themeId?: string | null): ChatTheme {
  return (
    CHAT_THEMES.find((theme) => theme.id === themeId) ??
    CHAT_THEMES.find((theme) => theme.id === DEFAULT_CHAT_THEME_ID) ??
    CHAT_THEMES[0]
  );
}