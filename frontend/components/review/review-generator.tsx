'use client';

import { useEffect, useState } from 'react';
import { SparklesIcon, DocumentTextIcon, TrashIcon } from '@heroicons/react/24/outline';
import { deleteProjectDocument, executeTask, getConsensus, listAgentCatalog, listProjectDocuments, searchDocuments } from '@/lib/api';
import DocumentUpload from '@/components/upload/document-upload';
import type { AgentCatalogEntry, ProjectDocumentItem } from '@/lib/types';

const REVIEW_PROJECT_ID = 'default';

function formatDocumentSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FALLBACK_AGENTS = [
  { value: 'supervisor', label: 'Workflow Orchestrator', description: 'Coordinate evidence, drafting, and critique.' },
  { value: 'evidence_librarian', label: 'Evidence Librarian', description: 'Curate sources and the evidence set first.' },
  { value: 'report_writer', label: 'Report Writer', description: 'Draft structured scientific writing from evidence.' },
  { value: 'claim_auditor', label: 'Claim Auditor', description: 'Map claims to sources and find support gaps.' },
  { value: 'manuscript_critic', label: 'Manuscript Critic', description: 'Review writing quality, logic, and overclaiming.' },
  { value: 'reviewer_response_strategist', label: 'Reviewer Response Strategist', description: 'Plan point-by-point reviewer responses.' },
];

