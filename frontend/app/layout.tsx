import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/layout/sidebar';
import Navbar from '@/components/layout/navbar';

export const metadata: Metadata = {
  title: 'StudioOS',
  description: 'A unified operating system for writing, media production, and cross-domain promotion.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-950 text-slate-100" suppressHydrationWarning>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Navbar />
            <main className="researchos-shell flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
