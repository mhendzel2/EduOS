'use client';

import { useEffect, useMemo, useState } from 'react';
import { resolveApiUrl } from '@/lib/api';
import type { ProjectDocumentItem } from '@/lib/types';

type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'html' | 'text' | 'other';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v', '.avi'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a'];
const HTML_EXTENSIONS = ['.html', '.htm'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.xml', '.yml', '.yaml'];

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === 0) {
    return '';
  }
  return filename.slice(dotIndex).toLowerCase();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getPreviewKind(document: ProjectDocumentItem): PreviewKind {
  const contentType = (document.content_type || '').toLowerCase();
  const extension = getExtension(document.filename);

  if (contentType.startsWith('image/') || IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (contentType.startsWith('video/') || VIDEO_EXTENSIONS.includes(extension)) return 'video';
  if (contentType.startsWith('audio/') || AUDIO_EXTENSIONS.includes(extension)) return 'audio';
  if (contentType === 'application/pdf' || extension === '.pdf') return 'pdf';
  if (contentType.startsWith('text/html') || HTML_EXTENSIONS.includes(extension)) return 'html';
  if (
    contentType.startsWith('text/')
    || contentType.includes('json')
    || contentType.includes('xml')
    || TEXT_EXTENSIONS.includes(extension)
  ) {
    return 'text';
  }
  return 'other';
}

interface DocumentPreviewProps {
  document: ProjectDocumentItem | null;
}

export default function DocumentPreview({ document }: DocumentPreviewProps) {
  const [textPreview, setTextPreview] = useState('');
  const [loadingText, setLoadingText] = useState(false);
  const previewUrl = useMemo(() => (document ? resolveApiUrl(document.url) : ''), [document]);
  const previewKind = document ? getPreviewKind(document) : 'other';

  useEffect(() => {
    if (!document || previewKind !== 'text') {
      setTextPreview('');
      setLoadingText(false);
      return;
    }

    const controller = new AbortController();
    setLoadingText(true);
    setTextPreview('');

    fetch(previewUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load preview (${response.status})`);
        }
        const text = await response.text();
        setTextPreview(text.slice(0, 20000));
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        setTextPreview(error instanceof Error ? error.message : 'Unable to load preview.');
      })
      .finally(() => setLoadingText(false));

    return () => controller.abort();
  }, [document, previewKind, previewUrl]);

  if (!document) {
    return (
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Asset Preview</h2>
          <p className="mt-2 text-sm text-slate-400">
            Select any stored page, image, or video asset to preview it here.
          </p>
        </div>
        <div className="flex min-h-[24rem] items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 p-6 text-center text-sm text-slate-500">
          No project asset selected yet.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Asset Preview</h2>
          <p className="mt-1 text-sm text-slate-300">{document.filename}</p>
          <p className="mt-1 text-xs text-slate-500">
            {document.content_type || 'application/octet-stream'} · {formatBytes(document.size)}
          </p>
        </div>
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
        >
          Open source
        </a>
      </div>

      <div className="min-h-[24rem] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
        {previewKind === 'image' && (
          <div className="flex min-h-[24rem] items-center justify-center bg-slate-950">
            <img src={previewUrl} alt={document.filename} className="max-h-[32rem] w-full object-contain" />
          </div>
        )}

        {previewKind === 'video' && (
          <video controls className="min-h-[24rem] w-full bg-black" src={previewUrl} />
        )}

        {previewKind === 'audio' && (
          <div className="flex min-h-[24rem] items-center justify-center p-6">
            <audio controls className="w-full max-w-xl" src={previewUrl} />
          </div>
        )}

        {previewKind === 'pdf' && (
          <iframe
            src={previewUrl}
            title={document.filename}
            className="min-h-[32rem] w-full bg-white"
          />
        )}

        {previewKind === 'html' && (
          <iframe
            src={previewUrl}
            title={document.filename}
            sandbox="allow-same-origin"
            className="min-h-[32rem] w-full bg-white"
          />
        )}

        {previewKind === 'text' && (
          <div className="min-h-[24rem] p-4">
            {loadingText ? (
              <p className="text-sm text-slate-500">Loading text preview…</p>
            ) : (
              <>
                <pre className="whitespace-pre-wrap text-sm text-slate-200">{textPreview || 'No text preview available.'}</pre>
                {textPreview.length >= 20000 && (
                  <p className="mt-3 text-xs text-slate-500">Preview truncated to the first 20,000 characters.</p>
                )}
              </>
            )}
          </div>
        )}

        {previewKind === 'other' && (
          <div className="flex min-h-[24rem] items-center justify-center p-6 text-center">
            <div>
              <p className="text-sm text-slate-300">This asset does not have an inline preview yet.</p>
              <p className="mt-2 text-xs text-slate-500">Use the source link to inspect it directly.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
