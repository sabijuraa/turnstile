import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { siteDescription, siteName } from "@/lib/site";
import "@/styles/globals.css";
import { display, mono, text } from "./fonts";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Turnstile. Pay-per-request payments for AI agents",
    template: "%s · Turnstile",
  },
  description: siteDescription,
  applicationName: siteName,
  openGraph: {
    type: "website",
    siteName,
    title: "Turnstile. Let software pay for itself",
    description: siteDescription,
    locale: "en_US",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "Turnstile. Let software pay for itself",
    description: siteDescription,
  },
};

export const viewport: Viewport = {
  themeColor: "#f6f5f0",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Header />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
