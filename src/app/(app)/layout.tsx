import Link from "next/link";
import { auth } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col max-w-lg mx-auto">
      <header className="sticky top-0 z-10 bg-white border-b border-stone-100 px-4 py-3 flex items-center justify-between">
        <span className="text-lg font-bold text-brand-600">Rendez</span>
        <Link href="/profile" className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 text-sm font-bold">
          {session.user.name?.[0]?.toUpperCase() ?? "?"}
        </Link>
      </header>

      <main className="flex-1 pb-20">{children}</main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-white border-t border-stone-100 px-6 py-2 flex items-center justify-around safe-pb z-10">
        <NavItem href="/dashboard" icon="🏠" label="Home" />
        <NavItem href="/matches" icon="✨" label="Matches" />
        <NavItem href="/feed" icon="📋" label="Feed" />
        <NavItem href="/profile" icon="👤" label="Profile" />
      </nav>
    </div>
  );
}

function NavItem({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg hover:bg-stone-100 transition-colors">
      <span className="text-xl">{icon}</span>
      <span className="text-xs text-stone-500">{label}</span>
    </Link>
  );
}
