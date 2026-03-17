"use client";

import { FormEvent, useState } from "react";

export default function HomePage() {
  const [prompt, setPrompt] = useState("Write a short welcome message for my app.");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      setError("Please enter a prompt.");
      setResult("");
      return;
    }

    setLoading(true);
    setError("");
    setResult("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: trimmedPrompt,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Request failed.");
      }

      setResult(data?.text || "No response returned.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-white text-gray-900 px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight">
            Next.js + OpenAI Starter
          </h1>
          <p className="mt-3 text-gray-600">
            Production-ready minimal starter with App Router, server-side API key
            handling, loading states, and error handling.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label htmlFor="prompt" className="block text-sm font-medium">
            Prompt
          </label>

          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask something..."
            className="w-full min-h-[180px] rounded-xl border border-gray-300 p-4 outline-none focus:ring-2 focus:ring-gray-400"
          />

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl border border-gray-900 bg-gray-900 px-5 py-2.5 text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Generating..." : "Send"}
            </button>

            {loading && (
              <span className="text-sm text-gray-500">
                Waiting for model response...
              </span>
            )}
          </div>
        </form>

        {error ? (
          <div className="mt-8 rounded-xl border border-red-300 bg-red-50 p-4 text-red-700">
            <p className="font-medium">Error</p>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        ) : null}

        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Response</h2>
          <div className="min-h-[180px] rounded-xl border border-gray-300 bg-gray-50 p-4 whitespace-pre-wrap">
            {result || "Your model response will appear here."}
          </div>
        </div>
      </div>
    </main>
  );
}