import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "sonner";
import { createClient } from "@/lib/supabase/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The manifest <link> is what makes the browser offer "install app", so it is
// only emitted for admins (manifest.webmanifest itself stays public — browsers
// fetch it without cookies). Other roles never see the install prompt.
export async function generateMetadata(): Promise<Metadata> {
  const base: Metadata = {
    title: "Noveliotech CRM",
    description: "Digital Agency CRM Platform",
    icons: {
      icon: '/favicon.svg',
      apple: '/apple-touch-icon.png',
    },
  };

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return base;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profile?.role !== 'admin') return base;

    return {
      ...base,
      manifest: '/manifest.webmanifest',
      appleWebApp: {
        capable: true,
        statusBarStyle: 'black-translucent',
        title: 'Novelio CRM',
      },
    };
  } catch {
    return base;
  }
}

export const viewport: Viewport = {
  themeColor: '#0A0820',
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
            var t = localStorage.getItem('theme') || 'dark';
            document.documentElement.classList.add(t);
          } catch(e) { document.documentElement.classList.add('dark'); }
        `}} />
      </head>
      <body className="bg-[#0A0820] text-slate-100 min-h-screen">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:bg-orange-500 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:font-medium focus:text-sm"
        >
          Skip to main content
        </a>
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: { background: '#1e1b4b', border: '1px solid #3730a3', color: '#f1f5f9' },
          }}
        />
      </body>
    </html>
  );
}
