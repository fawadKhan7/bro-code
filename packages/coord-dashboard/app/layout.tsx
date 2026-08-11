import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BroCode — coordination",
  description: "Observability dashboard for a BroCode session: roster, agent activity, queues, locks and approvals",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
