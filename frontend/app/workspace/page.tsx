'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import DocumentPreview from '@/components/assets/document-preview';
import ProjectChatPanel from '@/components/chat/project-chat-panel';
import DocumentUpload from '@/components/upload/document-upload';
import {
  deleteProjectDocument,
  fetchHealth,
  listProjectDocuments,
  listProjects,
  resolveApiUrl,
  searchDocuments,
} from '@/lib/api';
import type { HealthResponse, ProjectDocumentItem, SearchResultItem, StudioProject } from '@/lib/types';

export default function WorkspacePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [documents, setDocuments] = useState<ProjectDocumentItem[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealth(null));
    listProjects()
      .then((data) => {
        setProjects(data.projects);
        setSelectedProjectId((current) => current || data.projects[0]?.id || '');
      })
      .catch(() => setProjects([]));
  }, []);

  const refreshDocuments = async (projectId: string) => {
    if (!projectId) {
      setDocuments([]);
      setSearchResults([]);
      return;
    }

    setLoadingDocuments(true);
    try {
      const data = await listProjectDocuments(projectId, { limit: 100 });
      setDocuments(data.documents);
      setSelectedDocumentId((current) =>
        data.documents.some((document) => document.id === current) ? current : data.documents[0]?.id || ''
      );
      setError('');
    } catch (err) {
      setDocuments([]);
      setSelectedDocumentId('');
      setError(err instanceof Error ? err.message : 'Unable to load documents.');
    } finally {
      setLoadingDocuments(false);
    }
  };

  useEffect(() => {
    refreshDocuments(selectedProjectId).catch(() => undefined);
  }, [selectedProjectId]);

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query || !selectedProjectId) return;

    setSearching(true);
    try {
      const response = await searchDocuments(query, selectedProjectId, 8);
      setSearchResults(response.results);
      setError('');
    } catch (err) {
      setSearchResults([]);
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    setDeletingDocumentId(documentId);
    try {
      await deleteProjectDocument(documentId);
      await refreshDocuments(selectedProjectId);
      setSearchResults((current) => current.filter((result) => result.document_id !== documentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) || null;
  const totalDocuments = projects.reduce((sum, project) => sum + (project.document_count ?? 0), 0);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <Card title="Projects" value={String(projects.length)} subtitle="Active studio workspaces" />
        <Card title="Documents" value={String(totalDocuments)} subtitle="Stored project files" />
        <Card title="Coordinator" value={health?.coordinator ?? 'local'} subtitle="Runtime orchestration layer" />
        <Card title="Domains" value={(health?.domains ?? []).join(', ') || 'loading'} subtitle="Validated project modes" />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr,0.6fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Current Workspace</h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                StudioOS routes work through writing, media, and promo workforces based on each project’s domain set.
                The document layer now stores project files and exposes semantic search for reference material.
              </p>
            </div>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white"
            >
              <option value="">Select a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <QuickLink href="/projects" label="Manage Projects" />
            <QuickLink href="/pipeline" label="Build Pipeline" />
            <QuickLink href="/agents" label="Inspect Workforces" />
            <QuickLink href="/story-bible" label="Open Story Bible" />
            <QuickLink href="/memory" label="Open Memory" />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-lg font-semibold text-white">Selected Project</h2>
          {selectedProject ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="font-medium text-white">{selectedProject.name}</p>
                <p className="mt-1 text-sm text-slate-400">{selectedProject.description || 'No description yet.'}</p>
              </div>
              <p className="text-sm text-slate-500">{selectedProject.document_count ?? documents.length} stored documents</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">Create a project first to upload and search files.</p>
          )}
        </div>
      </section>

      <ProjectChatPanel
        projectId={selectedProjectId}
        scope="workspace"
        title="Workspace Chat"
        description="Drive StudioOS from chat instead of building workflows by hand. Attach files, pull in existing project media, and let the planner route writing, media, promo, and coordination work behind the scenes."
        availableDocuments={documents}
        documentIds={selectedDocumentId ? [selectedDocumentId] : []}
        contextLabel={
          selectedDocument
            ? `Current asset target: ${selectedDocument.filename}`
            : 'No specific asset selected. StudioOS will fall back to recent project files, media, and artifacts.'
        }
        suggestedPrompts={[
          'Scan the current project files and tell me what work should happen next.',
          'Review the attached materials and draft a stronger project brief.',
          'Analyze the current assets and propose brand positioning improvements.',
        ]}
        onUploadComplete={(documentId) => {
          refreshDocuments(selectedProjectId)
            .then(() => setSelectedDocumentId(documentId))
            .catch(() => undefined);
        }}
      />

      <section className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Upload Assets</h2>
            <p className="mt-2 text-sm text-slate-400">
              Upload reference material, HTML pages, images, or source videos to the selected project. Text-based files
              are indexed for search automatically.
            </p>
            <div className="mt-5">
              {selectedProjectId ? (
                <DocumentUpload
                  projectId={selectedProjectId}
                  onUploadSuccess={(documentId) => {
                    refreshDocuments(selectedProjectId)
                      .then(() => setSelectedDocumentId(documentId))
                      .catch(() => undefined);
                  }}
                  onImportComplete={() => {
                    refreshDocuments(selectedProjectId).catch(() => undefined);
                  }}
                />
              ) : (
                <p className="text-sm text-slate-500">Select a project to enable uploads.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Project Documents</h2>
                <p className="mt-2 text-sm text-slate-400">Stored files for the selected project.</p>
              </div>
              {loadingDocuments && <span className="text-xs text-slate-500">Refreshing…</span>}
            </div>

            <div className="mt-4 space-y-3">
              {documents.map((document) => (
                <div
                  key={document.id}
                  className={`rounded-xl border p-4 transition ${
                    document.id === selectedDocumentId
                      ? 'border-cyan-500/70 bg-cyan-500/10'
                      : 'border-slate-800 bg-slate-950/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <button
                      type="button"
                      onClick={() => setSelectedDocumentId(document.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate font-medium text-white hover:text-cyan-200">
                        {document.filename}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {document.content_type} · {formatBytes(document.size)}
                      </p>
                      {document.source_path && (
                        <p className="mt-1 truncate text-xs text-slate-600">{document.source_path}</p>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <a
                        href={resolveApiUrl(document.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
                      >
                        Open
                      </a>
                      <button
                        onClick={() => handleDelete(document.id)}
                        disabled={deletingDocumentId === document.id}
                        className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50"
                      >
                        {deletingDocumentId === document.id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {!loadingDocuments && documents.length === 0 && (
                <p className="text-sm text-slate-500">No uploaded documents for this project yet.</p>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <DocumentPreview document={selectedDocument} />
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Semantic Search</h2>
            <p className="mt-2 text-sm text-slate-400">
              Search indexed content inside the selected project. Image, video, and other binary assets stay stored for
              preview but do not produce text hits.
            </p>

            <div className="mt-5 flex gap-3">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleSearch();
                  }
                }}
                placeholder="Search uploaded notes, manuscripts, scripts, and briefs"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none"
              />
              <button
                onClick={() => void handleSearch()}
                disabled={!selectedProjectId || !searchQuery.trim() || searching}
                className="rounded-full bg-amber-400 px-5 py-2.5 text-sm font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-60"
              >
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>

            {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

            <div className="mt-6 space-y-4">
              {searchResults.map((result, index) => (
                <article key={`${result.document_id}-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-white">{result.filename || result.document_id}</p>
                    <span className="text-xs text-slate-500">{Math.round(result.score * 100)}%</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{result.content}</p>
                </article>
              ))}
              {!searching && searchResults.length === 0 && (
                <p className="text-sm text-slate-500">Run a search to see indexed document excerpts here.</p>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function Card({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-400/20"
    >
      {label}
    </Link>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
