'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpenIcon,
  BoltIcon,
  CircleStackIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  Cog6ToothIcon,
  FolderIcon,
  HomeIcon,
  MegaphoneIcon,
  PencilSquareIcon,
  SparklesIcon,
  UserGroupIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import { clsx } from 'clsx';

const NAV_ITEMS = [
  { href: '/workspace', label: 'Workspace', icon: HomeIcon },
  { href: '/projects', label: 'Projects', icon: FolderIcon },
  { href: '/writing-studio', label: 'Writing Studio', icon: PencilSquareIcon },
  { href: '/media-studio', label: 'Media Studio', icon: VideoCameraIcon },
  { href: '/promo-studio', label: 'Promo Studio', icon: MegaphoneIcon },
  { href: '/story-bible', label: 'Story Bible', icon: BookOpenIcon },
  { href: '/brand-bible', label: 'Brand Bible', icon: SparklesIcon },
  { href: '/memory', label: 'Memory', icon: CircleStackIcon },
  { href: '/prompt-library', label: 'Prompt Library', icon: ClipboardDocumentListIcon },
  { href: '/pipeline', label: 'Pipeline Builder', icon: BoltIcon },
  { href: '/provenance', label: 'Run History', icon: ClockIcon },
  { href: '/agents', label: 'Workforces', icon: UserGroupIcon },
  { href: '/settings', label: 'Settings', icon: Cog6ToothIcon },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 flex-col border-r border-slate-800 bg-slate-900">
      <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 via-amber-500 to-red-500 text-sm font-black text-slate-950">
          EO
        </div>
        <div>
          <span className="text-base font-bold text-white">EduOS</span>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Education + Media</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  )}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-slate-800 p-4">
        <div className="rounded-lg bg-slate-800 p-3 text-xs text-slate-400">
          <p className="font-medium text-slate-200">Pipeline Gates</p>
          <p className="mt-1 text-slate-500">Hard quality gates are enforced for draft, thumbnail, brand, and spoiler review.</p>
        </div>
      </div>
    </aside>
  );
}
