'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  listCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
  getUpcomingEvents,
  type CalendarEvent,
} from '@/lib/api';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function CalendarPanel() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [upcoming, setUpcoming] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  // New event form
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [location, setLocation] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [color, setColor] = useState(COLORS[0]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = startOfMonth(currentMonth);
      const e = endOfMonth(currentMonth);
      const [evts, up] = await Promise.all([
        listCalendarEvents({ start: s.toISOString(), end: e.toISOString() }),
        getUpcomingEvents(48),
      ]);
      setEvents(evts);
      setUpcoming(up);
    } catch {
      // noop
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => { load(); }, [load]);

  const prevMonth = () => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));

  // Build calendar grid
  const grid = useMemo(() => {
    const first = startOfMonth(currentMonth);
    const last = endOfMonth(currentMonth);
    const startDay = first.getDay(); // 0=Sun
    const days: (Date | null)[] = [];
    for (let i = 0; i < startDay; i++) days.push(null);
    for (let d = 1; d <= last.getDate(); d++) {
      days.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d));
    }
    return days;
  }, [currentMonth]);

  const eventsForDay = (d: Date) =>
    events.filter((ev) => {
      const evDate = new Date(ev.start_time);
      return isSameDay(evDate, d);
    });

  const handleCreate = async () => {
    if (!title || !startTime) return;
    await createCalendarEvent({
      title,
      start_time: new Date(startTime).toISOString(),
      end_time: endTime ? new Date(endTime).toISOString() : undefined,
      description: desc,
      location,
      all_day: allDay,
      color,
    });
    setShowCreate(false);
    setTitle('');
    setDesc('');
    setLocation('');
    setStartTime('');
    setEndTime('');
    setAllDay(false);
    await load();
  };

  const handleDelete = async (id: string) => {
    await deleteCalendarEvent(id);
    await load();
    setSelectedDate(null);
  };

  const today = new Date();

  return (
    <div className="flex h-[calc(100vh-10rem)] gap-4">
      {/* Calendar grid */}
      <div className="flex flex-1 flex-col rounded-xl border border-slate-700 bg-slate-800/50">
        {/* Month header */}
        <div className="flex items-center justify-between border-b border-slate-700 p-3">
          <button onClick={prevMonth} title="Previous month" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white">
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <h3 className="text-sm font-semibold text-white">
            {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </h3>
          <div className="flex gap-1">
            <button onClick={nextMonth} title="Next month" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white">
              <ChevronRightIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-cyan-500 p-1.5 text-slate-950 hover:bg-cyan-400"
              title="New event"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-slate-700 text-center text-[10px] font-medium text-slate-500">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="py-1.5">{d}</div>
          ))}
        </div>

        {/* Days */}
        <div className="grid flex-1 grid-cols-7 auto-rows-fr">
          {grid.map((date, i) => {
            const dayEvents = date ? eventsForDay(date) : [];
            const isToday = date ? isSameDay(date, today) : false;
            const isSelected = date && selectedDate ? isSameDay(date, selectedDate) : false;
            return (
              <div
                key={i}
                onClick={() => date && setSelectedDate(date)}
                className={`cursor-pointer border-b border-r border-slate-700/50 p-1 transition-colors hover:bg-slate-700/30 ${
                  isSelected ? 'bg-slate-700/50' : ''
                }`}
              >
                {date && (
                  <>
                    <span
                      className={`inline-block rounded-full px-1.5 py-0.5 text-[11px] ${
                        isToday ? 'bg-cyan-500 font-bold text-slate-950' : 'text-slate-400'
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {dayEvents.slice(0, 3).map((ev) => (
                      <div
                        key={ev.id}
                        className="mt-0.5 truncate rounded px-1 text-[10px] text-white"
                        style={{ backgroundColor: ev.color + '66' }}
                      >
                        {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="mt-0.5 text-[10px] text-slate-500">+{dayEvents.length - 3} more</div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sidebar: upcoming + day detail */}
      <div className="flex w-80 flex-col gap-4">
        {/* Upcoming events */}
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
          <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold text-white">
            <CalendarDaysIcon className="h-4 w-4 text-cyan-400" />
            Upcoming (48h)
          </h4>
          {upcoming.length === 0 ? (
            <p className="text-xs text-slate-500">No upcoming events</p>
          ) : (
            <ul className="space-y-1.5">
              {upcoming.map((ev) => (
                <li key={ev.id} className="rounded-lg border border-slate-700 p-2">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: ev.color }} />
                    <span className="truncate text-xs font-medium text-white">{ev.title}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {fmtTime(ev.start_time)} – {fmtTime(ev.end_time)}
                  </p>
                  {ev.location && <p className="text-[10px] text-slate-500">{ev.location}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Selected day detail */}
        {selectedDate && (
          <div className="flex-1 overflow-y-auto rounded-xl border border-slate-700 bg-slate-800/50 p-3">
            <h4 className="mb-2 text-xs font-semibold text-white">
              {selectedDate.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h4>
            {eventsForDay(selectedDate).length === 0 ? (
              <p className="text-xs text-slate-500">No events</p>
            ) : (
              <ul className="space-y-2">
                {eventsForDay(selectedDate).map((ev) => (
                  <li key={ev.id} className="rounded-lg border border-slate-700 p-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: ev.color }} />
                          <span className="text-xs font-medium text-white">{ev.title}</span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          {ev.all_day ? 'All day' : `${fmtTime(ev.start_time)} – ${fmtTime(ev.end_time)}`}
                        </p>
                        {ev.location && <p className="text-[10px] text-slate-500">{ev.location}</p>}
                        {ev.description && <p className="mt-1 text-[10px] text-slate-400">{ev.description}</p>}
                      </div>
                      <button
                        onClick={() => handleDelete(ev.id)}
                        title="Delete event"
                        className="rounded p-1 text-slate-500 hover:bg-red-500/20 hover:text-red-400"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Create event modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">New Event</h3>
              <button onClick={() => setShowCreate(false)} title="Close" className="text-slate-400 hover:text-white">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Event title"
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400">Start</label>
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    title="Start date and time"
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">End</label>
                  <input
                    type="datetime-local"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    title="End date and time"
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Location (optional)"
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500"
              />
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500"
              />
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={allDay}
                    onChange={(e) => setAllDay(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-900"
                  />
                  All day
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400">Color:</span>
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      title={`Color ${c}`}
                      className={`h-5 w-5 rounded-full border-2 ${
                        color === c ? 'border-white' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <button
                onClick={handleCreate}
                disabled={!title || !startTime}
                className="w-full rounded-lg bg-cyan-500 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
              >
                Create Event
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
