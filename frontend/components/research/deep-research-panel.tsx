'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  compileDeepResearchPrompt,
  deepResearch,
  getDeepResearchPrompt,
  listDeepResearchPrompts,
  reingestExternalDeepResearchReport,
  searchPubMed,
  searchAcademic,
  ragQuery,
  reuseDeepResearchPrompt,
  updateDeepResearchPrompt,
  exportDocx,
  exportPptx,
  exportXlsx,
  type DeepResearchOffloadIngestResponse,
  type DeepResearchPrompt,
  type DeepResearchPromptCompileResponse,
  type DeepResearchResult,
  type PubMedSearchResult,
  type AcademicResult,
  type RAGAnswer,
} from '@/lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type Tab = 'research' | 'offload' | 'search' | 'rag';
type ReportType =
  | 'research_report'
  | 'literature_review'
  | 'systematic_review'
  | 'grant_narrative'
  | 'brief_summary';
type EvidenceMode = 'abstracts' | 'web' | 'pdf';
type PromptRating = '' | '1' | '2' | '3' | '4' | '5';

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'research_report', label: 'Research Report' },
  { value: 'literature_review', label: 'Literature Review' },
  { value: 'systematic_review', label: 'Systematic Review' },
  { value: 'grant_narrative', label: 'Grant Narrative' },
  { value: 'brief_summary', label: 'Brief Summary' },
];

const SEARCH_SOURCES = [
  { id: 'semantic_scholar', label: 'Semantic Scholar' },
  { id: 'europe_pmc', label: 'Europe PMC' },
  { id: 'openalex', label: 'OpenAlex' },
];

const EVIDENCE_MODES: { value: EvidenceMode; label: string; note: string }[] = [
  {
    value: 'abstracts',
    label: 'Abstracts Only',
    note: 'Fastest mode. Reviews abstracts and metadata without downloading local files.',
  },
  {
    value: 'web',
    label: 'Live Web Pages',
    note: 'Uses article landing pages through the browser service without local PDF storage.',
  },
  {
    value: 'pdf',
    label: 'Full PDFs',
    note: 'Attempts full-PDF review first and falls back to abstracts when full text is unavailable.',
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatLines(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }
  return value.map((item) => String(item)).join('\n');
}

async function copyText(text: string) {
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Ignore clipboard failures; the text remains visible in the panel.
  }
}

