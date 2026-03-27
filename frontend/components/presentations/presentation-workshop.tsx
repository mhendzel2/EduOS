'use client';

import { useState } from 'react';
import {
  ArrowDownTrayIcon,
  FilmIcon,
  GlobeAltIcon,
  MusicalNoteIcon,
  PhotoIcon,
  PresentationChartBarIcon,
  SpeakerWaveIcon,
} from '@heroicons/react/24/outline';
import {
  exportDocx,
  exportPptx,
  gatherWebContent,
  generateAudioOverview,
  generateInfographic,
  generatePresentationPlan,
  generateVideoScript,
} from '@/lib/api';

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function PresentationWorkshop() {
  const [theme, setTheme] = useState('How chromatin architecture shapes gene regulation in cancer');
  const [audience, setAudience] = useState('scientific');
  const [duration, setDuration] = useState(15);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [plan, setPlan] = useState<any>(null);
  const [infographic, setInfographic] = useState<any>(null);
  const [videoScript, setVideoScript] = useState<any>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [loadingInfographic, setLoadingInfographic] = useState(false);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function exportPresentationDeck() {
    if (!plan?.slides?.length) return;
    setError(null);
    try {
      const content = plan.slides
        .map((slide: any) => `Slide ${slide.slide_number}: ${slide.title}\n${slide.content}\nSpeaker notes: ${slide.speaker_notes || ''}\nVisual: ${slide.visual_suggestion || ''}`)
        .join('\n\n');
      const response = await exportPptx({ title: theme, content });
      const blob = await response.blob();
      downloadBlob(blob, 'presentation-workshop-deck.pptx');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export PowerPoint deck');
    }
  }

  async function exportPresentationBrief() {
    if (!plan?.slides?.length) return;
    setError(null);
    try {
      const content = [
        `Theme: ${theme}`,
        `Audience: ${audience}`,
        `Duration: ${duration} minutes`,
        '',
        'Slides:',
        ...plan.slides.map((slide: any) => `${slide.slide_number}. ${slide.title}\n${slide.content}\nNotes: ${slide.speaker_notes || ''}`),
        '',
        'Narration Script:',
        plan.narration_script || '',
      ].join('\n');
      const response = await exportDocx({ title: `${theme} Brief`, content });
      const blob = await response.blob();
      downloadBlob(blob, 'presentation-workshop-brief.docx');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export presentation brief');
    }
  }

  function downloadInfographicSvg() {
    if (!infographic?.svg_code) return;
    const blob = new Blob([infographic.svg_code], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, 'presentation-infographic.svg');
  }

  async function buildNarrationAudio() {
    if (!videoScript?.script) return;
    setLoadingAudio(true);
    setError(null);
    try {
      const result = await generateAudioOverview({
        text: videoScript.script,
        title: `${theme} narration`,
        instructions: `Create a polished ${audience} presentation narration with cinematic pacing.`,
      });
      const binary = atob(result.audio_b64 || '');
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setAudioUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return url;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate narration audio');
    } finally {
      setLoadingAudio(false);
    }
  }

  async function loadSource() {
    if (!sourceUrl.trim()) return;
    setLoadingSource(true);
    setError(null);
    try {
      const result = await gatherWebContent({ url: sourceUrl, extract_type: 'markdown' });
      setSourceContent(result.markdown || result.article?.textContent || JSON.stringify(result, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to gather web content');
    } finally {
      setLoadingSource(false);
    }
  }

  async function buildPlan() {
    setLoadingPlan(true);
    setError(null);
    try {
      const result = await generatePresentationPlan({
        theme,
        audience,
        duration_minutes: duration,
        sources: sourceContent ? [sourceContent.slice(0, 4000)] : [],
      });
      setPlan(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate presentation plan');
    } finally {
      setLoadingPlan(false);
    }
  }

  async function buildInfographic() {
    setLoadingInfographic(true);
    setError(null);
    try {
      const result = await generateInfographic({
        topic: theme,
        audience,
        style: 'scientific cinematic',
        key_points: plan?.slides?.slice(0, 5).map((slide: any) => slide.title) || [],
      });
      setInfographic(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate infographic');
    } finally {
      setLoadingInfographic(false);
    }
  }

  async function buildVideoScript() {
    setLoadingVideo(true);
    setError(null);
    try {
      const result = await generateVideoScript({
        topic: theme,
        audience,
        narration_style: 'cinematic scientific',
        duration_seconds: duration * 60,
        key_points: plan?.slides?.slice(0, 6).map((slide: any) => slide.title) || [],
      });
      setVideoScript(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate video script');
    } finally {
      setLoadingVideo(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_rgba(15,23,42,0.96)_38%,_rgba(2,6,23,1)_100%)] p-6">
        <div className="text-xs uppercase tracking-[0.24em] text-cyan-300">NotebookLM media studio</div>
        <h2 className="mt-2 text-2xl font-semibold text-white">Presentation workshop for slide decks, infographics, and cinematic science videos</h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
          This workshop gathers source material with the AI-operated browser, prepares NotebookLM-ready context, plans the presentation structure, and generates visual assets for talks, outreach, and polished scientific storytelling.
        </p>
      </div>

      {error && <div className="rounded-2xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <SectionCard title="Presentation brief">
            <div className="grid gap-4">
              <label className="block text-sm text-slate-300">
                Theme
                <textarea value={theme} onChange={(e) => setTheme(e.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white focus:border-cyan-500 focus:outline-none" />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-sm text-slate-300">
                  Audience
                  <input value={audience} onChange={(e) => setAudience(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none" />
                </label>
                <label className="block text-sm text-slate-300">
                  Duration (minutes)
                  <input type="number" min={1} max={120} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 1)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none" />
                </label>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Gather source material with browser + RAG prep">
            <label className="block text-sm text-slate-300">
              Source URL
              <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none" />
            </label>
            <button onClick={loadSource} disabled={loadingSource || !sourceUrl.trim()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">
              <GlobeAltIcon className="h-4 w-4" />
              {loadingSource ? 'Gathering content...' : 'Gather web content'}
            </button>
            <div className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950/70 p-4 text-sm leading-6 text-slate-300">
              {sourceContent || 'Readable source content extracted by the browser will appear here and can be used as NotebookLM-ready input.'}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Generate slide plan">
            <div className="flex flex-wrap gap-3">
              <button onClick={buildPlan} disabled={loadingPlan} className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">
                <PresentationChartBarIcon className="h-4 w-4" />
                {loadingPlan ? 'Building plan...' : 'Build presentation plan'}
              </button>
              <button onClick={buildInfographic} disabled={loadingInfographic || !plan} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60">
                <PhotoIcon className="h-4 w-4" />
                {loadingInfographic ? 'Creating infographic...' : 'Create infographic'}
              </button>
              <button onClick={buildVideoScript} disabled={loadingVideo || !plan} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60">
                <FilmIcon className="h-4 w-4" />
                {loadingVideo ? 'Writing video script...' : 'Create cinematic video script'}
              </button>
              <button onClick={exportPresentationDeck} disabled={!plan?.slides?.length} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60">
                <ArrowDownTrayIcon className="h-4 w-4" /> Export PPTX
              </button>
              <button onClick={exportPresentationBrief} disabled={!plan?.slides?.length} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60">
                <ArrowDownTrayIcon className="h-4 w-4" /> Export DOCX
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {plan?.slides?.length ? plan.slides.map((slide: any) => (
                <div key={slide.slide_number} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-cyan-300">Slide {slide.slide_number}</div>
                  <h3 className="mt-1 text-sm font-semibold text-white">{slide.title}</h3>
                  <p className="mt-2 text-sm text-slate-300">{slide.content}</p>
                  {slide.visual_suggestion && <p className="mt-2 text-xs text-slate-500">Visual: {slide.visual_suggestion}</p>}
                </div>
              )) : (
                <p className="text-sm text-slate-400">The slide-by-slide presentation plan will appear here.</p>
              )}
            </div>
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Infographic output">
              <div className="space-y-3 text-sm text-slate-300">
                <div>{infographic?.layout_description || 'Infographic layout description will appear here.'}</div>
                {infographic?.color_palette?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {infographic.color_palette.map((color: string) => (
                      <div key={color} className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
                        {color}
                      </div>
                    ))}
                  </div>
                ) : null}
                {infographic?.svg_code ? (
                  <>
                    <button onClick={downloadInfographicSvg} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white">
                      <ArrowDownTrayIcon className="h-4 w-4" /> Download SVG asset
                    </button>
                    <div className="rounded-xl border border-slate-800 bg-white p-2 text-slate-900" dangerouslySetInnerHTML={{ __html: infographic.svg_code }} />
                  </>
                ) : null}
              </div>
            </SectionCard>

            <SectionCard title="Cinematic video script">
              <div className="space-y-3 text-sm text-slate-300">
                <div className="whitespace-pre-wrap">{videoScript?.script || 'Narration script and scene plan will appear here.'}</div>
                <div className="flex flex-wrap gap-3">
                  <button onClick={buildNarrationAudio} disabled={loadingAudio || !videoScript?.script} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60">
                    <SpeakerWaveIcon className="h-4 w-4" /> {loadingAudio ? 'Generating audio...' : 'Generate narration audio'}
                  </button>
                  {audioUrl ? (
                    <a href={audioUrl} download="presentation-narration.wav" className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white">
                      <ArrowDownTrayIcon className="h-4 w-4" /> Download WAV
                    </a>
                  ) : null}
                </div>
                {audioUrl ? <audio controls className="w-full"><source src={audioUrl} type="audio/wav" /></audio> : null}
                {videoScript?.audio_cues?.length ? (
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                      <MusicalNoteIcon className="h-4 w-4" /> Audio cues
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {videoScript.audio_cues.map((cue: string) => (
                        <span key={cue} className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{cue}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}
