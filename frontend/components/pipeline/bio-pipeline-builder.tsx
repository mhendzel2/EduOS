'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BeakerIcon,
  BookmarkSquareIcon,
  ChartBarIcon,
  CodeBracketIcon,
  CommandLineIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import {
  createBioPipelineTemplate,
  deleteBioPipelineTemplate,
  designBioPipeline,
  generateBioVisualization,
  generatePipelineCode,
  listBioPipelineTemplates,
  pipelineAdvisorChat,
  searchPublicData,
  generateVisDescription,
} from '@/lib/api';
import type {
  BioPipelineCodeResponse,
  BioPipelineDesignResponse,
  BioPipelineStep,
  BioPipelineTemplate,
  BioVisResponse,
  PublicDataRecord,
} from '@/lib/types';
import PlotlyChart from '@/components/visualization/plotly-chart';

const CATEGORIES = [
  { value: 'rnaseq', label: 'RNA-seq' },
  { value: 'chipseq', label: 'ChIP-seq' },
  { value: 'atacseq', label: 'ATAC-seq' },
  { value: 'variant_calling', label: 'Variant Calling' },
  { value: 'wgs', label: 'Whole Genome Sequencing' },
  { value: 'wes', label: 'Whole Exome Sequencing' },
  { value: 'scrnaseq', label: 'Single-cell RNA-seq' },
  { value: 'spatial', label: 'Spatial Transcriptomics' },
  { value: 'proteomics', label: 'Proteomics' },
  { value: 'methylation', label: 'Methylation' },
  { value: 'hic', label: 'Hi-C / 3D Genome' },
  { value: 'custom', label: 'Custom' },
];

const PUBLIC_DATABASES = ['geo', 'sra', 'encode', 'uniprot', 'pdb', 'dbgap'];
const VIS_EXAMPLES = [
  'volcano plot of differential expression results',
  'PCA of normalized RNA-seq counts',
  'sample correlation heatmap',
  'pathway enrichment bar chart',
  'variant consequence summary',
];

const VIS_TYPES = [
  { value: 'rnaseq_deg', label: 'RNA-seq differential expression' },
  { value: 'pca', label: 'PCA / dimensionality reduction' },
  { value: 'heatmap', label: 'Heatmap / clustering' },
  { value: 'enrichment', label: 'Pathway enrichment' },
  { value: 'variant_summary', label: 'Variant summary' },
  { value: 'custom', label: 'Custom' },
];

type TabKey = 'advisor' | 'data' | 'code' | 'visualize' | 'saved';

