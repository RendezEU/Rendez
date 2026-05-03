import { auth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { formatTimeAgo } from "@/lib/utils/date";

const EVENT_LABELS: Record<string, string> = {
  NO_SHOW: "❌ Didn't show up",
  DATE_COMPLETED: "✅ Completed a date",
  LATE_ARRIVAL: "⏰ Arrived late",
  ON_TIME: "✅ Arrived on time",
  CONNECT_RECEIVED: "💚 Someone connected with you",
  PASS_RECEIVED: "💔 Someone passed",
};

export default async function ReputationPage() {
  const session = await auth();
  const userId = session!.user.id;

  const [rep, events] = await Promise.all([
    prisma.reputation.findUnique({ where: { userId } }),
    prisma.reputationEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-xl font-bold text-stone-900">Your reputation</h1>

      {rep ? (
        <>
          {/* Score breakdown */}
          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <div className="text-center mb-5">
              <div className={`text-5xl font-bold ${
                rep.reliabilityScore >= 0.8 ? "text-green-600"
                : rep.reliabilityScore >= 0.6 ? "text-yellow-600"
                : "text-red-600"
              }`}>
                {Math.round(rep.reliabilityScore * 100)}
              </div>
              <div className="text-sm text-stone-400 mt-1">Reliability score</div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Show-up", value: rep.showUpScore, weight: "40%" },
                { label: "Punctuality", value: rep.punctualityScore, weight: "30%" },
                { label: "Experience", value: rep.experienceScore, weight: "30%" },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <div className="text-lg font-bold text-stone-800">{Math.round(s.value * 100)}</div>
                  <div className="text-xs text-stone-500">{s.label}</div>
                  <div className="text-xs text-stone-300">{s.weight} weight</div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-stone-100 grid grid-cols-3 gap-2 text-center text-sm">
              <div>
                <div className="font-bold">{rep.totalDates}</div>
                <div className="text-stone-400 text-xs">Dates</div>
              </div>
              <div>
                <div className="font-bold text-red-500">{rep.totalNoShows}</div>
                <div className="text-stone-400 text-xs">No-shows</div>
              </div>
              <div>
                <div className="font-bold text-yellow-500">{rep.totalLateArrivals}</div>
                <div className="text-stone-400 text-xs">Late</div>
              </div>
            </div>
          </div>

          {/* How it works */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <strong>How your score works:</strong> Show-up rate is most important (40%). Punctuality (30%) and post-date experience ratings (30%) round it out. High scores improve your match quality and priority.
          </div>

          {/* History */}
          {events.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3">History</h2>
              <div className="space-y-2">
                {events.map((e) => (
                  <div key={e.id} className="bg-white border border-stone-100 rounded-xl px-4 py-3 flex items-center justify-between">
                    <span className="text-sm text-stone-700">{EVENT_LABELS[e.eventType] ?? e.eventType}</span>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium ${e.delta > 0 ? "text-green-600" : "text-red-500"}`}>
                        {e.delta > 0 ? "+" : ""}{(e.delta * 100).toFixed(0)}
                      </span>
                      <span className="text-xs text-stone-400">{formatTimeAgo(e.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📊</div>
          <div className="font-semibold text-stone-700">No reputation data yet</div>
          <p className="text-sm text-stone-400 mt-1">Complete your first date to start building your score.</p>
        </div>
      )}
    </div>
  );
}
