import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Noveliotech CRM",
  description: "Digital Agency CRM Platform",
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Novelio CRM',
  },
};

export const viewport: Viewport = {
  // Browser/PWA chrome follows the OS scheme (matches --canvas in globals.css)
  themeColor: [
    { media: '(prefers-color-scheme: dark)',  color: '#0E1424' },
    { media: '(prefers-color-scheme: light)', color: '#F2F3F8' },
  ],
  width: 'device-width',
  initialScale: 1,
  // App-like feel when installed; pages handle their own scroll containers
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      suppressHydrationWarning
    >
      {/* Prevent flash of wrong theme on load */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var p = localStorage.getItem('theme') || 'system';
            var t = p === 'light' || p === 'dark' ? p
              : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
            document.documentElement.classList.add(t);
          } catch(e) { document.documentElement.classList.add('dark'); }
        `}} />
      </head>
      <body className="bg-canvas text-slate-100 min-h-screen">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:bg-orange-500 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:font-medium focus:text-sm"
        >
          Skip to main content
        </a>
        <ThemeProvider>{children}</ThemeProvider>
        {/* visibleToasts caps the stack so a burst of notifications doesn't
            wallpaper the screen. Duration stays at sonner's 4s default —
            incoming-notification popups pass their own 10s, so action
            confirmations (including live-call toasts in the dialer) stay quick. */}
        <Toaster
          position="bottom-right"
          visibleToasts={3}
          toastOptions={{
            style: { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--foreground)' },
          }}
        />
      </body>
    </html>
  );
}
