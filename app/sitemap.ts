import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/branding";

const PUBLIC_ROUTES = [
  "",
  "/workflow-automation",
  "/workflow-preview",
  "/request",
  "/pricing",
  "/help",
  "/about",
  "/blog",
  "/levi",
  "/privacy",
  "/terms",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: `${BRAND.url}${route}`,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route.startsWith("/workflow") ? 0.8 : 0.6,
  }));
}
