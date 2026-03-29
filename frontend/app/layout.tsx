import type { Metadata } from 'next';
import { Suspense } from 'react';
import '@excalidraw/excalidraw/index.css';
import './globals.css';
import Sidebar from '@/components/layout/sidebar';
import Navbar from '@/components/layout/navbar';
import PageSkeleton from '@/components/ui/page-skeleton';
import ActivityMonitor from '@/components/shared/activity-monitor';
import { IS_PI_MODE } from '@/lib/app-mode';

export const metadata: Metadata = {
  title: IS_PI_MODE ? 'PI Agent' : 'Research OS',
  description: IS_PI_MODE
    ? 'A focused CIHR grant-review workspace with deep research and grant-writing surfaces.'
    : 'A unified operating system for experiments, analyses, figures, manuscripts, presentations, and provenance.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-950 text-slate-100" suppressHydrationWarning>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <Navbar />
            <div className="flex flex-1 overflow-hidden">
              <main className="researchos-shell flex-1 overflow-y-auto p-6 bg-slate-950">
                <Suspense fallback={<PageSkeleton />}>
                  {children}
                </Suspense>
              </main>
              {/* Activity Log Right Column */}
              <aside className="hidden xl:flex w-80 flex-col border-l border-slate-800 bg-slate-900/50 backdrop-blur z-30">
                <ActivityMonitor docked={true} />
              </aside>
            </div>
          </div>
        </div>
        <div className="xl:hidden">
          <ActivityMonitor docked={false} />
        </div>
      </body>
    </html>
  );
}
