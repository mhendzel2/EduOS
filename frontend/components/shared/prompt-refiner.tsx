'use client';

/**
 * PromptRefiner — two-step Ollama-powered modal for sharpening research prompts.
 *
 * Phase 1: Ollama asks the user 3-5 clarifying questions that target the five
 *          under-specified dimensions of deep-research prompts: scope,
 *          evidentiary standard, analytical depth, output structure, and
 *          epistemic limits.
 * Phase 2: Ollama takes the original prompt + answers and emits a single,
 *          fully-structured query following the five-section research template.
 *
 * Usage:
 *   <PromptRefiner
 *     initialPrompt={topic}
 *     taskType="deep_research"          // 'deep_research' | 'manuscript' | 'grant'
 *     onAccept={(refined) => setTopic(refined)}
 *     onClose={() => setRefinerOpen(false)}
 *   />
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SparklesIcon, XMarkIcon, ClipboardDocumentCheckIcon } from '@heroicons/react/24/outline';
import { sendLocalChat } from '@/lib/api';
import type { LocalChatMessage } from '@/lib/types';

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const CLARIFY_SYSTEM = `You are a research prompt architect. Your task is to help a researcher refine a vague or underspecified prompt into a rigorous, review-grade query.

Before generating any revised prompt, ask the researcher 3–5 short, targeted clarifying questions that address the dimensions below where their prompt is underspecified:

1. SCOPE — exact system, organism, cell type, tissue, population, or experimental condition; relevant time window of literature; explicit exclusions.
2. EVIDENTIARY STANDARD — primary literature vs reviews; preprints; requirement for contradictory or negative studies.
3. ANALYTICAL DEPTH — mechanistic pathways required or descriptive survey sufficient; causal inference vs correlation; confounder identification.
4. OUTPUT STRUCTURE — which sections are needed (consensus, supporting evidence, contradictory findings, mechanisms, knowledge gaps, testable predictions).
5. EPISTEMIC LIMITS — how uncertainty should be handled; whether speculative claims should be flagged separately from established findings.

Ask each question on its own numbered line. Be concise. Do not ask about anything already clear from the prompt.`;

const REFINE_SYSTEM = `You are a research prompt architect. Based on the researcher's original prompt and their answers to your questions, generate a single fully-specified research query.

Use this exact structure:

"Provide a mechanistic, evidence-based analysis of [specific question].
Scope: [define system, species, conditions, timeframe].
Requirements:
- Prioritize primary literature and clearly distinguish established findings from hypotheses.
- Include conflicting or contradictory evidence and explain discrepancies.
- Provide mechanistic pathways rather than descriptive summaries.
- Identify limitations in existing studies and major knowledge gaps.
- Do not speculate beyond available evidence; explicitly state when data are lacking.
Structure your response as:
1. Current consensus
2. Key evidence (with citations)
3. Contradictory findings
4. Mechanistic interpretation
5. Knowledge gaps
6. Specific experiments that would resolve uncertainties"

Fill in [specific question], the scope statement, and adjust requirements or structural sections to match the answers given. Output ONLY the refined prompt text — no preamble, no explanations, no markdown headers.`;

// For manuscript/grant tasks use a slightly different framing for phase 2.
const REFINE_SYSTEM_WRITING = `You are a research writing prompt architect. Based on the researcher's original request and their answers to your questions, generate a single fully-specified writing or critique prompt that explicitly states:
- The exact document section or task
- The target audience and publication/grant context
- Evidentiary standards required (which claims need citations, which are acceptable assertions)
- Voice, tone, and structural requirements
- Known reviewer concerns or weaknesses to address
- What constitutes a successful output

Output ONLY the refined prompt text — no preamble, no explanations, no markdown headers.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskType = 'deep_research' | 'manuscript' | 'grant';
type Phase = 'asking' | 'answering' | 'refining' | 'done' | 'error';

interface Props {
  initialPrompt: string;
  taskType: TaskType;
  onAccept: (refinedPrompt: string) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PromptRefiner({ initialPrompt, taskType, onAccept, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('asking');
  const [questions, setQuestions] = useState('');
  const [answers, setAnswers] = useState('');
  const [refined, setRefined] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const historyRef = useRef<LocalChatMessage[]>([]);
  const answersRef = useRef<HTMLTextAreaElement>(null);

  const systemPrompt = taskType === 'deep_research'
    ? CLARIFY_SYSTEM
    : CLARIFY_SYSTEM; // same — phase 2 differs

  const refineSystemPrompt = taskType === 'deep_research'
    ? REFINE_SYSTEM
    : REFINE_SYSTEM_WRITING;

  // ── Phase 1: ask clarifying questions immediately on mount ──────────────
  useEffect(() => {
    let cancelled = false;

    async function askQuestions() {
      try {
        const userMessage = `Original prompt: "${initialPrompt}"`;
        const resp = await sendLocalChat({
          message: userMessage,
          history: [],
          model: 'ollama/llama3.2',
          temperature: 0.3,
          context: { system_prompt_override: systemPrompt },
        });

        if (cancelled) return;

        // Store the conversation turn for phase 2.
        historyRef.current = [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: resp.reply },
        ];

        setQuestions(resp.reply);
        setPhase('answering');
        setTimeout(() => answersRef.current?.focus(), 100);
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Ollama request failed. Is Ollama running locally?');
          setPhase('error');
        }
      }
    }

    void askQuestions();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Phase 2: generate refined prompt ────────────────────────────────────
  const handleSubmitAnswers = useCallback(async () => {
    if (!answers.trim()) return;
    setPhase('refining');

    try {
      const history: LocalChatMessage[] = [
        ...historyRef.current,
        { role: 'user', content: answers },
      ];

      const refineMessage =
        'Based on my answers above, produce the fully-specified research prompt now.';

      const resp = await sendLocalChat({
        message: refineMessage,
        history,
        model: 'ollama/llama3.2',
        temperature: 0.2,
        context: { system_prompt_override: refineSystemPrompt },
      });

      setRefined(resp.reply.trim());
      setPhase('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ollama request failed.');
      setPhase('error');
    }
  }, [answers, refineSystemPrompt]);

  const handleAccept = () => {
    onAccept(refined);
    onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <SparklesIcon className="h-5 w-5 text-blue-400" />
            <h2 className="text-base font-semibold text-white">AI Prompt Refinement</h2>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">via Ollama</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close prompt refiner"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-5">
          {/* Original prompt chip */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5">
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Original prompt</p>
            <p className="text-sm text-slate-300 line-clamp-3">{initialPrompt}</p>
          </div>

          {/* Phase: asking */}
          {phase === 'asking' && (
            <div className="flex items-center gap-3 py-6 text-slate-400">
              <svg className="h-5 w-5 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">Ollama is analyzing your prompt and composing clarifying questions…</span>
            </div>
          )}

          {/* Phase: answering */}
          {phase === 'answering' && (
            <>
              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-300">Clarifying questions</p>
                <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {questions}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  Your answers
                  <span className="ml-2 text-xs font-normal text-slate-500">(address each question; you can be brief)</span>
                </label>
                <textarea
                  ref={answersRef}
                  value={answers}
                  onChange={(e) => setAnswers(e.target.value)}
                  rows={6}
                  placeholder="1. Mouse hippocampal neurons, in vitro, 2015–present…&#10;2. Primary literature preferred; reviews acceptable for background…"
                  className="w-full resize-y rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {/* Phase: refining */}
          {phase === 'refining' && (
            <div className="flex items-center gap-3 py-6 text-slate-400">
              <svg className="h-5 w-5 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">Generating structured prompt from your answers…</span>
            </div>
          )}

          {/* Phase: done */}
          {phase === 'done' && (
            <div>
              <label htmlFor="refined-prompt" className="mb-1.5 block text-sm font-medium text-slate-300">Refined prompt</label>
              <textarea
                id="refined-prompt"
                value={refined}
                onChange={(e) => setRefined(e.target.value)}
                rows={10}
                aria-label="Refined research prompt"
                className="w-full resize-y rounded-lg border border-blue-600/50 bg-slate-800 px-3 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1.5 text-xs text-slate-500">You can edit the refined prompt above before accepting it.</p>
            </div>
          )}

          {/* Phase: error */}
          {phase === 'error' && (
            <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>

          {phase === 'answering' && (
            <button
              type="button"
              onClick={() => void handleSubmitAnswers()}
              disabled={!answers.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SparklesIcon className="h-4 w-4" />
              Generate refined prompt
            </button>
          )}

          {phase === 'done' && (
            <button
              type="button"
              onClick={handleAccept}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <ClipboardDocumentCheckIcon className="h-4 w-4" />
              Use this prompt
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
