import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/branding";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/chat", "/account", "/capa", "/quality-data"] },
    sitemap: `${BRAND.url}/sitemap.xml`,
  };
}
