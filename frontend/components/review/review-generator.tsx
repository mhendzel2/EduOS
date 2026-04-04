'use client';

import { useEffect, useMemo, useState } from 'react';
import { SparklesIcon, DocumentTextIcon, TrashIcon, ArrowDownTrayIcon, ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline';
import { deleteProjectDocument, executeTask, executeDocumentReview, exportDocx, getConsensus, listAgentCatalog, listProjectDocuments, searchDocuments } from '@/lib/api';
import DocumentUpload from '@/components/upload/document-upload';
import { useModelDirectory } from '@/lib/model-directory';
import PromptRefiner from '@/components/shared/prompt-refiner';
import type { AgentCatalogEntry, ProjectDocumentItem } from '@/lib/types';
import type { DeepResearchStructuredCritique } from '@/lib/api';

function formatDocumentSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function asStructuredCritique(value: unknown): DeepResearchStructuredCritique | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as DeepResearchStructuredCritique;
}

function StructuredCritiqueView({ critique }: { critique: DeepResearchStructuredCritique }) {
  const sections: Array<{ title: string; items: string[] }> = [
    {
      title: 'Major Flaws',
      items: (critique.major_flaws || []).map((item) => `${item.claim}${item.citation_tokens?.length ? ` (${item.citation_tokens.join(', ')})` : ''}`),
    },
    {
      title: 'Minor Flaws',
      items: (critique.minor_flaws || []).map((item) => `${item.claim}${item.citation_tokens?.length ? ` (${item.citation_tokens.join(', ')})` : ''}`),
    },
    {
      title: 'Missing Controls',
      items: (critique.missing_controls || []).map((item) => `${item.claim}${item.citation_tokens?.length ? ` (${item.citation_tokens.join(', ')})` : ''}`),
    },
    {
      title: 'Revision Priorities',
      items: (critique.revision_priorities || []).map((item) => String(item)),
    },
    {
      title: 'Strengths',
      items: (critique.strengths || []).map((item) => String(item)),
    },
  ].filter((section) => section.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs text-slate-300">
        {typeof critique.score === 'number' && (
          <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-amber-300">Score: {critique.score.toFixed(2)}</span>
        )}
        {critique.overall_readiness && (
          <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-rose-300">Readiness: {critique.overall_readiness}</span>
        )}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {sections.map((section) => (
          <div key={section.title} className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
            <h3 className="text-sm font-semibold text-white">{section.title}</h3>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-300">
              {section.items.map((item) => (
                <li key={`${section.title}-${item}`} className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

const FALLBACK_AGENTS = [
  { value: 'supervisor', label: 'Workflow Orchestrator', description: 'Coordinate evidence, drafting, and critique.' },
  { value: 'evidence_librarian', label: 'Evidence Librarian', description: 'Curate sources and the evidence set first.' },
  { value: 'report_writer', label: 'Report Writer', description: 'Draft structured scientific writing from evidence.' },
  { value: 'claim_auditor', label: 'Claim Auditor', description: 'Map claims to sources and find support gaps.' },
  { value: 'manuscript_critic', label: 'Manuscript Critic', description: 'Review writing quality, logic, and overclaiming.' },
  { value: 'reviewer_response_strategist', label: 'Reviewer Response Strategist', description: 'Plan point-by-point reviewer responses.' },
];

function buildManuscriptReviewTemplate(documentNames: string[]): string {
  const documentBlock = documentNames.length > 0
    ? documentNames.map((name) => `- ${name}`).join('\n')
    : '- [Select the uploaded manuscript document]';

  return [
    'Perform a structured manuscript analysis on the uploaded draft.',
    '',
    'Documents under review:',
    documentBlock,
    '',
    'Review scope:',
    '- Evaluate scientific logic, evidentiary support, and overclaiming.',
    '- Flag missing controls, missing caveats, and methodological weaknesses.',
    '- Assess novelty framing, clarity of claims, and section-level rewrite priorities.',
    '- Focus on what would materially affect reviewer reception or publication readiness.',
    '',
    'Structured review requirements:',
    '1. Major flaws',
    '2. Minor flaws',
    '3. Missing controls',
    '4. Major strengths',
    '5. Highest-value revision priorities',
    '6. Publication readiness assessment',
    '',
    'Additional context to fill in before running:',
    '- Target journal or audience: [fill in]',
    '- Manuscript type: [original research | review | methods | grant-like narrative]',
    '- Sections requiring extra scrutiny: [fill in]',
    '- Reviewer comments already received: [optional]',
    '- Claims or figures you are least confident about: [optional]',
    '',
    'Use the uploaded manuscript as the primary draft under review.',
  ].join('\n');
}

export default function ReviewGenerator({ projectId }: { projectId?: string }) {
  const reviewProjectId = projectId ?? 'default';
  const [task, setTask] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('supervisor');
  const [agents, setAgents] = useState<AgentCatalogEntry[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>(['google/gemini-2.5-flash']);
  const [modelSearch, setModelSearch] = useState('');
  const [documents, setDocuments] = useState<ProjectDocumentItem[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [consensusMode, setConsensusMode] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [modelResponses, setModelResponses] = useState<Record<string, string>>({});
  const [activeView, setActiveView] = useState<string>('consensus');
  const [refinerOpen, setRefinerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [outputLevel, setOutputLevel] = useState<'CRITIQUE_ONLY' | 'DEVELOPMENTAL_EDIT' | 'FULL_POLISH'>('FULL_POLISH');
  const [critiqueFilePath, setCritiqueFilePath] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [removingDocumentId, setRemovingDocumentId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const [exportingDocx, setExportingDocx] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const { modelGroups, loading: modelsLoading, refreshing: modelsRefreshing, refreshCatalog, openrouterConfigured } = useModelDirectory();
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
  const isManuscriptReviewMode = selectedAgent === 'manuscript_critic';

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
  }, [reviewProjectId]);

  useEffect(() => {
    const availableModels = new Set(modelGroups.flatMap((group) => group.options.map((option) => option.value)));
    if (availableModels.size === 0) {
      return;
    }
    setSelectedModels((previous) => {
      const retained = previous.filter((model) => availableModels.has(model));
      if (retained.length > 0) {
        return retained;
      }
      const preferred = ['google/gemini-2.5-flash'].filter((model) => availableModels.has(model));
      if (preferred.length > 0) {
        return preferred;
      }
      const fallback = modelGroups.flatMap((group) => group.options.map((option) => option.value))[0];
      return fallback ? [fallback] : retained;
    });
  }, [modelGroups]);

  const selectedDocuments = documents.filter((entry) => selectedDocumentIds.includes(entry.id));
  const filteredModelGroups = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) {
      return modelGroups;
    }
    return modelGroups
      .map((group) => ({
        ...group,
        options: group.options.filter((option) =>
          `${option.label} ${option.value} ${option.meta}`.toLowerCase().includes(query)
        ),
      }))
      .filter((group) => group.options.length > 0);
  }, [modelGroups, modelSearch]);

  const toggleModel = (modelValue: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelValue)
        ? prev.filter((m) => m !== modelValue)
        : [...prev, modelValue]
    );
  };

  async function handleExportDocx() {
    const content = activeView === 'consensus' ? result : (modelResponses[activeView] ?? '');
    if (!content) return;

    setExportingDocx(true);
    try {
      const title = task.trim().slice(0, 60) || 'Writing Studio Output';
      const res = await exportDocx({ title, content });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title.replace(/[^a-z0-9]+/gi, '_')}.docx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore export errors
    } finally {
      setExportingDocx(false);
    }
  }

  async function handleCopyText() {
    const content = activeView === 'consensus' ? result : (modelResponses[activeView] ?? '');
    if (!content) return;

    try {
      await navigator.clipboard.writeText(content);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // silently ignore clipboard errors
    }
  }

  const loadDocuments = async (preferredDocumentId?: string) => {
    setDocumentsLoading(true);
    try {
      const response = await listProjectDocuments(reviewProjectId, { limit: 100 });
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
    if (isManuscriptReviewMode && selectedDocuments.length === 0) {
      setError('Upload and select at least one manuscript document before running structured manuscript analysis.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setMetadata({});  // clear previous run's metadata so stale badges don't bleed through
    setModelResponses({});
    setActiveView('consensus');

    // Race the API call against a 10-minute timeout so the spinner never
    // hangs indefinitely when the backend LLM calls are slow.
    const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) =>
          setTimeout(
            () => reject(new Error('The request timed out after 10 minutes. The server may still be processing — check back later or try a shorter task.')),
            10 * 60 * 1000,
          )
        ),
      ]);

    try {
      const documentIds = selectedDocuments.map((entry) => entry.id);
      let matchedChunks = 0;
      let retrievalWarning: string | null = null;
      let runContext: Record<string, unknown> = {
        project_id: reviewProjectId,
        uploaded_documents: selectedDocuments.map((entry) => ({
          documentId: entry.id,
          filename: entry.filename,
        })),
        document_ids: documentIds,
        uploaded_filenames: selectedDocuments.map((entry) => entry.filename),
      };

      if (documentIds.length > 0) {
        try {
          const response = await searchDocuments(task, reviewProjectId, 12);
          const relevantResults = response.results
            .filter((entry) => documentIds.includes(entry.document_id))
            .slice(0, 6);

          if (relevantResults.length > 0) {
            const compiledContent = relevantResults
              .map((entry, index) => {
                const filename = typeof entry.metadata?.filename === 'string'
                  ? entry.metadata.filename
                  : `Document ${index + 1}`;
                // Carry the EndNote temporary citation token into the chunk header so
                // every retrieved chunk — not just the first — exposes the cite token
                // to the writing agent, regardless of which text chunk was matched.
                const cite = typeof entry.metadata?.endnote_temp_cite === 'string'
                  ? entry.metadata.endnote_temp_cite
                  : null;
                const header = cite
                  ? `[${filename} | Preferred citation: ${cite}]`
                  : `[${filename}]`;
                return `${header}\n${entry.content}`;
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
                // Pass full bibliographic metadata so backend agents can build
                // structured citations from format_source_list_for_prompt().
                endnote_temp_cite: entry.metadata?.endnote_temp_cite,
                title: entry.metadata?.title,
                year: entry.metadata?.year,
                doi: entry.metadata?.doi,
                pmid: entry.metadata?.pmid,
                journal: entry.metadata?.journal,
                authors_display: entry.metadata?.authors_display,
              })),
            };
          }
        } catch {
          retrievalWarning = 'Uploaded files were saved, but semantic retrieval was unavailable for this run.';
        }
      }

      if (consensusMode) {
        const response = await withTimeout(getConsensus(task, selectedModels, runContext));
        setResult(response.consensus);
        setModelResponses(response.responses);
        setMetadata({
          agreement_score: response.agreement_score,
          models_queried: Object.keys(response.responses).length,
          uploaded_documents: selectedDocuments.length,
          matched_document_chunks: matchedChunks,
          retrieval_warning: retrievalWarning,
        });
      } else if (isManuscriptReviewMode) {
        const docName = selectedDocuments[0]?.filename || "draft.pdf";
        const response = await withTimeout(executeDocumentReview({
            pdf_path: `uploads/${docName}`,
            doc_type: "MANUSCRIPT",
            output_level: outputLevel,
            critique_file: critiqueFilePath || undefined
        }));
        setResult(response.message || "Document successfully parsed and processed.");
        setMetadata({
          retrieval_warning: `Pipeline completed: ${outputLevel}`,
        });
      } else {
        const response = await withTimeout(executeTask(task, runContext, selectedAgent));
        setResult(response.result);
        const nextMetadata = {
          ...(response.metadata ?? {}),
          uploaded_documents: selectedDocuments.length,
          matched_document_chunks: matchedChunks,
          retrieval_warning: retrievalWarning,
        };
        setMetadata(nextMetadata);
        if (selectedAgent === 'manuscript_critic' && asStructuredCritique(nextMetadata.structured_critique)) {
          setActiveView('structured_analysis');
        }
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
                <p className="text-sm font-medium text-slate-200">
                  {isManuscriptReviewMode ? 'Manuscript Under Review' : 'Reference Documents'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {isManuscriptReviewMode
                    ? 'Upload the manuscript draft, reviewer letter, or supporting notes. Structured manuscript analysis will use the selected files as the primary review source.'
                    : 'Upload a manuscript, reviewer letter, protocol, or notes. The writing agents will retrieve relevant excerpts from these files during the run.'}
                </p>
              </div>
              <DocumentUpload projectId={reviewProjectId} onUploadSuccess={handleUploadSuccess} />
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {isManuscriptReviewMode ? 'Selected manuscript files' : 'Available review documents'}
                  </p>
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
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-300">
                  {isManuscriptReviewMode ? 'Structured manuscript review request' : 'Drafting or critique request'}
                </label>
                <div className="flex items-center gap-2">
                  {isManuscriptReviewMode && (
                    <button
                      type="button"
                      onClick={() => setTask(buildManuscriptReviewTemplate(selectedDocuments.map((entry) => entry.filename)))}
                      className="rounded-md border border-emerald-700/60 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition-colors hover:border-emerald-500 hover:text-emerald-200"
                      title="Insert a structured manuscript review template"
                    >
                      Use Review Template
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRefinerOpen(true)}
                    disabled={!task.trim()}
                    title="Use local AI to refine your prompt with targeted clarifying questions"
                    className="flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:border-blue-500/60 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                    </svg>
                    Refine prompt
                  </button>
                </div>
              </div>
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder={isManuscriptReviewMode
                  ? 'Use the structured review template, then fill in journal, section focus, and reviewer context before running manuscript analysis...'
                  : 'e.g., Draft a results subsection, critique a reviewer response, or generate methods text linked to the experiment context...'}
                rows={5}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />
              {isManuscriptReviewMode && (
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  The review template sets the expected structure, but the uploaded manuscript files remain the primary material being analyzed.
                </p>
              )}
            </div>

            {refinerOpen && (
              <PromptRefiner
                initialPrompt={task}
                taskType={selectedAgent === 'report_writer' || selectedAgent === 'supervisor' ? 'grant' : 'manuscript'}
                onAccept={(refined) => setTask(refined)}
                onClose={() => setRefinerOpen(false)}
              />
            )}

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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void refreshCatalog()}
                    disabled={modelsRefreshing}
                    className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    {modelsRefreshing ? 'Refreshing…' : 'Refresh models'}
                  </button>
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
              </div>

              <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <input
                    type="text"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="Search local and OpenRouter models"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none sm:max-w-sm"
                  />
                  <span className="text-[11px] text-slate-500">
                    {openrouterConfigured
                      ? 'Paid OpenRouter models are available in this list.'
                      : 'Set the OpenRouter key in Settings to run paid catalog models.'}
                  </span>
                </div>

                <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                  {modelsLoading ? (
                    <p className="text-sm text-slate-500">Loading model catalog…</p>
                  ) : filteredModelGroups.length > 0 ? (
                    filteredModelGroups.map((group) => (
                      <div key={group.key}>
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          {group.label}
                        </p>
                        <div className="space-y-2">
                          {group.options.map((model) => (
                            <label key={model.value} className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2.5 hover:border-slate-700">
                              <input
                                type="checkbox"
                                checked={selectedModels.includes(model.value)}
                                onChange={() => toggleModel(model.value)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-700 text-blue-600"
                              />
                              <span className="min-w-0">
                                <span className="block text-sm text-slate-300">{model.label}</span>
                                <span className="mt-0.5 block text-[11px] text-slate-500">
                                  {model.value}{model.meta ? ` • ${model.meta}` : ''}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No models matched the current search.</p>
                  )}
                </div>
              </div>
            </div>

            {isManuscriptReviewMode && (
              <div className="mb-4 space-y-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
                  <label className="text-sm font-medium text-slate-300">Processing Pipeline Output Level</label>
                  <select 
                      value={outputLevel} 
                      onChange={(e) => setOutputLevel(e.target.value as any)} 
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  >
                      <option value="CRITIQUE_ONLY">Critique Only (Fast / Extremely Cheap)</option>
                      <option value="DEVELOPMENTAL_EDIT">Developmental Edit (Structure Mapping)</option>
                      <option value="FULL_POLISH">Full Polish (Line-by-Line Claude 4.6 Rewrite)</option>
                  </select>
                  
                  <label className="mt-3 block text-sm font-medium text-slate-300">Resume from existing JSON Critique? (Optional)</label>
                  <input 
                        type="text" 
                        value={critiqueFilePath} 
                        onChange={(e) => setCritiqueFilePath(e.target.value)} 
                        placeholder="Path to prior review .json to bypass Phase 1..." 
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
              </div>
            )}

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
                  {isManuscriptReviewMode ? 'Run Manuscript Review' : 'Run Writing Pass'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Results Panel */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Draft & Manuscript Analysis</h2>
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

        {result != null && (() => {
          const modelKeys = Object.keys(modelResponses);
          const displayedContent = activeView === 'consensus' ? result : (modelResponses[activeView] ?? '');
          const structuredCritique = asStructuredCritique(metadata.structured_critique);
          return (
            <div className="prose prose-invert prose-sm max-w-none">
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {structuredCritique && (
                  <button
                    type="button"
                    onClick={() => setActiveView('structured_analysis')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      activeView === 'structured_analysis'
                        ? 'bg-blue-600 text-white'
                        : 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Structured Manuscript Analysis
                  </button>
                )}
                {modelKeys.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveView('consensus')}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        activeView === 'consensus'
                          ? 'bg-blue-600 text-white'
                          : 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      Consensus Draft
                    </button>
                    {modelKeys.map((modelKey) => {
                      const shortLabel = modelKey.includes('/') ? modelKey.split('/').pop()! : modelKey;
                      return (
                        <button
                          key={modelKey}
                          type="button"
                          onClick={() => setActiveView(modelKey)}
                          title={modelKey}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                            activeView === modelKey
                              ? 'bg-blue-600 text-white'
                              : 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {shortLabel}
                        </button>
                      );
                    })}
                    <span className="mx-1 text-slate-700">|</span>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleExportDocx}
                  disabled={exportingDocx || !displayedContent}
                  title="Export as Word document"
                  className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                  <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                  {exportingDocx ? 'Exporting…' : 'Export DOCX'}
                </button>
                <button
                  type="button"
                  onClick={handleCopyText}
                  disabled={!displayedContent}
                  title="Copy to clipboard"
                  className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                  {copySuccess ? (
                    <><CheckIcon className="h-3.5 w-3.5 text-emerald-400" />Copied</>
                  ) : (
                    <><ClipboardDocumentIcon className="h-3.5 w-3.5" />Copy</>
                  )}
                </button>
              </div>
              <div className="max-h-[500px] overflow-y-auto rounded-lg bg-slate-800/50 p-4 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                {activeView === 'structured_analysis' && structuredCritique ? (
                  <StructuredCritiqueView critique={structuredCritique} />
                ) : displayedContent ? (
                  displayedContent
                ) : (
                  <p className="italic text-slate-500">The agents completed their pass but returned no text output. Check the error logs or try again.</p>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
