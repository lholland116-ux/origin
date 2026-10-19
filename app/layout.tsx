import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { BRAND } from "@/lib/branding";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),

  title: {
    default: BRAND.seo.title,
    template: `%s | ${BRAND.name}`,
  },

  description: BRAND.seo.description,
  keywords: [...BRAND.seo.keywords],
  authors: [{ name: BRAND.creator }],
  creator: BRAND.creator,
  publisher: BRAND.legal.company,
  applicationName: BRAND.name,
  category: BRAND.product.category,

  alternates: {
    canonical: "/",
  },

  robots: {
    index: true,
    follow: true,
  },

  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },

  icons: {
    icon: [
      { url: "/logos/logo-icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
    shortcut: ["/favicon.ico"],
    apple: ["/favicon.ico"],
  },

  openGraph: {
    type: "website",
    url: BRAND.url,
    siteName: BRAND.name,
    title: BRAND.seo.title,
    description: BRAND.seo.description,
    images: [
      {
        url: BRAND.social.ogImage,
        width: 1200,
        height: 630,
        alt: BRAND.name,
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: BRAND.seo.title,
    description: BRAND.seo.description,
    images: [BRAND.social.ogImage],
    creator: BRAND.social.twitterHandle,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#020817",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-dvh overflow-x-hidden antialiased`}
      >
        <Script id="sanitize-marketing-attribution" strategy="beforeInteractive">
          {`
            try {
              const attributionUrl = new URL(window.location.href);
              const attributionFields = ['utm_source', 'utm_medium', 'utm_campaign'];
              const isSafeAttribution = (value) => value && value.length <= 100 && /^[A-Za-z0-9._~%-]+$/.test(value);
              const captured = {};
              for (const key of Array.from(attributionUrl.searchParams.keys())) {
                const normalizedKey = key.toLowerCase();
                if (attributionFields.includes(normalizedKey)) {
                  const value = attributionUrl.searchParams.get(key);
                  if (isSafeAttribution(value)) captured[normalizedKey] = value;
                }
              }
              const storageKey = 'lvtchat:lead-attribution:v1';
              let previous = {};
              try {
                const stored = JSON.parse(window.sessionStorage.getItem(storageKey) || 'null');
                const age = Date.now() - stored?.savedAt;
                if (stored && age >= 0 && age < 24 * 60 * 60 * 1000) previous = stored;
                else if (stored) window.sessionStorage.removeItem(storageKey);
              } catch {}
              if (Object.keys(captured).length > 0) {
                try { window.sessionStorage.setItem(storageKey, JSON.stringify({ ...previous, ...captured, savedAt: Date.now() })); } catch {}
              }
              let changed = false;
              for (const key of Array.from(attributionUrl.searchParams.keys())) {
                if (key.toLowerCase().startsWith('utm_')) {
                  attributionUrl.searchParams.delete(key);
                  changed = true;
                }
              }
              if (attributionUrl.pathname === '/request') {
                const validSources = ['homepage', 'workflow_automation', 'workflow_preview', 'pricing', 'about', 'faq', 'direct', 'other'];
                const interest = attributionUrl.searchParams.get('interest') === 'demo' ? 'demo' : 'early_access';
                const requestedSource = attributionUrl.searchParams.get('source');
                const source = validSources.includes(requestedSource) ? requestedSource : 'other';
                attributionUrl.search = '';
                attributionUrl.searchParams.set('interest', interest);
                attributionUrl.searchParams.set('source', source);
                changed = true;
              }
              if (changed) window.history.replaceState(window.history.state, '', attributionUrl);
            } catch {}
          `}
        </Script>
        {children}

        {gaMeasurementId ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
              strategy="afterInteractive"
            />

            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){window.dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${gaMeasurementId}');
              `}
            </Script>
          </>
        ) : null}
      </body>
    </html>
  );
}
