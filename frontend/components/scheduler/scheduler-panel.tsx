'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowPathIcon,
  ClockIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  TrashIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import {
  listScheduledTasks,
  createScoutTask,
  toggleScheduledTask,
  runTaskNow,
  deleteScheduledTask,
  getSchedulerStatus,
  listProjects,
  type ScheduledTask,
} from '@/lib/api';
import type { Project } from '@/lib/types';

const STATUS_STYLES: Record<string, string> = {
  success: 'bg-green-500/20 text-green-400',
  error: 'bg-red-500/20 text-red-400',
  running: 'bg-blue-500/20 text-blue-400',
  never: 'bg-slate-700/30 text-slate-500',
};

export default function SchedulerPanel() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [intervalHours, setIntervalHours] = useState(6);
  const [creating, setCreating] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [taskList, status, projectList] = await Promise.all([
        listScheduledTasks(),
        getSchedulerStatus(),
        listProjects(),
      ]);
      setTasks(taskList);
      setSchedulerRunning(status.running);
      setProjects(projectList);
    } catch {
      /* silently fail */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!selectedProject) return;
    setCreating(true);
    try {
      const t = await createScoutTask({ project_id: selectedProject, interval_hours: intervalHours });
      setTasks(prev => [t, ...prev]);
      setShowCreate(false);
      setSelectedProject('');
    } catch {
      /* silently fail */
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (task: ScheduledTask) => {
    try {
      const updated = await toggleScheduledTask(task.id, !task.enabled);
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    } catch { /* ignore */ }
  };

  const handleRunNow = async (task: ScheduledTask) => {
    setRunningIds(prev => new Set(prev).add(task.id));
    try {
      const updated = await runTaskNow(task.id);
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    } catch { /* ignore */ }
    finally {
      setRunningIds(prev => { const next = new Set(prev); next.delete(task.id); return next; });
    }
  };

  const handleDelete = async (task: ScheduledTask) => {
    try {
      await deleteScheduledTask(task.id);
      setTasks(prev => prev.filter(t => t.id !== task.id));
    } catch { /* ignore */ }
  };

  const projectName = (id?: string | null) => {
    if (!id) return 'All projects';
    return projects.find(p => p.id === id)?.name ?? id;
  };

  const fmtDate = (d?: string | null) => {
    if (!d) return 'Never';
    return new Date(d).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <ArrowPathIcon className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClockIcon className="h-7 w-7 text-cyan-400" />
          <h1 className="text-2xl font-bold text-white">Research Scout Scheduler</h1>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${schedulerRunning ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${schedulerRunning ? 'bg-green-400' : 'bg-red-400'}`} />
            {schedulerRunning ? 'Running' : 'Stopped'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} title="Refresh" className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition">
            <ArrowPathIcon className="h-4 w-4" />
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 transition">
            <PlusIcon className="h-4 w-4" />
            New Scout Task
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-400">
        <MagnifyingGlassIcon className="inline h-4 w-4 mr-1.5 -mt-0.5 text-cyan-400" />
        Scout agents periodically search <strong className="text-slate-300">PubMed</strong>, <strong className="text-slate-300">bioRxiv</strong>, and <strong className="text-slate-300">academic databases</strong> for new research related to your projects.
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-5 space-y-4">
          <h2 className="text-lg font-semibold text-white">Create Scout Task</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Project</label>
              <select
                title="Project"
                value={selectedProject}
                onChange={e => setSelectedProject(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              >
                <option value="">Select a project…</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Check interval (hours)</label>
              <input
                title="Interval hours"
                type="number"
                min={1}
                max={168}
                value={intervalHours}
                onChange={e => setIntervalHours(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-600 transition">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={!selectedProject || creating} className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40 transition">
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 p-12 text-center">
          <ClockIcon className="mx-auto h-12 w-12 text-slate-600" />
          <p className="mt-3 text-sm text-slate-400">No scheduled tasks yet.</p>
          <p className="text-xs text-slate-500 mt-1">Create a scout task to monitor new research for your projects.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => (
            <div key={task.id} className={`rounded-lg border bg-slate-800 p-4 transition ${task.enabled ? 'border-slate-700' : 'border-slate-700/50 opacity-60'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-white truncate">{task.name}</h3>
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[task.last_status] ?? STATUS_STYLES.never}`}>
                      {task.last_status === 'success' && <CheckCircleIcon className="h-3 w-3 mr-0.5" />}
                      {task.last_status === 'error' && <ExclamationCircleIcon className="h-3 w-3 mr-0.5" />}
                      {task.last_status}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
                    <span>Project: <span className="text-slate-400">{projectName(task.project_id)}</span></span>
                    <span>Schedule: <span className="text-slate-400">{task.schedule}</span></span>
                    <span>Last run: <span className="text-slate-400">{fmtDate(task.last_run_at)}</span></span>
                  </div>
                  {task.last_result_summary && (
                    <p className="mt-2 text-sm text-slate-400 line-clamp-2">{task.last_result_summary}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleToggle(task)}
                    title={task.enabled ? 'Pause' : 'Resume'}
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white transition"
                  >
                    {task.enabled
                      ? <PauseCircleIcon className="h-5 w-5" />
                      : <PlayCircleIcon className="h-5 w-5" />
                    }
                  </button>
                  <button
                    onClick={() => handleRunNow(task)}
                    disabled={runningIds.has(task.id)}
                    title="Run now"
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-cyan-400 disabled:opacity-30 transition"
                  >
                    <ArrowPathIcon className={`h-5 w-5 ${runningIds.has(task.id) ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => handleDelete(task)}
                    title="Delete"
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-red-400 transition"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
