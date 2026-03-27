'use client';

import { useEffect, useMemo, useState } from 'react';
import { listProjects, listProjectRuns } from '@/lib/api';
import type { RunRecord, StudioProject } from '@/lib/types';

export default function DashboardPage() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);

  useEffect(() => {
    listProjects()
      .then(async (data) => {
        setProjects(data.projects);
        const first = data.projects[0];
        if (first) {
          const runData = await listProjectRuns(first.id);
          setRuns(runData.runs);
        }
      })
      .catch(() => {
        setProjects([]);
        setRuns([]);
      });
  }, []);

  const stats = useMemo(() => {
    const totalRuns = projects.reduce((sum, project) => sum + (project.run_count ?? 0), 0);
    const totalArtifacts = projects.reduce((sum, project) => sum + (project.artifact_count ?? 0), 0);
    const mixedDomain = projects.filter((project) => project.domains.length > 1).length;
    return { totalRuns, totalArtifacts, mixedDomain };
  }, [projects]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Metric title="Projects" value={String(projects.length)} />
        <Metric title="Runs" value={String(stats.totalRuns)} />
        <Metric title="Artifacts" value={String(stats.totalArtifacts)} />
        <Metric title="Cross-Domain" value={String(stats.mixedDomain)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-lg font-semibold text-white">Project Mix</h2>
          <div className="mt-4 space-y-3">
            {projects.map((project) => (
              <div key={project.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{project.name}</p>
                    <p className="mt-1 text-sm text-slate-400">{project.description || 'No description yet.'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {project.domains.map((domain) => (
                      <span key={domain} className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">
                        {domain}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {projects.length === 0 && <p className="text-sm text-slate-500">No projects available.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-lg font-semibold text-white">Latest Run Events</h2>
          <div className="mt-4 space-y-3">
            {runs.slice(0, 5).map((run) => (
              <div key={run.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{run.run_type}</span>
                  <span className="text-xs text-slate-500">{run.status}</span>
                </div>
                <p className="mt-2 text-sm text-slate-400">{run.task}</p>
              </div>
            ))}
            {runs.length === 0 && <p className="text-sm text-slate-500">Run activity appears here after pipeline execution.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </div>
  );
}
