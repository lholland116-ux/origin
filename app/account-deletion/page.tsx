export default function AccountDeletionPage() {
  return (
    <main className="min-h-screen bg-black px-6 py-12 text-white">
      <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-zinc-900 p-8 shadow-xl">
        <h1 className="text-3xl font-bold">LVTChat Account Deletion</h1>

        <p className="mt-4 text-zinc-300">
          Users may request deletion of their LVTChat account and associated
          personal data by contacting:
        </p>

        <p className="mt-4 font-semibold text-white">
          support@lvtchat.com
        </p>

        <h2 className="mt-8 text-xl font-semibold">
          What happens when you request deletion?
        </h2>

        <p className="mt-3 text-zinc-300">
          Upon verification of your request, LVTChat will delete account
          information, chat history, uploaded documents associated with your
          account, and personal information stored within the application.
        </p>

        <h2 className="mt-8 text-xl font-semibold">
          Data that may be retained
        </h2>

        <p className="mt-3 text-zinc-300">
          Certain records may be retained when required for legal obligations,
          fraud prevention, financial and tax reporting requirements, or
          subscription and payment records processed through Stripe.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Processing time</h2>

        <p className="mt-3 text-zinc-300">
          Deletion requests are typically processed within 30 days.
        </p>

        <p className="mt-8 text-zinc-300">
          For questions regarding privacy or data deletion, contact
          support@lvtchat.com.
        </p>
      </div>
    </main>
  );
}