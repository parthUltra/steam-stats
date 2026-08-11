import type { Metadata } from "next";
import { JetBrains_Mono, Outfit } from "next/font/google";
import { DevLiveReload } from "@/components/DevLiveReload";
import { cn } from "@/lib/utils";
import "./globals.css";

/** UI + headings — hierarchy via weight/size. */
const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
});

/** Playtime, money, KPIs. */
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "700"],
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
        <DevLiveReload />
        <div className="ambient" aria-hidden>
          <span className="ambient-orb ambient-orb-a" />
          <span className="ambient-orb ambient-orb-b" />
        </div>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
