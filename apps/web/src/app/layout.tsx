import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FluxMandate — Financial authority for autonomous companies",
  description: "Turn contracts into safe, explainable, on-chain financial authority for autonomous agents.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

