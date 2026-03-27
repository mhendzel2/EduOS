'use client';

import React, { useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawImperativeAPI = any;

// Dynamic import to avoid SSR issues
const Excalidraw = dynamic(
  async () => {
    const { Excalidraw } = await import('@excalidraw/excalidraw');
    return Excalidraw;
  },
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-slate-400">Loading annotation canvas…</div> }
);

// exportToBlob loaded separately to avoid SSR issues
async function getExportFn() {
  const { exportToBlob } = await import('@excalidraw/excalidraw');
  return exportToBlob;
}

interface FigureAnnotateProps {
  figureUrl: string | null;
  onSave: (blob: Blob) => Promise<void> | void;
  saving?: boolean;
}

export default function FigureAnnotate({ figureUrl, onSave, saving = false }: FigureAnnotateProps) {
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  const handleSave = useCallback(async () => {
    const api = excalidrawApiRef.current;
    if (!api || saving) return;
    try {
      const exportToBlob = await getExportFn();
      const blob = await exportToBlob({
        elements: api.getSceneElements(),
        appState: { ...api.getAppState(), exportWithDarkMode: false },
        files: api.getFiles(),
        mimeType: 'image/png',
        quality: 1,
      });
      if (blob) {
        await onSave(blob);
      }
    } catch (err) {
      console.error('Excalidraw export failed:', err);
    }
  }, [onSave, saving]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative rounded-lg overflow-hidden border border-slate-700" style={{ height: '560px' }}>
        {figureUrl && (
          // Background image overlay beneath the canvas
          <div
            className="absolute inset-0 bg-center bg-no-repeat bg-contain pointer-events-none z-0"
            style={{ backgroundImage: `url(${figureUrl})`, opacity: 0.85 }}
          />
        )}
        <div className="relative z-10 w-full h-full">
          <Excalidraw
            excalidrawAPI={(api: ExcalidrawImperativeAPI) => { excalidrawApiRef.current = api; }}
            initialData={{ appState: { viewBackgroundColor: 'transparent' } }}
            UIOptions={{ canvasActions: { export: false, loadScene: false } }}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        {!figureUrl && (
          <p className="text-sm text-slate-500">Select or generate a figure panel above to annotate it.</p>
        )}
        <button
          onClick={handleSave}
          disabled={!figureUrl || saving}
          className="ml-auto px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save Annotated Figure'}
        </button>
      </div>
    </div>
  );
}
