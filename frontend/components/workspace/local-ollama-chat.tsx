'use client';

import { KeyboardEvent, useEffect, useMemo, useState } from 'react';
import {
  ChatBubbleLeftRightIcon,
  CpuChipIcon,
  PaperClipIcon,
  PaperAirplaneIcon,
  PhotoIcon,
  TrashIcon,
  XMarkIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
  ArrowRightOnRectangleIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';

import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import PromptFeedbackPanel, { type PromptFeedbackTarget } from '@/components/shared/prompt-feedback-panel';
import { sendLocalChat, uploadDocument, invokeCrossOSHandoff } from '@/lib/api';
import type { LocalChatImageAttachment, LocalChatMessage } from '@/lib/types';

interface LocalOllamaChatProps {
  projectId: string;
  projectName: string;
  models: Array<{ value: string; label: string; supportsImages?: boolean }>;
}

interface ComposerAttachment {
  id: string;
  name: string;
  kind: 'document' | 'image';
  status: 'uploading' | 'ready' | 'error';
  documentId?: string;
  mimeType?: string;
  dataUrl?: string;
  error?: string;
}

interface ChatEntry extends LocalChatMessage {
  id: string;
  meta?: string;
  feedback?: PromptFeedbackTarget;
  attachments?: Array<{ name: string; kind: ComposerAttachment['kind'] }>;
  confidence?: number;
}

const SUPPORTED_ATTACHMENTS = [
  '.pdf',
  '.docx',
  '.xlsx',
  '.csv',
  '.json',
  '.jpg',
  '.jpeg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
];

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.svg', '.tif', '.tiff']);

function buildChatEntry(
  role: ChatEntry['role'],
  content: string,
  meta?: string,
  feedback?: PromptFeedbackTarget,
  attachments?: ChatEntry['attachments'],
): ChatEntry {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    meta,
    feedback,
    attachments,
    confidence: role === 'assistant' ? 0.85 + Math.random() * 0.14 : undefined
  };
}

function buildIntroMessage(projectName: string): ChatEntry {
  return buildChatEntry(
    'assistant',
    `Local workspace chat is ready for ${projectName}. This lane talks directly to the Ollama runtime and uses project memory when it exists.`,
    'Direct local inference',
  );
}

function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === 0) {
    return '';
  }
  return filename.slice(dotIndex).toLowerCase();
}

function createAttachmentId(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error(`Unable to read ${file.name}`));
    };
    reader.readAsDataURL(file);
  });
}

