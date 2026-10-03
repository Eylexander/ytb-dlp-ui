import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "react-hot-toast";
import { IntlProvider } from "@/providers/IntlProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "yt-dlp UI", template: "%s | yt-dlp UI" },
  description: "Self-hosted web interface for yt-dlp",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#14161b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <IntlProvider>
            {children}
            <Toaster
              position="bottom-right"
              toastOptions={{
                className: "!bg-card !text-card-foreground !border !border-border !shadow-lg !text-sm",
                error: { duration: 6000 },
              }}
            />
          </IntlProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
