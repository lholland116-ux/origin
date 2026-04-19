"use client";

import { useState } from "react";

export default function SourcePill({
  sources,
  total,
}: {
  sources: string[];
  total: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2 text-xs text-zinc-400">
      <button
        onClick={() => setOpen(!open)}
        className="hover:text-white"
      >
        Sources ({total})
      </button>

      {open && (
        <div className="mt-1 space-y-1">
          {sources.map((s, i) => (
            <div key={i}>• {s}</div>
          ))}
        </div>
      )}
    </div>
  );
}