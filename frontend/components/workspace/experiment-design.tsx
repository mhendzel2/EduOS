'use client';

import { useState } from 'react';
import {
  BeakerIcon,
  LightBulbIcon,
  ExclamationTriangleIcon,
  BookOpenIcon,
  ShieldCheckIcon,
  ClipboardDocumentListIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { runExperimentDesign } from '@/lib/api';
import type { ExperimentDesignResponse, ExperimentDesignMethodOption } from '@/lib/types';

interface Props {
  projectId?: string;
}

function MethodCard({ method, accent }: { method: ExperimentDesignMethodOption; accent: 'cyan' | 'violet' }) {
  const [open, setOpen] = useState(false);
  const border = accent === 'cyan' ? 'border-cyan-700/40' : 'border-violet-700/40';
  const bg = accent === 'cyan' ? 'bg-cyan-500/10' : 'bg-violet-500/10';
  const tag = accent === 'cyan' ? 'text-cyan-300' : 'text-violet-300';

  return (
    <div className={`rounded-lg border ${border} ${bg} p-4`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <h4 className={`font-semibold ${tag}`}>{method.name}</h4>
        {open ? (
          <ChevronDownIcon className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRightIcon className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {method.description && (
        <p className="mt-2 text-sm text-slate-300 leading-relaxed">{method.description}</p>
      )}
      {open && (
        <div className="mt-3 space-y-2 text-sm">
          {method.strengths.length > 0 && (
            <div>
              <span className="font-medium text-emerald-400">Strengths:</span>
              <ul className="ml-4 mt-1 list-disc text-slate-300">
                {method.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {method.limitations.length > 0 && (
            <div>
              <span className="font-medium text-amber-400">Limitations:</span>
              <ul className="ml-4 mt-1 list-disc text-slate-300">
                {method.limitations.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {method.estimated_timeline && (
            <p className="text-slate-400">Timeline: {method.estimated_timeline}</p>
          )}
          {method.estimated_cost_level && (
            <p className="text-slate-400">Cost: {method.estimated_cost_level}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-slate-800/50 transition-colors"
      >
        <Icon className="h-5 w-5 text-cyan-300 flex-shrink-0" />
        <h3 className="flex-1 font-semibold text-white text-sm">{title}</h3>
        {open ? (
          <ChevronDownIcon className="h-4 w-4 text-slate-500" />
        ) : (
          <ChevronRightIcon className="h-4 w-4 text-slate-500" />
        )}
      </button>
      {open && <div className="border-t border-slate-800 px-5 py-4">{children}</div>}
    </section>
  );
}

export default function ExperimentDesign({ projectId }: Props) {
  const [question, setQuestion] = useState('');
  const [proposedMethod, setProposedMethod] = useState('');
  const [organism, setOrganism] = useState('');
  const [field, setField] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExperimentDesignResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await runExperimentDesign({
        question: question.trim(),
        proposed_method: proposedMethod.trim() || undefined,
        organism: organism.trim() || undefined,
        field_of_study: field.trim() || undefined,
        project_id: projectId,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Experiment design analysis failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Input Form */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-cyan-500/15 p-2">
            <BeakerIcon className="h-5 w-5 text-cyan-300" />
          </div>
          <div>
            <h2 className="font-semibold text-white">Experiment Design Assistant</h2>
            <p className="text-xs text-slate-400">
              Describe your experimental question and the AI will survey available methods, provide protocols, and share practical tips.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Experimental Question or Hypothesis *
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g., How can I measure the effect of a small molecule inhibitor on chromatin loop extrusion in live cells?"
              rows={3}
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none resize-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Proposed Method <span className="text-slate-500">(optional)</span>
            </label>
            <textarea
              value={proposedMethod}
              onChange={(e) => setProposedMethod(e.target.value)}
              placeholder="e.g., I was thinking of using Hi-C after drug treatment, but I'm open to alternatives."
              rows={2}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none resize-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Model Organism / System
              </label>
              <input
                type="text"
                value={organism}
                onChange={(e) => setOrganism(e.target.value)}
                placeholder="e.g., human HCT116 cells, C. elegans, mouse"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Field of Study
              </label>
              <input
                type="text"
                value={field}
                onChange={(e) => setField(e.target.value)}
                placeholder="e.g., chromatin biology, neuroscience, oncology"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <>
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                Analysing methods and building protocol…
              </>
            ) : (
              <>
                <BeakerIcon className="h-4 w-4" />
                Design Experiment
              </>
            )}
          </button>
        </form>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 p-4 text-sm text-red-300">{error}</div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Recommended Methods */}
          {result.recommended_methods.length > 0 && (
            <Section title="Recommended Methods" icon={BeakerIcon}>
              <div className="space-y-3">
                {result.recommended_methods.map((m, i) => (
                  <MethodCard key={i} method={m} accent="cyan" />
                ))}
              </div>
            </Section>
          )}

          {/* Alternative Approaches */}
          {result.alternative_approaches.length > 0 && (
            <Section title="Alternative Approaches" icon={LightBulbIcon}>
              <div className="space-y-3">
                {result.alternative_approaches.map((m, i) => (
                  <MethodCard key={i} method={m} accent="violet" />
                ))}
              </div>
            </Section>
          )}

          {/* Standard Protocol */}
          {result.standard_protocol && (
            <Section title="Standard Protocol" icon={ClipboardDocumentListIcon}>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                {result.standard_protocol}
              </div>
            </Section>
          )}

          {/* Tips & Tricks */}
          {result.tips_and_tricks.length > 0 && (
            <Section title="Tips &amp; Tricks for Novices" icon={LightBulbIcon}>
              <ul className="space-y-2">
                {result.tips_and_tricks.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="mt-0.5 flex-shrink-0 text-emerald-400">✦</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Common Pitfalls */}
          {result.common_pitfalls.length > 0 && (
            <Section title="Common Pitfalls" icon={ExclamationTriangleIcon}>
              <ul className="space-y-2">
                {result.common_pitfalls.map((pitfall, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="mt-0.5 flex-shrink-0 text-amber-400">⚠</span>
                    {pitfall}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Controls */}
          {result.controls_needed.length > 0 && (
            <Section title="Essential Controls" icon={ShieldCheckIcon}>
              <ul className="space-y-2">
                {result.controls_needed.map((ctrl, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="mt-0.5 flex-shrink-0 text-cyan-400">●</span>
                    {ctrl}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Key References */}
          {result.key_references.length > 0 && (
            <Section title="Key References" icon={BookOpenIcon} defaultOpen={false}>
              <ul className="space-y-2">
                {result.key_references.map((ref, i) => (
                  <li key={i} className="text-sm text-slate-300">
                    <span className="mr-2 text-slate-500">[{i + 1}]</span>
                    {ref}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Raw AI Output */}
          <div className="rounded-xl border border-slate-800 bg-slate-900">
            <button
              type="button"
              onClick={() => setShowRaw(!showRaw)}
              className="flex w-full items-center gap-2 px-5 py-3 text-left text-xs text-slate-500 hover:bg-slate-800/50 transition-colors"
            >
              {showRaw ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
              Full AI analysis output
            </button>
            {showRaw && (
              <div className="border-t border-slate-800 px-5 py-4">
                <div className="max-h-96 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-400">
                  {result.raw_analysis}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900/50 py-16 text-center">
          <BeakerIcon className="mb-3 h-10 w-10 text-slate-700" />
          <p className="text-sm text-slate-500">
            Describe your experimental question and the AI will survey methods, protocols, and practical tips
          </p>
        </div>
      )}
    </div>
  );
}
