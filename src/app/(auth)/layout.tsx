import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center px-4">
      <Link href="/" className="text-2xl font-bold text-brand-600 tracking-tight mb-8">
        Rendez
      </Link>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
        {children}
      </div>
    </div>
  );
}
