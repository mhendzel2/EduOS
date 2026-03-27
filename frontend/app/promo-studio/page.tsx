'use client';

import { useEffect, useState } from 'react';
import { getArtifacts, listProjects, runProjectAgent } from '@/lib/api';
import type { Artifact, GateVerdict, StudioProject } from '@/lib/types';

export default function PromoStudioPage() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [promoBriefs, setPromoBriefs] = useState<Artifact[]>([]);
  const [hooks, setHooks] = useState<Artifact[]>([]);
  const [clearedHooks, setClearedHooks] = useState<Artifact[]>([]);
  const [calendar, setCalendar] = useState<Artifact[]>([]);
  const [gateVerdict, setGateVerdict] = useState<GateVerdict | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshArtifacts = async (nextProjectId: string) => {
    const [briefData, hookData, clearedData, calendarData] = await Promise.all([
      getArtifacts(nextProjectId, 'promo_brief'),
      getArtifacts(nextProjectId, 'story_hook_set'),
      getArtifacts(nextProjectId, 'spoiler_cleared_hooks'),
      getArtifacts(nextProjectId, 'promo_calendar'),
    ]);
    setPromoBriefs(briefData.artifacts);
    setHooks(hookData.artifacts);
    setClearedHooks(clearedData.artifacts);
    setCalendar(calendarData.artifacts);
  };

  useEffect(() => {
    listProjects().then((data) => {
      const eligible = data.projects.filter(
        (project) =>
          project.domains.includes('writing') &&
          (project.domains.includes('web') || project.domains.includes('youtube'))
      );
      setProjects(data.projects);
      if (eligible[0]) {
        setProjectId(eligible[0].id);
      } else if (data.projects[0]) {
        setProjectId(data.projects[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    refreshArtifacts(projectId).catch(() => {
      setPromoBriefs([]);
      setHooks([]);
      setClearedHooks([]);
      setCalendar([]);
    });
  }, [projectId]);

  const selectedProject = projects.find((project) => project.id === projectId);
  const promoEnabled = Boolean(
    selectedProject &&
      selectedProject.domains.includes('writing') &&
      (selectedProject.domains.includes('web') || selectedProject.domains.includes('youtube'))
  );

  const runPromoAgent = async (agentId: string, prompt: string) => {
    if (!projectId || !promoEnabled) return;
    setBusy(agentId);
    try {
      const response = await runProjectAgent(projectId, 'promo', agentId, {
        session_id: `promo-${projectId}`,
        user_input: prompt,
        context: {
          project_id: projectId,
          promo_brief: promoBriefs[0]?.content,
          hooks: hooks[0]?.content,
          cleared_hooks: clearedHooks[0]?.content,
        },
      });
      setGateVerdict(extractGateVerdict(response.response.content));
      await refreshArtifacts(projectId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">Promo Studio</h1>
            <p className="text-sm text-slate-400">Cross-domain promotion activates only for writing + media projects.</p>
          </div>
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
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
        {!promoEnabled && (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-400">
            Promo Studio is disabled for this project. Select a project with `writing` plus `web` or `youtube`.
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="Campaign Plan"
          actionLabel="Generate Plan"
          busy={busy === 'campaign_planner'}
          disabled={!promoEnabled}
          onAction={() =>
            runPromoAgent(
              'campaign_planner',
              'Create a spoiler-safe campaign plan that ties upcoming story beats to media content.'
            )
          }
          content={promoBriefs[0]?.content || 'No campaign plan yet.'}
        />
        <Panel
          title="Hooks"
          actionLabel="Extract Hooks"
          busy={busy === 'story_hook_extractor'}
          disabled={!promoEnabled}
          onAction={() => runPromoAgent('story_hook_extractor', 'Extract 5 to 8 non-spoiler hooks from the current story material.')}
          content={hooks[0]?.content || 'No hook set yet.'}
        />
        <Panel
          title="Promo Calendar"
          actionLabel="Adapt Content"
          busy={busy === 'promo_adapter'}
          disabled={!promoEnabled}
          onAction={() => runPromoAgent('promo_adapter', 'Adapt the cleared hooks into a platform-specific promo calendar.')}
          content={calendar[0]?.content || 'No promo calendar yet.'}
        />
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Spoiler Guardian</h2>
            <p className="text-sm text-slate-500">All hooks must pass spoiler clearance before downstream promotion.</p>
          </div>
          <button
            onClick={() => runPromoAgent('spoiler_guardian', hooks[0]?.content || 'Review the hook set for spoiler safety.')}
            disabled={!promoEnabled || busy === 'spoiler_guardian'}
            className="rounded-full bg-amber-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-60"
          >
            {busy === 'spoiler_guardian' ? 'Running…' : 'Run Gate'}
          </button>
        </div>
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr,1fr]">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="font-medium text-white">Approved / Rejected Hooks</p>
            <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{clearedHooks[0]?.content || 'No spoiler-cleared hook set yet.'}</pre>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="font-medium text-white">Gate Verdict</p>
            {gateVerdict ? (
              <div className="mt-3 space-y-3 text-sm">
                <span
                  className={`inline-flex rounded-full px-2 py-1 ${
                    gateVerdict.passed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                  }`}
                >
                  {gateVerdict.passed ? 'passed' : 'failed'}
                </span>
                <p className="text-slate-300">{gateVerdict.reason}</p>
                <ul className="space-y-1 text-slate-400">
                  {gateVerdict.revisions.map((revision, index) => (
                    <li key={`${revision}-${index}`}>• {revision}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">No gate verdict recorded yet.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Panel({
  title,
  actionLabel,
  busy,
  disabled,
  onAction,
  content,
}: {
  title: string;
  actionLabel: string;
  busy: boolean;
  disabled: boolean;
  onAction: () => void;
  content: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <button
          onClick={onAction}
          disabled={disabled || busy}
          className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50"
        >
          {busy ? 'Running…' : actionLabel}
        </button>
      </div>
      <pre className="mt-4 min-h-72 whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
        {content}
      </pre>
    </section>
  );
}

function extractGateVerdict(content: string): GateVerdict | null {
  const fencedMatch = content.match(/```json\s*([\s\S]*?)```/i);
  const candidates = [content, fencedMatch?.[1] || ''];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (typeof parsed?.passed === 'boolean') {
        return {
          passed: parsed.passed,
          reason: String(parsed.reason || ''),
          revisions: Array.isArray(parsed.revisions) ? parsed.revisions.map(String) : [],
          blocking: typeof parsed.blocking === 'boolean' ? parsed.blocking : true,
        };
      }
    } catch {}
  }
  return null;
}
