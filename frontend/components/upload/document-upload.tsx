'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowUpTrayIcon, DocumentIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { importProjectDocumentsFromPath, uploadDocument } from '@/lib/api';

interface DocumentUploadProps {
  projectId?: string;
  onUploadSuccess?: (documentId: string, filename: string) => void;
  onImportComplete?: () => void;
}

const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.txt',
  '.docx',
  '.csv',
  '.json',
  '.md',
  '.html',
  '.htm',
  '.mp4',
  '.mov',
  '.webm',
  '.m4v',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
];

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === 0) return '';
  return filename.slice(dotIndex).toLowerCase();
}

interface UploadedFile {
  key: string;
  name: string;
  size: number;
  status: 'uploading' | 'success' | 'error';
  error?: string;
  documentId?: string;
  sourcePath?: string;
}

export default function DocumentUpload({ projectId = 'default', onUploadSuccess, onImportComplete }: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [importPath, setImportPath] = useState('');
  const [importMode, setImportMode] = useState<'copy' | 'reference'>('reference');
  const [importingPath, setImportingPath] = useState(false);
  const [importSummary, setImportSummary] = useState('');
  const directoryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!directoryInputRef.current) {
      return;
    }
    directoryInputRef.current.setAttribute('webkitdirectory', '');
    directoryInputRef.current.setAttribute('directory', '');
  }, []);

  const getUploadKey = (file: File): string => `${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`;

  const processFiles = useCallback(async (fileList: FileList) => {
    const newFiles: UploadedFile[] = [];

    for (const file of Array.from(fileList)) {
      const ext = getFileExtension(file.name);
      const uploadKey = getUploadKey(file);
      const sourcePath = file.webkitRelativePath || file.name;
      if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
        newFiles.push({
          key: uploadKey,
          name: file.name,
          size: file.size,
          status: 'error',
          error: ext ? `File type ${ext} not supported` : 'File has no extension',
          sourcePath,
        });
        continue;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        newFiles.push({
          key: uploadKey,
          name: file.name,
          size: file.size,
          status: 'error',
          error: 'File exceeds the 500 MB upload limit',
          sourcePath,
        });
        continue;
      }
      newFiles.push({ key: uploadKey, name: file.name, size: file.size, status: 'uploading', sourcePath });
    }

    setFiles((prev) => [...prev, ...newFiles]);
    setImportSummary('');

    // Process uploads
    const validFiles = Array.from(fileList).filter((file) => {
      const ext = getFileExtension(file.name);
      return ext && ALLOWED_EXTENSIONS.includes(ext) && file.size <= MAX_FILE_SIZE_BYTES;
    });

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const uploadKey = getUploadKey(file);
      const sourcePath = file.webkitRelativePath || file.name;
      try {
        const result = await uploadDocument(file, projectId, { sourcePath });
        setFiles((prev) =>
          prev.map((f) =>
            f.key === uploadKey && f.status === 'uploading'
              ? { ...f, status: 'success', documentId: result.document_id }
              : f
          )
        );
        onUploadSuccess?.(result.document_id, file.name);
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) =>
            f.key === uploadKey && f.status === 'uploading'
              ? { ...f, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
              : f
          )
        );
      }
    }
  }, [projectId, onUploadSuccess]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        void processFiles(e.dataTransfer.files);
      }
    },
    [processFiles]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void processFiles(e.target.files);
    }
    e.target.value = '';
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handlePathImport = useCallback(async () => {
    const sourcePath = importPath.trim();
    if (!sourcePath) {
      setImportSummary('Enter a local file or folder path to import.');
      return;
    }

    setImportingPath(true);
    setImportSummary('');
    try {
      const result = await importProjectDocumentsFromPath(projectId, {
        source_path: sourcePath,
        mode: importMode,
        recursive: true,
      });
      setImportSummary(
        `Imported ${result.imported} of ${result.selected_files} files from ${result.normalized_source_path} ` +
        `(${result.mode} mode, skipped ${result.skipped_existing}, indexing failed ${result.indexing_failed}).`
      );
      onImportComplete?.();
    } catch (err) {
      setImportSummary(err instanceof Error ? err.message : 'Path import failed.');
    } finally {
      setImportingPath(false);
    }
  }, [importMode, importPath, onImportComplete, projectId]);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          isDragging
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-slate-700 bg-slate-900/50 hover:border-slate-600'
        }`}
      >
        <input
          type="file"
          multiple
          accept={ALLOWED_EXTENSIONS.join(',')}
          onChange={handleFileInput}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
        <ArrowUpTrayIcon className={`h-10 w-10 mb-3 ${isDragging ? 'text-blue-400' : 'text-slate-500'}`} />
        <p className="text-base font-medium text-slate-300">
          Drop files here or <span className="text-blue-400">browse</span>
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Supports documents, pages, images, and video assets for project previews. Max 500 MB per file.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          ref={directoryInputRef}
          type="file"
          multiple
          onChange={handleFileInput}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => directoryInputRef.current?.click()}
          className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          Import Folder
        </button>
        <p className="self-center text-xs text-slate-500">
          Folder imports keep the original relative path in project metadata.
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-200">Import Local Path</p>
            <p className="mt-1 text-xs text-slate-500">
              Use `reference` mode to keep pre-existing site files in their original directory.
            </p>
          </div>
          <select
            value={importMode}
            onChange={(event) => setImportMode(event.target.value as 'copy' | 'reference')}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          >
            <option value="reference">Reference Original Files</option>
            <option value="copy">Copy Into StudioOS</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <input
            value={importPath}
            onChange={(event) => setImportPath(event.target.value)}
            placeholder="C:\\Users\\mjhen\\Github\\cellnucleus.com"
            className="min-w-[18rem] flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
          />
          <button
            type="button"
            onClick={() => void handlePathImport()}
            disabled={importingPath}
            className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            {importingPath ? 'Importing…' : 'Import Path'}
          </button>
        </div>
        {importSummary && <p className="mt-3 text-xs text-slate-400">{importSummary}</p>}
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3"
            >
              <DocumentIcon className="h-5 w-5 flex-shrink-0 text-slate-400" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-slate-300">{file.name}</p>
                <p className="text-xs text-slate-500">{formatSize(file.size)}</p>
                {file.sourcePath && file.sourcePath !== file.name && (
                  <p className="truncate text-xs text-slate-600">{file.sourcePath}</p>
                )}
              </div>
              <div className="flex-shrink-0">
                {file.status === 'uploading' && (
                  <svg className="h-5 w-5 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {file.status === 'success' && <CheckCircleIcon className="h-5 w-5 text-emerald-400" />}
                {file.status === 'error' && (
                  <span className="text-xs text-red-400">{file.error ?? 'Error'}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
