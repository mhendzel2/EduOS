'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import Button from '@/components/ui/button';
import { runProjectChat, uploadDocument } from '@/lib/api';
import type { ProjectChatMessage, ProjectChatResponse, ProjectDocumentItem } from '@/lib/types';

const ACCEPTED_ATTACHMENT_TYPES = [
  '.pdf',
  '.txt',
  '.docx',
  '.csv',
  '.json',
  '.md',
  '.html',
  '.htm',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.mp4',
  '.mov',
  '.webm',
  '.m4v',
  '.mp3',
  '.wav',
  '.m4a',
].join(',');

interface ProjectChatPanelProps {
  projectId: string;
  scope?: 'workspace' | 'media' | 'general';
  title?: string;
  description?: string;
  availableDocuments?: ProjectDocumentItem[];
  documentIds?: string[];
  artifactIds?: string[];
  contextLabel?: string;
  suggestedPrompts?: string[];
  onExecuted?: (response: ProjectChatResponse) => void;
  onUploadComplete?: (documentId: string, filename: string) => void;
}

interface ChatBubble extends ProjectChatMessage {
  id: string;
  meta?: {
    route?: string;
    model?: string;
  };
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function inferDocumentKind(document: ProjectDocumentItem): string {
  const contentType = (document.content_type || '').toLowerCase();
  const filename = document.filename.toLowerCase();
  if (contentType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].some((suffix) => filename.endsWith(suffix))) {
    return 'image';
  }
  if (contentType.startsWith('video/') || ['.mp4', '.mov', '.webm', '.m4v', '.avi'].some((suffix) => filename.endsWith(suffix))) {
    return 'video';
  }
  if (contentType.startsWith('audio/') || ['.mp3', '.wav', '.m4a'].some((suffix) => filename.endsWith(suffix))) {
    return 'audio';
  }
  if (contentType === 'application/pdf' || filename.endsWith('.pdf')) {
    return 'pdf';
  }
  return 'text';
}

function routeLabel(response: ProjectChatResponse): string {
  if (response.plan.execution_mode === 'agent') {
    return `${response.plan.workforce}.${response.plan.agent_id}`;
  }
  if (response.plan.execution_mode === 'pipeline') {
    return `${response.plan.pipeline_kind} pipeline`;
  }
  return `${response.plan.steps.length} custom step${response.plan.steps.length === 1 ? '' : 's'}`;
}

