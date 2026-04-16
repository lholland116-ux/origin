import { Suspense } from "react";
import { BRAND } from "@/lib/branding";
import LoginClient from "./LoginClient";

function LoginFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6 text-center shadow-2xl">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
          {BRAND.name}
        </p>
        <h1 className="mt-3 text-xl font-semibold text-zinc-100">
          Loading sign in
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Please wait while we prepare your {BRAND.name} login experience.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginClient />
    </Suspense>
  );
}