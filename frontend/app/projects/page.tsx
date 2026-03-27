'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createProject, fetchHealth, listProjects } from '@/lib/api';
import type { Domain, HealthResponse, StudioProject } from '@/lib/types';

const DOMAINS: Domain[] = ['writing', 'web', 'youtube'];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domains, setDomains] = useState<Domain[]>(['writing']);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const refreshProjects = () => {
    listProjects()
      .then((data) => setProjects(data.projects))
      .catch((err) => setError(String(err)));
  };

  useEffect(() => {
    refreshProjects();
    fetchHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  const toggleDomain = (domain: Domain) => {
    setDomains((current) =>
      current.includes(domain) ? current.filter((value) => value !== domain) : [...current, domain]
    );
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createProject({ name, description, domains });
      setName('');
      setDescription('');
      setDomains(['writing']);
      refreshProjects();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[0.95fr,1.05fr]">
      <div className="space-y-6">
        <form onSubmit={handleCreate} className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-lg font-semibold text-white">Create Project</h2>
          <p className="mt-2 text-sm text-slate-400">
            StudioOS activates the writing, media, and promo workforces from the selected domain set.
          </p>

          <label className="mt-6 block text-sm text-slate-300">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none ring-0"
              placeholder="Test Novel"
              required
            />
          </label>

          <label className="mt-4 block text-sm text-slate-300">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-2 min-h-28 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none"
              placeholder="What this project is for."
            />
          </label>

          <div className="mt-4">
            <p className="text-sm text-slate-300">Domains</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {DOMAINS.map((domain) => {
                const active = domains.includes(domain);
                return (
                  <button
                    key={domain}
                    type="button"
                    onClick={() => toggleDomain(domain)}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      active
                        ? 'border-amber-400 bg-amber-400/15 text-amber-200'
                        : 'border-slate-700 bg-slate-950 text-slate-300'
                    }`}
                  >
                    {domain}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="mt-6 rounded-full bg-amber-400 px-5 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-amber-300 disabled:opacity-60"
          >
            {saving ? 'Creating…' : 'Create Project'}
          </button>
        </form>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-lg font-semibold text-white">Storage & Import</h2>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            <p>
              Project records are stored in{' '}
              <span className="font-mono text-slate-200">{health?.database_url ?? 'Loading storage path…'}</span>
            </p>
            <p>
              Imported project files are stored under{' '}
              <span className="font-mono text-slate-200">
                {health ? `${health.upload_dir}/<project_id>/` : 'Loading upload path…'}
              </span>
            </p>
            <p className="text-slate-400">
              Import options now include direct file upload, drag and drop, and full folder import for images, `.mp4`,
              and other supported project assets.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/workspace"
              className="rounded-full bg-amber-400 px-5 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-amber-300"
            >
              Open Workspace Imports
            </Link>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold text-white">Projects</h2>
        <div className="mt-4 space-y-4">
          {projects.map((project) => (
            <article key={project.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-medium text-white">{project.name}</h3>
                  <p className="mt-1 text-sm text-slate-400">{project.description || 'No description yet.'}</p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p>{project.run_count ?? 0} runs</p>
                  <p>{project.artifact_count ?? 0} artifacts</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {project.domains.map((domain) => (
                  <span key={domain} className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">
                    {domain}
                  </span>
                ))}
              </div>
            </article>
          ))}
          {projects.length === 0 && <p className="text-sm text-slate-500">No projects created yet.</p>}
        </div>
      </section>
    </div>
  );
}
