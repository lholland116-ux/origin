"use client";

import { useEffect, useRef, useState } from "react";

type SourceItem = {
  title: string;
  url: string;
  snippet?: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: SourceItem[];
};

type ChatClientProps = {
  userEmail: string;
};

type ChatResponse = {
  reply?: string;
  sources?: SourceItem[];
  error?: string;
};

const MAX_INPUT_LENGTH = 2000;

export default function ChatClient({ userEmail }: ChatClientProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: loading ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || loading) return;

    if (trimmed.length > MAX_INPUT_LENGTH) {
      window.alert(`Message too long. Maximum ${MAX_INPUT_LENGTH} characters.`);
      return;
    }

    const nextMessages: Message[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];

    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
        }),
      });

      const data: ChatResponse = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Request failed.");
      }

      const assistantMessage: Message = {
        role: "assistant",
        content:
          typeof data.reply === "string" && data.reply.trim().length > 0
            ? data.reply.trim()
            : "No response generated.",
        sources: Array.isArray(data.sources) ? data.sources : [],
      };

      setMessages([...nextMessages, assistantMessage]);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const fallbackMessage: Message = {
        role: "assistant",
        content:
          error instanceof Error
            ? error.message
            : "Something went wrong. Please try again.",
      };

      setMessages([...nextMessages, fallbackMessage]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6">
        <div className="mb-4 rounded-3xl border border-neutral-800 bg-neutral-950 p-4">
          <p className="text-xs text-neutral-400">Origin Sable</p>
          <h1 className="text-2xl font-bold">AI Assistant</h1>
          <p className="text-sm text-neutral-400">Logged in as {userEmail}</p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto">
          {messages.map((m, i) => {
            const sources = Array.isArray(m.sources) ? m.sources : [];

            return (
              <div key={`${m.role}-${i}`} className="space-y-2">
                <div
                  className={`max-w-3xl rounded-2xl p-3 ${
                    m.role === "user"
                      ? "ml-auto bg-white text-black"
                      : "bg-neutral-900 text-white"
                  }`}
                >
                  {m.content}
                </div>

                {sources.length > 0 && (
                  <div className="max-w-3xl space-y-2">
                    {sources.map((s, j) => (
                      <a
                        key={`${s.url}-${j}`}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-xl border border-neutral-800 bg-neutral-950 p-3 transition hover:border-neutral-700"
                      >
                        <div className="text-xs text-blue-400 underline">
                          {s.title}
                        </div>
                        {s.snippet ? (
                          <div className="mt-1 text-xs text-neutral-400">
                            {s.snippet}
                          </div>
                        ) : null}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="max-w-3xl rounded-2xl bg-neutral-900 p-3 text-neutral-400">
              Thinking...
            </div>
          )}

          <div ref={endRef} />
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 rounded-xl bg-neutral-900 p-3 outline-none"
            placeholder="Ask something..."
            maxLength={MAX_INPUT_LENGTH}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || input.trim().length === 0}
            className="rounded-xl bg-white px-4 text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}