const MODELS = [
  // Google (direct API — configured)
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { value: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  // Free via OpenRouter
  { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)' },
  { value: 'qwen/qwen3-coder:free', label: 'Qwen 3 Coder (free)' },
  { value: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral Small 3.1 (free)' },
  { value: 'nousresearch/hermes-3-llama-3.1-405b:free', label: 'Hermes 3 405B (free)' },
  // Ollama (local)
  { value: 'ollama/llama3.2', label: 'Ollama: Llama 3.2' },
  { value: 'ollama/mistral', label: 'Ollama: Mistral' },
  { value: 'ollama/codellama', label: 'Ollama: CodeLlama' },
  { value: 'ollama/phi3', label: 'Ollama: Phi-3' },
];

export default function ReviewGenerator() {
  const [task, setTask] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('supervisor');
  const [agents, setAgents] = useState<AgentCatalogEntry[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>(['google/gemini-2.5-flash']);
  const [documents, setDocuments] = useState<ProjectDocumentItem[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [consensusMode, setConsensusMode] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [removingDocumentId, setRemovingDocumentId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const agentOptions = (
    agents.length > 0
      ? agents
          .filter((agent) => agent.is_active)
          .map((agent) => ({
            value: agent.name,
            label: agent.display_name,
            description: agent.description,
          }))
      : FALLBACK_AGENTS
  );
  const selectedAgentInfo = agentOptions.find((agent) => agent.value === selectedAgent) || FALLBACK_AGENTS[0];

  useEffect(() => {
    let mounted = true;

    async function loadAgents() {
      try {
        const response = await listAgentCatalog();
        if (mounted) {
          setAgents(response);
        }
      } catch {
        // Use fallback list silently.
      }
    }

    loadAgents();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!agentOptions.some((agent) => agent.value === selectedAgent)) {
      setSelectedAgent(agentOptions[0]?.value || 'supervisor');
    }
  }, [agentOptions, selectedAgent]);

  useEffect(() => {
    void loadDocuments();
  }, []);

  const selectedDocuments = documents.filter((entry) => selectedDocumentIds.includes(entry.id));

  const toggleModel = (modelValue: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelValue)
        ? prev.filter((m) => m !== modelValue)
        : [...prev, modelValue]
    );
  };

  const loadDocuments = async (preferredDocumentId?: string) => {
    setDocumentsLoading(true);
    try {
      const response = await listProjectDocuments(REVIEW_PROJECT_ID, { limit: 100 });
      setDocuments(response.documents);
      setDocumentsError(null);
      setSelectedDocumentIds((previous) => {
        const validIds = new Set(response.documents.map((entry) => entry.id));
        const retained = previous.filter((entry) => validIds.has(entry));
        if (preferredDocumentId && validIds.has(preferredDocumentId) && !retained.includes(preferredDocumentId)) {
          return [...retained, preferredDocumentId];
        }
        if (retained.length > 0 || response.documents.length === 0) {
          return retained;
        }
        return response.documents.map((entry) => entry.id);
      });
    } catch (err) {
      setDocumentsError(err instanceof Error ? err.message : 'Unable to load review documents');
    } finally {
      setDocumentsLoading(false);
    }
  };

  const handleUploadSuccess = async (documentId: string) => {
    await loadDocuments(documentId);
  };

  const toggleDocumentSelection = (documentId: string) => {
    setSelectedDocumentIds((previous) => (
      previous.includes(documentId)
        ? previous.filter((entry) => entry !== documentId)
        : [...previous, documentId]
    ));
  };

  const handleDeleteDocument = async (documentId: string) => {
    setRemovingDocumentId(documentId);
    try {
      await deleteProjectDocument(documentId);
      setDocuments((previous) => previous.filter((entry) => entry.id !== documentId));
      setSelectedDocumentIds((previous) => previous.filter((entry) => entry !== documentId));
      setDocumentsError(null);
    } catch (err) {
      setDocumentsError(err instanceof Error ? err.message : 'Unable to delete document');
    } finally {
      setRemovingDocumentId(null);
    }
  };

  const handleGenerate = async () => {
    if (!task.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const documentIds = selectedDocuments.map((entry) => entry.id);
      let matchedChunks = 0;
      let retrievalWarning: string | null = null;
      let runContext: Record<string, unknown> = {
        project_id: REVIEW_PROJECT_ID,
        uploaded_documents: selectedDocuments.map((entry) => ({
          documentId: entry.id,
          filename: entry.filename,
        })),
        document_ids: documentIds,
        uploaded_filenames: selectedDocuments.map((entry) => entry.filename),
      };

      if (documentIds.length > 0) {
        try {
          const response = await searchDocuments(task, REVIEW_PROJECT_ID, 12);
          const relevantResults = response.results
            .filter((entry) => documentIds.includes(entry.document_id))
            .slice(0, 6);

          if (relevantResults.length > 0) {
            const compiledContent = relevantResults
              .map((entry, index) => {
                const filename = typeof entry.metadata?.filename === 'string'
                  ? entry.metadata.filename
                  : `Document ${index + 1}`;
                return `[${filename}]\n${entry.content}`;
              })
              .join('\n\n---\n\n');

            matchedChunks = relevantResults.length;
            runContext = {
              ...runContext,
              content: compiledContent,
              draft_content: compiledContent,
              research_content: compiledContent,
              sources: relevantResults.map((entry) => ({
                document_id: entry.document_id,
                filename: entry.metadata?.filename,
                score: entry.score,
                excerpt: entry.content,
              })),
            };
          }
        } catch {
          retrievalWarning = 'Uploaded files were saved, but semantic retrieval was unavailable for this run.';
        }
      }

      if (consensusMode) {
        const response = await getConsensus(task, selectedModels, runContext);
        setResult(response.consensus);
        setMetadata({
          agreement_score: response.agreement_score,
          models_queried: Object.keys(response.responses).length,
          uploaded_documents: selectedDocuments.length,
          matched_document_chunks: matchedChunks,
          retrieval_warning: retrievalWarning,
        });
      } else {
        const response = await executeTask(task, runContext, selectedAgent);
        setResult(response.result);
        setMetadata({
          ...(response.metadata ?? {}),
          uploaded_documents: selectedDocuments.length,
          matched_document_chunks: matchedChunks,
          retrieval_warning: retrievalWarning,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Input Panel */}
      <div className="space-y-5">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-4 text-base font-semibold text-white">Writing Pass</h2>

          <div className="space-y-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <div className="mb-3">
                <p className="text-sm font-medium text-slate-200">Reference documents</p>
                <p className="mt-1 text-xs text-slate-500">
                  Upload a manuscript, reviewer letter, protocol, or notes. The writing agents will retrieve relevant excerpts from these files during the run.
                </p>
              </div>
              <DocumentUpload projectId={REVIEW_PROJECT_ID} onUploadSuccess={handleUploadSuccess} />
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Available review documents</p>
                  {selectedDocuments.length > 0 && (
                    <span className="text-xs text-cyan-300">{selectedDocuments.length} selected</span>
                  )}
                </div>
                {documentsLoading && <p className="text-xs text-slate-500">Loading documents...</p>}
                {!documentsLoading && documents.length === 0 && (
                  <p className="text-xs text-slate-500">No review documents uploaded yet.</p>
                )}
                {documentsError && (
                  <p className="mb-2 text-xs text-red-300">{documentsError}</p>
                )}
                <div className="space-y-2">
                  {documents.map((document) => {
                    const isSelected = selectedDocumentIds.includes(document.id);
                    return (
                      <div
                        key={document.id}
                        className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleDocumentSelection(document.id)}
                          aria-label={`Use ${document.filename} for this writing pass`}
                          title={`Use ${document.filename} for this writing pass`}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-600"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-200">{document.filename}</p>
                          <p className="text-xs text-slate-500">{formatDocumentSize(document.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDeleteDocument(document.id)}
                          disabled={removingDocumentId === document.id}
                          className="rounded-md border border-slate-700 p-1.5 text-slate-400 transition-colors hover:border-red-500/40 hover:text-red-300 disabled:opacity-50"
                          aria-label={`Delete ${document.filename}`}
                          title={`Delete ${document.filename}`}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Drafting or critique request
              </label>
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="e.g., Draft a results subsection, critique a reviewer response, or generate methods text linked to the experiment context..."
                rows={5}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Agent</label>
              <select
                title="Writing agent"
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                {agentOptions.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-slate-500">
                {selectedAgentInfo.description}
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-300">Review models</label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs text-slate-400">Reviewer Sweep</span>
                  <input
                    type="checkbox"
                    checked={consensusMode}
                    onChange={(e) => setConsensusMode(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-600"
                  />
                </label>
              </div>
              <div className="space-y-2">
                {MODELS.map((model) => (
                  <label key={model.value} className="flex items-center gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={selectedModels.includes(model.value)}
                      onChange={() => toggleModel(model.value)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-600"
                    />
                    <span className="text-sm text-slate-400 group-hover:text-slate-300 transition-colors">
                      {model.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !task.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <SparklesIcon className="h-4 w-4" />
                  Run Writing Pass
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Results Panel */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Draft & Critique Output</h2>
          {Object.keys(metadata).length > 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              {metadata.agreement_score !== undefined && (
                <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-400">
                  Agreement: {Math.round((metadata.agreement_score as number) * 100)}%
                </span>
              )}
              {typeof metadata.matched_document_chunks === 'number' && metadata.matched_document_chunks > 0 && (
                <span className="rounded-md bg-cyan-500/15 px-2 py-0.5 text-cyan-300">
                  Retrieved chunks: {metadata.matched_document_chunks as number}
                </span>
              )}
            </div>
          )}
        </div>

        {typeof metadata.retrieval_warning === 'string' && metadata.retrieval_warning && (
          <div className="mb-4 rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-200">
            {metadata.retrieval_warning}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <DocumentTextIcon className="mb-3 h-12 w-12 text-slate-700" />
            <p className="text-slate-500">Writing outputs will appear here</p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <svg className="h-8 w-8 animate-spin text-blue-400 mb-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-slate-400 text-sm">AI agents are drafting and reviewing your scientific text...</p>
          </div>
        )}

        {result && (
          <div className="prose prose-invert prose-sm max-w-none">
            <div className="max-h-[500px] overflow-y-auto rounded-lg bg-slate-800/50 p-4 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
              {result}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
