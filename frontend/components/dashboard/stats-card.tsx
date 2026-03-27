import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/solid';
import { ElementType } from 'react';

interface StatsCardProps {
  title: string;
  value: string;
  description?: string;
  icon: ElementType;
  trend?: {
    value: number;
    direction: 'up' | 'down';
  };
}

export default function StatsCard({ title, value, description, icon: Icon, trend }: StatsCardProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 transition-all hover:border-slate-700">
      <div className="flex items-center justify-between">
        <div className="rounded-lg bg-slate-800 p-2">
          <Icon className="h-5 w-5 text-blue-400" />
        </div>
        {trend && (
          <div
            className={`flex items-center gap-1 text-xs font-medium ${
              trend.direction === 'up' ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {trend.direction === 'up' ? (
              <ArrowTrendingUpIcon className="h-3.5 w-3.5" />
            ) : (
              <ArrowTrendingDownIcon className="h-3.5 w-3.5" />
            )}
            {trend.value}%
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="mt-0.5 text-sm font-medium text-slate-400">{title}</p>
        {description && <p className="mt-0.5 text-xs text-slate-600">{description}</p>}
      </div>
    </div>
  );
}