function cls(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function TabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof SparklesIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cls(
        'flex items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-colors',
        active
          ? 'border-cyan-500 bg-cyan-500/10 text-cyan-200'
          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function Badge({ text }: { text: string }) {
  return <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">{text}</span>;
}

function StepCard({
  step,
  index,
}: {
  step: BioPipelineStep;
  index: number;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-cyan-400">Step {index + 1}</div>
          <h4 className="mt-1 text-sm font-semibold text-white">{step.name}</h4>
          <p className="mt-1 text-xs text-slate-400">{step.description}</p>
        </div>
        <Badge text={step.tool} />
      </div>
    </div>
  );
}

export default function BioPipelineBuilder() {
  const [activeTab, setActiveTab] = useState<TabKey>('advisor');
  const [templates, setTemplates] = useState<BioPipelineTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [goal, setGoal] = useState('Identify differentially expressed genes from human RNA-seq samples and visualize the biological pathways involved.');
  const [organism, setOrganism] = useState('human');
  const [constraints, setConstraints] = useState('Use standard tools, explain steps for a novice, and recommend a publication-ready visualization strategy.');

  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorResponse, setAdvisorResponse] = useState('');
  const [designedPipeline, setDesignedPipeline] = useState<BioPipelineDesignResponse | null>(null);

  const [dataQuery, setDataQuery] = useState('breast cancer rnaseq');
  const [selectedDatabases, setSelectedDatabases] = useState<string[]>(['geo', 'sra', 'encode']);
  const [dataResults, setDataResults] = useState<PublicDataRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [selectedAccessions, setSelectedAccessions] = useState<string[]>([]);

  const [codeLanguage, setCodeLanguage] = useState('python');
  const [codeLoading, setCodeLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<BioPipelineCodeResponse | null>(null);

  const [visPrompt, setVisPrompt] = useState(VIS_EXAMPLES[0]);
  const [visType, setVisType] = useState('rnaseq_deg');
  const [visLoading, setVisLoading] = useState(false);
  const [visAdvice, setVisAdvice] = useState('');
  const [visChart, setVisChart] = useState<BioVisResponse | null>(null);

  const [saveName, setSaveName] = useState('rnaseq_deseq2_project');
  const [saveDisplayName, setSaveDisplayName] = useState('RNA-seq Differential Expression Workflow');
  const [saveCategory, setSaveCategory] = useState('rnaseq');
  const [saveLoading, setSaveLoading] = useState(false);

  const refreshTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const result = await listBioPipelineTemplates();
      setTemplates(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved pipelines');
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTemplates();
  }, [refreshTemplates]);

  const recommendedTools = useMemo(() => {
    if (!designedPipeline) return [];
    return Array.from(new Set(designedPipeline.recommended_steps.map((step) => step.tool).filter(Boolean)));
  }, [designedPipeline]);

  const runAdvisor = useCallback(async () => {
    setAdvisorLoading(true);
    setError(null);
    try {
      const [advisor, design] = await Promise.all([
        pipelineAdvisorChat({ goal, organism, optional_constraints: constraints }),
        designBioPipeline({ goal, organism, optional_constraints: constraints }),
      ]);
      setAdvisorResponse(advisor.response || '');
      setDesignedPipeline(design);
      setActiveTab('data');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bioinformatics advisor failed');
    } finally {
      setAdvisorLoading(false);
    }
  }, [goal, organism, constraints]);

  const runDataSearch = useCallback(async () => {
    setDataLoading(true);
    setError(null);
    try {
      const result = await searchPublicData({
        query: dataQuery || goal,
        organism,
        databases: selectedDatabases,
        max_results: 18,
      });
      setDataResults(result.results || []);
      setActiveTab('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Public data search failed');
    } finally {
      setDataLoading(false);
    }
  }, [dataQuery, goal, organism, selectedDatabases]);

  const runCodeGeneration = useCallback(async () => {
    setCodeLoading(true);
    setError(null);
    try {
      const result = await generatePipelineCode({
        goal,
        organism,
        language: codeLanguage,
        steps: designedPipeline?.recommended_steps || [],
        data_accessions: selectedAccessions,
      });
      setGeneratedCode(result);
      setActiveTab('visualize');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pipeline code generation failed');
    } finally {
      setCodeLoading(false);
    }
  }, [goal, organism, codeLanguage, designedPipeline, selectedAccessions]);

  const runVisAdvisor = useCallback(async () => {
    setVisLoading(true);
    setError(null);
    try {
      const descriptionText = `${visPrompt}. Analysis goal: ${goal}. Organism: ${organism}. Tools: ${recommendedTools.join(', ')}. Selected public accessions: ${selectedAccessions.join(', ') || 'none selected'}.`;
      const [result, chart] = await Promise.all([
        generateVisDescription({
          data_description: descriptionText,
          chart_type: 'auto',
        }),
        generateBioVisualization({
          analysis_type: visType,
          description: descriptionText,
          organism,
          sample_data: {
            accessions: selectedAccessions,
            tools: recommendedTools,
            steps: designedPipeline?.recommended_steps?.map((step) => ({
              name: step.name,
              tool: step.tool,
            })) || [],
          },
        }),
      ]);
      setVisAdvice(result.description || '');
      setVisChart(chart);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Visualization advisor failed');
    } finally {
      setVisLoading(false);
    }
  }, [visPrompt, goal, organism, recommendedTools, selectedAccessions, visType, designedPipeline]);

  const savePipeline = useCallback(async () => {
    if (!designedPipeline) {
      setError('Generate a pipeline design first before saving.');
      return;
    }
    setSaveLoading(true);
    setError(null);
    try {
      await createBioPipelineTemplate({
        name: saveName,
        display_name: saveDisplayName,
        description: goal,
        category: saveCategory,
        organism: organism || 'any',
        tools: recommendedTools,
        steps: designedPipeline.recommended_steps,
        default_params: {
          constraints,
          selected_accessions: selectedAccessions,
          language: codeLanguage,
        },
      });
      await refreshTemplates();
      setActiveTab('saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pipeline');
    } finally {
      setSaveLoading(false);
    }
  }, [designedPipeline, saveName, saveDisplayName, goal, saveCategory, organism, recommendedTools, constraints, selectedAccessions, codeLanguage, refreshTemplates]);

  const removeTemplate = useCallback(async (templateId: string) => {
    try {
      await deleteBioPipelineTemplate(templateId);
      await refreshTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete saved pipeline');
    }
  }, [refreshTemplates]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_rgba(15,23,42,0.96)_38%,_rgba(2,6,23,1)_100%)] p-6">
        <div className="max-w-4xl">
          <div className="text-xs uppercase tracking-[0.24em] text-cyan-300">AI-guided bioinformatics studio</div>
          <h2 className="mt-2 text-2xl font-semibold text-white">Design the pipeline, find the data, generate the code, and plan the figures in one workflow.</h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            This workspace is built for novices as well as advanced users. Start with a plain-language analysis question, let the advisor propose the standard methodology, discover public datasets from major providers, generate runnable pipeline code, and confirm that the visualization strategy matches publication-ready bioinformatics outputs.
          </p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
            <label className="block text-sm font-medium text-slate-300">What analysis are you trying to do?</label>
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={4}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white focus:border-cyan-500 focus:outline-none"
              placeholder="Example: Compare tumor and control RNA-seq, identify differential expression, find enriched pathways, and prepare figures for a manuscript."
            />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-300">
                Organism
                <input
                  value={organism}
                  onChange={(event) => setOrganism(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
                  placeholder="human, mouse, drosophila..."
                />
              </label>
              <label className="block text-sm font-medium text-slate-300">
                Constraints or preferences
                <input
                  value={constraints}
                  onChange={(event) => setConstraints(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
                  placeholder="preferred tools, compute limits, desired outputs"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={runAdvisor}
                disabled={advisorLoading || !goal.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <SparklesIcon className="h-4 w-4" />
                {advisorLoading ? 'Designing workflow...' : 'Ask AI Advisor'}
              </button>
              <button
                onClick={() => setActiveTab('saved')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:border-slate-600 hover:text-white"
              >
                <BookmarkSquareIcon className="h-4 w-4" />
                Saved pipelines
              </button>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Major data sources</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {['GEO', 'SRA', 'ENCODE', 'UniProt', 'PDB', 'dbGaP'].map((label) => (
                  <Badge key={label} text={label} />
                ))}
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                The data browser searches public repositories so the user can identify appropriate datasets before writing code.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Visualization readiness</div>
              <p className="mt-2 text-sm text-slate-300">
                Publication outputs supported: volcano plots, PCA, heatmaps, pathway bars, QC summaries, and reusable Plotly exports.
              </p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <TabButton active={activeTab === 'advisor'} icon={SparklesIcon} label="Advisor" onClick={() => setActiveTab('advisor')} />
        <TabButton active={activeTab === 'data'} icon={MagnifyingGlassIcon} label="Public Data" onClick={() => setActiveTab('data')} />
        <TabButton active={activeTab === 'code'} icon={CodeBracketIcon} label="Pipeline Code" onClick={() => setActiveTab('code')} />
        <TabButton active={activeTab === 'visualize'} icon={ChartBarIcon} label="Visualize Results" onClick={() => setActiveTab('visualize')} />
        <TabButton active={activeTab === 'saved'} icon={BookmarkSquareIcon} label="Saved Workflows" onClick={() => setActiveTab('saved')} />
      </div>

      {activeTab === 'advisor' && (
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <SparklesIcon className="h-4 w-4 text-cyan-300" />
              AI bioinformatics advisor
            </div>
            <div className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-950/70 p-4 text-sm leading-7 text-slate-300">
              {advisorResponse || 'Run the advisor to get a beginner-friendly explanation of the right workflow, why each step matters, and where to get the right public data.'}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <BeakerIcon className="h-4 w-4 text-cyan-300" />
                Recommended workflow
              </div>
              <div className="mt-4 space-y-3">
                {designedPipeline?.recommended_steps?.length ? (
                  designedPipeline.recommended_steps.map((step, index) => (
                    <StepCard key={`${step.name}-${index}`} step={step} index={index} />
                  ))
                ) : (
                  <p className="text-sm text-slate-400">The structured pipeline design will appear here after the advisor runs.</p>
                )}
              </div>
            </div>

            {designedPipeline && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <div className="text-sm font-medium text-white">Methodology rationale</div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{designedPipeline.standard_methodology}</p>
                <div className="mt-4 text-sm font-medium text-white">Parameter guidance</div>
                <p className="mt-3 text-sm leading-6 text-slate-300">{designedPipeline.parameters_explanation}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'data' && (
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-sm font-medium text-white">Search public repositories</div>
            <label className="mt-4 block text-sm text-slate-300">
              Search query
              <input
                value={dataQuery}
                onChange={(event) => setDataQuery(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
                placeholder="tumor normal rnaseq, ATAC-seq macrophage, ChIP-seq MYC..."
              />
            </label>
            <div className="mt-4">
              <div className="text-sm text-slate-300">Databases</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {PUBLIC_DATABASES.map((database) => {
                  const selected = selectedDatabases.includes(database);
                  return (
                    <button
                      key={database}
                      onClick={() => setSelectedDatabases((current) => selected ? current.filter((item) => item !== database) : [...current, database])}
                      className={cls(
                        'rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.16em] transition-colors',
                        selected
                          ? 'border-cyan-500 bg-cyan-500/10 text-cyan-200'
                          : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                      )}
                    >
                      {database}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              onClick={runDataSearch}
              disabled={dataLoading || selectedDatabases.length === 0}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <MagnifyingGlassIcon className="h-4 w-4" />
              {dataLoading ? 'Searching...' : 'Find public datasets'}
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-white">Candidate datasets</div>
              <div className="text-xs text-slate-500">Select accessions to wire into code generation</div>
            </div>
            <div className="mt-4 space-y-3">
              {dataResults.length === 0 ? (
                <p className="text-sm text-slate-400">Run the search to retrieve datasets from GEO, SRA, ENCODE, UniProt, PDB, and related public repositories.</p>
              ) : (
                dataResults.map((record) => {
                  const selected = selectedAccessions.includes(record.accession);
                  return (
                    <div
                      key={`${record.database}-${record.accession}`}
                      className={cls(
                        'w-full rounded-xl border p-4 text-left transition-colors',
                        selected
                          ? 'border-cyan-500 bg-cyan-500/10'
                          : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => setSelectedAccessions((current) => selected ? current.filter((item) => item !== record.accession) : [...current, record.accession])}
                              aria-label={`Select ${record.accession}`}
                              className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-cyan-500"
                            />
                            <Badge text={record.database} />
                            <span className="text-xs uppercase tracking-[0.16em] text-slate-500">{record.accession}</span>
                          </div>
                          <h4 className="mt-2 text-sm font-semibold text-white">{record.title}</h4>
                          <p className="mt-1 text-xs leading-5 text-slate-400">{record.description || 'No description available.'}</p>
                          {record.organism && <p className="mt-2 text-xs text-slate-500">Organism: {record.organism}</p>}
                        </div>
                        <a
                          href={record.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-cyan-300 hover:text-cyan-200"
                        >
                          Open source
                        </a>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'code' && (
        <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="text-sm font-medium text-white">Generate runnable pipeline code</div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block text-sm text-slate-300">
                Language / workflow
                <select
                  value={codeLanguage}
                  onChange={(event) => setCodeLanguage(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
                >
                  <option value="python">Python</option>
                  <option value="r">R</option>
                  <option value="snakemake">Snakemake</option>
                  <option value="nextflow">Nextflow</option>
                </select>
              </label>
              <div className="block text-sm text-slate-300">
                Selected public accessions
                <div className="mt-2 flex min-h-[46px] flex-wrap gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2">
                  {selectedAccessions.length > 0 ? selectedAccessions.map((accession) => <Badge key={accession} text={accession} />) : <span className="text-xs text-slate-500">No accessions selected yet.</span>}
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Pipeline steps sent to the code generator</div>
              <div className="mt-3 space-y-2">
                {designedPipeline?.recommended_steps?.length ? (
                  designedPipeline.recommended_steps.map((step, index) => (
                    <div key={`${step.name}-${index}`} className="text-sm text-slate-300">
                      <span className="mr-2 text-cyan-300">{index + 1}.</span>
                      {step.name} <span className="text-slate-500">({step.tool})</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Generate a structured workflow first so the code agent knows the intended steps.</p>
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={runCodeGeneration}
                disabled={codeLoading || !goal.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CodeBracketIcon className="h-4 w-4" />
                {codeLoading ? 'Generating code...' : 'Generate code'}
              </button>
              <button
                onClick={savePipeline}
                disabled={saveLoading || !designedPipeline}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:border-slate-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <PlusIcon className="h-4 w-4" />
                {saveLoading ? 'Saving...' : 'Save workflow'}
              </button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="block text-sm text-slate-300">
                Save slug
                <input value={saveName} onChange={(event) => setSaveName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
              </label>
              <label className="block text-sm text-slate-300 md:col-span-2">
                Display name
                <input value={saveDisplayName} onChange={(event) => setSaveDisplayName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
              </label>
              <label className="block text-sm text-slate-300">
                Category
                <select value={saveCategory} onChange={(event) => setSaveCategory(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none">
                  {CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-white">Generated pipeline</div>
              {generatedCode?.dependencies?.length ? (
                <div className="flex flex-wrap gap-2">
                  {generatedCode.dependencies.slice(0, 6).map((dependency) => <Badge key={dependency} text={dependency} />)}
                </div>
              ) : null}
            </div>
            <p className="mt-3 text-sm text-slate-400">{generatedCode?.explanation || 'The code generator will produce runnable analysis code or workflow syntax here.'}</p>
            <pre className="mt-4 max-h-[640px] overflow-auto rounded-xl bg-slate-950/80 p-4 text-xs leading-6 text-slate-200">
              <code>{generatedCode?.code || '# No code generated yet'}</code>
            </pre>
          </div>
        </div>
      )}

      {activeTab === 'visualize' && (
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ChartBarIcon className="h-4 w-4 text-cyan-300" />
                Visualization advisor
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Bioinformatics outputs need the right display mode. Use this advisor to confirm the correct figure class for RNA-seq, ChIP-seq, variant analysis, pathway enrichment, or QC reporting.
              </p>
              <label className="mt-4 block text-sm text-slate-300">
                Describe the result you need to visualize
                <textarea
                  value={visPrompt}
                  onChange={(event) => setVisPrompt(event.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white focus:border-cyan-500 focus:outline-none"
                />
              </label>
              <label className="mt-4 block text-sm text-slate-300">
                Visualization type
                <select
                  value={visType}
                  onChange={(event) => setVisType(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
                >
                  {VIS_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                {VIS_EXAMPLES.map((example) => (
                  <button
                    key={example}
                    onClick={() => setVisPrompt(example)}
                    className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200"
                  >
                    {example}
                  </button>
                ))}
              </div>
              <button
                onClick={runVisAdvisor}
                disabled={visLoading}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ChartBarIcon className="h-4 w-4" />
                {visLoading ? 'Generating advice...' : 'Recommend visualization'}
              </button>
              <div className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-950/70 p-4 text-sm leading-7 text-slate-300">
                {visAdvice || 'The advisor will explain which chart type to use, which annotations matter, and how to present bioinformatics results clearly.'}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <div className="text-sm font-medium text-white">Built-in preview capability</div>
              <ul className="mt-3 space-y-2 text-sm text-slate-300">
                <li>Volcano plots for differential expression significance and effect size.</li>
                <li>PCA and clustering plots for sample-level structure and QC.</li>
                <li>Heatmaps for top genes, pathway activity, or correlation matrices.</li>
                <li>Bar and dot plots for enrichment analysis and annotation summaries.</li>
                <li>Reusable Plotly export for downstream figures and presentations.</li>
              </ul>
            </div>
          </div>

          <div className="space-y-6">
            {visChart ? (
              <>
                <PlotlyChart
                  data={visChart.plotly_data as never[]}
                  layout={visChart.plotly_layout as never}
                  title={visChart.title}
                />
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                  <div className="text-sm font-medium text-white">Rendered chart rationale</div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{visChart.explanation}</p>
                  {visChart.code_snippet ? (
                    <pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-slate-950/80 p-4 text-xs leading-6 text-slate-200"><code>{visChart.code_snippet}</code></pre>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <div className="text-sm font-medium text-white">Interactive chart preview</div>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Generate a visualization recommendation to produce a renderable Plotly chart matched to the current bioinformatics task.
                </p>
              </div>
            )}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <div className="text-sm font-medium text-white">Why this matters</div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Differential expression alone is not enough. Novice users need clear cues about which plots answer which questions: sample separation uses PCA, significance uses volcano plots, pathway prioritization uses ranked bars or dot plots, and quality control uses per-sample summaries. This workflow now includes explicit visualization guidance so the dataset selection, code generation, and figure planning remain aligned.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'saved' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-white">Saved pipeline templates</div>
              <p className="mt-1 text-sm text-slate-400">Reusable workflows generated or curated for future analyses.</p>
            </div>
            <button onClick={refreshTemplates} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-600 hover:text-white">
              Refresh
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {templatesLoading ? (
              <p className="text-sm text-slate-400">Loading saved workflows...</p>
            ) : templates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 px-6 py-10 text-center text-sm text-slate-400">
                No saved workflows yet. Generate and save a pipeline to build your reusable library.
              </div>
            ) : (
              templates.map((template) => (
                <div key={template.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-white">{template.display_name}</h3>
                        <Badge text={template.category} />
                        <Badge text={template.organism} />
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{template.description || 'No description provided.'}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {template.tools.map((tool) => <Badge key={tool} text={tool} />)}
                      </div>
                    </div>
                    <button
                      onClick={() => removeTemplate(template.id)}
                      className="inline-flex items-center gap-2 rounded-xl border border-red-900 px-3 py-2 text-sm text-red-300 hover:bg-red-950/40"
                    >
                      <TrashIcon className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {template.steps.map((step, index) => (
                      <StepCard key={`${template.id}-${step.name}-${index}`} step={step} index={index} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
