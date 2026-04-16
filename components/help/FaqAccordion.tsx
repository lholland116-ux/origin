"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { BRAND_NAME, FAQ_ITEMS, type FaqItem } from "./faq-data";

type FaqAccordionProps = {
  title?: string;
  subtitle?: string;
  className?: string;
};

function normalizeForSearch(value: string): string {
  return value.trim().toLowerCase();
}

function createFaqKey(item: FaqItem): string {
  return `${item.category}-${item.question}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function FaqAccordion({
  title = `Getting Started with ${BRAND_NAME}`,
  subtitle = `Learn how to use ${BRAND_NAME} and get better answers faster.`,
  className = "",
}: FaqAccordionProps) {
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(
    FAQ_ITEMS.length > 0 ? createFaqKey(FAQ_ITEMS[0]) : null
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeForSearch(query);

    if (!normalizedQuery) {
      return FAQ_ITEMS;
    }

    return FAQ_ITEMS.filter((item) => {
      const question = normalizeForSearch(item.question);
      const answer = normalizeForSearch(item.answer);
      const category = normalizeForSearch(item.category);
      const keywords = Array.isArray(item.keywords)
        ? item.keywords.map(normalizeForSearch)
        : [];

      return (
        question.includes(normalizedQuery) ||
        answer.includes(normalizedQuery) ||
        category.includes(normalizedQuery) ||
        keywords.some((keyword) => keyword.includes(normalizedQuery))
      );
    });
  }, [query]);

  return (
    <section
      className={`w-full rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
      aria-labelledby="faq-heading"
    >
      <div className="mb-4">
        <h2
          id="faq-heading"
          className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
        >
          {title}
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {subtitle}
        </p>
      </div>

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
          aria-hidden="true"
        />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search help topics..."
          className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
          aria-label="Search help topics"
        />
      </div>

      <div className="space-y-2">
        {filteredItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No help topics found. Try a different keyword.
          </div>
        ) : (
          filteredItems.map((item) => {
            const itemKey = createFaqKey(item);
            const isOpen = openKey === itemKey;
            const triggerId = `faq-trigger-${itemKey}`;
            const panelId = `faq-panel-${itemKey}`;

            return (
              <div
                key={itemKey}
                className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
              >
                <button
                  type="button"
                  onClick={() => setOpenKey(isOpen ? null : itemKey)}
                  className="flex w-full items-center justify-between gap-4 bg-zinc-50 px-4 py-3 text-left transition hover:bg-zinc-100 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  id={triggerId}
                >
                  <div className="min-w-0">
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {item.category}
                    </div>
                    <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {item.question}
                    </span>
                  </div>

                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>

                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={triggerId}
                  className={`grid transition-all duration-200 ease-out ${
                    isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="border-t border-zinc-200 bg-white px-4 py-3 text-sm leading-6 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                      {item.answer}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}