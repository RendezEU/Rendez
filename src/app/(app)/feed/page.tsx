import { auth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import Link from "next/link";
import { ACTIVITY_EMOJIS } from "@/types";
import { formatDate } from "@/lib/utils/date";
import CreateActivityButton from "@/components/feed/CreateActivityButton";

export default async function FeedPage() {
  const session = await auth();
  const userId = session!.user.id;

  const profile = await prisma.profile.findUnique({ where: { userId } });
  const city = profile?.city ?? "";

  const posts = await prisma.activityPost.findMany({
    where: {
      city,
      isActive: true,
      expiresAt: { gt: new Date() },
      userId: { not: userId },
    },
    include: {
      user: { include: { profile: true, reputation: true } },
      matchRequests: { where: { requesterId: userId } },
    },
    orderBy: { scheduledAt: "asc" },
    take: 20,
  });

  // Count requests made this week
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const weeklyRequests = await prisma.feedMatchRequest.count({
    where: {
      requesterId: userId,
      createdAt: { gte: weekStart },
    },
  });

  const billing = await prisma.billing.findUnique({ where: { userId } });
  const maxRequests = billing?.tier === "PREMIUM" ? 10 : 3;
  const requestsLeft = Math.max(0, maxRequests - weeklyRequests);

  return (
    <div className="px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Activity feed</h1>
          <p className="text-sm text-stone-400">{city} · {requestsLeft} requests left this week</p>
        </div>
        <CreateActivityButton userId={userId} city={city} />
      </div>

      {posts.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🔍</div>
          <div className="font-semibold text-stone-700">No activities nearby yet</div>
          <p className="text-sm text-stone-400 mt-1">Be the first to post one!</p>
        </div>
      )}

      <div className="space-y-3">
        {posts.map((post) => {
          const alreadyRequested = post.matchRequests.length > 0;
          const rep = post.user.reputation;

          return (
            <div key={post.id} className="bg-white border border-stone-200 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="text-3xl">{ACTIVITY_EMOJIS[post.activityCategory]}</div>
                <div className="flex-1">
                  <div className="font-semibold text-stone-900">{post.title}</div>
                  <div className="text-sm text-stone-500 mt-0.5">
                    {formatDate(post.scheduledAt)}
                    {post.locationName && <> · {post.locationName}</>}
                  </div>

                  <div className="flex items-center gap-2 mt-2">
                    <div className="w-6 h-6 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 text-xs font-bold">
                      {post.user.name?.[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm text-stone-600">{post.user.name}</span>
                    {rep && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        rep.reliabilityScore >= 0.8 ? "bg-green-100 text-green-700"
                        : rep.reliabilityScore >= 0.6 ? "bg-yellow-100 text-yellow-700"
                        : "bg-red-100 text-red-700"
                      }`}>
                        {Math.round(rep.reliabilityScore * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {!alreadyRequested && requestsLeft > 0 && (
                <Link
                  href={`/feed/${post.id}`}
                  className="mt-3 block text-center bg-brand-600 text-white py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
                >
                  Request to join
                </Link>
              )}
              {alreadyRequested && (
                <div className="mt-3 text-center text-sm text-stone-400">Request sent ✓</div>
              )}
              {!alreadyRequested && requestsLeft === 0 && (
                <div className="mt-3 text-center text-xs text-stone-400">No requests left this week</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
