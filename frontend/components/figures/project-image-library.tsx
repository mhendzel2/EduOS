'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { getDocumentContentUrl, listProjectDocuments, resolveApiUrl, uploadDocument } from '@/lib/api';
import type { ProjectDocumentItem } from '@/lib/types';

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const ACCEPTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

export interface ProjectImageAsset extends ProjectDocumentItem {
  resolvedUrl: string;
}

interface ProjectImageLibraryProps {
  projectId: string;
  title?: string;
  description?: string;
  emptyMessage?: string;
  selectedDocumentId?: string | null;
  allowUpload?: boolean;
  refreshKey?: number;
  onSelect?: (asset: ProjectImageAsset) => void;
  onUploadComplete?: (asset: ProjectImageAsset) => void;
}

function isImageDocument(document: ProjectDocumentItem): boolean {
  const filename = document.filename.toLowerCase();
  return Boolean(document.content_type?.startsWith('image/'))
    || ACCEPTED_IMAGE_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

function isAcceptedImageFile(file: File): boolean {
  const filename = file.name.toLowerCase();
  return ACCEPTED_IMAGE_TYPES.includes(file.type)
    || ACCEPTED_IMAGE_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

function resolveDocumentUrl(document: ProjectDocumentItem): string {
  return resolveApiUrl(document.url || getDocumentContentUrl(document.id));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProjectImageLibrary({
  projectId,
  title = 'Project Assets',
  description,
  emptyMessage = 'No stored image assets in this project yet.',
  selectedDocumentId = null,
  allowUpload = false,
  refreshKey = 0,
  onSelect,
  onUploadComplete,
}: ProjectImageLibraryProps) {
  const [assets, setAssets] = useState<ProjectImageAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listProjectDocuments(projectId, { limit: 200 });
      const nextAssets = response.documents
        .filter(isImageDocument)
        .map((document) => ({
          ...document,
          resolvedUrl: resolveDocumentUrl(document),
        }));
      setAssets(nextAssets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project assets');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets, refreshKey]);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const validFiles = Array.from(files).filter(isAcceptedImageFile);
    if (validFiles.length === 0) {
      setError('Only PNG, JPG, WEBP, and GIF images can be added to project assets.');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      for (const file of validFiles) {
        const response = await uploadDocument(file, projectId);
        const nextAsset: ProjectImageAsset = {
          id: response.document_id,
          filename: response.filename,
          path: response.path,
          size: response.size,
          content_type: response.content_type,
          url: response.url,
          created_at: new Date().toISOString(),
          resolvedUrl: resolveApiUrl(response.url || getDocumentContentUrl(response.document_id)),
        };
        setAssets((prev) => [nextAsset, ...prev.filter((asset) => asset.id !== nextAsset.id)]);
        onUploadComplete?.(nextAsset);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [onUploadComplete, projectId]);

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      void processFiles(event.target.files);
    }
    event.target.value = '';
  }, [processFiles]);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-white">{title}</h3>
          {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
        </div>
        <button
          type="button"
          onClick={() => void loadAssets()}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
        >
          Refresh
        </button>
      </div>

      {allowUpload && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            if (event.dataTransfer.files.length > 0) {
              void processFiles(event.dataTransfer.files);
            }
          }}
          className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
            isDragging
              ? 'border-cyan-500 bg-cyan-500/10'
              : 'border-slate-700 bg-slate-900/50 hover:border-slate-600'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            multiple
            className="hidden"
            onChange={handleInputChange}
          />
          <p className="text-sm font-medium text-slate-200">
            Drop images here or{' '}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-cyan-400 transition-colors hover:text-cyan-300"
            >
              browse
            </button>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            PNG, JPG, WEBP, GIF. Uploaded files stay in the selected project for reuse.
          </p>
          {uploading && <p className="mt-2 text-xs text-cyan-300">Uploading to project assets…</p>}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-4 text-center text-sm text-slate-400">
          Loading project assets…
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-4 text-center text-sm text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {assets.map((asset) => {
            const isSelected = asset.id === selectedDocumentId;
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSelect?.(asset)}
                className={`overflow-hidden rounded-xl border text-left transition-colors ${
                  isSelected
                    ? 'border-cyan-500 bg-cyan-500/10'
                    : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
                }`}
              >
                <div className="aspect-[4/3] bg-slate-950">
                  <img
                    src={asset.resolvedUrl}
                    alt={asset.filename}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                </div>
                <div className="space-y-1 px-3 py-2">
                  <p className="truncate text-xs font-medium text-slate-200">{asset.filename}</p>
                  <p className="text-[11px] text-slate-500">{formatBytes(asset.size)}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
