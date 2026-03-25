"use client";

import { useState, useRef } from "react";

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

export default function ChatClient({ userEmail }: { userEmail: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const trimmed = input.trim();

    if (!trimmed || loading) return;

    if (trimmed.length > 2000) {
      alert("Message too long.");
      return;
    }

    const nextMessages: Message[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];

    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    // cancel previous request
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

      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || "Request failed");

      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: data.reply,
          sources: data.sources || [],
        },
      ]);
    } catch (error) {
      if ((error as any)?.name === "AbortError") return;

      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: "Something went wrong. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6">
        
        {/* HEADER */}
        <div className="mb-6 rounded-3xl border border-neutral-800 bg-neutral-950 p-5">
          <p className="text-xs text-neutral-400">Origin Sable</p>
          <h1 className="text-2xl font-bold">AI Assistant</h1>
          <p className="text-sm text-neutral-400">
            Logged in as {userEmail}
          </p>
        </div>

        {/* CHAT */}
        <div className="flex-1 space-y-4 overflow-y-auto">
          {messages.map((m, i) => (
            <div key={i}>
              <div
                className={`rounded-xl p-3 ${
                  m.role === "user"
                    ? "bg-white text-black ml-auto"
                    : "bg-neutral-900"
                }`}
              >
                {m.content}
              </div>

              {/* Sources */}
              {m.sources?.length > 0 && (
                <div className="mt-2 space-y-2">
                  {m.sources.map((s, j) => (
                    <a key={j} href={s.url} target="_blank">
                      <div className="text-xs text-blue-400 underline">
                        {s.title}
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}

          {loading && <div className="text-neutral-400">Thinking...</div>}
        </div>

        {/* INPUT */}
        <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 p-3 bg-neutral-900 rounded-xl"
            placeholder="Ask something..."
          />
          <button className="bg-white text-black px-4 rounded-xl">
            Send
          </button>
        </form>
      </div>
    </main>
  );
}