import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rendez — Meet for real",
  description: "Activity-based dating. No swiping. Real meetings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
