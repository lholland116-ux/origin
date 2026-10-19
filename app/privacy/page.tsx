import type { Metadata } from "next";
import { BRAND } from "@/lib/branding";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How LVTChat handles account information, product usage, and early-access or demo requests.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#020817] px-6 py-16 text-white">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-4xl font-semibold">Privacy Policy</h1>

        <p className="mt-4 text-sm text-white/60">
          Effective date: {new Date().toLocaleDateString()}
        </p>

        <section className="mt-8 space-y-6 text-white/75 text-sm leading-7">
          <p>
            {BRAND.name} (“we”, “our”, or “us”) provides AI-powered assistance
            through our web application. This Privacy Policy explains how we
            collect, use, and protect your information.
          </p>

          <div>
            <h2 className="text-lg font-semibold text-white">
              Information We Collect
            </h2>
            <ul className="mt-2 space-y-2">
              <li>• Account information (email address)</li>
              <li>• User inputs, prompts, and uploaded content</li>
              <li>• Technical data (browser, device, logs)</li>
              <li>• Usage data and interaction history</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">
              How We Use Information
            </h2>
            <ul className="mt-2 space-y-2">
              <li>• Provide and improve our services</li>
              <li>• Authenticate users</li>
              <li>• Process AI requests</li>
              <li>• Monitor system performance and security</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">
              Third-Party Services
            </h2>
            <p className="mt-2">
              We use trusted third-party providers such as hosting, database,
              authentication, and AI services to operate {BRAND.name}.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">
              Data Retention
            </h2>
            <p className="mt-2">
              We retain data only as long as necessary to provide our services,
              comply with legal obligations, and improve the platform.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">Early Access and Demo Requests</h2>
            <p className="mt-2">
              If you submit an early-access or demo request, we collect the name, business email, company, role, workflow or business problem, interest type, and optional current process or tools that you provide. We use those details to respond to and manage your request. Optional product-update consent is separate and is not required for a response. The form does not accept uploads; please do not submit confidential manufacturing, personal, or customer records.
            </p>
            <p className="mt-2">
              Request records are stored in a private database table with no public read access and are available through authorized operator access. We record limited page-source and campaign attribution for internal request reporting. Campaign attribution may be carried in this browser session for up to 24 hours, then expires, and is cleared after a successful request. We do not send names, email addresses, company names, free-text request details, or UTM values to analytics. If analytics is configured, it receives only categorical form-view or submission events, interest type, and an approved source category.
            </p>
            <p className="mt-2">
              We use Cloudflare Turnstile to reduce automated form submissions. The Turnstile widget communicates with Cloudflare and may process technical and browser-interaction information for verification under the <a href="https://www.cloudflare.com/privacypolicy/" className="underline">Cloudflare Privacy Policy</a>. LVTChat sends the verification token to Cloudflare&apos;s Siteverify service; it does not send your form fields or a client IP address in that server-side verification request.
            </p>
            <p className="mt-2">
              We plan to review lead requests monthly and delete them by 12 months after submission unless a documented ongoing request or legal obligation requires limited additional retention. You may request access, correction, or deletion sooner using the contact details below. Deletion from active records does not immediately remove copies held in encrypted backups; those copies expire under the applicable backup-retention schedule.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">Security</h2>
            <p className="mt-2">
              We implement reasonable technical and organizational safeguards.
              However, no system is completely secure.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">Your Rights</h2>
            <p className="mt-2">
              You may request access, correction, or deletion of your data by
              contacting us at {BRAND.contact.email}.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-white">Contact</h2>
            <p className="mt-2">{BRAND.legal.company}<br />{BRAND.contact.email}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
