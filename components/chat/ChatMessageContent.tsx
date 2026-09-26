"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy as CopyIcon } from "lucide-react";
import {
  parseFencedCodeBlocks,
  type MarkdownContentBlock,
} from "@/lib/chat/parse-fenced-code";
import Tooltip from "@/components/ui/Tooltip";
import { getChatThemeById, getChatThemeHoverClass, type ChatTheme } from "@/lib/chat-themes";

const REMARK_PLUGINS = [remarkGfm];

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type ChatMessageContentProps = {
  content: string;
  theme?: ChatTheme;
};

type CodePanelProps = {
  content: string;
  language: string | null;
  theme: ChatTheme;
};

const CodePanel = memo(function CodePanel({ content, language, theme }: CodePanelProps) {
  const [copied, setCopied] = useState(false);
  const resetCopiedTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetCopiedTimeoutRef.current !== null) {
        window.clearTimeout(resetCopiedTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);

      if (resetCopiedTimeoutRef.current !== null) {
        window.clearTimeout(resetCopiedTimeoutRef.current);
      }

      resetCopiedTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        resetCopiedTimeoutRef.current = null;
      }, 1500);
    } catch {
      setCopied(false);
    }
  }, [content]);

  return (
    <div className={cx("my-4 min-w-0 max-w-full overflow-hidden rounded-xl border", theme.panelBg, theme.panelBorder)}>
      <div className={cx("flex min-w-0 items-center justify-between gap-3 border-b px-3 py-2 text-xs", theme.panelBorder, theme.mutedText)}>
        <span className="min-w-0 truncate font-medium">{language ?? "Code"}</span>
        <Tooltip theme={theme} content="Copy code" touchSafe>
          <button
            type="button"
            onClick={handleCopy}
            className={cx("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-400/50", theme.panelBorder, theme.inputText, getChatThemeHoverClass(theme))}
            aria-label="Copy code"
          >
            {copied ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <CopyIcon className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="sr-only">{copied ? "Copied" : "Copy code"}</span>
          </button>
        </Tooltip>
      </div>
      <pre className={cx("m-0 max-w-full overflow-x-auto p-4 text-xs leading-5", theme.assistantText)}>
        <code
          className="block max-w-none whitespace-pre font-mono"
          style={{ overflowWrap: "normal", wordBreak: "normal" }}
        >
          {content}
        </code>
      </pre>
    </div>
  );
});

const MarkdownText = memo(function MarkdownText({ content }: { content: string }) {
  if (!content) return null;

  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
      {content}
    </ReactMarkdown>
  );
});

function renderContentBlock(block: MarkdownContentBlock, index: number, theme: ChatTheme) {
  if (block.type === "code") {
    return (
      <CodePanel
        key={`code-${index}`}
        content={block.content}
        language={block.language}
        theme={theme}
      />
    );
  }

  return <MarkdownText key={`text-${index}`} content={block.content} />;
}

export const ChatMessageContent = memo(function ChatMessageContent({
  content,
  theme = getChatThemeById(),
}: ChatMessageContentProps) {
  const blocks = useMemo(() => parseFencedCodeBlocks(content), [content]);

  return <>{blocks.map((block, index) => renderContentBlock(block, index, theme))}</>;
});
