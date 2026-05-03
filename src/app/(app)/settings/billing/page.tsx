import { auth } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import Link from "next/link";

export default async function BillingPage() {
  const session = await auth();
  const userId = session?.user?.id as string;

  const billing = await prisma.billing.findUnique({ where: { userId } });
  const isPremium = billing?.tier === "PREMIUM";
  const totalCredits = (billing?.freeCreditsRemaining ?? 0) + (billing?.purchasedCredits ?? 0);

  return (
    <div className="px-4 py-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/profile" className="text-stone-400 hover:text-stone-600">←</Link>
        <h1 className="text-xl font-bold text-stone-900">Billing & credits</h1>
      </div>

      {/* Current status */}
      <div className={`rounded-2xl p-5 ${isPremium ? "bg-brand-600 text-white" : "bg-white border border-stone-200"}`}>
        <div className={`text-sm font-medium ${isPremium ? "text-brand-200" : "text-stone-500"}`}>
          Current plan
        </div>
        <div className={`text-2xl font-bold mt-1 ${isPremium ? "text-white" : "text-stone-900"}`}>
          {isPremium ? "Premium" : "Free"}
        </div>
        {!isPremium && (
          <div className={`text-sm mt-1 ${isPremium ? "text-brand-200" : "text-stone-500"}`}>
            {totalCredits} date credits remaining
          </div>
        )}
        {isPremium && billing?.subscriptionEndsAt && (
          <div className="text-sm text-brand-200 mt-1">
            Renews {new Date(billing.subscriptionEndsAt).toLocaleDateString()}
          </div>
        )}
      </div>

      {/* Plans */}
      {!isPremium && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide">Available options</h2>

          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold text-stone-900">Single date credit</div>
                <div className="text-sm text-stone-500 mt-0.5">Confirm one date with a match</div>
                <ul className="text-xs text-stone-400 mt-2 space-y-0.5">
                  <li>✓ One confirmed date</li>
                  <li>✓ No subscription required</li>
                </ul>
              </div>
              <div className="text-right">
                <div className="font-bold text-stone-900">€2.50</div>
              </div>
            </div>
            <form action="/api/stripe/checkout" method="POST">
              <input type="hidden" name="type" value="match_pack" />
              <input type="hidden" name="quantity" value="1" />
              <button type="submit" className="w-full mt-4 border border-brand-500 text-brand-600 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-50 transition-colors">
                Buy 1 credit — €2.50
              </button>
            </form>
          </div>

          <div className="bg-white border-2 border-brand-500 rounded-2xl p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-stone-900">Premium</span>
                  <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-medium">Best value</span>
                </div>
                <div className="text-sm text-stone-500 mt-0.5">Unlimited dates + priority matching</div>
                <ul className="text-xs text-stone-400 mt-2 space-y-0.5">
                  <li>✓ Unlimited confirmed dates</li>
                  <li>✓ Priority AI matching</li>
                  <li>✓ High-reliability match pool</li>
                  <li>✓ Advanced filters</li>
                </ul>
              </div>
              <div className="text-right">
                <div className="font-bold text-stone-900">€11</div>
                <div className="text-xs text-stone-400">/month</div>
              </div>
            </div>
            <form action="/api/stripe/checkout" method="POST">
              <input type="hidden" name="type" value="subscription" />
              <button type="submit" className="w-full mt-4 bg-brand-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors">
                Upgrade to Premium — €11/mo
              </button>
            </form>
          </div>
        </div>
      )}

      {isPremium && (
        <form action="/api/stripe/portal" method="POST">
          <button type="submit" className="w-full border border-stone-200 text-stone-700 py-2.5 rounded-xl text-sm font-medium hover:bg-stone-50 transition-colors">
            Manage subscription
          </button>
        </form>
      )}
    </div>
  );
}