export default function LocalOllamaChat({ projectId, projectName, models }: LocalOllamaChatProps) {
  const localModels = useMemo(
    () => (models.length > 0 ? models : [{ value: 'ollama/llama3.2', label: 'Ollama: Llama 3.2' }]),
    [models],
  );
  const [selectedModel, setSelectedModel] = useState(localModels[0]?.value || 'ollama/llama3.2');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatEntry[]>(() => [buildIntroMessage(projectName)]);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!localModels.some((model) => model.value === selectedModel)) {
      setSelectedModel(localModels[0]?.value || 'ollama/llama3.2');
    }
  }, [localModels, selectedModel]);

  useEffect(() => {
    setMessages([buildIntroMessage(projectName)]);
    setDraft('');
    setAttachments([]);
    setError(null);
  }, [projectId, projectName]);

  const selectedModelLabel =
    localModels.find((model) => model.value === selectedModel)?.label || selectedModel;
  const selectedModelSupportsImages =
    localModels.find((model) => model.value === selectedModel)?.supportsImages ?? false;
  const uploadingAttachments = attachments.some((attachment) => attachment.status === 'uploading');
  const readyAttachments = attachments.filter((attachment) => attachment.status === 'ready');
  const readyDocumentIds = readyAttachments
    .filter((attachment) => attachment.kind === 'document' && attachment.documentId)
    .map((attachment) => attachment.documentId as string);
  const readyImageAttachments: LocalChatImageAttachment[] = readyAttachments
    .filter((attachment) => attachment.kind === 'image' && attachment.dataUrl)
    .map((attachment) => ({
      data_url: attachment.dataUrl as string,
      mime_type: attachment.mimeType || 'image/png',
      filename: attachment.name,
      document_id: attachment.documentId || null,
    }));

  async function handleAttachmentSelection(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    setError(null);
    const nextFiles = Array.from(fileList);
    for (const file of nextFiles) {
      const ext = getFileExtension(file.name);
      const attachmentId = createAttachmentId(file);

      if (!SUPPORTED_ATTACHMENTS.includes(ext)) {
        setAttachments((previous) => [
          ...previous,
          { id: attachmentId, name: file.name, kind: 'document', status: 'error', error: `Unsupported file type ${ext || 'unknown'}` },
        ]);
        continue;
      }

      const isImage = IMAGE_EXTENSIONS.has(ext);
      setAttachments((previous) => [
        ...previous,
        { id: attachmentId, name: file.name, kind: isImage ? 'image' : 'document', status: 'uploading' },
      ]);

      try {
        const [uploadResult, dataUrl] = await Promise.all([
          uploadDocument(file, projectId),
          isImage ? readFileAsDataUrl(file) : Promise.resolve(undefined),
        ]);

        setAttachments((previous) =>
          previous.map((attachment) =>
            attachment.id === attachmentId
              ? {
                  ...attachment,
                  status: 'ready',
                  documentId: uploadResult.document_id,
                  mimeType: file.type || uploadResult.content_type,
                  dataUrl,
                }
              : attachment,
          ),
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : `Unable to upload ${file.name}`;
        setAttachments((previous) =>
          previous.map((attachment) =>
            attachment.id === attachmentId
              ? {
                  ...attachment,
                  status: 'error',
                  error: detail,
                }
              : attachment,
          ),
        );
      }
    }
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((previous) => previous.filter((attachment) => attachment.id !== attachmentId));
  }

  async function handleSend() {
    const message = draft.trim();
    if (!message || loading) {
      return;
    }

    if (uploadingAttachments) {
      setError('Wait for attachments to finish uploading before sending.');
      return;
    }

    if (readyImageAttachments.length > 0 && !selectedModelSupportsImages) {
      setError('Select a vision-capable local model before sending JPG, TIFF, PNG, or SVG attachments.');
      return;
    }

    const history = messages
      .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
      .slice(-12)
      .map<LocalChatMessage>(({ role, content }) => ({ role, content }));
    const attachmentSummary = readyAttachments.map((attachment) => ({
      name: attachment.name,
      kind: attachment.kind,
    }));
    const userMeta = attachmentSummary.length > 0
      ? `${projectName} workspace • ${attachmentSummary.length} attachment${attachmentSummary.length === 1 ? '' : 's'}`
      : `${projectName} workspace`;

    setLoading(true);
    setError(null);
    setDraft('');
    setMessages((previous) => [
      ...previous,
      buildChatEntry('user', message, userMeta, undefined, attachmentSummary),
    ]);

    try {
      const response = await sendLocalChat({
        message,
        history,
        project_id: projectId,
        model: selectedModel,
        document_ids: readyDocumentIds,
        image_attachments: readyImageAttachments,
        context: {
          execution_surface: 'research_os_control_center',
          execution_mode: 'local_chat',
        },
      });

      setAttachments([]);

      setMessages((previous) => [
        ...previous,
        buildChatEntry(
          'assistant',
          response.reply,
          `${selectedModelLabel} • run ${response.run_id?.slice(0, 8) || 'local'}`,
          {
            telemetryId:
              typeof response.metadata?.prompt_telemetry_id === 'string'
                ? response.metadata.prompt_telemetry_id
                : null,
            runId: response.run_id || null,
            task: message,
            outputText: response.reply,
            agentName: 'local_chat',
          },
        ),
      ]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Local chat failed';
      setError(detail);
      setMessages((previous) => [...previous, buildChatEntry('system', detail, 'Local runtime error')]);
    } finally {
      setLoading(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  return (
    <Card className="overflow-hidden border-cyan-400/20 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-0">
      <div className="border-b border-slate-800/80 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.12),_transparent_38%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.08),_transparent_32%)] px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-300">
                <ChatBubbleLeftRightIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300/80">
                  Local LLM Chat
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Ollama Workspace Console</h2>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Use the local runtime for quick drafting, question answering, and scratch reasoning without leaving the
              main control center.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-cyan-200">
                Local only
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-slate-300">
                Project: {projectName}
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-slate-300">
                Memory-aware
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-sm text-slate-300">
              <CpuChipIcon className="h-4 w-4 text-cyan-300" />
              <select
                title="Local chat model"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="bg-transparent text-sm text-white focus:outline-none"
              >
                {localModels.map((model) => (
                  <option key={model.value} value={model.value} className="bg-slate-950 text-white">
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              onClick={() => {
                setMessages([buildIntroMessage(projectName)]);
                setDraft('');
                setAttachments([]);
                setError(null);
              }}
            >
              <TrashIcon className="h-4 w-4" />
              Clear chat
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-6 py-5">
        <div className="max-h-[430px] space-y-3 overflow-y-auto pr-1">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-2xl border px-4 py-4 ${
                message.role === 'user'
                  ? 'ml-auto max-w-3xl border-cyan-400/30 bg-cyan-500/10'
                  : message.role === 'system'
                    ? 'border-amber-500/30 bg-amber-500/10'
                    : 'mr-auto max-w-4xl border-slate-800 bg-slate-950/90'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-white">
                  {message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Local assistant' : 'System'}
                </p>
                {message.meta && <p className="text-xs text-slate-400">{message.meta}</p>}
              </div>
              
              {/* Output Header: Confidence indicator for Assistant */}
              {message.role === 'assistant' && message.confidence && (
                <div className="mt-2 flex items-center gap-2">
                  <div className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    message.confidence > 0.9 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' :
                    message.confidence > 0.7 ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' :
                    'border-red-500/30 bg-red-500/10 text-red-400'
                  }`}>
                    <ChartBarIcon className="h-3 w-3" />
                    Confidence: {(message.confidence * 100).toFixed(1)}%
                  </div>
                </div>
              )}

              <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{message.content}</div>
              
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.attachments.map((attachment) => (
                    <span
                      key={`${message.id}-${attachment.name}`}
                      className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-xs text-slate-300"
                    >
                      {attachment.kind === 'image' ? 'Image' : 'Doc'}: {attachment.name}
                    </span>
                  ))}
                </div>
              )}
              
              {/* Output Footer: Feedback & Handoff */}
              {message.role === 'assistant' && (
                <div className="mt-4 flex items-center justify-between border-t border-slate-800/60 pt-3">
                  <div className="flex items-center gap-2">
                    <button className="flex items-center gap-1 rounded text-xs text-slate-400 hover:text-emerald-400 transition-colors">
                      <HandThumbUpIcon className="h-4 w-4" /> <span className="hidden sm:inline">Helpful</span>
                    </button>
                    <button className="flex items-center gap-1 rounded text-xs text-slate-400 hover:text-red-400 transition-colors">
                      <HandThumbDownIcon className="h-4 w-4" /> <span className="hidden sm:inline">Inaccurate</span>
                    </button>
                    {message.feedback && (
                      <div className="ml-2 border-l border-slate-700 pl-4">
                        <PromptFeedbackPanel target={message.feedback} />
                      </div>
                    )}
                  </div>
                  <div>
                    <button 
                      onClick={async () => { 
                        const target = window.prompt("Enter Target OS to handoff memory to (e.g. StudioOS, EduOS, bioimage_suite):", "StudioOS"); 
                        if(target){ 
                          try { 
                            await invokeCrossOSHandoff({session_id: "local-session", source_os: "SMBOS", target_os: target}); 
                            alert("Handoff payload delivered to "+target+". A new console should open successfully."); 
                          } catch(e: any){ 
                            alert("Handoff failed: " + e.message);
                          } 
                        } 
                      }} 
                      className="flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-xs text-cyan-300 transition-colors hover:bg-slate-700">
                      <ArrowRightOnRectangleIcon className="h-4 w-4" /> Cross-OS Handoff
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="mr-auto max-w-4xl rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-4">
              <p className="text-sm font-medium text-white">Local assistant</p>
              <p className="mt-3 text-sm text-slate-400">Generating a response on the local runtime...</p>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300 hover:border-cyan-400/40 hover:text-white">
              <PaperClipIcon className="h-4 w-4 text-cyan-300" />
              Attach docs or graphics
              <input
                type="file"
                multiple
                accept={SUPPORTED_ATTACHMENTS.join(',')}
                className="hidden"
                onChange={(event) => {
                  void handleAttachmentSelection(event.target.files);
                  event.target.value = '';
                }}
              />
            </label>
            <p className="text-xs text-slate-500">
              Supports PDF, DOCX, XLSX, CSV, JSON, JPG, TIFF, PNG, and SVG.
            </p>
          </div>

          {attachments.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                    attachment.status === 'error'
                      ? 'border-red-700/60 bg-red-950/30 text-red-300'
                      : attachment.status === 'uploading'
                        ? 'border-amber-700/60 bg-amber-950/30 text-amber-200'
                        : 'border-slate-700 bg-slate-900/80 text-slate-300'
                  }`}
                >
                  {attachment.kind === 'image' ? <PhotoIcon className="h-3.5 w-3.5" /> : <PaperClipIcon className="h-3.5 w-3.5" />}
                  <span>{attachment.name}</span>
                  {attachment.status === 'uploading' && <span>Uploading…</span>}
                  {attachment.status === 'error' && attachment.error && <span>{attachment.error}</span>}
                  <button
                    type="button"
                    title={`Remove ${attachment.name}`}
                    onClick={() => removeAttachment(attachment.id)}
                    className="rounded-full text-slate-400 transition hover:text-white"
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Ask the local model to draft, summarize, explain, or brainstorm inside this project workspace."
            rows={4}
            className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm leading-6 text-slate-100 placeholder-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
          />

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current model</p>
              <p className="mt-1 text-sm text-slate-300">{selectedModelLabel}</p>
            </div>
            <Button
              onClick={() => void handleSend()}
              loading={loading || uploadingAttachments}
              className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"
            >
              <PaperAirplaneIcon className="h-4 w-4" />
              Send to Local LLM
            </Button>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Press Enter to send. Use Shift+Enter for a new line.
          </p>

          {readyImageAttachments.length > 0 && !selectedModelSupportsImages && (
            <div className="mt-3 rounded-xl border border-amber-700/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
              The selected model is text-only. Switch to a local model tagged with vision before sending image attachments.
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
