import { auth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { notFound } from "next/navigation";
import { ACTIVITY_EMOJIS, ACTIVITY_LABELS, PROFILE_PROMPTS } from "@/types";
import { formatDate } from "@/lib/utils/date";
import RequestMatchButton from "@/components/feed/RequestMatchButton";

export default async function ActivityDetailPage({ params }: { params: Promise<{ activityId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id as string;
  const { activityId } = await params;

  const post = await prisma.activityPost.findUnique({
    where: { id: activityId },
    include: {
      user: { include: { profile: { include: { promptAnswers: true } }, reputation: true } },
      matchRequests: { where: { requesterId: userId } },
    },
  });

  if (!post || !post.isActive) notFound();

  const alreadyRequested = post.matchRequests.length > 0;
  const isOwn = post.userId === userId;
  const profile = post.user.profile;
  const rep = post.user.reputation;
  const promptAnswer = profile?.promptAnswers?.[0];
  const promptQuestion = promptAnswer
    ? PROFILE_PROMPTS.find((p) => p.key === promptAnswer.promptKey)?.question
    : null;

  return (
    <div className="px-4 py-6 space-y-5">
      {/* Activity header */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-4xl">{ACTIVITY_EMOJIS[post.activityCategory]}</span>
          <div>
            <div className="font-bold text-stone-900 text-lg">{post.title}</div>
            <div className="text-sm text-stone-500">{ACTIVITY_LABELS[post.activityCategory]}</div>
          </div>
        </div>
        <div className="text-sm text-stone-600">{formatDate(post.scheduledAt)}</div>
        {post.locationName && <div className="text-sm text-stone-400">{post.locationName}</div>}
      </div>

      {/* Profile */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-bold text-xl">
            {post.user.name?.[0]?.toUpperCase()}
          </div>
          <div>
            <div className="font-bold text-stone-900">{post.user.name}</div>
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
        </div>

        {promptAnswer && promptQuestion && (
          <div className="bg-stone-50 rounded-xl p-4">
            <div className="text-xs text-stone-400 mb-1">{promptQuestion}</div>
            <div className="text-sm text-stone-800 font-medium">&ldquo;{promptAnswer.answer}&rdquo;</div>
          </div>
        )}
      </div>

      {/* CTA */}
      {!isOwn && (
        <RequestMatchButton
          activityId={activityId}
          alreadyRequested={alreadyRequested}
        />
      )}

      {isOwn && (
        <div className="text-center text-sm text-stone-400">This is your activity post.</div>
      )}
    </div>
  );
}
