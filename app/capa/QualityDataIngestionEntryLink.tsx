"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function QualityDataIngestionEntryLink() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/quality-data/xlsx", {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }).then(async (response) => {
      const body: unknown = await response.json().catch(() => null);
      const canIngest = typeof body === "object" && body !== null && !Array.isArray(body)
        && "can_ingest" in body && body.can_ingest === true;
      if (active && response.ok && canIngest) setAvailable(true);
    }).catch(() => {
      // Hide the pilot entry when eligibility cannot be confirmed.
    });
    return () => { active = false; };
  }, []);

  if (!available) return null;

  return (
    <Link className="inline-flex rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800" href="/quality-data">
      Import manufacturing quality data
    </Link>
  );
}
