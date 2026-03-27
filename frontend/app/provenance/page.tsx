'use client';

import { useEffect, useState } from 'react';
import { getRun, listProjectRuns, listProjects } from '@/lib/api';
import type { RunRecord, StudioProject } from '@/lib/types';

export default function ProvenancePage() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);

  useEffect(() => {
    listProjects().then((data) => {
      setProjects(data.projects);
      if (data.projects[0]) {
        setProjectId(data.projects[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    listProjectRuns(projectId).then((data) => {
      setRuns(data.runs);
      setSelectedRun(data.runs[0] ?? null);
    });
  }, [projectId]);

  const loadRun = async (runId: string) => {
    const run = await getRun(runId);
    setSelectedRun(run);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr,1.2fr]">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold text-white">Run History</h2>
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
        >
          <option value="">Select a project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <div className="mt-4 space-y-3">
          {runs.map((run) => (
            <button
              key={run.id}
              onClick={() => loadRun(run.id)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-left transition hover:border-slate-700"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">{run.run_type}</span>
                <span className="text-xs text-slate-500">{run.status}</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">{run.task}</p>
            </button>
          ))}
          {runs.length === 0 && <p className="text-sm text-slate-500">No runs recorded for this project.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold text-white">Run Events</h2>
        {!selectedRun && <p className="mt-4 text-sm text-slate-500">Select a run to inspect its event stream.</p>}
        {selectedRun && (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <p className="font-medium text-white">{selectedRun.task}</p>
              <p className="mt-2 text-sm text-slate-400">{selectedRun.final_output || 'No final output saved.'}</p>
            </div>
            {selectedRun.events.map((event) => (
              <div key={`${event.sequence}-${event.event_type}`} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">{event.event_type}</span>
                  <span className="text-xs text-slate-500">#{event.sequence}</span>
                </div>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-slate-400">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
