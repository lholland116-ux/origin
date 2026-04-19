"use client";

import { useState } from "react";

type SourceItem = {
  title: string;
  url: string;
  snippet?: string;
};

export default function SourcesDisclosure({
  sources,
}: {
  sources: SourceItem[];
}) {
  const [open, setOpen] = useState(false);

  const visible = sources.slice(0, 3);
  const total = sources.length;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-neutral-400 hover:text-white transition"
      >
        Sources ({total})
      </button>

      {open && (
        <div className="mt-2 space-y-1 text-xs text-neutral-300">
          {visible.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="block hover:underline"
            >
              • {new URL(s.url).hostname.replace("www.", "")}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}