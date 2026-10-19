import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { SITE_DESCRIPTION } from "@/lib/branding";
import { NavigationTracker } from "@/components/navigation-history";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  axes: ["opsz", "SOFT", "WONK"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL!),
  title: { default: "Sealed", template: "%s · Sealed" },
  description: SITE_DESCRIPTION,
  applicationName: "Sealed",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f1" },
    { media: "(prefers-color-scheme: dark)", color: "#24211f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} h-full bg-background antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <NavigationTracker />
      </body>
    </html>
  );
}
