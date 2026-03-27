'use client';

import { useEffect, useState } from 'react';
import { getArtifacts, getStoryBible, listProjects, updateStoryBible } from '@/lib/api';
import type { Artifact, StoryBible, StudioProject } from '@/lib/types';

const EMPTY_BIBLE: StoryBible = {
  characters: {},
  continuity: [],
  timeline: [],
  lore_rules: [],
};

export default function StoryBiblePage() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [bible, setBible] = useState<StoryBible>(EMPTY_BIBLE);
  const [jsonDraft, setJsonDraft] = useState(JSON.stringify(EMPTY_BIBLE, null, 2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
    getStoryBible(projectId).then((data) => {
      const nextBible = { ...EMPTY_BIBLE, ...(data.story_bible || {}) };
      setBible(nextBible);
      setJsonDraft(JSON.stringify(nextBible, null, 2));
      setError('');
    });
  }, [projectId]);

  const saveBible = async () => {
    if (!projectId) return;
    setSaving(true);
    setError('');
    try {
      const parsed = parseStoryBibleDraft(jsonDraft);
      setBible(parsed);
      setJsonDraft(JSON.stringify(parsed, null, 2));
      await updateStoryBible(projectId, parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save story bible.');
    } finally {
      setSaving(false);
    }
  };

  const syncFromLastRun = async () => {
    if (!projectId) return;
    const [continuityData, characterData] = await Promise.all([
      getArtifacts(projectId, 'continuity_record'),
      getArtifacts(projectId, 'character_bible'),
    ]);
    const merged = mergeBibleFromArtifacts(bible, continuityData.artifacts, characterData.artifacts);
    setBible(merged);
    setJsonDraft(JSON.stringify(merged, null, 2));
    setError('');
    await updateStoryBible(projectId, merged);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">Story Bible</h1>
            <p className="text-sm text-slate-400">Character, continuity, timeline, and lore state for writing projects.</p>
          </div>
          <div className="flex gap-2">
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
            <button
              onClick={syncFromLastRun}
              className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-white"
            >
              Sync from last run
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Characters</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {Object.values(bible.characters || {}).map((character) => (
                <div key={character.name} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="font-medium text-white">{character.name}</p>
                  <p className="text-sm text-slate-500">{character.role}</p>
                  <p className="mt-3 text-sm text-slate-300">{character.arc_status}</p>
                  <details className="mt-3 text-sm text-slate-400">
                    <summary>View details</summary>
                    <p className="mt-2">{character.description}</p>
                    <p className="mt-2">{character.motivation}</p>
                    <p className="mt-2">{character.voice_notes}</p>
                  </details>
                </div>
              ))}
              {Object.keys(bible.characters || {}).length === 0 && <p className="text-sm text-slate-500">No character profiles yet.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Continuity</h2>
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-950/80 text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Fact</th>
                    <th className="px-4 py-3">Established In</th>
                    <th className="px-4 py-3">Canon</th>
                  </tr>
                </thead>
                <tbody>
                  {bible.continuity.map((entry, index) => (
                    <tr key={`${entry.fact}-${index}`} className="border-t border-slate-800 bg-slate-950/40 text-slate-300">
                      <td className="px-4 py-3">{entry.fact}</td>
                      <td className="px-4 py-3">{entry.established_in}</td>
                      <td className="px-4 py-3">{entry.canon ? 'Canon' : 'Disputed'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {bible.continuity.length === 0 && <p className="p-4 text-sm text-slate-500">No continuity records yet.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Timeline & Lore</h2>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-white">Timeline</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  {bible.timeline.map((event, index) => (
                    <li key={`${event.event}-${index}`}>
                      {event.chapter}: {event.event}
                    </li>
                  ))}
                  {bible.timeline.length === 0 && <li className="text-slate-500">No timeline events yet.</li>}
                </ul>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Lore Rules</p>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-300">
                  {bible.lore_rules.map((rule, index) => (
                    <li key={`${rule}-${index}`}>{rule}</li>
                  ))}
                  {bible.lore_rules.length === 0 && <li className="text-slate-500">No lore rules yet.</li>}
                </ol>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Raw Editor</h2>
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={saveBible}
                disabled={saving}
                className="rounded-full bg-amber-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {error && <p className="text-sm text-rose-300">{error}</p>}
            </div>
          </div>
          <textarea
            value={jsonDraft}
            onChange={(event) => setJsonDraft(event.target.value)}
            className="mt-4 min-h-[42rem] w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-4 font-mono text-sm text-slate-200"
          />
        </section>
      </div>
    </div>
  );
}

function mergeBibleFromArtifacts(base: StoryBible, continuityArtifacts: Artifact[], characterArtifacts: Artifact[]): StoryBible {
  const next = {
    ...base,
    characters: { ...(base.characters || {}) },
    continuity: [...(base.continuity || [])],
  };

  if (continuityArtifacts[0]?.content) {
    next.continuity.unshift({
      fact: continuityArtifacts[0].content,
      established_in: 'latest_run',
      canon: true,
    });
  }

  const parsedCharacters = safeParseObject(characterArtifacts[0]?.content);
  const parsedMap = parsedCharacters.characters || parsedCharacters;
  if (parsedMap && typeof parsedMap === 'object') {
    for (const [key, value] of Object.entries(parsedMap)) {
      if (value && typeof value === 'object') {
        next.characters[key] = {
          name: String((value as Record<string, unknown>).name || key),
          role: String((value as Record<string, unknown>).role || ''),
          description: String((value as Record<string, unknown>).description || ''),
          motivation: String((value as Record<string, unknown>).motivation || ''),
          voice_notes: String((value as Record<string, unknown>).voice_notes || ''),
          arc_status: String((value as Record<string, unknown>).arc_status || ''),
        };
      }
    }
  }

  return next;
}

function safeParseObject(value?: string): Record<string, any> {
  if (!value) return {};
  const fenced = value.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidates = [value, fenced || ''];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  return {};
}

function parseStoryBibleDraft(rawValue: string): StoryBible {
  const source = rawValue.trim();
  if (!source) {
    return EMPTY_BIBLE;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(formatJsonError(error));
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Story Bible must be a JSON object.');
  }

  return parsed as StoryBible;
}

function formatJsonError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Invalid JSON.';
}