export default function ProjectChatPanel({
  projectId,
  scope = 'general',
  title = 'Project Chat',
  description = 'Chat with StudioOS to plan and run work against the current project.',
  availableDocuments = [],
  documentIds = [],
  artifactIds = [],
  contextLabel,
  suggestedPrompts = [],
  onExecuted,
  onUploadComplete,
}: ProjectChatPanelProps) {
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState('');
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>(uniq(documentIds));
  const [modelTarget, setModelTarget] = useState<'local' | 'openrouter'>('local');
  const [externalModel, setExternalModel] = useState('google/gemini-2.5-flash');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [lastResponse, setLastResponse] = useState<ProjectChatResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentIdsKey = documentIds.join('|');

  useEffect(() => {
    setMessages([]);
    setDraft('');
    setError('');
    setLastResponse(null);
    setSelectedDocumentIds(uniq(documentIds));
  }, [projectId, scope]);

  useEffect(() => {
    setSelectedDocumentIds((current) => uniq([...current, ...documentIds]));
  }, [documentIdsKey, documentIds]);

  const recentDocuments = useMemo(() => {
    const ranked = [...availableDocuments];
    ranked.sort((left, right) => {
      const leftKind = inferDocumentKind(left);
      const rightKind = inferDocumentKind(right);
      if (scope === 'media') {
        const weight = { video: 0, image: 1, audio: 2, pdf: 3, text: 4 } as Record<string, number>;
        return (weight[leftKind] ?? 9) - (weight[rightKind] ?? 9);
      }
      const weight = { text: 0, pdf: 1, image: 2, video: 3, audio: 4 } as Record<string, number>;
      return (weight[leftKind] ?? 9) - (weight[rightKind] ?? 9);
    });
    return ranked.slice(0, 14);
  }, [availableDocuments, scope]);

  const selectedArtifacts = artifactIds.filter(Boolean);
  const selectedVisionCount = useMemo(
    () =>
      availableDocuments.filter((document) => {
        if (!selectedDocumentIds.includes(document.id)) return false;
        const kind = inferDocumentKind(document);
        return kind === 'image' || kind === 'video';
      }).length,
    [availableDocuments, selectedDocumentIds]
  );
  const selectedTranscriptCandidateCount = useMemo(
    () =>
      availableDocuments.filter((document) => {
        if (!selectedDocumentIds.includes(document.id)) return false;
        const kind = inferDocumentKind(document);
        return kind === 'video' || kind === 'audio';
      }).length,
    [availableDocuments, selectedDocumentIds]
  );

  const toggleDocument = (documentId: string) => {
    setSelectedDocumentIds((current) =>
      current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId]
    );
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || !projectId) return;
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(fileList)) {
        const uploaded = await uploadDocument(file, projectId, { sourcePath: file.name });
        setSelectedDocumentIds((current) => uniq([...current, uploaded.document_id]));
        onUploadComplete?.(uploaded.document_id, file.name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attachment upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const sendMessage = async () => {
    const message = draft.trim();
    if (!projectId || !message || busy) return;

    const nextUserMessage: ChatBubble = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: message,
    };

    setMessages((current) => [...current, nextUserMessage]);
    setDraft('');
    setBusy(true);
    setError('');

    try {
      const response = await runProjectChat(projectId, {
        message,
        scope,
        conversation: messages.map((item) => ({ role: item.role, content: item.content })),
        document_ids: selectedDocumentIds,
        artifact_ids: selectedArtifacts,
        include_project_media: true,
        execute: true,
        model_target: modelTarget,
        external_model: externalModel.trim(),
      });

      setLastResponse(response);
      setMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-assistant`,
          role: 'assistant',
          content: response.assistant_message,
          meta: {
            route: routeLabel(response),
            model: response.model,
          },
        },
      ]);
      onExecuted?.(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat request failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-slate-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">{description}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-400">
          <p>Default runtime: local Ollama</p>
          <p className="mt-1">Optional external routing: OpenRouter</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[0.95fr,1.05fr]">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
              Scope: <span className="text-white">{scope}</span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
              Attachments: <span className="text-white">{selectedDocumentIds.length}</span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
              Artifacts: <span className="text-white">{selectedArtifacts.length}</span>
            </div>
          </div>

          {contextLabel && <p className="text-xs text-slate-500">{contextLabel}</p>}
          {selectedVisionCount > 0 && (
            <p className="text-xs text-cyan-300">
              Vision input ready for {selectedVisionCount} selected image/video asset{selectedVisionCount === 1 ? '' : 's'}.
            </p>
          )}
          {selectedTranscriptCandidateCount > 0 && (
            <p className="text-xs text-emerald-300">
              Audio transcription can be added for {selectedTranscriptCandidateCount} selected audio/video asset{selectedTranscriptCandidateCount === 1 ? '' : 's'} when transcription is configured.
            </p>
          )}

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setModelTarget('local')}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  modelTarget === 'local'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'border border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                Local LLM
              </button>
              <button
                type="button"
                onClick={() => setModelTarget('openrouter')}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  modelTarget === 'openrouter'
                    ? 'bg-amber-400 text-slate-950'
                    : 'border border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                OpenRouter
              </button>
            </div>
            {modelTarget === 'openrouter' && (
              <label className="mt-3 block">
                <span className="text-xs uppercase tracking-[0.18em] text-slate-500">External Model</span>
                <input
                  type="text"
                  value={externalModel}
                  onChange={(event) => setExternalModel(event.target.value)}
                  placeholder="google/gemini-2.5-flash"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </label>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">Attachments and Project Media</p>
                <p className="mt-1 text-xs text-slate-500">
                  Upload files here or attach recent project assets so chat can plan against the current media and docs.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_ATTACHMENT_TYPES}
                  onChange={(event) => void handleFiles(event.target.files)}
                  className="hidden"
                />
                <Button
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                  loading={uploading}
                  disabled={!projectId}
                >
                  Attach Files
                </Button>
              </div>
            </div>

            {recentDocuments.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {recentDocuments.map((document) => {
                  const selected = selectedDocumentIds.includes(document.id);
                  return (
                    <button
                      key={document.id}
                      type="button"
                      onClick={() => toggleDocument(document.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        selected
                          ? 'border-cyan-400 bg-cyan-500/15 text-cyan-100'
                          : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {document.filename} · {inferDocumentKind(document)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {suggestedPrompts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setDraft(prompt)}
                  className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-400/15"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="max-h-[26rem] min-h-[18rem] space-y-3 overflow-y-auto">
            {messages.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-800 p-5 text-sm text-slate-500">
                Start with a plain request like “scan the current project media and draft a stronger channel branding
                package” or “review the uploaded footage and propose a tighter video structure.”
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-2xl px-4 py-3 text-sm ${
                  message.role === 'user'
                    ? 'ml-8 bg-cyan-500/15 text-cyan-50'
                    : 'mr-8 border border-slate-800 bg-slate-900/80 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    {message.role === 'user' ? 'You' : 'StudioOS'}
                  </span>
                  {message.meta?.route && (
                    <span className="text-[11px] text-slate-500">
                      {message.meta.route} · {message.meta.model}
                    </span>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap">{message.content}</p>
              </div>
            ))}
            {busy && (
              <div className="mr-8 rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-400">
                StudioOS is planning and executing against the current project context…
              </div>
            )}
          </div>

          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="Ask for a plan, critique, brand analysis, asset scan, or new package. Attach files or select existing media above."
            className="mt-4 min-h-32 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">Press Ctrl/Cmd + Enter to send.</p>
            <Button
              onClick={() => void sendMessage()}
              loading={busy}
              disabled={!projectId || !draft.trim()}
              className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"
            >
              Send to StudioOS
            </Button>
          </div>

          {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

          {lastResponse && (
            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-xs text-slate-400">
              <p className="text-slate-200">{lastResponse.plan.summary}</p>
              <p className="mt-1">
                Route: {routeLabel(lastResponse)} · Model: {lastResponse.model}
              </p>
              {lastResponse.planner_model !== lastResponse.model && (
                <p className="mt-1">
                  Planner model: {lastResponse.planner_model}
                </p>
              )}
              {lastResponse.vision_enabled && lastResponse.used_vision_filenames.length > 0 && (
                <p className="mt-1 text-cyan-300">
                  Vision enabled for: {lastResponse.used_vision_filenames.join(', ')}
                </p>
              )}
              {lastResponse.audio_transcription_enabled && lastResponse.used_transcript_filenames.length > 0 && (
                <p className="mt-1 text-emerald-300">
                  Audio transcript used for: {lastResponse.used_transcript_filenames.join(', ')}
                </p>
              )}
              {lastResponse.multimodal_cache.cached_vision_filenames.length > 0 && (
                <p className="mt-1 text-cyan-400">
                  Reused cached frame manifests for: {lastResponse.multimodal_cache.cached_vision_filenames.join(', ')}
                </p>
              )}
              {lastResponse.multimodal_cache.generated_vision_filenames.length > 0 && (
                <p className="mt-1 text-cyan-200">
                  Generated new frame manifests for: {lastResponse.multimodal_cache.generated_vision_filenames.join(', ')}
                </p>
              )}
              {lastResponse.multimodal_cache.cached_transcript_filenames.length > 0 && (
                <p className="mt-1 text-emerald-400">
                  Reused cached transcripts for: {lastResponse.multimodal_cache.cached_transcript_filenames.join(', ')}
                </p>
              )}
              {lastResponse.multimodal_cache.generated_transcript_filenames.length > 0 && (
                <p className="mt-1 text-emerald-200">
                  Generated new transcripts for: {lastResponse.multimodal_cache.generated_transcript_filenames.join(', ')}
                </p>
              )}
              <p className="mt-1">
                Referenced docs: {lastResponse.referenced_documents.length} · Referenced artifacts:{' '}
                {lastResponse.referenced_artifacts.length}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
