'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  PlusIcon,
  TrashIcon,
  BoltIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  SparklesIcon,
  CodeBracketIcon,
  ClipboardDocumentIcon,
  DocumentTextIcon,
  LightBulbIcon,
} from '@heroicons/react/24/outline';
import { streamPipeline, composeScript, interpretAnalysis, listScripts, getElnoteStatus, pushToElnote, listProjects } from '@/lib/api';
import type { RunStreamEvent, Script, Project } from '@/lib/types';

type BuilderStep = {
  agent: string;
  label: string;
  description?: string;
};

const AVAILABLE_STEPS = [
  { agent: 'evidence_librarian', label: 'Evidence Librarian', description: 'Expand queries, deduplicate sources, and curate the evidence set' },
  { agent: 'deep_research', label: 'Deep Research', description: 'Run retrieval-backed multi-source literature review' },
  { agent: 'report_writer', label: 'Report Writer', description: 'Draft report or manuscript text from curated evidence' },
  { agent: 'claim_auditor', label: 'Claim Audit', description: 'Map claims to evidence and find citation gaps' },
  { agent: 'manuscript_critic', label: 'Manuscript Critic', description: 'Critique draft quality, logic, and overclaiming' },
  { agent: 'reviewer_response_strategist', label: 'Reviewer Response', description: 'Convert reviewer comments into a rebuttal plan' },
  { agent: 'research', label: 'Research', description: 'Search literature and gather information' },
  { agent: 'summarizer', label: 'Summarize', description: 'Create concise summaries' },
  { agent: 'synthesizer', label: 'Synthesize', description: 'Combine multiple sources' },
  { agent: 'verifier', label: 'Verify', description: 'Fact-check and validate claims' },
  { agent: 'bioinformatics', label: 'Bioinformatics', description: 'Analyze biological data' },
  { agent: 'image_analysis', label: 'Image Analysis', description: 'Analyze figures and charts' },
  { agent: 'code', label: 'Code Generation', description: 'Write analysis scripts' },
  { agent: 'media', label: 'Media', description: 'Generate visualizations' },
];

const STEP_COLORS: Record<string, string> = {
  evidence_librarian: 'bg-sky-600/20 text-sky-400 border-sky-700',
  deep_research: 'bg-indigo-600/20 text-indigo-400 border-indigo-700',
  report_writer: 'bg-fuchsia-600/20 text-fuchsia-400 border-fuchsia-700',
  claim_auditor: 'bg-rose-600/20 text-rose-400 border-rose-700',
  manuscript_critic: 'bg-red-600/20 text-red-400 border-red-700',
  reviewer_response_strategist: 'bg-lime-600/20 text-lime-400 border-lime-700',
  research: 'bg-blue-600/20 text-blue-400 border-blue-700',
  summarizer: 'bg-violet-600/20 text-violet-400 border-violet-700',
  synthesizer: 'bg-emerald-600/20 text-emerald-400 border-emerald-700',
  verifier: 'bg-amber-600/20 text-amber-400 border-amber-700',
  bioinformatics: 'bg-teal-600/20 text-teal-400 border-teal-700',
  image_analysis: 'bg-pink-600/20 text-pink-400 border-pink-700',
  code: 'bg-cyan-600/20 text-cyan-400 border-cyan-700',
  media: 'bg-orange-600/20 text-orange-400 border-orange-700',
};

