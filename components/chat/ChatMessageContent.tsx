"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  parseFencedCodeBlocks,
  type MarkdownContentBlock,
} from "@/lib/chat/parse-fenced-code";

const REMARK_PLUGINS = [remarkGfm];

type ChatMessageContentProps = {
  content: string;
};

type CodePanelProps = {
  content: string;
  language: string | null;
};

const CodePanel = memo(function CodePanel({ content, language }: CodePanelProps) {
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
    <div className="my-4 min-w-0 max-w-full overflow-hidden rounded-xl border border-white/10 bg-black/30">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
        <span className="min-w-0 truncate font-medium">{language ?? "Code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-white/80 transition hover:bg-white/10"
          aria-label="Copy code"
        >
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre className="m-0 max-w-full overflow-x-auto p-4 text-xs leading-5 text-white/90">
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

function renderContentBlock(block: MarkdownContentBlock, index: number) {
  if (block.type === "code") {
    return (
      <CodePanel
        key={`code-${index}`}
        content={block.content}
        language={block.language}
      />
    );
  }

  return <MarkdownText key={`text-${index}`} content={block.content} />;
}

export const ChatMessageContent = memo(function ChatMessageContent({
  content,
}: ChatMessageContentProps) {
  const blocks = useMemo(() => parseFencedCodeBlocks(content), [content]);

  return <>{blocks.map(renderContentBlock)}</>;
});
