import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const report = readFileSync("app/quality-data/QualityDataIntelligenceReportClient.tsx", "utf8");

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(first: string, second: string): number {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("quality intelligence report contrast", () => {
  it("sets report-local text colors for light and dark cards while retaining navy page status", () => {
    expect(report).toContain("text-slate-900 dark:text-slate-100 sm:px-6");
    expect(report).toContain('bg-white p-6 dark:border-slate-700 dark:bg-slate-900');
    expect(report).toContain('role="status" aria-live="polite" className="break-words text-sm text-slate-100"');
    expect(report).toContain('className="text-blue-300 underline">Quality-data workspace');
  });

  it("gives every report form control explicit foreground, background, and placeholder colors", () => {
    expect(report).toContain("bg-white p-2 text-slate-900 placeholder:text-slate-500");
    expect(report).toContain("dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400");
    expect(report.match(/className=\{reportControlClasses\}/g)).toHaveLength(4);
  });

  it("keeps muted details and links readable in both themes", () => {
    expect(report.match(/text-slate-500 dark:text-slate-400/g)).toHaveLength(3);
    expect(report).toContain('className="text-blue-700 underline dark:text-blue-300" href="/capa"');

    // WCAG AA requires 4.5:1 for ordinary text. These are the Tailwind colors above.
    for (const [foreground, background] of [
      ["#0f172a", "#ffffff"], // slate-900 on white report cards
      ["#f1f5f9", "#0f172a"], // slate-100 on slate-900 dark cards
      ["#64748b", "#ffffff"], // slate-500 on white cards
      ["#94a3b8", "#0f172a"], // slate-400 on dark cards
      ["#f1f5f9", "#020817"], // status on the navy page
      ["#93c5fd", "#020817"], // loading link on the navy page
      ["#ffffff", "#1d4ed8"], // review button
      ["#ffffff", "#047857"], // CAPA button
    ]) {
      expect(contrast(foreground!, background!)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
