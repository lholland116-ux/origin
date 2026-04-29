"use client";

import Link from "next/link";
import { BRAND } from "@/lib/branding";

type UpgradeModalProps = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
};

export default function UpgradeModal({
  open,
  title,
  message,
  onClose,
}: UpgradeModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#020817] p-6 text-white shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">
          Pro feature
        </p>

        <h2 className="mt-3 text-2xl font-semibold">{title}</h2>

        <p className="mt-3 text-sm leading-6 text-white/70">{message}</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/15 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Maybe later
          </button>

          <Link
            href={BRAND.routes.pricing}
            className="rounded-2xl bg-[linear-gradient(90deg,#2563EB,#3B82F6)] px-4 py-3 text-center text-sm font-semibold text-white shadow-[0_12px_30px_rgba(37,99,235,0.35)] transition hover:scale-[1.02]"
          >
            Upgrade to Pro
          </Link>
        </div>
      </div>
    </div>
  );
}