export default function PipelineBuilder() {
  const [task, setTask] = useState('');
  const [steps, setSteps] = useState<BuilderStep[]>([
    { agent: 'evidence_librarian', label: 'Evidence Librarian' },
    { agent: 'deep_research', label: 'Deep Research' },
    { agent: 'report_writer', label: 'Report Writer' },
    { agent: 'claim_auditor', label: 'Claim Audit' },
    { agent: 'manuscript_critic', label: 'Manuscript Critic' },
  ]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [pipelineResults, setPipelineResults] = useState<Record<string, unknown>>({});
  const [executionEvents, setExecutionEvents] = useState<RunStreamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAddStep, setShowAddStep] = useState(false);

  // ---- Code Generation state ----
  const [codePrompt, setCodePrompt] = useState('');
  const [codeLanguage, setCodeLanguage] = useState<'python' | 'r'>('python');
  const [generatedCode, setGeneratedCode] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [showCodeGen, setShowCodeGen] = useState(false);
  const [scriptLibrary, setScriptLibrary] = useState<Script[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [showScriptPicker, setShowScriptPicker] = useState(false);

  // ---- AI Interpretation state ----
  const [interpretEnabled, setInterpretEnabled] = useState(false);
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const [interpretLoading, setInterpretLoading] = useState(false);

  // ---- ELNOTE push state (optional) ----
  const [elnoteAvailable, setElnoteAvailable] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [elnoteProjectId, setElnoteProjectId] = useState<string | null>(null);
  const [elnotePushing, setElnotePushing] = useState(false);
  const [elnoteMsg, setElnoteMsg] = useState<string | null>(null);

  // Check ELNOTE availability on mount
  useEffect(() => {
    getElnoteStatus()
      .then((s) => {
        setElnoteAvailable(s.available);
        if (s.available) listProjects().then(setProjects).catch(() => {});
      })
      .catch(() => setElnoteAvailable(false));
  }, []);

  // Load script library when script picker opens
  useEffect(() => {
    if (showScriptPicker && scriptLibrary.length === 0) {
      listScripts().then(setScriptLibrary).catch(() => {});
    }
  }, [showScriptPicker, scriptLibrary.length]);

  const handleComposeCode = useCallback(async () => {
    if (!codePrompt.trim()) return;
    setCodeLoading(true);
    setCodeError(null);
    try {
      const res = await composeScript({
        prompt: codePrompt,
        language: codeLanguage,
        existing_script_id: selectedScriptId ?? undefined,
      });
      setGeneratedCode(res.code);
    } catch (err: unknown) {
      setCodeError(err instanceof Error ? err.message : 'Code generation failed');
    } finally {
      setCodeLoading(false);
    }
  }, [codePrompt, codeLanguage, selectedScriptId]);

  const handleInterpret = useCallback(async (output: string) => {
    if (!output) return;
    setInterpretLoading(true);
    try {
      const res = await interpretAnalysis({
        code: generatedCode || '(pipeline execution)',
        stdout: output,
        task_description: task,
        language: codeLanguage,
      });
      setInterpretation(res.interpretation);
    } catch {
      setInterpretation('Interpretation request failed.');
    } finally {
      setInterpretLoading(false);
    }
  }, [generatedCode, task, codeLanguage]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  const handleElnotePush = useCallback(async () => {
    if (!elnoteProjectId || (!result && !interpretation)) return;
    setElnotePushing(true);
    setElnoteMsg(null);
    try {
      const content = [result, interpretation].filter(Boolean).join('\n\n---\n\n');
      await pushToElnote({
        project_id: elnoteProjectId,
        title: task || 'Analysis Studio Results',
        content,
        entry_type: interpretation ? 'interpretation' : 'result',
        metadata: { source: 'analysis_studio', steps: steps.map((s) => s.agent) },
      });
      setElnoteMsg('Pushed to ELNOTE');
    } catch (err: unknown) {
      setElnoteMsg(err instanceof Error ? err.message : 'ELNOTE push failed');
    } finally {
      setElnotePushing(false);
    }
  }, [elnoteProjectId, result, interpretation, task, steps]);

  const addStep = (agent: string, label: string) => {
    setSteps((prev) => [...prev, { agent, label }]);
    setShowAddStep(false);
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const newSteps = [...steps];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= newSteps.length) return;
    [newSteps[index], newSteps[target]] = [newSteps[target], newSteps[index]];
    setSteps(newSteps);
  };

  const handleExecute = async () => {
    if (!task.trim() || steps.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setPipelineResults({});
    setExecutionEvents([]);
    setInterpretation(null);

    try {
      const response = await streamPipeline(task, {}, steps.map((s) => s.agent), (event) => {
        setExecutionEvents((previous) => [...previous, event]);
      });
      setResult(response.final_output);
      setPipelineResults(response.results ?? {});

      // Auto-interpret if enabled
      if (interpretEnabled && response.final_output) {
        handleInterpret(response.final_output);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Pipeline execution failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      {/* Left Column – Pipeline Config */}
      <div className="space-y-5">
        <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-sm text-slate-300">
          Analyses in the Research OS are intended to be deterministic, sandboxed, and limited to the approved scientific stack.
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-4 text-base font-semibold text-white">Code Task Plan</h2>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">Analysis Intent</label>
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe the analysis, figure, or reproducibility task you want to execute..."
                rows={3}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-none"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-300">Pipeline Steps</label>
                <button
                  onClick={() => setShowAddStep(!showAddStep)}
                  className="flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Add Capability
                </button>
              </div>

              {showAddStep && (
                <div className="mb-3 rounded-lg border border-slate-700 bg-slate-800 p-3">
                  <p className="mb-2 text-xs font-medium text-slate-400">Select a capability to add:</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {AVAILABLE_STEPS.map((step) => (
                      <button
                        key={step.agent}
                        onClick={() => addStep(step.agent, step.label)}
                        className="rounded-md border border-slate-700 px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                      >
                        {step.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {steps.map((step, index) => (
                  <div
                    key={`${step.agent}-${index}`}
                    className={`flex items-center gap-3 rounded-lg border p-3 ${STEP_COLORS[step.agent] || 'bg-slate-800 text-slate-400 border-slate-700'}`}
                  >
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-black/20 text-xs font-bold">
                      {index + 1}
                    </span>
                    <span className="flex-1 text-sm font-medium">{step.label}</span>
                    <div className="flex items-center gap-1">
                      <button
                        title="Move up"
                        onClick={() => moveStep(index, 'up')}
                        disabled={index === 0}
                        className="rounded p-0.5 hover:bg-black/20 disabled:opacity-30"
                      >
                        <ChevronUpIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Move down"
                        onClick={() => moveStep(index, 'down')}
                        disabled={index === steps.length - 1}
                        className="rounded p-0.5 hover:bg-black/20 disabled:opacity-30"
                      >
                        <ChevronDownIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Remove step"
                        onClick={() => removeStep(index)}
                        className="rounded p-0.5 hover:bg-black/20 text-red-400"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {steps.length === 0 && (
                  <p className="text-center text-sm text-slate-600 py-4">No steps added yet</p>
                )}
              </div>
            </div>

            {/* AI Interpretation Toggle */}
            <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-3">
              <LightBulbIcon className="h-5 w-5 text-amber-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-300">AI Interpretation</p>
                <p className="text-xs text-slate-500">Automatically interpret results after execution</p>
              </div>
              <button
                title="Toggle AI interpretation"
                onClick={() => setInterpretEnabled(!interpretEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  interpretEnabled ? 'bg-amber-500' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    interpretEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <button
              onClick={handleExecute}
              disabled={loading || !task.trim() || steps.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Running Deterministic Pipeline...
                </>
              ) : (
                <>
                  <BoltIcon className="h-4 w-4" />
                  Execute Analysis Run
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Center Column – Code Generation */}
      <div className="space-y-5">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <SparklesIcon className="h-5 w-5 text-violet-400" />
              Code Generation
            </h2>
            <button
              onClick={() => setShowCodeGen(!showCodeGen)}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              {showCodeGen ? 'Collapse' : 'Expand'}
            </button>
          </div>

          {showCodeGen && (
            <div className="space-y-4">
              {/* Language Selector */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-400">Language:</label>
                <div className="flex rounded-lg border border-slate-700 overflow-hidden">
                  <button
                    onClick={() => setCodeLanguage('python')}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      codeLanguage === 'python'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    Python
                  </button>
                  <button
                    onClick={() => setCodeLanguage('r')}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      codeLanguage === 'r'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    R
                  </button>
                </div>
              </div>

              {/* Modify Existing Script */}
              <div>
                <button
                  onClick={() => setShowScriptPicker(!showScriptPicker)}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <DocumentTextIcon className="h-3.5 w-3.5" />
                  {selectedScriptId ? 'Change base script' : 'Modify existing script (optional)'}
                </button>

                {selectedScriptId && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="rounded bg-violet-600/20 px-2 py-0.5 text-xs text-violet-300">
                      Base: {scriptLibrary.find((s) => s.id === selectedScriptId)?.title || selectedScriptId}
                    </span>
                    <button
                      onClick={() => setSelectedScriptId(null)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Clear
                    </button>
                  </div>
                )}

                {showScriptPicker && (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 p-2 space-y-1">
                    {scriptLibrary.length === 0 && (
                      <p className="text-xs text-slate-500 p-2">No scripts in library</p>
                    )}
                    {scriptLibrary.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setSelectedScriptId(s.id);
                          setShowScriptPicker(false);
                        }}
                        className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                          selectedScriptId === s.id
                            ? 'bg-violet-600/30 text-violet-300'
                            : 'text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        <span className="font-medium">{s.title}</span>
                        <span className="ml-2 text-slate-500">{s.language}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Prompt Input */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">Describe the code you need</label>
                <textarea
                  value={codePrompt}
                  onChange={(e) => setCodePrompt(e.target.value)}
                  placeholder="e.g., Load RNA-seq count matrix from CSV, normalize by library size, run PCA, plot PC1 vs PC2 colored by condition..."
                  rows={5}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none resize-none"
                />
              </div>

              {/* Generate Button */}
              <button
                onClick={handleComposeCode}
                disabled={codeLoading || !codePrompt.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {codeLoading ? (
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
                    {selectedScriptId ? 'Modify Script' : 'Generate Code'}
                  </>
                )}
              </button>

              {codeError && (
                <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-xs text-red-300">
                  {codeError}
                </div>
              )}
            </div>
          )}

          {/* Generated Code Preview */}
          {generatedCode && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                  <CodeBracketIcon className="h-4 w-4 text-cyan-400" />
                  Generated Code
                </h3>
                <button
                  onClick={() => copyToClipboard(generatedCode)}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
                >
                  <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                  Copy
                </button>
              </div>
              <div className="max-h-[400px] overflow-y-auto rounded-lg bg-slate-950 border border-slate-700 p-4">
                <pre className="text-xs text-emerald-300 leading-relaxed whitespace-pre-wrap font-mono">
                  {generatedCode}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Column – Results */}
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-700 bg-red-900/30 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {Object.keys(pipelineResults).length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h3 className="mb-3 text-sm font-semibold text-white">Execution Ledger</h3>
            <div className="space-y-2">
              {Object.entries(pipelineResults).map(([key, stepResult]) => {
                const sr = stepResult as Record<string, unknown>;
                return (
                  <div key={key} className="rounded-lg bg-slate-800/50 p-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`font-medium ${sr.success ? 'text-emerald-400' : 'text-red-400'}`}>
                        {sr.success ? '✓' : '✗'}
                      </span>
                      <span className="text-slate-300 font-medium">{sr.agent as string}</span>
                      <span className="text-slate-500">— {sr.description as string}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Analysis Output</h3>
              {!interpretEnabled && !interpretation && (
                <button
                  onClick={() => handleInterpret(result)}
                  disabled={interpretLoading}
                  className="flex items-center gap-1 rounded-md bg-amber-600/20 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-600/30 transition-colors disabled:opacity-50"
                >
                  <LightBulbIcon className="h-3.5 w-3.5" />
                  {interpretLoading ? 'Interpreting...' : 'Interpret Results'}
                </button>
              )}
            </div>
            <div className="max-h-[400px] overflow-y-auto rounded-lg bg-slate-800/50 p-4 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
              {result}
            </div>
          </div>
        )}

        {/* AI Interpretation Panel */}
        {(interpretation || interpretLoading) && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-900/10 p-5">
            <h3 className="mb-3 text-sm font-semibold text-amber-300 flex items-center gap-2">
              <LightBulbIcon className="h-4 w-4" />
              AI Interpretation
            </h3>
            {interpretLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Analyzing results...
              </div>
            ) : (
              <div className="max-h-[400px] overflow-y-auto rounded-lg bg-amber-950/30 p-4 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                {interpretation}
              </div>
            )}
          </div>
        )}

        {/* ELNOTE Push (only when configured + results exist) */}
        {elnoteAvailable && (result || interpretation) && (
          <div className="rounded-xl border border-teal-500/20 bg-teal-900/10 p-4">
            <h3 className="mb-2 text-sm font-semibold text-teal-300">Push to ELNOTE</h3>
            <select
              title="Select ELNOTE project"
              value={elnoteProjectId || ''}
              onChange={(e) => setElnoteProjectId(e.target.value || null)}
              className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white focus:border-teal-500 focus:outline-none"
            >
              <option value="">Select project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={handleElnotePush}
              disabled={elnotePushing || !elnoteProjectId}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {elnotePushing ? 'Pushing…' : 'Push Results to ELNOTE'}
            </button>
            {elnoteMsg && (
              <p className={`mt-1.5 text-xs ${elnoteMsg.includes('failed') ? 'text-red-400' : 'text-emerald-400'}`}>
                {elnoteMsg}
              </p>
            )}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900/50 py-16 text-center">
            <BoltIcon className="mb-3 h-10 w-10 text-slate-700" />
            <p className="text-slate-500 text-sm">Configure a deterministic analysis run</p>
          </div>
        )}

        {executionEvents.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h3 className="mb-3 text-sm font-semibold text-white">Live Trace</h3>
            <div className="space-y-2">
              {executionEvents.map((event, index) => (
                <div key={`${event.event_type}-${event.sequence ?? index}-${index}`} className="rounded-lg bg-slate-800/50 p-3">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-cyan-300">{event.event_type}</p>
                  <p className="mt-1 text-sm text-slate-300">{JSON.stringify(event.payload)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
