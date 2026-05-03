import { auth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { notFound, redirect } from "next/navigation";
import { formatDate } from "@/lib/utils/date";
import { ACTIVITY_EMOJIS, ACTIVITY_LABELS } from "@/types";
import CoordinationPanel from "@/components/matches/CoordinationPanel";
import PostDateScreen from "@/components/matches/PostDateScreen";
import CountdownTimer from "@/components/matches/CountdownTimer";

export default async function MatchDetailPage({ params }: { params: Promise<{ matchId: string }> }) {
  const session = await auth();
  const userId = session!.user.id;
  const { matchId } = await params;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      userA: { include: { profile: { include: { promptAnswers: true } }, reputation: true } },
      userB: { include: { profile: { include: { promptAnswers: true } }, reputation: true } },
      messages: { include: { sender: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      systemActions: { orderBy: { createdAt: "asc" } },
      finalizedPlan: true,
      postDateDecisions: true,
    },
  });

  if (!match) notFound();
  if (match.userAId !== userId && match.userBId !== userId) redirect("/matches");

  const isA = match.userAId === userId;
  const other = isA ? match.userB : match.userA;
  const myDecision = match.postDateDecisions.find((d) => d.userId === userId);

  // Post-date screen
  if (match.status === "COMPLETED" && !myDecision) {
    return <PostDateScreen matchId={matchId} otherName={other.name ?? "your match"} />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-4 border-b border-stone-100 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-bold">
            {other.name?.[0]?.toUpperCase()}
          </div>
          <div>
            <div className="font-bold text-stone-900">{other.name}</div>
            <div className="flex items-center gap-1 text-sm text-stone-500">
              <span>{ACTIVITY_EMOJIS[match.activityCategory]}</span>
              <span>{ACTIVITY_LABELS[match.activityCategory]}</span>
            </div>
          </div>
        </div>

        {/* Finalized plan summary */}
        {match.finalizedPlan && (
          <div className="mt-3 bg-brand-50 border border-brand-200 rounded-xl p-3">
            <div className="text-xs font-semibold text-brand-600 uppercase tracking-wide mb-1">Plan confirmed</div>
            <div className="font-semibold text-stone-900">{formatDate(match.finalizedPlan.scheduledAt)}</div>
            <div className="text-sm text-stone-600">{match.finalizedPlan.locationName}</div>
            {match.finalizedPlan.locationUrl && (
              <a href={match.finalizedPlan.locationUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-brand-600 hover:underline mt-1 block">
                View on map →
              </a>
            )}
          </div>
        )}

        {/* Countdown */}
        {match.finalizedPlan && (
          <CountdownTimer scheduledAt={match.finalizedPlan.scheduledAt.toISOString()} />
        )}
      </div>

      {/* Coordination panel */}
      <CoordinationPanel
        match={{
          id: match.id,
          status: match.status,
          activityCategory: match.activityCategory,
          messages: match.messages.map((m) => ({
            id: m.id,
            content: m.content,
            messageIndex: m.messageIndex,
            createdAt: m.createdAt.toISOString(),
            sender: m.sender,
          })),
          systemActions: match.systemActions.map((a) => ({
            id: a.id,
            actionType: a.actionType,
            initiatorId: a.initiatorId,
            payload: a.payload as Record<string, unknown>,
            acceptedAt: a.acceptedAt?.toISOString() ?? null,
            createdAt: a.createdAt.toISOString(),
          })),
          finalizedPlan: match.finalizedPlan ? {
            locationName: match.finalizedPlan.locationName,
            scheduledAt: match.finalizedPlan.scheduledAt.toISOString(),
            userAArrivedAt: match.finalizedPlan.userAArrivedAt?.toISOString() ?? null,
            userBArrivedAt: match.finalizedPlan.userBArrivedAt?.toISOString() ?? null,
          } : null,
        }}
        currentUserId={userId}
        isUserA={isA}
        otherName={other.name ?? "them"}
      />
    </div>
  );
}
