'use client';

import { useState } from 'react';
import { callWorkforceAgent } from '@/lib/api';
import type { AgentResponsePayload } from '@/lib/types';

const WORKFORCES = [
  {
    name: 'Coordination',
    workforce: 'coordination',
    agents: [
      { id: 'director', role: 'Execution brief and cross-workforce coordination', isGate: false },
    ],
  },
  {
    name: 'Writing',
    workforce: 'writing',
    agents: [
      { id: 'outline', role: 'Outline generation', isGate: false },
      { id: 'writer', role: 'Scene drafting', isGate: false },
      { id: 'critique', role: 'Scene quality gate', isGate: true },
      { id: 'worldbuilding', role: 'Continuity gate', isGate: true },
      { id: 'character', role: 'Character voice review', isGate: false },
    ],
  },
  {
    name: 'Media',
    workforce: 'media',
    agents: [
      { id: 'research', role: 'Research briefing', isGate: false },
      { id: 'scriptwriter', role: 'Script drafting', isGate: false },
      { id: 'script_critic', role: 'Script gate', isGate: true },
      { id: 'video_critic', role: 'Source video assessment', isGate: false },
      { id: 'video_editor', role: 'Long-form edit planner', isGate: false },
      { id: 'shorts_editor', role: 'Shorts edit planner', isGate: false },
      { id: 'channel_brand', role: 'Channel branding package', isGate: false },
      { id: 'seo', role: 'YouTube and web metadata', isGate: false },
      { id: 'thumbnail_brief', role: 'Thumbnail briefing', isGate: false },
      { id: 'visual_critic', role: 'Thumbnail gate', isGate: true },
      { id: 'audio_planner', role: 'Audio coverage plan', isGate: false },
      { id: 'assembly_planner', role: 'Release assembly plan', isGate: false },
      { id: 'distribution_manager', role: 'YouTube and web distribution package', isGate: false },
      { id: 'brand_manager', role: 'Brand gate', isGate: true },
      { id: 'site_manager', role: 'Final publish package', isGate: false },
    ],
  },
  {
    name: 'Promo',
    workforce: 'promo',
    agents: [
      { id: 'campaign_planner', role: 'Campaign sequencing', isGate: false },
      { id: 'story_hook_extractor', role: 'Story hook extraction', isGate: false },
      { id: 'spoiler_guardian', role: 'Spoiler gate', isGate: true },
      { id: 'promo_adapter', role: 'Platform adaptation', isGate: false },
    ],
  },
];

export default function AgentsPage() {
  const [testPrompt, setTestPrompt] = useState('Create a concise test output.');
  const [selected, setSelected] = useState<{ workforce: string; agentId: string } | null>(null);
  const [response, setResponse] = useState<AgentResponsePayload | null>(null);
  const [loading, setLoading] = useState(false);

  const runTest = async (workforce: string, agentId: string) => {
    setLoading(true);
    setSelected({ workforce, agentId });
    try {
      const result = await callWorkforceAgent(workforce, agentId, {
        session_id: 'frontend-agent-test',
        user_input: testPrompt,
        context: { source: 'agents_page' },
      });
      setResponse(result);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold text-white">Workforce Test Bench</h2>
        <textarea
          value={testPrompt}
          onChange={(event) => setTestPrompt(event.target.value)}
          className="mt-4 min-h-28 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {WORKFORCES.map((workforce) => (
          <section key={workforce.workforce} className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h3 className="text-lg font-semibold text-white">{workforce.name}</h3>
            <div className="mt-4 space-y-3">
              {workforce.agents.map((agent) => (
                <div key={agent.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{agent.id}</p>
                      <p className="text-sm text-slate-400">{agent.role}</p>
                    </div>
                    {agent.isGate && <span className="rounded-full bg-rose-500/20 px-2 py-1 text-xs text-rose-300">gate</span>}
                  </div>
                  <button
                    onClick={() => runTest(workforce.workforce, agent.id)}
                    className="mt-4 rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
                  >
                    Test
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold text-white">Latest Test Response</h2>
        {!selected && <p className="mt-4 text-sm text-slate-500">Select an agent to run a direct test call.</p>}
        {selected && (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="text-sm text-slate-500">
              {selected.workforce}.{selected.agentId} {loading ? 'running…' : 'completed'}
            </p>
            <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{response?.content || 'No response yet.'}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