function getContextString(record: DeepResearchPrompt | null, key: string): string {
  if (!record) return '';
  return String(record.biological_context?.[key] ?? '');
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function DeepResearchPanel() {
  const [tab, setTab] = useState<Tab>('research');

  // Research form
  const [topic, setTopic] = useState('');
  const [maxPapers, setMaxPapers] = useState(30);
  const [reportType, setReportType] = useState<ReportType>('research_report');
  const [evidenceMode, setEvidenceMode] = useState<EvidenceMode>('abstracts');
  const [persistEvidenceToRag, setPersistEvidenceToRag] = useState(false);
  const [useRag, setUseRag] = useState(true);
  const [saveToRag, setSaveToRag] = useState(true);

  // Search form
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSource, setSearchSource] = useState<'pubmed' | 'academic'>('pubmed');
  const [enabledSources, setEnabledSources] = useState<string[]>([
    'semantic_scholar',
    'europe_pmc',
    'openalex',
  ]);

  // RAG form
  const [ragQuestion, setRagQuestion] = useState('');

  // External deep research offload
  const [promptTitle, setPromptTitle] = useState('');
  const [promptDescription, setPromptDescription] = useState('');
  const [epistemicBaseline, setEpistemicBaseline] = useState('');
  const [targetGap, setTargetGap] = useState('');
  const [exclusionCriteriaText, setExclusionCriteriaText] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');
  const [promptTagsText, setPromptTagsText] = useState('');
  const [savePrompt, setSavePrompt] = useState(true);
  const [writePromptToFile, setWritePromptToFile] = useState(false);
  const [saveAsNewPrompt, setSaveAsNewPrompt] = useState(true);
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [promptQualityRating, setPromptQualityRating] = useState<PromptRating>('');
  const [promptEffectivenessNotes, setPromptEffectivenessNotes] = useState('');
  const [externalReportText, setExternalReportText] = useState('');

  // Results
  const [activeAction, setActiveAction] = useState('');
  const [promptLibraryLoading, setPromptLibraryLoading] = useState(false);
  const [promptLibraryLoaded, setPromptLibraryLoaded] = useState(false);
  const [error, setError] = useState('');
  const [researchResult, setResearchResult] = useState<DeepResearchResult | null>(null);
  const [pubmedResult, setPubmedResult] = useState<PubMedSearchResult | null>(null);
  const [academicResult, setAcademicResult] = useState<AcademicResult | null>(null);
  const [ragResult, setRagResult] = useState<RAGAnswer | null>(null);
  const [promptLibrary, setPromptLibrary] = useState<DeepResearchPrompt[]>([]);
  const [compiledPromptResult, setCompiledPromptResult] = useState<DeepResearchPromptCompileResponse | null>(null);
  const [offloadResult, setOffloadResult] = useState<DeepResearchOffloadIngestResponse | null>(null);

  const loading = activeAction.length > 0;
  const selectedPrompt = useMemo(
    () => promptLibrary.find((record) => record.id === selectedPromptId) ?? null,
    [promptLibrary, selectedPromptId],
  );

  const hydratePromptForm = useCallback((prompt: DeepResearchPrompt | null) => {
    if (!prompt) {
      setPromptTitle('');
      setPromptDescription('');
      setEpistemicBaseline('');
      setTargetGap('');
      setExclusionCriteriaText('');
      setAdditionalContext('');
      setPromptTagsText('');
      setPromptQualityRating('');
      setPromptEffectivenessNotes('');
      return;
    }

    setPromptTitle(prompt.title);
    setPromptDescription(prompt.description);
    setEpistemicBaseline(getContextString(prompt, 'epistemic_baseline'));
    setTargetGap(getContextString(prompt, 'target_gap'));
    setExclusionCriteriaText(formatLines(prompt.biological_context?.exclusion_criteria));
    setAdditionalContext(getContextString(prompt, 'additional_context'));
    setPromptTagsText(prompt.tags.join('\n'));
    setPromptQualityRating(prompt.quality_rating ? String(prompt.quality_rating) as PromptRating : '');
    setPromptEffectivenessNotes(prompt.effectiveness_notes ?? '');
    setCompiledPromptResult({
      prompt: prompt.prompt_text,
      compiled_path: null,
      saved_prompt: prompt,
      biological_context: prompt.biological_context,
    });
  }, []);

  const refreshPromptLibrary = useCallback(async () => {
    setPromptLibraryLoading(true);
    try {
      const prompts = await listDeepResearchPrompts({ limit: 100 });
      setPromptLibrary(prompts);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load saved prompts');
    } finally {
      setPromptLibraryLoading(false);
      setPromptLibraryLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (tab === 'offload' && !promptLibraryLoaded) {
      void refreshPromptLibrary();
    }
  }, [tab, promptLibraryLoaded, refreshPromptLibrary]);

  useEffect(() => {
    if (selectedPrompt) {
      setPromptQualityRating(selectedPrompt.quality_rating ? String(selectedPrompt.quality_rating) as PromptRating : '');
      setPromptEffectivenessNotes(selectedPrompt.effectiveness_notes ?? '');
    }
  }, [selectedPrompt]);

  // ---- Handlers ----
  const runDeepResearch = useCallback(async () => {
    if (!topic.trim()) return;
    setActiveAction('deep_research');
    setError('');
    setResearchResult(null);
    try {
      const result = await deepResearch({
        topic,
        max_papers: maxPapers,
        download_pdfs: evidenceMode === 'pdf',
        evidence_mode: evidenceMode,
        persist_evidence_to_rag: persistEvidenceToRag,
        use_rag: useRag,
        save_to_rag: saveToRag,
        report_type: reportType,
        sources: ['pubmed', ...enabledSources],
      });
      setResearchResult(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Research failed');
    } finally {
      setActiveAction('');
    }
  }, [topic, maxPapers, evidenceMode, persistEvidenceToRag, useRag, saveToRag, reportType, enabledSources]);

  const runSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setActiveAction('search');
    setError('');
    setPubmedResult(null);
    setAcademicResult(null);
    try {
      if (searchSource === 'pubmed') {
        const result = await searchPubMed({ query: searchQuery, max_results: maxPapers });
        setPubmedResult(result);
      } else {
        const result = await searchAcademic({ query: searchQuery, max_results: maxPapers, sources: enabledSources });
        setAcademicResult(result);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setActiveAction('');
    }
  }, [searchQuery, searchSource, maxPapers, enabledSources]);

  const runRag = useCallback(async () => {
    if (!ragQuestion.trim()) return;
    setActiveAction('rag');
    setError('');
    setRagResult(null);
    try {
      const result = await ragQuery({ question: ragQuestion });
      setRagResult(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'RAG query failed');
    } finally {
      setActiveAction('');
    }
  }, [ragQuestion]);

  const selectPrompt = useCallback(async (promptId: string) => {
    setError('');
    if (!promptId) {
      setSelectedPromptId('');
      hydratePromptForm(null);
      return;
    }

    setActiveAction('select_prompt');
    try {
      const prompt = await getDeepResearchPrompt(promptId);
      setSelectedPromptId(prompt.id);
      setPromptLibrary((prev) => {
        const next = prev.filter((record) => record.id !== prompt.id);
        return [prompt, ...next];
      });
      hydratePromptForm(prompt);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load saved prompt');
    } finally {
      setActiveAction('');
    }
  }, [hydratePromptForm]);

  const compileOrReusePrompt = useCallback(async () => {
    if (!epistemicBaseline.trim() || !targetGap.trim()) {
      return;
    }

    setActiveAction('compile_prompt');
    setError('');
    setCompiledPromptResult(null);
    try {
      const tags = parseLines(promptTagsText);
      const exclusionCriteria = parseLines(exclusionCriteriaText);
      const response = selectedPromptId
        ? await reuseDeepResearchPrompt(selectedPromptId, {
            title: promptTitle.trim() || undefined,
            description: promptDescription.trim() || undefined,
            epistemic_baseline: epistemicBaseline.trim(),
            target_gap: targetGap.trim(),
            exclusion_criteria: exclusionCriteria,
            additional_context: additionalContext.trim(),
            tags,
            save_as_new: saveAsNewPrompt,
            write_to_file: writePromptToFile,
          })
        : await compileDeepResearchPrompt({
            title: promptTitle.trim() || undefined,
            description: promptDescription.trim(),
            epistemic_baseline: epistemicBaseline.trim(),
            target_gap: targetGap.trim(),
            exclusion_criteria: exclusionCriteria,
            additional_context: additionalContext.trim(),
            tags,
            save_prompt: savePrompt,
            write_to_file: writePromptToFile,
          });
      setCompiledPromptResult(response);
      if (response.saved_prompt) {
        setSelectedPromptId(response.saved_prompt.id);
        hydratePromptForm(response.saved_prompt);
        await refreshPromptLibrary();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Prompt compilation failed');
    } finally {
      setActiveAction('');
    }
  }, [
    additionalContext,
    epistemicBaseline,
    exclusionCriteriaText,
    hydratePromptForm,
    promptDescription,
    promptTagsText,
    promptTitle,
    refreshPromptLibrary,
    saveAsNewPrompt,
    savePrompt,
    selectedPromptId,
    targetGap,
    writePromptToFile,
  ]);

  const savePromptNotes = useCallback(async () => {
    if (!selectedPromptId) {
      return;
    }

    setActiveAction('update_prompt');
    setError('');
    try {
      await updateDeepResearchPrompt(selectedPromptId, {
        effectiveness_notes: promptEffectivenessNotes,
        quality_rating: promptQualityRating ? Number(promptQualityRating) : null,
      });
      await refreshPromptLibrary();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update prompt notes');
    } finally {
      setActiveAction('');
    }
  }, [promptEffectivenessNotes, promptQualityRating, refreshPromptLibrary, selectedPromptId]);

  const runExternalReingestion = useCallback(async () => {
    if (!externalReportText.trim()) {
      return;
    }

    setActiveAction('reingest_report');
    setError('');
    setOffloadResult(null);
    try {
      const result = await reingestExternalDeepResearchReport({
        source_prompt_id: selectedPromptId || compiledPromptResult?.saved_prompt?.id,
        report_text: externalReportText,
      });
      setOffloadResult(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Deep research report validation failed');
    } finally {
      setActiveAction('');
    }
  }, [compiledPromptResult?.saved_prompt?.id, externalReportText, selectedPromptId]);

  const handleExport = useCallback(
    async (format: 'docx' | 'pptx' | 'xlsx') => {
      if (!researchResult?.report) return;
      try {
        if (format === 'docx') {
          const response = await exportDocx({ title: topic || 'Research Report', content: researchResult.report });
          const blob = await response.blob();
          downloadBlob(blob, 'research_report.docx');
        } else if (format === 'pptx') {
          const response = await exportPptx({ title: topic || 'Research Report', content: researchResult.report });
          const blob = await response.blob();
          downloadBlob(blob, 'research_report.pptx');
        } else {
          const articles =
            (researchResult.metadata?.articles as Record<string, unknown>[]) || [];
          const response = await exportXlsx({ title: topic || 'References', content: researchResult.report, articles });
          const blob = await response.blob();
          downloadBlob(blob, 'references.xlsx');
        }
      } catch {
        setError(`Export to ${format.toUpperCase()} failed`);
      }
    },
    [researchResult, topic],
  );

  // toggle source
  const toggleSource = (id: string) =>
    setEnabledSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );

  const clearPromptSelection = useCallback(() => {
    setSelectedPromptId('');
    setCompiledPromptResult(null);
    hydratePromptForm(null);
  }, [hydratePromptForm]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-800 p-1">
        {(
          [
            ['research', 'Deep Research'],
            ['offload', 'External Offload'],
            ['search', 'Database Search'],
            ['rag', 'Ask Library (RAG)'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ============ Deep Research tab ============ */}
      {tab === 'research' && (
        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          {/* Main area */}
          <section className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">Research Topic</span>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={3}
                placeholder="e.g. Role of liquid-liquid phase separation in chromatin organization"
                className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </label>

            <button
              onClick={runDeepResearch}
              disabled={loading || !topic.trim()}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Researching…' : 'Run Deep Research'}
            </button>

            {/* Result */}
            {researchResult && (
              <div className="space-y-4">
                {/* Metadata badges */}
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge label="Papers Found" value={String(researchResult.metadata?.papers_found ?? 0)} />
                  <Badge label="Reviewed" value={String(researchResult.metadata?.papers_reviewed ?? 0)} />
                  <Badge label="Indexed" value={String(researchResult.metadata?.papers_indexed ?? 0)} />
                  <Badge label="Evidence" value={String(researchResult.metadata?.evidence_mode ?? evidenceMode)} />
                  {researchResult.metadata?.saved_document_id && (
                    <span className="rounded-full border border-emerald-600/50 bg-emerald-700/30 px-2.5 py-1 text-emerald-300">
                      ✓ Saved to RAG library
                    </span>
                  )}
                  {(researchResult.metadata?.sources_searched as string[])?.map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-emerald-600/30 bg-emerald-700/20 px-2.5 py-1 text-emerald-300"
                    >
                      {s}
                    </span>
                  ))}
                </div>

                {/* Export buttons */}
                <div className="flex gap-2">
                  {(['docx', 'pptx', 'xlsx'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => handleExport(fmt)}
                      className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-600"
                    >
                      Export {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>

                {/* Report */}
                <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-700 bg-slate-950 p-6">
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                    {researchResult.report}
                  </pre>
                </div>

                {Array.isArray(researchResult.metadata?.queries) && researchResult.metadata.queries.length > 0 && (
                  <Panel title="Query Plan">
                    <div className="flex flex-wrap gap-2">
                      {(researchResult.metadata.queries as string[]).map((query) => (
                        <span
                          key={query}
                          className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-300"
                        >
                          {query}
                        </span>
                      ))}
                    </div>
                  </Panel>
                )}

                {Array.isArray(researchResult.metadata?.evidence_ledger) && researchResult.metadata.evidence_ledger.length > 0 && (
                  <Panel title="Evidence Ledger Preview">
                    <div className="space-y-2">
                      {(researchResult.metadata.evidence_ledger as Record<string, unknown>[]).slice(0, 8).map((item, index) => (
                        <div key={`${String(item.title ?? 'source')}-${index}`} className="rounded-lg border border-slate-700 bg-slate-800 p-3 text-xs">
                          <p className="font-medium text-slate-200">{String(item.title ?? 'Untitled')}</p>
                          <p className="mt-1 text-slate-500">
                            {[item.source, item.year, item.doi].filter(Boolean).map((value) => String(value)).join(' • ')}
                          </p>
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}
              </div>
            )}
          </section>

          {/* Sidebar controls */}
          <aside className="space-y-4">
            <Panel title="Report Type">
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value as ReportType)}
                title="Report type"
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
              >
                {REPORT_TYPES.map((rt) => (
                  <option key={rt.value} value={rt.value}>
                    {rt.label}
                  </option>
                ))}
              </select>
            </Panel>

            <Panel title="Options">
              <NumField
                label="Max Papers"
                value={maxPapers}
                min={1}
                max={200}
                onChange={setMaxPapers}
              />
              <label className="space-y-2 text-xs text-slate-400">
                <span className="block">Evidence Mode</span>
                <select
                  value={evidenceMode}
                  onChange={(e) => setEvidenceMode(e.target.value as EvidenceMode)}
                  title="Evidence mode"
                  className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
                >
                  {EVIDENCE_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  {EVIDENCE_MODES.find((mode) => mode.value === evidenceMode)?.note}
                </p>
              </label>
              <Toggle label="Query existing RAG library" checked={useRag} onChange={setUseRag} />
              <Toggle
                label="Index gathered evidence into RAG"
                checked={persistEvidenceToRag}
                onChange={setPersistEvidenceToRag}
              />
              <Toggle label="Save report to RAG" checked={saveToRag} onChange={setSaveToRag} />
            </Panel>

            <Panel title="Academic Sources">
              <div className="flex flex-wrap gap-2">
                {SEARCH_SOURCES.map((src) => (
                  <button
                    key={src.id}
                    onClick={() => toggleSource(src.id)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                      enabledSources.includes(src.id)
                        ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300'
                        : 'border-slate-700 bg-slate-800 text-slate-500'
                    }`}
                  >
                    {src.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">PubMed is always included for deep research runs.</p>
            </Panel>

            <Panel title="Process">
              <ol className="space-y-2 text-xs text-slate-400">
                <li className="flex items-start gap-2">
                  <StepNum n={1} /> Generate search queries via LLM
                </li>
                <li className="flex items-start gap-2">
                  <StepNum n={2} /> Search PubMed, Semantic Scholar, Europe PMC, OpenAlex
                </li>
                <li className="flex items-start gap-2">
                  <StepNum n={3} /> Rank and gatekeep the most useful papers for review
                </li>
                <li className="flex items-start gap-2">
                  <StepNum n={4} /> Review abstracts, live web pages, or full PDFs based on the selected mode
                </li>
                <li className="flex items-start gap-2">
                  <StepNum n={5} /> Optionally index gathered evidence into RAG
                </li>
                <li className="flex items-start gap-2">
                  <StepNum n={6} /> Synthesize a comprehensive report with citations
                </li>
              </ol>
            </Panel>
          </aside>
        </div>
      )}

      {/* ============ External Offload tab ============ */}
      {tab === 'offload' && (
        <div className="grid gap-6 xl:grid-cols-[1.2fr_360px]">
          <section className="space-y-4">
            <Panel title="Prompt Compiler">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2 text-xs text-slate-400">
                  <span className="block">Prompt Title</span>
                  <input
                    value={promptTitle}
                    onChange={(e) => setPromptTitle(e.target.value)}
                    placeholder="Optional reusable title"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="space-y-2 text-xs text-slate-400">
                  <span className="block">Tags</span>
                  <input
                    value={promptTagsText}
                    onChange={(e) => setPromptTagsText(e.target.value)}
                    placeholder="chromatin, lamin-a, mutation"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </label>
              </div>

              <label className="space-y-2 text-xs text-slate-400">
                <span className="block">Description</span>
                <input
                  value={promptDescription}
                  onChange={(e) => setPromptDescription(e.target.value)}
                  placeholder="What this prompt variant is meant to do"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="space-y-2 text-xs text-slate-400">
                <span className="block">Epistemic Baseline</span>
                <textarea
                  value={epistemicBaseline}
                  onChange={(e) => setEpistemicBaseline(e.target.value)}
                  rows={4}
                  placeholder="Established facts to inject into the external deep research prompt"
                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="space-y-2 text-xs text-slate-400">
                <span className="block">Target Gap</span>
                <textarea
                  value={targetGap}
                  onChange={(e) => setTargetGap(e.target.value)}
                  rows={3}
                  placeholder="What specific question should Gemini, ChatGPT, or Claude investigate?"
                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="space-y-2 text-xs text-slate-400">
                <span className="block">Exclusion Criteria</span>
                <textarea
                  value={exclusionCriteriaText}
                  onChange={(e) => setExclusionCriteriaText(e.target.value)}
                  rows={4}
                  placeholder={'One per line, e.g.\npreprints\nin silico docking\nnon-peer-reviewed'}
                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="space-y-2 text-xs text-slate-400">
                <span className="block">Additional Context</span>
                <textarea
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  rows={3}
                  placeholder="Extra scope, assay preference, species restriction, or cautionary context"
                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <div className="grid gap-2 md:grid-cols-2">
                <Toggle label="Save compiled prompt to library" checked={savePrompt} onChange={setSavePrompt} />
                <Toggle label="Write compiled prompt to backend file" checked={writePromptToFile} onChange={setWritePromptToFile} />
                <Toggle
                  label="Reuse selected prompt as new record"
                  checked={saveAsNewPrompt}
                  onChange={setSaveAsNewPrompt}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={compileOrReusePrompt}
                  disabled={loading || !epistemicBaseline.trim() || !targetGap.trim()}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {activeAction === 'compile_prompt'
                    ? 'Compiling…'
                    : selectedPromptId
                      ? 'Reuse Selected Prompt'
                      : 'Compile Prompt'}
                </button>
                <button
                  type="button"
                  onClick={() => void copyText(compiledPromptResult?.prompt ?? '')}
                  disabled={!compiledPromptResult?.prompt}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Copy Prompt
                </button>
                <button
                  type="button"
                  onClick={clearPromptSelection}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  Start Blank
                </button>
              </div>
            </Panel>

            {compiledPromptResult && (
              <Panel title="Compiled Prompt">
                <div className="flex flex-wrap gap-2 text-xs">
                  {compiledPromptResult.saved_prompt && (
                    <span className="rounded-full border border-emerald-600/40 bg-emerald-700/20 px-2.5 py-1 text-emerald-300">
                      Saved as reusable prompt
                    </span>
                  )}
                  {compiledPromptResult.compiled_path && (
                    <span className="rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-slate-300">
                      File: {compiledPromptResult.compiled_path}
                    </span>
                  )}
                  {selectedPrompt && (
                    <span className="rounded-full border border-cyan-600/40 bg-cyan-700/20 px-2.5 py-1 text-cyan-300">
                      Source: {selectedPrompt.title}
                    </span>
                  )}
                </div>
                <div className="max-h-[28rem] overflow-auto rounded-xl border border-slate-700 bg-slate-950 p-4">
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                    {compiledPromptResult.prompt}
                  </pre>
                </div>
              </Panel>
            )}

            <Panel title="Returned Report Intake">
              <p className="text-xs leading-relaxed text-slate-500">
                Paste the external Deep Research report here. The backend will extract PMIDs and DOIs, validate them,
                and purge unsupported or rejected claims before reuse.
              </p>
              <textarea
                value={externalReportText}
                onChange={(e) => setExternalReportText(e.target.value)}
                rows={12}
                placeholder="Paste the returned report from Gemini, ChatGPT, or Claude here."
                className="w-full resize-y rounded-lg border border-slate-700 bg-slate-800 px-3 py-3 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={runExternalReingestion}
                  disabled={loading || !externalReportText.trim()}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {activeAction === 'reingest_report' ? 'Validating…' : 'Validate and Sanitize'}
                </button>
                <button
                  type="button"
                  onClick={() => void copyText(offloadResult?.sanitized_text ?? '')}
                  disabled={!offloadResult?.sanitized_text}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Copy Sanitized Text
                </button>
              </div>
            </Panel>

            {offloadResult && (
              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <Panel title="Sanitized Output">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge label="Parsed Claims" value={String(offloadResult.parsed_claim_count)} />
                    <Badge label="Valid" value={String(offloadResult.valid_claim_count)} />
                    <Badge label="Rejected" value={String(offloadResult.rejected_claim_count)} />
                  </div>
                  <div className="max-h-[24rem] overflow-auto rounded-xl border border-slate-700 bg-slate-950 p-4">
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                      {offloadResult.sanitized_text}
                    </pre>
                  </div>
                </Panel>

                <Panel title="Rejected Claims">
                  {offloadResult.rejected_claims.length > 0 ? (
                    <div className="space-y-2">
                      {offloadResult.rejected_claims.slice(0, 8).map((claim, index) => (
                        <div
                          key={`${String(claim.claim_id ?? 'claim')}-${index}`}
                          className="rounded-lg border border-rose-800/60 bg-rose-950/30 p-3 text-xs text-rose-100"
                        >
                          <p className="leading-relaxed">{String(claim.text ?? 'Rejected claim')}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No rejected claims in the returned report.</p>
                  )}
                </Panel>
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <Panel title="Saved Prompt Library">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void refreshPromptLibrary()}
                  disabled={promptLibraryLoading}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {promptLibraryLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              <div className="space-y-2">
                {promptLibrary.length > 0 ? (
                  promptLibrary.map((prompt) => (
                    <button
                      key={prompt.id}
                      type="button"
                      onClick={() => void selectPrompt(prompt.id)}
                      className={`w-full rounded-xl border p-3 text-left transition-colors ${
                        prompt.id === selectedPromptId
                          ? 'border-cyan-500 bg-cyan-500/10'
                          : 'border-slate-700 bg-slate-900 hover:border-slate-500'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{prompt.title}</p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-500">
                            {String((prompt.biological_context?.target_gap ?? prompt.description) || 'No target gap')}
                          </p>
                        </div>
                        <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] text-slate-400">
                          {prompt.usage_count} uses
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {prompt.tags.slice(0, 4).map((tag) => (
                          <span
                            key={`${prompt.id}-${tag}`}
                            className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-slate-500">
                    {promptLibraryLoading ? 'Loading saved prompts…' : 'No saved deep-research prompts yet.'}
                  </p>
                )}
              </div>
            </Panel>

            <Panel title="Selected Prompt Notes">
              {selectedPrompt ? (
                <>
                  <div className="space-y-1 text-xs text-slate-400">
                    <p className="text-sm font-medium text-white">{selectedPrompt.title}</p>
                    <p>Source type: {selectedPrompt.source_type}</p>
                    <p>Prompt kind: {selectedPrompt.prompt_kind}</p>
                    <p>Last used: {selectedPrompt.last_used_at ? new Date(selectedPrompt.last_used_at).toLocaleString() : 'Not yet'}</p>
                  </div>
                  <label className="space-y-2 text-xs text-slate-400">
                    <span className="block">Quality Rating</span>
                    <select
                      value={promptQualityRating}
                      onChange={(e) => setPromptQualityRating(e.target.value as PromptRating)}
                      className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Unrated</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                    </select>
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    <span className="block">Effectiveness Notes</span>
                    <textarea
                      value={promptEffectivenessNotes}
                      onChange={(e) => setPromptEffectivenessNotes(e.target.value)}
                      rows={5}
                      placeholder="What worked, what failed, and when to reuse this prompt."
                      className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={savePromptNotes}
                    disabled={loading || !selectedPromptId}
                    className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {activeAction === 'update_prompt' ? 'Saving…' : 'Save Notes'}
                  </button>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  Select a saved prompt to annotate its quality and reuse history.
                </p>
              )}
            </Panel>

            <Panel title="Flow">
              <ol className="space-y-2 text-xs text-slate-400">
                <li className="flex items-start gap-2">
                  <StepNum n={1} /> Compile a constrained prompt for Gemini, ChatGPT, or Claude.
                </li>
                <li className="flex items-start gap-2">
                  <StepNum n={2} /> Copy the prompt into the external Deep Research UI.
                </li>
                <li className="flex items-start gap-2">
                  <StepNum n={3} /> Paste the returned report back here for hostile validation.
                </li>
                <li className="flex items-start gap-2">
                  <StepNum n={4} /> Reuse only the sanitized claims in downstream writing and editing.
                </li>
              </ol>
            </Panel>
          </aside>
        </div>
      )}

      {/* ============ Database Search tab ============ */}
      {tab === 'search' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search PubMed or academic databases…"
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <select
              value={searchSource}
              onChange={(e) => setSearchSource(e.target.value as 'pubmed' | 'academic')}
              title="Search source"
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200"
            >
              <option value="pubmed">PubMed</option>
              <option value="academic">Multi-Source</option>
            </select>
            <button
              onClick={runSearch}
              disabled={loading || !searchQuery.trim()}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>

          {searchSource === 'academic' && (
            <div className="flex gap-2">
              {SEARCH_SOURCES.map((src) => (
                <button
                  key={src.id}
                  onClick={() => toggleSource(src.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                    enabledSources.includes(src.id)
                      ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300'
                      : 'border-slate-700 bg-slate-800 text-slate-500'
                  }`}
                >
                  {src.label}
                </button>
              ))}
            </div>
          )}

          {/* PubMed results */}
          {pubmedResult && (
            <div className="space-y-2">
              <p className="text-sm text-slate-400">
                {pubmedResult.total} results for &ldquo;{pubmedResult.query}&rdquo;
              </p>
              {pubmedResult.articles.map((a, i) => (
                <ArticleCard key={i} article={a} />
              ))}
            </div>
          )}

          {/* Academic results */}
          {academicResult && (
            <div className="space-y-2">
              <p className="text-sm text-slate-400">
                {academicResult.total} results for &ldquo;{academicResult.query}&rdquo;
              </p>
              {academicResult.results.map((r, i) => (
                <ArticleCard key={i} article={r} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============ RAG tab ============ */}
      {tab === 'rag' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={ragQuestion}
              onChange={(e) => setRagQuestion(e.target.value)}
              placeholder="Ask a question about your indexed papers…"
              onKeyDown={(e) => e.key === 'Enter' && runRag()}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={runRag}
              disabled={loading || !ragQuestion.trim()}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Querying…' : 'Ask'}
            </button>
          </div>

          {ragResult && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-700 bg-slate-950 p-6">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                  {ragResult.answer}
                </pre>
              </div>

              {ragResult.sources.length > 0 && (
                <Panel title={`Sources (${ragResult.sources.length})`}>
                  <div className="space-y-2">
                    {ragResult.sources.map((s, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-slate-700 bg-slate-800 p-3 text-xs"
                      >
                        <p className="font-medium text-slate-300">
                          {(s as Record<string, unknown>).metadata
                            ? String(
                                (
                                  (s as Record<string, unknown>).metadata as Record<
                                    string,
                                    unknown
                                  >
                                )?.title ?? 'Source',
                              )
                            : 'Source'}
                        </p>
                        <p className="mt-1 text-slate-500">
                          Score: {Number((s as Record<string, unknown>).score ?? 0).toFixed(3)}
                        </p>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small sub-components                                               */
/* ------------------------------------------------------------------ */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
      <span className="text-slate-500">{label}:</span> {value}
    </span>
  );
}

function StepNum({ n }: { n: number }) {
  return (
    <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
      {n}
    </span>
  );
}

function NumField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between text-xs text-slate-400">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
        className="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between text-xs text-slate-400">
      {label}
      <button
        type="button"
        title={`${label}: ${checked ? 'enabled' : 'disabled'}`}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-slate-600'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

function ArticleCard({ article }: { article: Record<string, unknown> }) {
  const title = String(article.title ?? 'Untitled');
  const authors = Array.isArray(article.authors)
    ? (article.authors as string[]).slice(0, 3).join(', ')
    : '';
  const year = String(article.year ?? '');
  const journal = String(article.journal ?? '');
  const doi = String(article.doi ?? '');
  const pmid = String(article.pmid ?? '');
  const citations = article.citation_count != null ? Number(article.citation_count) : null;
  const source = String(article.source ?? '');

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <h4 className="text-sm font-medium text-white">{title}</h4>
      <p className="mt-1 text-xs text-slate-400">
        {authors}
        {year && ` (${year})`}
        {journal && ` — ${journal}`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
        {pmid && (
          <a
            href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-blue-600/30 bg-blue-700/20 px-2 py-0.5 text-blue-300 hover:bg-blue-700/40"
          >
            PMID: {pmid}
          </a>
        )}
        {doi && (
          <a
            href={`https://doi.org/${doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-cyan-600/30 bg-cyan-700/20 px-2 py-0.5 text-cyan-300 hover:bg-cyan-700/40"
          >
            DOI
          </a>
        )}
        {source && (
          <span className="rounded-full border border-slate-600 px-2 py-0.5 text-slate-400">
            {source}
          </span>
        )}
        {citations != null && (
          <span className="rounded-full border border-amber-600/30 bg-amber-700/20 px-2 py-0.5 text-amber-300">
            {citations} citations
          </span>
        )}
      </div>
      {article.abstract ? (
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-500">
          {String(article.abstract)}
        </p>
      ) : null}
    </div>
  );
}
