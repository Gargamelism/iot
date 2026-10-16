import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Synth Course",
  description: "Build a polyphonic wavetable synth on an ESP32-C3, yourself.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold">
              Synth Course
            </Link>
            <Link href="/" className="text-muted hover:text-fg">
              Modules
            </Link>
            <Link href="/curriculum" className="text-muted hover:text-fg">
              Curriculum &amp; bibliography
            </Link>
            <Link href="/play/web-sim" className="text-muted hover:text-fg">
              Simulator
            </Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
