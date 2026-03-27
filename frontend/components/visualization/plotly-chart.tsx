'use client';

import dynamic from 'next/dynamic';
import { useState, type ComponentType } from 'react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';

type PlotComponentProps = {
  data: Record<string, unknown>[];
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
  style?: React.CSSProperties;
  className?: string;
  useResizeHandler?: boolean;
};

const Plot = dynamic<PlotComponentProps>(
  async () => {
    const [{ default: createPlotlyComponent }, plotlyModule] = await Promise.all([
      import('react-plotly.js/factory'),
      import('plotly.js-basic-dist-min'),
    ]);
    const Plotly = ('default' in plotlyModule ? plotlyModule.default : plotlyModule) as unknown;
    return createPlotlyComponent(Plotly) as ComponentType<PlotComponentProps>;
  },
  { ssr: false },
);

interface PlotlyChartProps {
  data: Record<string, unknown>[];
  layout?: Record<string, unknown>;
  title?: string;
  className?: string;
}

const DARK_LAYOUT: Record<string, unknown> = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(15,23,42,0.6)',
  font: { color: '#cbd5e1', family: 'Inter, system-ui, sans-serif' },
  margin: { t: 40, r: 20, b: 50, l: 60 },
  xaxis: { gridcolor: '#334155', zerolinecolor: '#475569' },
  yaxis: { gridcolor: '#334155', zerolinecolor: '#475569' },
  legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: '#94a3b8' } },
  colorway: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'],
};

export default function PlotlyChart({ data, layout, title, className }: PlotlyChartProps) {
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'svg'>('png');

  const mergedLayout: Record<string, unknown> = {
    ...DARK_LAYOUT,
    ...layout,
    title: title ? { text: title, font: { size: 14, color: '#e2e8f0' } } : undefined,
    autosize: true,
  };

  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900 p-4 ${className ?? ''}`}>
      <div className="flex items-center justify-end gap-2 mb-2">
        <select
          aria-label="Chart export format"
          value={downloadFormat}
          onChange={(e) => setDownloadFormat(e.target.value as 'png' | 'svg')}
          className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300"
        >
          <option value="png">PNG</option>
          <option value="svg">SVG</option>
        </select>
        <button
          onClick={() => {
            const gd = document.querySelector('.js-plotly-plot') as HTMLElement | null;
            if (gd) {
              import('plotly.js-basic-dist-min').then((Plotly) => {
                Plotly.downloadImage(gd, {
                  format: downloadFormat,
                  filename: title || 'chart',
                  width: 1200,
                  height: 800,
                  scale: 2,
                });
              });
            }
          }}
          className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
        >
          <ArrowDownTrayIcon className="h-3 w-3" /> Export
        </button>
      </div>
      <Plot
        data={data}
        layout={mergedLayout}
        config={{
          responsive: true,
          displayModeBar: true,
          modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d', 'select2d'],
          displaylogo: false,
          toImageButtonOptions: { format: downloadFormat, scale: 2 },
        }}
        style={{ width: '100%', height: '100%', minHeight: 400 }}
        useResizeHandler
      />
    </div>
  );
}
