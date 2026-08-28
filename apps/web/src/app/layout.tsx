import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Radio",
  description: "An AI DJ over your Spotify.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="bg-zinc-950 text-zinc-100 antialiased">
      <body className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-5 py-8">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Radio</h1>
          <span className="text-xs text-zinc-500">prototype</span>
        </header>
        <main className="flex flex-1 flex-col gap-8">{children}</main>
      </body>
    </html>
  );
}
