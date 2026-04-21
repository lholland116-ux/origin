import { BRAND } from "@/lib/branding";

export default function PrivacyPage() {
  const address = BRAND.contact.address;

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
            <p className="mt-2">
              {BRAND.legal.company}
              <br />
              {address.line1}
              <br />
              {address.line2}
              <br />
              {address.city}, {address.state} {address.postalCode}
              <br />
              {address.country}
              <br />
              {BRAND.contact.email}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}