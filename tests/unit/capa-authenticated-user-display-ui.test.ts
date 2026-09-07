import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("CAPA authenticated-user display", () => {
  const page = readFileSync(
    resolve("app/capa/page.tsx"),
    "utf8",
  );

  const intake = readFileSync(
    resolve("app/capa/CapaIntakeClient.tsx"),
    "utf8",
  );

  it("derives the displayed email from the server-authenticated Supabase user", () => {
    expect(page).toContain("supabase.auth.getUser()");
    expect(page).toContain('userEmail={user.email ?? ""}');
    expect(page).toContain("redirect(\"/login\")");
  });

  it("renders the authenticated CAPA user in the persistent page header", () => {
    const headerStart = intake.indexOf("<header");
    const headerEnd = intake.indexOf("</header>", headerStart);

    expect(headerStart).toBeGreaterThan(-1);
    expect(headerEnd).toBeGreaterThan(headerStart);

    const header = intake.slice(
      headerStart,
      headerEnd,
    );

    expect(header).toContain(
      "Authenticated CAPA user",
    );

    expect(header).toContain(
      '{userEmail || "Authenticated user"}',
    );
  });

  it("keeps the identity display read-only", () => {
    const identityStart = intake.indexOf(
      "Authenticated CAPA user",
    );

    const backToChat = intake.indexOf(
      "Back to Chat",
      identityStart,
    );

    const identityRegion = intake.slice(
      identityStart,
      backToChat,
    );

    expect(identityRegion).not.toContain("<input");
    expect(identityRegion).not.toContain("<select");
    expect(identityRegion).not.toContain("<textarea");
    expect(identityRegion).not.toContain("<button");
  });
});
