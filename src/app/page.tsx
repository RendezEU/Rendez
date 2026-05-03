import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
        <span className="text-xl font-bold text-brand-600 tracking-tight">Rendez</span>
        <div className="flex gap-3">
          <Link href="/login" className="text-sm text-stone-600 hover:text-stone-900 px-3 py-1.5 rounded-lg hover:bg-stone-100 transition-colors">
            Sign in
          </Link>
          <Link href="/register" className="text-sm bg-brand-600 text-white px-4 py-1.5 rounded-lg hover:bg-brand-700 transition-colors">
            Join free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20">
        <div className="max-w-2xl">
          <h1 className="text-5xl font-bold tracking-tight text-stone-900 mb-4 leading-tight">
            Dating built around<br />
            <span className="text-brand-600">doing things</span>
          </h1>
          <p className="text-lg text-stone-500 mb-8 max-w-md mx-auto">
            No swiping. No ghost conversations. Rendez matches you with someone for a specific activity — coffee, tennis, a walk — and gets out of the way.
          </p>
          <Link href="/register" className="inline-block bg-brand-600 text-white px-8 py-3.5 rounded-xl text-base font-medium hover:bg-brand-700 transition-colors shadow-sm">
            Get started — it&apos;s free
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-stone-100 px-6 py-16 bg-stone-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-stone-900 mb-10">How Rendez works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { num: "1", title: "Set your availability", desc: "Pick activities you enjoy and the time blocks that work for you. No exact times — just morning, afternoon, or evening." },
              { num: "2", title: "We suggest matches", desc: "Our AI finds 3–4 compatible people per week based on activity overlap, personality, and reliability — not photos." },
              { num: "3", title: "Meet in real life", desc: "Confirm a plan through our structured flow. 5 messages max. Everything else is handled by the app. Show up. Connect." },
            ].map((step) => (
              <div key={step.num} className="text-center">
                <div className="w-10 h-10 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center font-bold text-lg mx-auto mb-3">
                  {step.num}
                </div>
                <h3 className="font-semibold text-stone-900 mb-2">{step.title}</h3>
                <p className="text-sm text-stone-500">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 py-16 border-t border-stone-100">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-stone-900 mb-3">Simple pricing</h2>
          <p className="text-stone-500 mb-8">Pay only when you go on dates. No hidden fees.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
            <div className="border border-stone-200 rounded-2xl p-6">
              <div className="text-sm font-medium text-stone-500 mb-1">Free</div>
              <div className="text-3xl font-bold text-stone-900 mb-4">€0</div>
              <ul className="space-y-2 text-sm text-stone-600">
                <li>✓ Full profile &amp; onboarding</li>
                <li>✓ First 3 confirmed dates free</li>
                <li>✓ AI matching weekly</li>
                <li>✓ Activity feed access</li>
              </ul>
            </div>
            <div className="border-2 border-brand-500 rounded-2xl p-6 relative">
              <div className="absolute -top-3 left-4 bg-brand-600 text-white text-xs font-medium px-2 py-0.5 rounded-full">Popular</div>
              <div className="text-sm font-medium text-brand-600 mb-1">Premium</div>
              <div className="text-3xl font-bold text-stone-900 mb-1">€11<span className="text-base font-normal text-stone-500">/mo</span></div>
              <div className="text-xs text-stone-400 mb-4">or €2–3 per confirmed date</div>
              <ul className="space-y-2 text-sm text-stone-600">
                <li>✓ Unlimited confirmed dates</li>
                <li>✓ Priority matching</li>
                <li>✓ High-reliability match pool</li>
                <li>✓ Advanced filters</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-stone-100 py-6 text-center text-xs text-stone-400">
        © {new Date().getFullYear()} Rendez. Built for real connections.
      </footer>
    </main>
  );
}
