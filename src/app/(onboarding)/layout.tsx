import Link from "next/link";

const STEPS = [
  { label: "About you", path: "/onboarding/demographics" },
  { label: "Intent", path: "/onboarding/intent" },
  { label: "Personality", path: "/onboarding/personality" },
  { label: "Activities", path: "/onboarding/activities" },
  { label: "Availability", path: "/onboarding/availability" },
  { label: "Profile", path: "/onboarding/prompts" },
];

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-stone-100 bg-white">
        <Link href="/" className="text-lg font-bold text-brand-600">Rendez</Link>
        <span className="text-sm text-stone-400">Set up your profile</span>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 py-10">
        <div className="w-full max-w-lg">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mb-8 justify-center">
            {STEPS.map((_, i) => (
              <div key={i} className="h-1.5 flex-1 rounded-full bg-stone-200 max-w-[40px]" />
            ))}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
