import type { Metadata } from "next";
import localFont from "next/font/local";
import { DevLiveReload } from "@/components/DevLiveReload";
import { cn } from "@/lib/utils";
import "./globals.css";

/*
 * Fonts are committed under ./fonts (OFL, licence text beside each file) so the
 * build never needs the network. Each file is the full variable font; one
 * @font-face per weight keeps weight matching identical to the previous
 * Google Fonts setup.
 */

/** UI + headings — hierarchy via weight/size. */
const outfit = localFont({
  src: [
    { path: "./fonts/Outfit-Variable.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Outfit-Variable.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Outfit-Variable.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Outfit-Variable.woff2", weight: "700", style: "normal" },
    { path: "./fonts/Outfit-Variable.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-sans",
});

/** Playtime, money, KPIs. */
const jetbrains = localFont({
  src: [
    {
      path: "./fonts/JetBrainsMono-Variable.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/JetBrainsMono-Variable.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/JetBrainsMono-Variable.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Steam Stats",
  description: "Local Steam spending habits and library valuation",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn(
        "dark h-full antialiased font-sans",
        outfit.variable,
        jetbrains.variable,
      )}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <DevLiveReload />
        <div className="ambient" aria-hidden>
          <span className="ambient-orb ambient-orb-a" />
          <span className="ambient-orb ambient-orb-b" />
        </div>
        {children}
      </body>
    </html>
  );
}
