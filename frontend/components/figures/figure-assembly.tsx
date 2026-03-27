'use client';

import { useState, useRef, useCallback, useEffect, type PointerEvent as ReactPointerEvent } from 'react';
import {
  generateFigureCaption,
  generateAudioOverview,
  generateNarrationScript,
  generateVisDescription,
  getElnoteStatus,
  pushToElnote,
  listProjects,
} from '@/lib/api';
import ProjectImageLibrary, { type ProjectImageAsset } from '@/components/figures/project-image-library';
import type { Project } from '@/lib/types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface PageSize {
  name: string;
  width: number;   // mm
  height: number;  // mm
  journal: string;
}

interface Panel {
  id: string;
  label: string;
  x: number;       // mm from left edge
  y: number;       // mm from top edge
  w: number;       // mm
  h: number;       // mm
  imageUrl: string | null;
  caption: string;
}

type DragMode = 'move' | 'resize-se' | 'resize-e' | 'resize-s';

interface DragInfo {
  panelId: string;
  mode: DragMode;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}

interface FigureAssemblyProps {
  projectId?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const PAGE_SIZES: Record<string, PageSize> = {
  'nature-1col':   { name: 'Nature – single column',  width: 89,    height: 120,   journal: 'Nature' },
  'nature-1.5col': { name: 'Nature – 1.5 column',     width: 120,   height: 170,   journal: 'Nature' },
  'nature-2col':   { name: 'Nature – double column',   width: 183,   height: 247,   journal: 'Nature' },
  'science-1col':  { name: 'Science – single column',  width: 90,    height: 120,   journal: 'Science' },
  'science-2col':  { name: 'Science – double column',  width: 180,   height: 230,   journal: 'Science' },
  'cell-1col':     { name: 'Cell – single column',     width: 85,    height: 120,   journal: 'Cell' },
  'cell-2col':     { name: 'Cell – double column',     width: 174,   height: 230,   journal: 'Cell' },
  'pnas-1col':     { name: 'PNAS – single column',     width: 87,    height: 120,   journal: 'PNAS' },
  'pnas-2col':     { name: 'PNAS – double column',     width: 178,   height: 230,   journal: 'PNAS' },
  'nejm-1col':     { name: 'NEJM – single column',     width: 84,    height: 120,   journal: 'NEJM' },
  'letter':        { name: 'US Letter (8.5 × 11 in)',  width: 215.9, height: 279.4, journal: 'Grant' },
  'a4':            { name: 'A4 (210 × 297 mm)',        width: 210,   height: 297,   journal: 'Grant' },
};

const LAYOUT_PRESETS: Record<string, { cols: number; rows: number }> = {
  '1 × 1': { cols: 1, rows: 1 },
  '1 × 2': { cols: 2, rows: 1 },
  '2 × 1': { cols: 1, rows: 2 },
  '2 × 2': { cols: 2, rows: 2 },
  '1 × 3': { cols: 3, rows: 1 },
  '3 × 1': { cols: 1, rows: 3 },
  '2 × 3': { cols: 3, rows: 2 },
  '3 × 2': { cols: 2, rows: 3 },
};

const GAP_MM = 2;
const MARGIN_MM = 3;
const MIN_PANEL_MM = 10;
const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DPI_OPTIONS = [72, 150, 300, 600, 1200];
const EXPORT_FORMATS = ['PNG', 'SVG', 'PDF', 'TIFF'] as const;
type ExportFormat = typeof EXPORT_FORMATS[number];

function mmToPx(mm: number, dpi: number) {
  return Math.round((mm / 25.4) * dpi);
}

let _counter = 0;
function nextPanelId() {
  return `p-${++_counter}-${Date.now()}`;
}

/* ------------------------------------------------------------------ */
/*  Ruler component (tick marks every 10 mm)                           */
/* ------------------------------------------------------------------ */
function Ruler({ axis, length, scale }: { axis: 'x' | 'y'; length: number; scale: number }) {
  const ticks: number[] = [];
  for (let mm = 0; mm <= length; mm += 10) ticks.push(mm);

  if (axis === 'x') {
    return (
      <div className="relative h-4 select-none" style={{ width: length * scale }}>
        {ticks.map(mm => (
          <div key={mm} className="absolute top-0 flex flex-col items-center" style={{ left: mm * scale }}>
            <div className="h-2 w-px bg-slate-600" />
            {mm % 50 === 0 && (
              <span className="text-[8px] text-slate-500 leading-none mt-px">{mm}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative w-5 select-none" style={{ height: length * scale }}>
      {ticks.map(mm => (
        <div key={mm} className="absolute left-0 flex items-center" style={{ top: mm * scale }}>
          <div className="w-2 h-px bg-slate-600" />
          {mm % 50 === 0 && (
            <span className="text-[8px] text-slate-500 leading-none ml-0.5">{mm}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Export helpers                                                      */
/* ------------------------------------------------------------------ */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderPanelsToCanvas(
  panelList: Panel[], pageW: number, pageH: number, dpiVal: number,
): Promise<HTMLCanvasElement> {
  const w = mmToPx(pageW, dpiVal);
  const h = mmToPx(pageH, dpiVal);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const s = w / pageW; // px per mm

  const loaded = new Map<string, HTMLImageElement>();
  await Promise.all(
    panelList.filter(p => p.imageUrl).map(p =>
      new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => { loaded.set(p.id, img); resolve(); };
        img.onerror = () => resolve();
        img.src = p.imageUrl!;
      }),
    ),
  );

  for (const panel of panelList) {
    const px = panel.x * s, py = panel.y * s, pw = panel.w * s, ph = panel.h * s;
    const img = loaded.get(panel.id);
    if (img) {
      const ia = img.naturalWidth / img.naturalHeight;
      const pa = pw / ph;
      let dw: number, dh: number, dx: number, dy: number;
      if (ia > pa) { dw = pw; dh = pw / ia; dx = px; dy = py + (ph - dh) / 2; }
      else { dh = ph; dw = ph * ia; dx = px + (pw - dw) / 2; dy = py; }
      ctx.drawImage(img, dx, dy, dw, dh);
    } else {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(px, py, pw, ph);
    }
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = Math.max(1, s * 0.3);
    ctx.strokeRect(px, py, pw, ph);

    const fontSize = Math.max(10, s * 3);
    const pad = s;
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    const tm = ctx.measureText(panel.label);
    const bw = tm.width + pad * 3, bh = fontSize * 1.4;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(px + pad, py + pad, bw, bh);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(panel.label, px + pad * 1.5, py + pad + bh / 2);
  }
  return canvas;
}

function buildSvgBlob(panelList: Panel[], pageW: number, pageH: number, dpiVal: number): Blob {
  const w = mmToPx(pageW, dpiVal);
  const h = mmToPx(pageH, dpiVal);
  const s = w / pageW;
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<rect width="100%" height="100%" fill="white"/>\n`;
  for (const panel of panelList) {
    const px = panel.x * s, py = panel.y * s, pw = panel.w * s, ph = panel.h * s;
    svg += '<g>\n';
    if (panel.imageUrl) {
      svg += `<image href="${esc(panel.imageUrl)}" x="${px}" y="${py}" width="${pw}" height="${ph}" preserveAspectRatio="xMidYMid meet"/>\n`;
    } else {
      svg += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#f8fafc"/>\n`;
    }
    const sw = Math.max(1, s * 0.3);
    svg += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="none" stroke="#cccccc" stroke-width="${sw}"/>\n`;
    const fontSize = Math.max(10, s * 3);
    const pad = s;
    const bh = fontSize * 1.4, bw2 = fontSize * 1.5 + pad * 2;
    svg += `<rect x="${px + pad}" y="${py + pad}" width="${bw2}" height="${bh}" rx="2" fill="rgba(0,0,0,0.75)"/>\n`;
    svg += `<text x="${px + pad * 1.5}" y="${py + pad + bh / 2}" fill="white" font-size="${fontSize}" font-weight="bold" font-family="Arial,sans-serif" dominant-baseline="central">${esc(panel.label)}</text>\n`;
    svg += '</g>\n';
  }
  svg += '</svg>';
  return new Blob([svg], { type: 'image/svg+xml' });
}

function buildTiffBlob(canvas: HTMLCanvasElement, dpiVal: number): Blob {
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { width, height, data } = imgData;
  const rgbLen = width * height * 3;
  const rgb = new Uint8Array(rgbLen);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2];
  }
  const numTags = 12;
  const ifdOff = 8;
  const ifdSz = 2 + numTags * 12 + 4;
  const bpsOff = ifdOff + ifdSz;
  const xrOff = bpsOff + 6;
  const yrOff = xrOff + 8;
  const stripOff = yrOff + 8;
  const buf = new ArrayBuffer(stripOff + rgbLen);
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  v.setUint16(0, 0x4949, false); v.setUint16(2, 42, true); v.setUint32(4, ifdOff, true);
  let o = ifdOff;
  v.setUint16(o, numTags, true); o += 2;
  const wt = (t: number, tp: number, c: number, val: number) => {
    v.setUint16(o, t, true); o += 2; v.setUint16(o, tp, true); o += 2;
    v.setUint32(o, c, true); o += 4;
    if (tp === 3 && c === 1) { v.setUint16(o, val, true); o += 4; }
    else { v.setUint32(o, val, true); o += 4; }
  };
  wt(256,3,1,width); wt(257,3,1,height); wt(258,3,3,bpsOff); wt(259,3,1,1);
  wt(262,3,1,2); wt(273,4,1,stripOff); wt(277,3,1,3); wt(278,4,1,height);
  wt(279,4,1,rgbLen); wt(282,5,1,xrOff); wt(283,5,1,yrOff); wt(296,3,1,2);
  v.setUint32(o, 0, true);
  v.setUint16(bpsOff, 8, true); v.setUint16(bpsOff + 2, 8, true); v.setUint16(bpsOff + 4, 8, true);
  v.setUint32(xrOff, dpiVal, true); v.setUint32(xrOff + 4, 1, true);
  v.setUint32(yrOff, dpiVal, true); v.setUint32(yrOff + 4, 1, true);
  bytes.set(rgb, stripOff);
  return new Blob([buf], { type: 'image/tiff' });
}

async function buildPdfBlob(canvas: HTMLCanvasElement, dpiVal: number): Promise<Blob> {
  const jpegBlob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.95));
  if (!jpegBlob) throw new Error('Failed to render JPEG');
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
  const pw = (canvas.width / dpiVal) * 72;
  const ph = (canvas.height / dpiVal) * 72;
  const enc = new TextEncoder();
  const ch: Uint8Array[] = [];
  const offs: number[] = [];
  let pos = 0;
  const wr = (s: string) => { const b = enc.encode(s); ch.push(b); pos += b.length; };
  const wrb = (b: Uint8Array) => { ch.push(b); pos += b.length; };
  const mk = () => { offs.push(pos); };
  wr('%PDF-1.4\n');
  mk(); wr('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n');
  mk(); wr('2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n');
  mk(); wr(`3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}]/Contents 4 0 R/Resources<</XObject<</I 5 0 R>>>>>>endobj\n`);
  mk(); const stm = `q ${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /I Do Q`;
  wr(`4 0 obj<</Length ${stm.length}>>stream\n${stm}\nendstream\nendobj\n`);
  mk(); wr(`5 0 obj<</Type/XObject/Subtype/Image/Width ${canvas.width}/Height ${canvas.height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpeg.length}>>stream\n`);
  wrb(jpeg); wr('\nendstream\nendobj\n');
  const xo = pos;
  wr(`xref\n0 ${offs.length + 1}\n0000000000 65535 f \n`);
  for (const off of offs) wr(`${String(off).padStart(10, '0')} 00000 n \n`);
  wr(`trailer<</Size ${offs.length + 1}/Root 1 0 R>>\nstartxref\n${xo}\n%%EOF\n`);
  const result = new Uint8Array(pos);
  let p = 0;
  for (const c of ch) { result.set(c, p); p += c.length; }
  return new Blob([result], { type: 'application/pdf' });
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export default function FigureAssembly({ projectId = 'default' }: FigureAssemblyProps) {
  const [sizeKey, setSizeKey] = useState('nature-2col');
  const [panels, setPanels] = useState<Panel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dpi, setDpi] = useState(300);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('PNG');
  const [exporting, setExporting] = useState(false);

  /* ---- Media & AI state ---- */
  const [mediaTab, setMediaTab] = useState<'caption' | 'audio' | 'narration' | 'vis'>('caption');
  const [mediaInput, setMediaInput] = useState('');
  const [mediaStyle, setMediaStyle] = useState('Nature');
  const [mediaAudience, setMediaAudience] = useState('scientific');
  const [mediaDuration, setMediaDuration] = useState(60);
  const [mediaResult, setMediaResult] = useState<string | null>(null);
  const [mediaAudioB64, setMediaAudioB64] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  /* ---- ELNOTE push state (optional) ---- */
  const [elnoteAvailable, setElnoteAvailable] = useState(false);
  const [elnoteProjects, setElnoteProjects] = useState<Project[]>([]);
  const [elnoteProjectId, setElnoteProjectId] = useState<string | null>(null);
  const [elnotePushing, setElnotePushing] = useState(false);
  const [elnoteMsg, setElnoteMsg] = useState<string | null>(null);

  const dragRef = useRef<DragInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const page = PAGE_SIZES[sizeKey];
  const maxCanvasW = 600;
  const scale = Math.min(maxCanvasW / page.width, 700 / page.height);
  const canvasW = page.width * scale;
  const canvasH = page.height * scale;
  const pxW = mmToPx(page.width, dpi);
  const pxH = mmToPx(page.height, dpi);

  const selectedPanel = panels.find(p => p.id === selectedId) ?? null;

  // Clamp panels when page size changes
  useEffect(() => {
    setPanels(prev =>
      prev.map(p => ({
        ...p,
        w: Math.min(p.w, page.width),
        h: Math.min(p.h, page.height),
        x: Math.min(p.x, Math.max(0, page.width - Math.min(p.w, page.width))),
        y: Math.min(p.y, Math.max(0, page.height - Math.min(p.h, page.height))),
      })),
    );
  }, [page.width, page.height]);

  /* ---------- ELNOTE availability check ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await getElnoteStatus();
        if (!cancelled && st.available) {
          setElnoteAvailable(true);
          const projs = await listProjects();
          if (!cancelled) setElnoteProjects(projs);
        }
      } catch { /* ELNOTE unavailable – silently skip */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleElnotePush = useCallback(async () => {
    if (!elnoteProjectId || !mediaResult) return;
    setElnotePushing(true);
    setElnoteMsg(null);
    try {
      const body: Record<string, unknown> = {
        project_id: elnoteProjectId,
        title: `Figure Workbench – ${mediaTab}`,
        content: mediaResult,
        entry_type: 'figure_media',
      };
      if (mediaAudioB64) {
        body.artifact_b64 = mediaAudioB64;
        body.artifact_filename = `figure_audio_${Date.now()}.mp3`;
        body.artifact_mime = 'audio/mpeg';
      }
      await pushToElnote(body as Parameters<typeof pushToElnote>[0]);
      setElnoteMsg('Pushed to ELNOTE');
    } catch (e: unknown) {
      setElnoteMsg(e instanceof Error ? e.message : 'Push failed');
    } finally {
      setElnotePushing(false);
    }
  }, [elnoteProjectId, mediaResult, mediaTab, mediaAudioB64]);

  /* ---------- Panel CRUD ---------- */
  const addPanel = useCallback(() => {
    const label = LABELS[panels.length % 26];
    const w = Math.min(60, page.width - 2 * MARGIN_MM);
    const h = Math.min(50, page.height - 2 * MARGIN_MM);
    const offset = (panels.length * 5) % 30;
    const newPanel: Panel = {
      id: nextPanelId(),
      label,
      x: MARGIN_MM + offset,
      y: MARGIN_MM + offset,
      w,
      h,
      imageUrl: null,
      caption: '',
    };
    setPanels(prev => [...prev, newPanel]);
    setSelectedId(newPanel.id);
  }, [panels.length, page.width, page.height]);

  const removePanel = useCallback(
    (id: string) => {
      setPanels(prev => prev.filter(p => p.id !== id));
      if (selectedId === id) setSelectedId(null);
    },
    [selectedId],
  );

  const updatePanel = useCallback((id: string, patch: Partial<Panel>) => {
    setPanels(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const placeProjectAsset = useCallback((asset: ProjectImageAsset) => {
    if (selectedId) {
      updatePanel(selectedId, { imageUrl: asset.resolvedUrl });
      return;
    }

    const label = LABELS[panels.length % 26];
    const w = Math.min(60, page.width - 2 * MARGIN_MM);
    const h = Math.min(50, page.height - 2 * MARGIN_MM);
    const offset = (panels.length * 5) % 30;
    const newPanel: Panel = {
      id: nextPanelId(),
      label,
      x: MARGIN_MM + offset,
      y: MARGIN_MM + offset,
      w,
      h,
      imageUrl: asset.resolvedUrl,
      caption: '',
    };
    setPanels((prev) => [...prev, newPanel]);
    setSelectedId(newPanel.id);
  }, [page.height, page.width, panels.length, selectedId, updatePanel]);

  /* ---------- Auto-layout ---------- */
  const applyLayout = useCallback(
    (preset: string) => {
      const { cols, rows } = LAYOUT_PRESETS[preset];
      const count = cols * rows;

      const existing = [...panels];
      while (existing.length < count) {
        existing.push({
          id: nextPanelId(),
          label: LABELS[existing.length % 26],
          x: 0, y: 0, w: 40, h: 40,
          imageUrl: null, caption: '',
        });
      }
      const arranged = existing.slice(0, count);
      const cellW = (page.width - 2 * MARGIN_MM - Math.max(0, cols - 1) * GAP_MM) / cols;
      const cellH = (page.height - 2 * MARGIN_MM - Math.max(0, rows - 1) * GAP_MM) / rows;

      let idx = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          arranged[idx] = {
            ...arranged[idx],
            label: LABELS[idx % 26],
            x: MARGIN_MM + c * (cellW + GAP_MM),
            y: MARGIN_MM + r * (cellH + GAP_MM),
            w: cellW,
            h: cellH,
          };
          idx++;
        }
      }
      setPanels(arranged);
      setSelectedId(null);
    },
    [panels, page.width, page.height],
  );

  /* ---------- Pointer drag / resize ---------- */
  const onPointerDown = useCallback(
    (e: ReactPointerEvent, panelId: string, mode: DragMode) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const panel = panels.find(p => p.id === panelId);
      if (!panel) return;
      setSelectedId(panelId);
      dragRef.current = {
        panelId,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        origX: panel.x,
        origY: panel.y,
        origW: panel.w,
        origH: panel.h,
      };
    },
    [panels],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / scale;
      const dy = (e.clientY - d.startY) / scale;

      setPanels(prev =>
        prev.map(p => {
          if (p.id !== d.panelId) return p;
          switch (d.mode) {
            case 'move':
              return {
                ...p,
                x: Math.max(0, Math.min(page.width - p.w, d.origX + dx)),
                y: Math.max(0, Math.min(page.height - p.h, d.origY + dy)),
              };
            case 'resize-se':
              return {
                ...p,
                w: Math.max(MIN_PANEL_MM, Math.min(page.width - p.x, d.origW + dx)),
                h: Math.max(MIN_PANEL_MM, Math.min(page.height - p.y, d.origH + dy)),
              };
            case 'resize-e':
              return {
                ...p,
                w: Math.max(MIN_PANEL_MM, Math.min(page.width - p.x, d.origW + dx)),
              };
            case 'resize-s':
              return {
                ...p,
                h: Math.max(MIN_PANEL_MM, Math.min(page.height - p.y, d.origH + dy)),
              };
            default:
              return p;
          }
        }),
      );
    },
    [scale, page.width, page.height],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  /* ---------- Image upload ---------- */
  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !selectedId) return;
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => updatePanel(selectedId, { imageUrl: reader.result as string });
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [selectedId, updatePanel],
  );

  /* ---------- Canvas double-click → upload ---------- */
  const handlePanelDblClick = useCallback(
    (e: React.MouseEvent, panelId: string) => {
      e.stopPropagation();
      setSelectedId(panelId);
      // Small timeout so selectedId is set before the file dialog opens
      setTimeout(() => fileInputRef.current?.click(), 0);
    },
    [],
  );

  /* ---------- Figure export ---------- */
  const handleExport = useCallback(async () => {
    if (panels.length === 0 || exporting) return;
    setExporting(true);
    try {
      const name = 'figure';
      if (exportFormat === 'SVG') {
        downloadBlob(buildSvgBlob(panels, page.width, page.height, dpi), `${name}.svg`);
      } else {
        const canvas = await renderPanelsToCanvas(panels, page.width, page.height, dpi);
        switch (exportFormat) {
          case 'PNG': {
            const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
            if (blob) downloadBlob(blob, `${name}.png`);
            break;
          }
          case 'TIFF':
            downloadBlob(buildTiffBlob(canvas, dpi), `${name}.tiff`);
            break;
          case 'PDF':
            downloadBlob(await buildPdfBlob(canvas, dpi), `${name}.pdf`);
            break;
        }
      }
    } finally {
      setExporting(false);
    }
  }, [panels, page.width, page.height, dpi, exportFormat, exporting]);

  /* ---------- Media & AI generation ---------- */
  const buildFigureDescription = useCallback(() => {
    if (mediaInput.trim()) return mediaInput;
    // Auto-build from panels
    return panels
      .map(p => `Panel ${p.label}: ${p.caption || '(no caption)'}${p.imageUrl ? ' [has image]' : ''}`)
      .join('\n') || 'No panels configured.';
  }, [panels, mediaInput]);

  const handleMediaGenerate = useCallback(async () => {
    setMediaLoading(true);
    setMediaError(null);
    setMediaResult(null);
    setMediaAudioB64(null);
    const desc = buildFigureDescription();
    try {
      switch (mediaTab) {
        case 'caption': {
          const res = await generateFigureCaption({
            figure_description: desc,
            research_context: '',
            style: mediaStyle,
          });
          setMediaResult(res.caption);
          break;
        }
        case 'audio': {
          const res = await generateAudioOverview({
            text: desc,
            title: 'Figure Overview',
            instructions: '',
          });
          setMediaResult(res.transcript);
          setMediaAudioB64(res.audio_b64);
          break;
        }
        case 'narration': {
          const res = await generateNarrationScript({
            figure_description: desc,
            audience: mediaAudience,
            duration_seconds: mediaDuration,
          });
          setMediaResult(res.script);
          break;
        }
        case 'vis': {
          const res = await generateVisDescription({
            data_description: desc,
            chart_type: 'auto',
          });
          setMediaResult(res.description);
          break;
        }
      }
    } catch (e: unknown) {
      setMediaError(e instanceof Error ? e.message : 'Media generation failed');
    } finally {
      setMediaLoading(false);
    }
  }, [mediaTab, buildFigureDescription, mediaStyle, mediaAudience, mediaDuration]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      {/* ===== Canvas column ===== */}
      <div className="min-w-0 flex-1">
        {/* Dimension readout */}
        <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span>{page.width} &times; {page.height}&thinsp;mm</span>
          <span className="text-slate-600">|</span>
          <span>{(page.width / 25.4).toFixed(2)} &times; {(page.height / 25.4).toFixed(2)}&thinsp;in</span>
          <span className="text-slate-600">|</span>
          <span>{pxW} &times; {pxH}&thinsp;px @ {dpi}&thinsp;DPI</span>
        </div>

        {/* Rulers + Canvas */}
        <div className="inline-flex flex-col">
          {/* Top ruler */}
          <div className="ml-5">
            <Ruler axis="x" length={page.width} scale={scale} />
          </div>

          <div className="flex">
            {/* Left ruler */}
            <Ruler axis="y" length={page.height} scale={scale} />

            {/* Canvas surface */}
            <div
              className="relative select-none border border-slate-600 bg-white shadow-lg"
              style={{ width: canvasW, height: canvasH }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={() => setSelectedId(null)}
            >
              {/* Panels */}
              {panels.map(panel => {
                const isSel = panel.id === selectedId;
                return (
                  <div
                    key={panel.id}
                    className={`absolute overflow-hidden border-2 ${
                      isSel
                        ? 'border-blue-500 ring-2 ring-blue-400/40 z-10'
                        : 'border-slate-300 hover:border-slate-500'
                    }`}
                    style={{
                      left: panel.x * scale,
                      top: panel.y * scale,
                      width: panel.w * scale,
                      height: panel.h * scale,
                      cursor: dragRef.current?.panelId === panel.id ? 'grabbing' : 'grab',
                    }}
                    onPointerDown={e => onPointerDown(e, panel.id, 'move')}
                    onClick={e => { e.stopPropagation(); setSelectedId(panel.id); }}
                    onDoubleClick={e => handlePanelDblClick(e, panel.id)}
                  >
                    {/* Content */}
                    {panel.imageUrl ? (
                      <img
                        src={panel.imageUrl}
                        alt={`Panel ${panel.label}`}
                        className="h-full w-full object-contain"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-slate-50 text-[11px] text-slate-400">
                        Double-click to add image
                      </div>
                    )}

                    {/* Label badge */}
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                      {panel.label}
                    </span>

                    {/* Resize handles (visible when selected) */}
                    {isSel && (
                      <>
                        <div
                          className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize bg-blue-500"
                          onPointerDown={e => onPointerDown(e, panel.id, 'resize-se')}
                        />
                        <div
                          className="absolute right-0 top-1/2 h-5 w-2 -translate-y-1/2 cursor-e-resize rounded-l bg-blue-500/70"
                          onPointerDown={e => onPointerDown(e, panel.id, 'resize-e')}
                        />
                        <div
                          className="absolute bottom-0 left-1/2 h-2 w-5 -translate-x-1/2 cursor-s-resize rounded-t bg-blue-500/70"
                          onPointerDown={e => onPointerDown(e, panel.id, 'resize-s')}
                        />
                      </>
                    )}
                  </div>
                );
              })}

              {/* Empty-state hint */}
              {panels.length === 0 && (
                <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
                  Add panels or choose a layout preset &rarr;
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-label="Upload panel image"
          className="hidden"
          onChange={handleImageUpload}
        />
      </div>

      {/* ===== Controls column ===== */}
      <div className="w-full flex-shrink-0 space-y-5 xl:w-80">
        {/* Page size */}
        <Section title="Page Size">
          <select
            value={sizeKey}
            onChange={e => setSizeKey(e.target.value)}
            title="Page size"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
          >
            {Object.entries(PAGE_SIZES).map(([key, sz]) => (
              <option key={key} value={key}>
                {sz.name} — {sz.width} × {sz.height} mm
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">{page.journal} format</p>
        </Section>

        {/* Layout presets */}
        <Section title="Layout Presets">
          <div className="grid grid-cols-4 gap-2">
            {Object.keys(LAYOUT_PRESETS).map(preset => (
              <button
                key={preset}
                onClick={() => applyLayout(preset)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
              >
                {preset}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Auto-arranges panels to fill the page.
          </p>
        </Section>

        {/* Add panel */}
        <button
          onClick={addPanel}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          + Add Panel
        </button>

        <Section title="Project Assets">
          <ProjectImageLibrary
            projectId={projectId}
            description={
              selectedId
                ? 'Click an asset to place it into the selected panel.'
                : 'Click an asset to create a new panel from it.'
            }
            emptyMessage="No project image assets yet. Upload from the Annotate tab to reuse them here."
            onSelect={placeProjectAsset}
          />
          <p className="mt-2 text-[10px] text-slate-500">
            Local uploads still work. Project assets let you reuse annotate inputs and saved outputs across sessions.
          </p>
        </Section>

        {/* Selected panel properties */}
        {selectedPanel && (
          <Section title={`Panel ${selectedPanel.label}`}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <NumField
                  label="X (mm)"
                  value={selectedPanel.x}
                  onChange={v => updatePanel(selectedPanel.id, { x: clampMm(v, 0, page.width - selectedPanel.w) })}
                />
                <NumField
                  label="Y (mm)"
                  value={selectedPanel.y}
                  onChange={v => updatePanel(selectedPanel.id, { y: clampMm(v, 0, page.height - selectedPanel.h) })}
                />
                <NumField
                  label="Width (mm)"
                  value={selectedPanel.w}
                  onChange={v => updatePanel(selectedPanel.id, { w: clampMm(v, MIN_PANEL_MM, page.width - selectedPanel.x) })}
                />
                <NumField
                  label="Height (mm)"
                  value={selectedPanel.h}
                  onChange={v => updatePanel(selectedPanel.id, { h: clampMm(v, MIN_PANEL_MM, page.height - selectedPanel.y) })}
                />
              </div>

              <label className="block text-xs text-slate-400">
                Label
                <input
                  type="text"
                  value={selectedPanel.label}
                  maxLength={3}
                  onChange={e => updatePanel(selectedPanel.id, { label: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="block text-xs text-slate-400">
                Caption
                <textarea
                  value={selectedPanel.caption}
                  rows={2}
                  onChange={e => updatePanel(selectedPanel.id, { caption: e.target.value })}
                  className="mt-0.5 w-full resize-none rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
                />
              </label>

              <div className="flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-600"
                >
                  Upload Image
                </button>
                <button
                  onClick={() => removePanel(selectedPanel.id)}
                  className="rounded-lg border border-red-800 bg-red-900/40 px-3 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-900/70"
                >
                  Delete
                </button>
              </div>

              {selectedPanel.imageUrl && (
                <button
                  onClick={() => updatePanel(selectedPanel.id, { imageUrl: null })}
                  className="w-full rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-400 transition-colors hover:text-white"
                >
                  Remove Image
                </button>
              )}

              <p className="text-[10px] text-slate-500">
                {mmToPx(selectedPanel.w, dpi)} × {mmToPx(selectedPanel.h, dpi)} px @ {dpi} DPI
              </p>
            </div>
          </Section>
        )}

        {/* Resolution */}
        <Section title="Resolution (DPI)">
          <div className="flex flex-wrap gap-2">
            {DPI_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => setDpi(d)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  d === dpi
                    ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300'
                    : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Output: {pxW} &times; {pxH} px
            {dpi >= 300 && <span className="ml-2 text-emerald-400">✓ Print-ready</span>}
          </p>
        </Section>

        {/* Export */}
        <Section title="Export">
          <div className="mb-3 flex gap-2">
            {EXPORT_FORMATS.map(f => (
              <button
                key={f}
                onClick={() => setExportFormat(f)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  f === exportFormat
                    ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300'
                    : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={panels.length === 0 || exporting}
            onClick={handleExport}
          >
            {exporting ? 'Exporting\u2026' : 'Export Figure'}
          </button>
        </Section>

        {/* ── Media & AI (NotebookLM) ── */}
        <Section title="Media &amp; AI">
          {/* Tabs */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {([
              ['caption', 'Caption'],
              ['audio', 'Audio Overview'],
              ['narration', 'Narration'],
              ['vis', 'Vis Advisor'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => { setMediaTab(key); setMediaResult(null); setMediaError(null); }}
                className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
                  mediaTab === key
                    ? 'border-violet-500 bg-violet-500/20 text-violet-300'
                    : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Input area */}
          <textarea
            value={mediaInput}
            onChange={e => setMediaInput(e.target.value)}
            rows={3}
            placeholder={
              mediaTab === 'vis'
                ? 'Describe your data (variables, sample sizes, comparisons)\u2026'
                : 'Describe the figure \u2014 or leave blank to auto-build from panel captions\u2026'
            }
            className="mb-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
          />

          {/* Style / audience controls (contextual) */}
          {mediaTab === 'caption' && (
            <label className="mb-2 block text-[11px] text-slate-400">
              Journal style
              <select
                value={mediaStyle}
                onChange={e => setMediaStyle(e.target.value)}
                className="ml-2 rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-white focus:border-violet-500 focus:outline-none"
              >
                {['Nature', 'Science', 'Cell', 'PNAS', 'NEJM', 'APA', 'ACS'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          )}
          {mediaTab === 'narration' && (
            <div className="mb-2 flex items-center gap-3">
              <label className="text-[11px] text-slate-400">
                Audience
                <select
                  value={mediaAudience}
                  onChange={e => setMediaAudience(e.target.value)}
                  className="ml-1 rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-white focus:border-violet-500 focus:outline-none"
                >
                  {['scientific', 'general', 'classroom', 'conference'].map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-slate-400">
                Duration
                <select
                  value={mediaDuration}
                  onChange={e => setMediaDuration(Number(e.target.value))}
                  className="ml-1 rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-white focus:border-violet-500 focus:outline-none"
                >
                  {[30, 60, 90, 120, 180].map(d => (
                    <option key={d} value={d}>{d}s</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={handleMediaGenerate}
            disabled={mediaLoading}
            className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
          >
            {mediaLoading
              ? 'Generating\u2026'
              : mediaTab === 'caption'
                ? 'Generate Caption'
                : mediaTab === 'audio'
                  ? 'Generate Audio Overview'
                  : mediaTab === 'narration'
                    ? 'Generate Narration Script'
                    : 'Get Visualization Advice'}
          </button>

          {/* Error */}
          {mediaError && (
            <p className="mt-2 text-xs text-red-400">{mediaError}</p>
          )}

          {/* Result */}
          {mediaResult && (
            <div className="mt-3 space-y-2">
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200 whitespace-pre-wrap">
                {mediaResult}
              </div>

              {/* Audio player */}
              {mediaAudioB64 && (
                <div className="rounded-lg border border-violet-800 bg-violet-900/20 p-2">
                  <p className="mb-1.5 text-[10px] font-semibold text-violet-300">Audio Overview</p>
                  <audio
                    controls
                    className="w-full h-8"
                    src={`data:audio/wav;base64,${mediaAudioB64}`}
                  />
                </div>
              )}

              {/* Copy / apply buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => { navigator.clipboard.writeText(mediaResult ?? ''); }}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-700"
                >
                  Copy
                </button>
                {mediaTab === 'caption' && selectedPanel && (
                  <button
                    onClick={() => {
                      if (selectedPanel && mediaResult) {
                        updatePanel(selectedPanel.id, { caption: mediaResult });
                      }
                    }}
                    className="flex-1 rounded-lg bg-violet-700 px-3 py-1.5 text-xs text-white transition-colors hover:bg-violet-600"
                  >
                    Apply to Panel {selectedPanel.label}
                  </button>
                )}
              </div>
            </div>
          )}
        </Section>

        {/* ELNOTE push – only when configured and media result available */}
        {elnoteAvailable && mediaResult && (
          <Section title="Push to ELNOTE">
            <div className="space-y-2">
              <select
                value={elnoteProjectId ?? ''}
                onChange={e => { setElnoteProjectId(e.target.value || null); setElnoteMsg(null); }}
                className="w-full rounded-lg border border-teal-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200"
              >
                <option value="">Select project…</option>
                {elnoteProjects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                disabled={!elnoteProjectId || elnotePushing}
                onClick={handleElnotePush}
                className="w-full rounded-lg bg-teal-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-teal-600 disabled:opacity-40"
              >
                {elnotePushing ? 'Pushing…' : 'Push to ELNOTE'}
              </button>
              {elnoteMsg && (
                <p className={`text-xs ${elnoteMsg.startsWith('Push') ? 'text-teal-400' : 'text-red-400'}`}>
                  {elnoteMsg}
                </p>
              )}
            </div>
          </Section>
        )}

        {/* Panel list */}
        {panels.length > 0 && (
          <Section title={`Panels (${panels.length})`}>
            <div className="space-y-1">
              {panels.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    p.id === selectedId
                      ? 'border-blue-500/40 bg-blue-600/20 text-blue-300'
                      : 'border-transparent text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className="font-bold">Panel {p.label}</span>
                  <span className="ml-2 text-slate-500">
                    {p.w.toFixed(0)} × {p.h.toFixed(0)} mm
                  </span>
                </button>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small reusable sub-components                                      */
/* ------------------------------------------------------------------ */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-2 text-sm font-semibold text-white">{title}</h3>
      {children}
    </section>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="text-xs text-slate-400">
      {label}
      <input
        type="number"
        step="0.5"
        value={value.toFixed(1)}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="mt-0.5 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
      />
    </label>
  );
}

function clampMm(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}
