import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "LendLoop: borrow what you need, lend what you don't",
  description:
    "A neighbourhood tool-lending board. List what you own, borrow what you need.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-paper font-serif text-[17px] text-ink">
        <ClerkProvider>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
