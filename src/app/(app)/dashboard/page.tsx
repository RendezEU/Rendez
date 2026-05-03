import { auth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import Link from "next/link";
import { formatDate, hoursUntil } from "@/lib/utils/date";
import { ACTIVITY_EMOJIS, ACTIVITY_LABELS } from "@/types";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;

  const [user, confirmedMatches, pendingMatches, billing] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { profile: true } }),
    prisma.match.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
        status: { in: ["CONFIRMED", "DATE_ACTIVE", "COORDINATING"] },
      },
      include: {
        userA: { include: { profile: true } },
        userB: { include: { profile: true } },
        finalizedPlan: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.match.count({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
        status: "PENDING_BOTH_DECISIONS",
      },
    }),
    prisma.billing.findUnique({ where: { userId } }),
  ]);

  const totalCredits = (billing?.freeCreditsRemaining ?? 0) + (billing?.purchasedCredits ?? 0);
  const isPremium = billing?.tier === "PREMIUM";

  return (
    <div className="px-4 py-6 space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-stone-900">
          Hey, {user?.name?.split(" ")[0] ?? "there"} 👋
        </h1>
        <p className="text-stone-500 text-sm mt-1">Ready to Rendez?</p>
      </div>

      {/* Credits */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-stone-700">
            {isPremium ? "Premium member" : `${totalCredits} date credits left`}
          </div>
          <div className="text-xs text-stone-400 mt-0.5">
            {isPremium ? "Unlimited confirmed dates" : "Free credits from onboarding"}
          </div>
        </div>
        {!isPremium && (
          <Link href="/settings/billing" className="text-xs bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 transition-colors">
            Upgrade
          </Link>
        )}
      </div>

      {/* Pending matches */}
      {pendingMatches > 0 && (
        <Link
          href="/matches"
          className="block bg-brand-600 text-white rounded-2xl p-4 hover:bg-brand-700 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">
                {pendingMatches} new {pendingMatches === 1 ? "match" : "matches"} waiting
              </div>
              <div className="text-sm opacity-80 mt-0.5">Accept or pass before they expire</div>
            </div>
            <span className="text-2xl">✨</span>
          </div>
        </Link>
      )}

      {/* Active & confirmed dates */}
      {confirmedMatches.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-stone-900 mb-3">Your upcoming dates</h2>
          <div className="space-y-3">
            {confirmedMatches.map((match) => {
              const other = match.userAId === userId ? match.userB : match.userA;
              const plan = match.finalizedPlan;
              const hoursLeft = plan ? hoursUntil(plan.scheduledAt) : null;
              const isActive = match.status === "DATE_ACTIVE";

              return (
                <Link
                  key={match.id}
                  href={`/matches/${match.id}`}
                  className={`block rounded-2xl p-4 border transition-colors ${
                    isActive
                      ? "bg-green-50 border-green-200 hover:bg-green-100"
                      : "bg-white border-stone-200 hover:border-stone-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-bold flex-shrink-0">
                      {other.name?.[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-stone-900">{other.name}</span>
                        <span>{ACTIVITY_EMOJIS[match.activityCategory]}</span>
                        {isActive && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                            Date active!
                          </span>
                        )}
                      </div>
                      {plan ? (
                        <>
                          <div className="text-sm text-stone-600 mt-0.5">{formatDate(plan.scheduledAt)}</div>
                          <div className="text-xs text-stone-400">{plan.locationName}</div>
                        </>
                      ) : (
                        <div className="text-sm text-stone-500 mt-0.5">
                          {ACTIVITY_LABELS[match.activityCategory]} — coordinating
                        </div>
                      )}
                      {hoursLeft !== null && hoursLeft > 0 && hoursLeft < 48 && (
                        <div className="text-xs text-brand-600 mt-1 font-medium">
                          {hoursLeft < 1 ? "Happening soon!" : `in ${Math.round(hoursLeft)}h`}
                        </div>
                      )}
                    </div>
                    <span className="text-stone-300 text-sm">→</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {confirmedMatches.length === 0 && pendingMatches === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🎯</div>
          <div className="font-semibold text-stone-700">No active dates yet</div>
          <p className="text-sm text-stone-400 mt-1">Check your matches or browse the activity feed.</p>
          <Link href="/matches" className="inline-block mt-4 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors">
            View matches
          </Link>
        </div>
      )}
    </div>
  );
}
