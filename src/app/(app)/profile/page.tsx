import { auth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import Link from "next/link";
import { ACTIVITY_EMOJIS, ACTIVITY_LABELS, PROFILE_PROMPTS, INTENT_LABELS } from "@/types";

export default async function ProfilePage() {
  const session = await auth();
  const userId = session!.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: { include: { promptAnswers: { orderBy: { displayOrder: "asc" } } } },
      reputation: true,
      billing: true,
    },
  });

  const profile = user?.profile;
  const rep = user?.reputation;

  const age = profile ? Math.floor((Date.now() - new Date(profile.birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;

  return (
    <div className="px-4 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-stone-900">Your profile</h1>
        <Link href="/profile/edit" className="text-sm text-brand-600 font-medium hover:underline">Edit</Link>
      </div>

      {/* Header */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-bold text-2xl">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div>
            <div className="text-xl font-bold text-stone-900">{user?.name}</div>
            {profile && (
              <>
                <div className="text-sm text-stone-500">{age} · {profile.city}</div>
                <div className="text-sm text-stone-400">{INTENT_LABELS[profile.intent]}</div>
              </>
            )}
          </div>
        </div>

        {/* Reputation */}
        {rep && (
          <div className="mt-4 pt-4 border-t border-stone-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-stone-700">Reliability</span>
              <span className={`text-sm font-bold ${rep.reliabilityScore >= 0.8 ? "text-green-600" : rep.reliabilityScore >= 0.6 ? "text-yellow-600" : "text-red-600"}`}>
                {Math.round(rep.reliabilityScore * 100)}%
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <div className="font-bold text-stone-800">{rep.totalDates}</div>
                <div className="text-stone-400">Dates</div>
              </div>
              <div>
                <div className="font-bold text-stone-800">{Math.round(rep.showUpScore * 100)}%</div>
                <div className="text-stone-400">Show-up</div>
              </div>
              <div>
                <div className="font-bold text-stone-800">{Math.round(rep.punctualityScore * 100)}%</div>
                <div className="text-stone-400">On time</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Activities */}
      {profile && profile.preferredActivities.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">Activities</h2>
          <div className="flex flex-wrap gap-2">
            {profile.preferredActivities.map((a) => (
              <span key={a} className="flex items-center gap-1 bg-stone-100 text-stone-700 px-3 py-1.5 rounded-full text-sm">
                {ACTIVITY_EMOJIS[a]} {ACTIVITY_LABELS[a]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Profile prompts */}
      {profile && profile.promptAnswers.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">Profile answers</h2>
          {profile.promptAnswers.map((answer) => {
            const prompt = PROFILE_PROMPTS.find((p) => p.key === answer.promptKey);
            return (
              <div key={answer.id} className="bg-white border border-stone-200 rounded-xl p-4">
                <div className="text-xs text-stone-400 mb-1">{prompt?.question}</div>
                <div className="text-sm text-stone-800 font-medium">&ldquo;{answer.answer}&rdquo;</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Links */}
      <div className="space-y-2">
        <Link href="/availability" className="block bg-white border border-stone-200 rounded-xl p-4 hover:border-stone-300 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-stone-900">Availability</div>
              <div className="text-sm text-stone-400">Update your free time blocks</div>
            </div>
            <span className="text-stone-400">→</span>
          </div>
        </Link>
        <Link href="/reputation" className="block bg-white border border-stone-200 rounded-xl p-4 hover:border-stone-300 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-stone-900">Reputation history</div>
              <div className="text-sm text-stone-400">See all your reliability events</div>
            </div>
            <span className="text-stone-400">→</span>
          </div>
        </Link>
        <Link href="/settings/billing" className="block bg-white border border-stone-200 rounded-xl p-4 hover:border-stone-300 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-stone-900">Billing & credits</div>
              <div className="text-sm text-stone-400">
                {user?.billing?.tier === "PREMIUM" ? "Premium member" : `${(user?.billing?.freeCreditsRemaining ?? 0) + (user?.billing?.purchasedCredits ?? 0)} credits`}
              </div>
            </div>
            <span className="text-stone-400">→</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
