'use client';

import { useEffect, useMemo, useState } from 'react';
import { getArtifacts, getStoryBible, listProjects, runProjectAgent } from '@/lib/api';
import type { AgentResponsePayload, Artifact, GateVerdict, StoryBible, StudioProject } from '@/lib/types';

type WritingAgentId = 'ingestion' | 'writer' | 'critique' | 'narrative' | 'character' | 'worldbuilding';
type TabKey = 'agents' | 'story' | 'chat';

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  agent?: string;
  content: string;
  gateVerdict?: GateVerdict | null;
}

const CHAT_AGENTS: Array<{ id: WritingAgentId; label: string }> = [
  { id: 'writer', label: 'Writer' },
  { id: 'narrative', label: 'Narrative' },
  { id: 'character', label: 'Character' },
  { id: 'critique', label: 'Critique Gate' },
  { id: 'worldbuilding', label: 'Worldbuilding Gate' },
];

export default function WritingStudioPage() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [outlineArtifacts, setOutlineArtifacts] = useState<Artifact[]>([]);
  const [editPassArtifacts, setEditPassArtifacts] = useState<Artifact[]>([]);
  const [continuityArtifacts, setContinuityArtifacts] = useState<Artifact[]>([]);
  const [storyBible, setStoryBible] = useState<StoryBible | null>(null);
  const [draftText, setDraftText] = useState('');
  const [chatPrompt, setChatPrompt] = useState('');
  const [chatAgent, setChatAgent] = useState<WritingAgentId>('writer');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [tab, setTab] = useState<TabKey>('agents');
  const [busy, setBusy] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const refreshProjectState = async (nextProjectId: string) => {
    const [outlineData, editData, continuityData, bibleData] = await Promise.all([
      getArtifacts(nextProjectId, 'outline'),
      getArtifacts(nextProjectId, 'edit_pass'),
      getArtifacts(nextProjectId, 'continuity_record'),
      getStoryBible(nextProjectId),
    ]);
    setOutlineArtifacts(outlineData.artifacts);
    setEditPassArtifacts(editData.artifacts);
    setContinuityArtifacts(continuityData.artifacts);
    setStoryBible(
      bibleData.story_bible || {
        characters: {},
        continuity: [],
        timeline: [],
        lore_rules: [],
      }
    );
  };

  useEffect(() => {
    listProjects().then((data) => {
      const writingProjects = data.projects.filter((project) => project.domains.includes('writing'));
      setProjects(writingProjects);
      if (writingProjects[0]) {
        setProjectId(writingProjects[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    refreshProjectState(projectId).catch(() => {
      setOutlineArtifacts([]);
      setEditPassArtifacts([]);
      setContinuityArtifacts([]);
      setStoryBible({ characters: {}, continuity: [], timeline: [], lore_rules: [] });
    });
  }, [projectId]);

  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const outlineLines = useMemo(() => {
    const outline = outlineArtifacts[0]?.content || '';
    return outline
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 12);
  }, [outlineArtifacts]);

  const runAgent = async (agentId: WritingAgentId, userInput?: string) => {
    if (!projectId) return;
    setBusy(agentId);
    setRunError(null);
    try {
      const payload = await runProjectAgent(projectId, 'writing', agentId, {
        session_id: `writing-${projectId}`,
        user_input: userInput || draftText || 'Generate a useful response for the current writing project.',
        context: {
          project_id: projectId,
          project_name: selectedProject?.name,
          story_bible: storyBible,
          outline: outlineArtifacts[0]?.content,
        },
      });
      await refreshProjectState(projectId);
      consumeAgentPayload(payload.response, agentId);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Failed to run agent.');
    } finally {
      setBusy(null);
    }
  };

  const consumeAgentPayload = (payload: AgentResponsePayload, agentId: WritingAgentId) => {
    const gateVerdict = extractGateVerdict(payload.content);
    if (agentId === 'writer' && payload.content) {
      setDraftText(payload.content);
    }
    setChatMessages((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        role: 'agent',
        agent: payload.agent_name,
        content: payload.content,
        gateVerdict,
      },
    ]);
  };

  const sendChat = async () => {
    if (!chatPrompt.trim() || !projectId) return;
    setChatMessages((current) => [
      ...current,
      { id: `${Date.now()}-user`, role: 'user', content: chatPrompt },
    ]);
    const prompt = chatPrompt;
    setChatPrompt('');
    await runAgent(chatAgent, prompt);
  };

  const chapterStatus = continuityArtifacts[0]
    ? 'final'
    : editPassArtifacts[0]
      ? 'gate-passed'
      : 'draft';

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[720px] gap-6">
      <aside className="w-64 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-4">
          <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Project</label>
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          >
            <option value="">Select a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Outline Navigator</h2>
        <div className="mt-3 space-y-2">
          {outlineLines.map((line, index) => (
            <div key={`${line}-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <p className="text-sm text-white">{line}</p>
              <span className="mt-2 inline-flex rounded-full bg-slate-800 px-2 py-1 text-[11px] text-slate-300">
                {chapterStatus}
              </span>
            </div>
          ))}
          {outlineLines.length === 0 && <p className="text-sm text-slate-500">No outline artifact yet.</p>}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Writing Studio</h1>
            <p className="text-sm text-slate-400">Draft, critique, and gate scenes against the story bible.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => runAgent('ingestion')} busy={busy === 'ingestion'} label="Analyze" />
            <ActionButton onClick={() => runAgent('writer')} busy={busy === 'writer'} label="Generate Scene" />
            <ActionButton onClick={() => runAgent('critique')} busy={busy === 'critique'} label="Critique" />
          </div>
        </div>
        {runError && (
          <div className="mt-4 rounded-2xl border border-rose-800/70 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
            {runError}
          </div>
        )}
        <textarea
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          placeholder="Scene draft appears here."
          className="mt-5 min-h-0 flex-1 rounded-2xl border border-slate-800 bg-[#11131a] px-5 py-4 font-serif text-base leading-7 text-slate-100 outline-none"
        />
      </section>

      <aside className="flex w-80 flex-col rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex gap-2">
          <TabButton active={tab === 'agents'} onClick={() => setTab('agents')} label="Agents" />
          <TabButton active={tab === 'story'} onClick={() => setTab('story')} label="Story Bible" />
          <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} label="Chat" />
        </div>

        {tab === 'agents' && (
          <div className="mt-4 space-y-3 overflow-y-auto">
            {CHAT_AGENTS.map((agent) => (
              <div key={agent.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-white">{agent.label}</p>
                  {(agent.id === 'critique' || agent.id === 'worldbuilding') && (
                    <span className="rounded-full bg-rose-500/20 px-2 py-1 text-[11px] text-rose-300">gate</span>
                  )}
                </div>
                <button
                  onClick={() => runAgent(agent.id)}
                  className="mt-3 rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
                >
                  Run
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === 'story' && (
          <div className="mt-4 space-y-4 overflow-y-auto text-sm text-slate-300">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="font-medium text-white">Characters</p>
              <ul className="mt-2 space-y-2">
                {Object.values(storyBible?.characters || {}).slice(0, 5).map((character) => (
                  <li key={character.name}>
                    <p className="font-medium">{character.name}</p>
                    <p className="text-slate-500">{character.role}</p>
                  </li>
                ))}
                {Object.keys(storyBible?.characters || {}).length === 0 && <li className="text-slate-500">No character profiles yet.</li>}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="font-medium text-white">Continuity</p>
              <ul className="mt-2 space-y-2">
                {(storyBible?.continuity || []).slice(0, 5).map((entry, index) => (
                  <li key={`${entry.fact}-${index}`}>{entry.fact}</li>
                ))}
                {(storyBible?.continuity || []).length === 0 && <li className="text-slate-500">No continuity records yet.</li>}
              </ul>
            </div>
          </div>
        )}

        {tab === 'chat' && (
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <div className="mb-3 flex items-center gap-2">
              <select
                value={chatAgent}
                onChange={(event) => setChatAgent(event.target.value as WritingAgentId)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                {CHAT_AGENTS.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
              {chatMessages.map((message) => (
                <div key={message.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {message.role === 'user' ? 'user' : message.agent}
                    </span>
                    {message.gateVerdict && (
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] ${
                          message.gateVerdict.passed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {message.gateVerdict.passed ? 'pass' : 'fail'}
                      </span>
                    )}
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{message.content}</pre>
                  {message.gateVerdict && !message.gateVerdict.passed && message.gateVerdict.revisions.length > 0 && (
                    <details className="mt-3 text-sm text-rose-200">
                      <summary>Revision Instructions</summary>
                      <ul className="mt-2 space-y-1 text-slate-300">
                        {message.gateVerdict.revisions.map((revision, index) => (
                          <li key={`${revision}-${index}`}>• {revision}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <textarea
                value={chatPrompt}
                onChange={(event) => setChatPrompt(event.target.value)}
                className="min-h-24 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                placeholder="Ask the selected writing agent for targeted help."
              />
              <button
                onClick={sendChat}
                className="self-end rounded-full bg-amber-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-300"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function ActionButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full bg-amber-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-300"
    >
      {busy ? 'Running…' : label}
    </button>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm transition ${
        active ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300'
      }`}
    >
      {label}
    </button>
  );
}

function extractGateVerdict(content: string): GateVerdict | null {
  const candidates = [content];
  const fencedMatch = content.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) candidates.push(fencedMatch[1]);
  const jsonMatch = content.match(/\{[\s\S]*"passed"[\s\S]*\}/);
  if (jsonMatch?.[0]) candidates.push(jsonMatch[0]);

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
