'use client';

import { useEffect, useMemo, useState } from 'react';

import Button from '@/components/ui/button';
import {
  autocompleteBrandBible,
  getBrandBible,
  listProjects,
  listPromptTemplates,
  updateBrandBible,
} from '@/lib/api';
import type { BrandAutocompleteResponse, BrandBible, PromptTemplate, StudioProject } from '@/lib/types';

const EMPTY_BRAND_BIBLE: BrandBible = {
  brand_name: '',
  voice_tone: '',
  style_guide: {},
  audience_personas: [],
  off_brand_examples: [],
  published_content_index: [],
};

type AutocompleteField =
  | 'brand_name'
  | 'voice_tone'
  | 'style_guide'
  | 'audience_personas'
  | 'off_brand_examples'
  | 'published_content_index'
  | 'all';

export default function BrandBiblePage() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [bible, setBible] = useState<BrandBible>(EMPTY_BRAND_BIBLE);
  const [styleGuideText, setStyleGuideText] = useState('{}');
  const [personasText, setPersonasText] = useState('[]');
  const [publishedText, setPublishedText] = useState('[]');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [aiGuidance, setAiGuidance] = useState('');
  const [aiLoadingField, setAiLoadingField] = useState<AutocompleteField | ''>('');
  const [aiSummary, setAiSummary] = useState('');

  useEffect(() => {
    listProjects()
      .then((data) => {
        const mediaProjects = data.projects.filter(
          (project) => project.domains.includes('web') || project.domains.includes('youtube')
        );
        setProjects(mediaProjects);
        if (mediaProjects[0]) {
          setProjectId(mediaProjects[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load projects.'));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setPrompts([]);
      setSelectedPromptId('');
      return;
    }

    Promise.all([
      getBrandBible(projectId),
      listPromptTemplates({ category: 'brand_autocomplete', projectId }),
    ])
      .then(([brandData, promptData]) => {
        const nextBible = { ...EMPTY_BRAND_BIBLE, ...(brandData.brand_bible || {}) };
        setBible(nextBible);
        setStyleGuideText(JSON.stringify(nextBible.style_guide || {}, null, 2));
        setPersonasText(JSON.stringify(nextBible.audience_personas || [], null, 2));
        setPublishedText(JSON.stringify(nextBible.published_content_index || [], null, 2));
        setPrompts(promptData.prompts);
        setSelectedPromptId((current) => {
          if (current && promptData.prompts.some((prompt) => prompt.id === current)) {
            return current;
          }
          return promptData.prompts[0]?.id || '';
        });
        setError('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load brand bible.'));
  }, [projectId]);

  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedPromptId) || prompts[0] || null,
    [prompts, selectedPromptId]
  );

  const currentDraftBible = (): BrandBible => ({
    ...bible,
    style_guide: safeParseJsonObjectInput(styleGuideText, bible.style_guide || {}),
    audience_personas: safeParseJsonArrayInput(personasText, bible.audience_personas || []),
    published_content_index: safeParseJsonArrayInput(publishedText, bible.published_content_index || []),
  });

  const applyAutocompleteSuggestions = (response: BrandAutocompleteResponse) => {
    const nextBible: BrandBible = {
      ...currentDraftBible(),
      ...(response.suggestions || {}),
      style_guide: response.suggestions.style_guide || currentDraftBible().style_guide,
      audience_personas: response.suggestions.audience_personas || currentDraftBible().audience_personas,
      off_brand_examples: response.suggestions.off_brand_examples || currentDraftBible().off_brand_examples,
      published_content_index: response.suggestions.published_content_index || currentDraftBible().published_content_index,
      brand_name: response.suggestions.brand_name ?? currentDraftBible().brand_name,
      voice_tone: response.suggestions.voice_tone ?? currentDraftBible().voice_tone,
    };

    setBible(nextBible);
    setStyleGuideText(JSON.stringify(nextBible.style_guide || {}, null, 2));
    setPersonasText(JSON.stringify(nextBible.audience_personas || [], null, 2));
    setPublishedText(JSON.stringify(nextBible.published_content_index || [], null, 2));
    setAiSummary(
      [
        response.rationale || `Filled ${response.field} using ${response.prompt_template_name}.`,
        response.context_documents.length > 0 ? `Context: ${response.context_documents.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' ')
    );
  };

  const runAutocomplete = async (field: AutocompleteField) => {
    if (!projectId) return;

    setAiLoadingField(field);
    setError('');
    setSuccess('');
    try {
      const response = await autocompleteBrandBible(projectId, {
        field,
        prompt_template_id: selectedPrompt?.id || null,
        guidance: aiGuidance,
        brand_bible: currentDraftBible(),
      });
      applyAutocompleteSuggestions(response);
      setSuccess(`AI autocomplete updated ${field === 'all' ? 'the brand bible' : field.replaceAll('_', ' ')}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to autocomplete brand bible.');
    } finally {
      setAiLoadingField('');
    }
  };

  const save = async () => {
    if (!projectId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const nextBible: BrandBible = {
        ...bible,
        style_guide: parseJsonObjectInput('Style Guide', styleGuideText),
        audience_personas: parseJsonArrayInput('Audience Personas', personasText),
        published_content_index: parseJsonArrayInput('Published Content Index', publishedText),
      };
      setBible(nextBible);
      setStyleGuideText(JSON.stringify(nextBible.style_guide || {}, null, 2));
      setPersonasText(JSON.stringify(nextBible.audience_personas || [], null, 2));
      setPublishedText(JSON.stringify(nextBible.published_content_index || [], null, 2));
      await updateBrandBible(projectId, nextBible);
      setSuccess('Brand bible saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save brand bible.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr,1fr]">
      <section className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">Brand Bible</h1>
            <p className="text-sm text-slate-400">Voice, style, audience, and publishing history for media projects.</p>
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

        <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">AI Autocomplete</h2>
              <p className="mt-2 text-sm text-slate-400">
                Use reusable prompt templates to expand existing brand guidance from project documents and current brand data.
              </p>
            </div>
            <Button variant="secondary" onClick={() => runAutocomplete('all')} loading={aiLoadingField === 'all'}>
              Fill All
            </Button>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <label className="block text-sm text-slate-300">
              Prompt Template
              <select
                value={selectedPrompt?.id || ''}
                onChange={(event) => setSelectedPromptId(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
              >
                {prompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.name}
                    {prompt.project_id ? ' · project' : ' · global'}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-slate-300">
              Extra Guidance
              <textarea
                value={aiGuidance}
                onChange={(event) => setAiGuidance(event.target.value)}
                placeholder="Optional: emphasize scientific authority, site readability, premium editorial tone, etc."
                className="mt-2 min-h-24 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => runAutocomplete('brand_name')} loading={aiLoadingField === 'brand_name'}>
              Brand Name
            </Button>
            <Button variant="secondary" onClick={() => runAutocomplete('voice_tone')} loading={aiLoadingField === 'voice_tone'}>
              Voice & Tone
            </Button>
            <Button variant="secondary" onClick={() => runAutocomplete('style_guide')} loading={aiLoadingField === 'style_guide'}>
              Style Guide
            </Button>
            <Button
              variant="secondary"
              onClick={() => runAutocomplete('audience_personas')}
              loading={aiLoadingField === 'audience_personas'}
            >
              Audience Personas
            </Button>
            <Button
              variant="secondary"
              onClick={() => runAutocomplete('off_brand_examples')}
              loading={aiLoadingField === 'off_brand_examples'}
            >
              Off-Brand
            </Button>
            <Button
              variant="secondary"
              onClick={() => runAutocomplete('published_content_index')}
              loading={aiLoadingField === 'published_content_index'}
            >
              Published Index
            </Button>
          </div>

          {selectedPrompt && <p className="mt-4 text-sm text-slate-500">{selectedPrompt.description}</p>}
          {aiSummary && <p className="mt-3 text-sm text-cyan-300">{aiSummary}</p>}
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-slate-300">
            Brand Name
            <input
              value={bible.brand_name}
              onChange={(event) => setBible((current) => ({ ...current, brand_name: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Voice & Tone
            <input
              value={bible.voice_tone}
              onChange={(event) => setBible((current) => ({ ...current, voice_tone: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
            />
          </label>
        </div>

        <label className="block text-sm text-slate-300">
          Style Guide
          <textarea
            value={styleGuideText}
            onChange={(event) => setStyleGuideText(event.target.value)}
            className="mt-2 min-h-40 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white"
          />
        </label>

        <label className="block text-sm text-slate-300">
          Audience Personas
          <textarea
            value={personasText}
            onChange={(event) => setPersonasText(event.target.value)}
            className="mt-2 min-h-40 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white"
          />
        </label>

        <label className="block text-sm text-slate-300">
          Off-Brand Examples
          <textarea
            value={bible.off_brand_examples.join('\n')}
            onChange={(event) =>
              setBible((current) => ({
                ...current,
                off_brand_examples: event.target.value
                  .split('\n')
                  .map((value) => value.trim())
                  .filter(Boolean),
              }))
            }
            className="mt-2 min-h-24 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} loading={saving}>
            Save Brand Bible
          </Button>
          {error && <p className="text-sm text-rose-300">{error}</p>}
          {success && <p className="text-sm text-emerald-300">{success}</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold text-white">Published Content Index</h2>
        <textarea
          value={publishedText}
          onChange={(event) => setPublishedText(event.target.value)}
          className="mt-4 min-h-[30rem] w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white"
        />
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="font-medium text-white">Current Summary</p>
          <div className="mt-3 space-y-3 text-sm text-slate-300">
            <p>Brand: {bible.brand_name || 'Unset'}</p>
            <p>Voice: {bible.voice_tone || 'Unset'}</p>
            <p>Off-brand examples: {bible.off_brand_examples.length}</p>
            <p>Prompt library entries: {prompts.length}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function parseJsonObjectInput(valueLabel: string, rawValue: string): Record<string, string> {
  const source = rawValue.trim();
  if (!source) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${valueLabel}: ${formatJsonError(error)}`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${valueLabel} must be a JSON object.`);
  }

  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')])
  );
}

function parseJsonArrayInput<T = any>(valueLabel: string, rawValue: string): T[] {
  const source = rawValue.trim();
  if (!source) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${valueLabel}: ${formatJsonError(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${valueLabel} must be a JSON array.`);
  }

  return parsed as T[];
}

function safeParseJsonObjectInput(rawValue: string, fallback: Record<string, string>): Record<string, string> {
  try {
    return parseJsonObjectInput('Style Guide', rawValue);
  } catch {
    return fallback;
  }
}

function safeParseJsonArrayInput<T = any>(rawValue: string, fallback: T[]): T[] {
  try {
    return parseJsonArrayInput<T>('Array value', rawValue);
  } catch {
    return fallback;
  }
}

function formatJsonError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Invalid JSON.';
}
