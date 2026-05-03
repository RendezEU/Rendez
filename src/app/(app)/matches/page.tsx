import { auth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import Link from "next/link";
import { ACTIVITY_EMOJIS, ACTIVITY_LABELS, PROFILE_PROMPTS } from "@/types";
import MatchDecision from "@/components/matches/MatchDecision";

export default async function MatchesPage() {
  const session = await auth();
  const userId = session!.user.id;

  const matches = await prisma.match.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: "PENDING_BOTH_DECISIONS",
      expiresAt: { gt: new Date() },
    },
    include: {
      userA: { include: { profile: { include: { promptAnswers: true } }, reputation: true } },
      userB: { include: { profile: { include: { promptAnswers: true } }, reputation: true } },
    },
    orderBy: { compatibilityScore: "desc" },
  });

  const activeMatches = await prisma.match.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      status: { in: ["ACCEPTED", "COORDINATING", "CONFIRMED", "DATE_ACTIVE"] },
    },
    include: {
      userA: { include: { profile: true } },
      userB: { include: { profile: true } },
      finalizedPlan: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-xl font-bold text-stone-900">Your matches</h1>

      {/* Pending decisions */}
      {matches.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">
              Decide this week ({matches.length})
            </h2>
          </div>

          {matches.map((match) => {
            const isA = match.userAId === userId;
            const other = isA ? match.userB : match.userA;
            const mySummary = isA ? match.aiSummaryA : match.aiSummaryB;
            const profile = other.profile;
            const rep = other.reputation;

            // Pick a context-relevant prompt answer to show
            const promptAnswer = profile?.promptAnswers?.[0];
            const promptQuestion = promptAnswer
              ? PROFILE_PROMPTS.find((p) => p.key === promptAnswer.promptKey)?.question
              : null;

            return (
              <div key={match.id} className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
                {/* Header */}
                <div className="p-4 pb-0">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-bold text-lg flex-shrink-0">
                      {other.name?.[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-stone-900">{other.name}</span>
                        {rep && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            rep.reliabilityScore >= 0.8 ? "bg-green-100 text-green-700"
                            : rep.reliabilityScore >= 0.6 ? "bg-yellow-100 text-yellow-700"
                            : "bg-red-100 text-red-700"
                          }`}>
                            {Math.round(rep.reliabilityScore * 100)}% reliable
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-lg">{ACTIVITY_EMOJIS[match.activityCategory]}</span>
                        <span className="text-sm text-stone-600">{ACTIVITY_LABELS[match.activityCategory]}</span>
                      </div>
                    </div>
                  </div>

                  {/* AI summary */}
                  {mySummary && (
                    <p className="text-sm text-stone-600 mt-3 leading-relaxed">{mySummary}</p>
                  )}

                  {/* Prompt preview */}
                  {promptAnswer && promptQuestion && (
                    <div className="mt-3 bg-stone-50 rounded-xl p-3">
                      <div className="text-xs text-stone-400 mb-1">{promptQuestion}</div>
                      <div className="text-sm text-stone-700 font-medium">"{promptAnswer.answer}"</div>
                    </div>
                  )}
                </div>

                {/* Decision */}
                <div className="p-4">
                  <MatchDecision matchId={match.id} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Active / coordinating matches */}
      {activeMatches.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">
            In progress ({activeMatches.length})
          </h2>
          {activeMatches.map((match) => {
            const other = match.userAId === userId ? match.userB : match.userA;
            const plan = match.finalizedPlan;

            return (
              <Link
                key={match.id}
                href={`/matches/${match.id}`}
                className="block bg-white border border-stone-200 rounded-2xl p-4 hover:border-stone-300 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-bold">
                    {other.name?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-stone-900">{other.name}</div>
                    <div className="text-sm text-stone-500">
                      {plan ? `Confirmed: ${plan.locationName}` : "Coordinating…"}
                    </div>
                  </div>
                  <span className="text-xs px-2 py-1 bg-stone-100 text-stone-600 rounded-full capitalize">
                    {match.status.replace("_", " ").toLowerCase()}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {matches.length === 0 && activeMatches.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🗓️</div>
          <div className="font-semibold text-stone-700">No matches this week yet</div>
          <p className="text-sm text-stone-400 mt-1">
            Rendez generates new matches every Monday. Check back soon or browse the activity feed.
          </p>
          <Link href="/feed" className="inline-block mt-4 border border-stone-300 text-stone-700 px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-stone-100 transition-colors">
            Browse activities
          </Link>
        </div>
      )}
    </div>
  );
}
