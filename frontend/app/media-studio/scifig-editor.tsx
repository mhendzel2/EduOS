'use client';
import './scifig.css';
import React, { useState, useRef, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { 
  Download, Plus, Image as ImageIcon, Type as TypeIcon, LayoutTemplate, 
  Trash2, Move, AlignLeft, AlignCenter, AlignRight, Bold, Italic, TypeOutline, Wand2, Loader2, Sparkles, Brain, Layers, Lock, Unlock, ArrowUp, ArrowDown, Users, UserX, Undo2, Redo2, Strikethrough, Subscript, Superscript
} from 'lucide-react';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const pxToMm = (px: number) => px * 0.2645833333;
export const mmToPx = (mm: number) => mm / 0.2645833333;

import { motion, PanInfo } from 'motion/react';
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

// Standard useHistory hook for atomic undo/redo of the elements canvas object
function useHistory<T>(initialState: T) {
  const [state, setState] = useState<T>(initialState);
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);

  const set = (newState: T | ((prev: T) => T)) => {
    setState((prev) => {
      const nextState = typeof newState === 'function' ? (newState as Function)(prev) : newState;
      if (prev === nextState) return prev;
      setPast((p) => [...p, prev]);
      setFuture([]);
      return nextState;
    });
  };

  const undo = () => {
    if (past.length === 0) return;
    setState((prev) => {
      const newPast = [...past];
      const previousState = newPast.pop()!;
      setPast(newPast);
      setFuture((f) => [prev, ...f]);
      return previousState;
    });
  };

  const redo = () => {
    if (future.length === 0) return;
    setState((prev) => {
      const newFuture = [...future];
      const nextState = newFuture.shift()!;
      setFuture(newFuture);
      setPast((p) => [...p, prev]);
      return nextState;
    });
  };

  return [state, set, undo, redo, past.length > 0, future.length > 0] as const;
}

type ElementType = 'text' | 'image';

interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  isLocked?: boolean;
  groupId?: string;
  name?: string;
}

interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  align: 'left' | 'center' | 'right';
}

interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
  width: number;
  height: number;
}

type CanvasElement = TextElement | ImageElement;

type Guide = { id: string; type: 'horizontal' | 'vertical'; pos: number };

const GROUP_COLORS = [
  "border-purple-500 bg-purple-500/10 text-purple-400",
  "border-green-500 bg-green-500/10 text-green-400",
  "border-orange-500 bg-orange-500/10 text-orange-400",
  "border-pink-500 bg-pink-500/10 text-pink-400",
  "border-cyan-500 bg-cyan-500/10 text-cyan-400",
  "border-yellow-500 bg-yellow-500/10 text-yellow-400",
  "border-blue-500 bg-blue-500/10 text-blue-400",
  "border-rose-500 bg-rose-500/10 text-rose-400"
];

const getGroupStyle = (groupId: string) => {
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) {
    hash = groupId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % GROUP_COLORS.length;
  return GROUP_COLORS[index];
};

export default function FigureIllustrator({ projectId = "default" }: { projectId?: string }) {
  const [elements, setElements, undo, redo, canUndo, canRedo] = useHistory<CanvasElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 89, height: 100 }); // in mm. 89mm is Nature 1-col
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiImgModel, setAiImgModel] = useState("gemini-3.1-flash-image-preview");
  const [aiImgSize, setAiImgSize] = useState("1K");
  const [isGenerating, setIsGenerating] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [aiEditPrompt, setAiEditPrompt] = useState("");
  const [aiEditMode, setAiEditMode] = useState("general");
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [rightTab, setRightTab] = useState<'properties' | 'layers'>('properties');
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [draggingGuide, setDraggingGuide] = useState<string | null>(null);
  const draggingGuideRef = useRef<string | null>(null);

  const [activeSnapGuides, setActiveSnapGuides] = useState<string[]>([]);
  const [elementDrag, setElementDrag] = useState<{
    id: string;
    groupId?: string;
    ptrStartX: number;
    ptrStartY: number;
    dx: number;
    dy: number;
  } | null>(null);
  
  const elementDragRef = useRef(elementDrag);
  const guidesRef = useRef(guides);
  const elementsRef = useRef(elements);
  
  useEffect(() => { elementDragRef.current = elementDrag; }, [elementDrag]);
  useEffect(() => { guidesRef.current = guides; }, [guides]);
  useEffect(() => { elementsRef.current = elements; }, [elements]);

  useEffect(() => {
    draggingGuideRef.current = draggingGuide;
  }, [draggingGuide]);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      // Guide dragging logic
      const id = draggingGuideRef.current;
      if (id) {
        const canvasEl = document.getElementById('main-canvas-area');
        if (!canvasEl) return;
        const rect = canvasEl.getBoundingClientRect();
        
        setGuides(prev => prev.map(g => {
          if (g.id === id) {
            const pos = g.type === 'horizontal' ? e.clientY - rect.top : e.clientX - rect.left;
            return { ...g, pos: Math.round(pos) };
          }
          return g;
        }));
      }

      // Element dragging logic
      const drag = elementDragRef.current;
      if (drag && e.buttons > 0) { // Ensure button is held down
        const rawDx = e.clientX - drag.ptrStartX;
        const rawDy = e.clientY - drag.ptrStartY;
        
        // Calculate bounding box of dragging elements
        const targets = elementsRef.current.filter(el => drag.groupId ? el.groupId === drag.groupId : el.id === drag.id);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        targets.forEach(t => {
          const w = t.type === 'image' ? t.width : 50;
          const h = t.type === 'image' ? t.height : (t as TextElement).fontSize || 16;
          minX = Math.min(minX, t.x);
          minY = Math.min(minY, t.y);
          maxX = Math.max(maxX, t.x + w);
          maxY = Math.max(maxY, t.y + h);
        });

        const currX = minX + rawDx;
        const currY = minY + rawDy;
        const currMaxX = maxX + rawDx;
        const currMaxY = maxY + rawDy;
        const currMidX = (currX + currMaxX) / 2;
        const currMidY = (currY + currMaxY) / 2;
        
        let finalDx = rawDx;
        let finalDy = rawDy;
        let snappedIds: string[] = [];
        const SNAP_DIST = 12;

        const allGuides = guidesRef.current;

        // Snap Y axis (Horizontal guides)
        for (const g of allGuides.filter(g => g.type === 'horizontal')) {
          if (Math.abs(currY - g.pos) < SNAP_DIST) { finalDy = g.pos - minY; snappedIds.push(g.id); break; }
          if (Math.abs(currMaxY - g.pos) < SNAP_DIST) { finalDy = g.pos - maxY; snappedIds.push(g.id); break; }
          if (Math.abs(currMidY - g.pos) < SNAP_DIST) { finalDy = g.pos - (minY + maxY) / 2; snappedIds.push(g.id); break; }
        }

        // Snap X axis (Vertical guides)
        for (const g of allGuides.filter(g => g.type === 'vertical')) {
          if (Math.abs(currX - g.pos) < SNAP_DIST) { finalDx = g.pos - minX; snappedIds.push(g.id); break; }
          if (Math.abs(currMaxX - g.pos) < SNAP_DIST) { finalDx = g.pos - maxX; snappedIds.push(g.id); break; }
          if (Math.abs(currMidX - g.pos) < SNAP_DIST) { finalDx = g.pos - (minX + maxX) / 2; snappedIds.push(g.id); break; }
        }

        setElementDrag({ ...drag, dx: finalDx, dy: finalDy });
        setActiveSnapGuides(snappedIds);
      }
    };

    const handleUp = (e: PointerEvent) => {
      // Guide drag completion
      const id = draggingGuideRef.current;
      if (id) {
        const canvasEl = document.getElementById('main-canvas-area');
        if (canvasEl) {
          const rect = canvasEl.getBoundingClientRect();
          setGuides(prev => {
            const activeGuide = prev.find(g => g.id === id);
            if (activeGuide) {
              const pos = activeGuide.type === 'horizontal' ? e.clientY - rect.top : e.clientX - rect.left;
              const limit = activeGuide.type === 'horizontal' ? rect.height : rect.width;
              if (pos < -20 || pos > limit + 20) {
                return prev.filter(g => g.id !== id);
              }
            }
            return prev;
          });
        }
        setDraggingGuide(null);
      }

      // Element drag completion
      const drag = elementDragRef.current;
      if (drag) {
        if (drag.dx !== 0 || drag.dy !== 0) {
          setElements(prev => prev.map(p => {
             if (drag.groupId ? p.groupId === drag.groupId : p.id === drag.id) {
                return { ...p, x: p.x + drag.dx, y: p.y + drag.dy };
             }
             return p;
          }));
        }
        setElementDrag(null);
        setActiveSnapGuides([]);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [setElements]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger undo/redo if the user is typing in an input or textarea
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const primaryKey = isMac ? e.metaKey : e.ctrlKey;

      if (primaryKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (primaryKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const handleAiAssistant = async (complex: boolean, promptOverride?: string) => {
    const promptToUse = promptOverride || assistantPrompt;
    if (!promptToUse) return;
    setIsThinking(true);
    try {
      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API key not found");
      const ai = new GoogleGenAI({ apiKey });
      
      const currentCanvasContext = JSON.stringify(elements.map(el => {
        if (el.type === 'image') return { id: el.id, type: el.type, x: el.x, y: Math.round(el.y), width: Math.round(el.width), height: Math.round(el.height), groupId: el.groupId, name: el.name, isLocked: el.isLocked };
        return el;
      }));
      
      const config: any = {
        systemInstruction: "You are an expert scientific diagram designer. Given the current canvas elements (images without src data) and the user's request, output the fully updated list of canvas elements as a JSON array. You may modify x/y coordinates for optimal spacing and alignment, add or update grouping (groupId) to logically relate elements, update text content, and tweak text alignments. Ensure semantic clarity, visual proportion, and readability. IMPORTANT: Preserve image elements EXACTLY as provided (keep same id, x, y, width, height unless the user's intent strongly implies resizing or moving them). If you add new elements, omit the 'id' field. Assign the same exact UUID string to the 'groupId' field of elements that should be coupled together (e.g., an image and its label).",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              type: { type: Type.STRING },
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              text: { type: Type.STRING },
              fontSize: { type: Type.NUMBER },
              fontFamily: { type: Type.STRING },
              fontWeight: { type: Type.STRING },
              fontStyle: { type: Type.STRING },
              color: { type: Type.STRING },
              align: { type: Type.STRING },
              width: { type: Type.NUMBER },
              height: { type: Type.NUMBER },
              groupId: { type: Type.STRING },
              name: { type: Type.STRING },
              isLocked: { type: Type.BOOLEAN }
            }
          }
        }
      };
      
      if (complex) {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
      }
      
      const model = complex ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";
      const response = await ai.models.generateContent({
        model,
        contents: `Canvas Elements: ${currentCanvasContext}\nUser Request: ${promptToUse}`,
        config
      });
      
      if (response.text) {
        const newElementsData = JSON.parse(response.text);
        if (Array.isArray(newElementsData)) {
          const updatedElements = newElementsData.map((newEl: any) => {
             const existing = elements.find(e => e.id === newEl.id);
             if (existing && existing.type === 'image') {
                return { ...newEl, src: existing.src };
             }
             if (!newEl.id) newEl.id = crypto.randomUUID();
             return newEl;
          });
          setElements(updatedElements);
        }
      }
    } catch(err) {
      console.error(err);
      alert('AI Task Failed.');
    } finally {
      setIsThinking(false);
      if (!promptOverride) {
        setAssistantPrompt('');
      }
    }
  };

  const editSelectedImage = async () => {
    if (!aiEditPrompt || !selectedId) return;
    const selectedEl = elements.find(e => e.id === selectedId);
    if (!selectedEl || selectedEl.type !== 'image') return;
    
    setIsEditingImage(true);
    try {
      if ((window as any).aistudio?.hasSelectedApiKey && !(await (window as any).aistudio.hasSelectedApiKey())) {
        await (window as any).aistudio.openSelectKey();
      }
      await new Promise(r => setTimeout(r, 500));
      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API key not found");
      const ai = new GoogleGenAI({ apiKey });
      
      const parts = selectedEl.src.split(',');
      const mimeType = parts[0].split(':')[1].split(';')[0];
      const data = parts[1];
      
      let finalPrompt = aiEditPrompt;
      if (aiEditMode === 'remove') {
        finalPrompt = `Carefully remove the following object from the image, filling in the background naturally: ${aiEditPrompt}`;
      } else if (aiEditMode === 'color') {
        finalPrompt = `Adjust the colors, lighting, and tone of this image based on the following instructions: ${aiEditPrompt}`;
      } else if (aiEditMode === 'style') {
        finalPrompt = `Apply a style transfer to this image so it looks like the following style, preserving the core content: ${aiEditPrompt}`;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: {
          parts: [
            { inlineData: { data, mimeType } },
            { text: finalPrompt }
          ]
        }
      });
      
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const newSrc = `data:${part.inlineData.mimeType || 'image/jpeg'};base64,${part.inlineData.data}`;
          updateSelected({ src: newSrc });
          break;
        }
      }
    } catch(err) {
       console.error(err);
       alert("Failed to edit image.");
    } finally {
       setIsEditingImage(false);
       setAiEditPrompt('');
    }
  };

  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pxWidth = Math.round(mmToPx(canvasSize.width));
  const pxHeight = Math.round(mmToPx(canvasSize.height));

  const addText = () => {
    const newText: TextElement = {
      id: crypto.randomUUID(),
      type: 'text',
      name: 'Text Label',
      text: 'New Label',
      x: 10,
      y: 10,
      fontSize: 12,
      fontFamily: 'helvetica',
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#000000',
      align: 'left',
    };
    setElements([...elements, newText]);
    setSelectedId(newText.id);
  };

  const addPanelLabel = () => {
    const newText: TextElement = {
      id: crypto.randomUUID(),
      type: 'text',
      name: 'Panel Label',
      text: 'A',
      x: 5,
      y: 5,
      fontSize: 16,
      fontFamily: 'helvetica',
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: '#000000',
      align: 'left',
    };
    setElements([...elements, newText]);
    setSelectedId(newText.id);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        // scale down if too large for canvas
        let w = img.width;
        let h = img.height;
        const maxW = pxWidth - 20;
        if (w > maxW) {
          h = (maxW / w) * h;
          w = maxW;
        }

        const newImage: ImageElement = {
          id: crypto.randomUUID(),
          type: 'image',
          name: 'Imported Image',
          src,
          width: w,
          height: h,
          x: 10,
          y: 10,
        };
        setElements(prev => [...prev, newImage]);
        setSelectedId(newImage.id);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const generateImage = async () => {
    if (!aiPrompt) return;
    setIsGenerating(true);
    try {
      if ((window as any).aistudio?.hasSelectedApiKey && !(await (window as any).aistudio.hasSelectedApiKey())) {
        await (window as any).aistudio.openSelectKey();
      }
      // Wait a moment for state to settle in case of race condition
      await new Promise(r => setTimeout(r, 500));
      
      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: aiImgModel,
        contents: {
          parts: [
            { text: aiPrompt },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
            imageSize: aiImgSize,
          }
        }
      });
      
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const base64EncodeString = part.inlineData.data;
          const imageUrl = `data:image/jpeg;base64,${base64EncodeString}`;
          const img = new Image();
          img.onload = () => {
            let w = img.width;
            let h = img.height;
            const maxW = pxWidth - 20;
            if (w > maxW) {
              h = (maxW / w) * h;
              w = maxW;
            }
            const newImage: ImageElement = {
              id: crypto.randomUUID(),
              type: 'image',
              name: 'AI Graphic',
              src: imageUrl,
              width: w,
              height: h,
              x: 10,
              y: 10,
            };
            setElements(prev => [...prev, newImage]);
            setSelectedId(newImage.id);
          };
          img.src = imageUrl;
          break;
        }
      }
    } catch(err) {
      console.error(err);
      alert('Failed to generate image. Please try again.');
    } finally {
      setIsGenerating(false);
      setAiPrompt('');
    }
  };

  const updateSelected = (updates: Partial<CanvasElement>) => {
    if (!selectedId) return;
    setElements(elements.map(el => el.id === selectedId ? { ...el, ...updates } as CanvasElement : el));
  };

  const handleTextFormat = (tag: string) => {
    if (!selectedId) return;
    const textarea = document.getElementById('text-content-editor') as HTMLTextAreaElement;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedEl = elements.find(e => e.id === selectedId);
    if (!selectedEl || selectedEl.type !== 'text') return;
    
    const text = selectedEl.text;
    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end);
    
    // For superscript/subscript, we might want to wrap.
    // If no text selected, we can insert an empty tag. Keep it simple.
    const newText = `${before}<${tag}>${selected}</${tag}>${after}`;
    
    updateSelected({ text: newText });
    
    // Focus back
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length + 2, end + tag.length + 2);
    }, 10);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setElements(elements.filter(el => el.id !== selectedId));
    setSelectedId(null);
  };

  const toggleLayerLock = (id: string) => {
    setElements(elements.map(el => el.id === id ? { ...el, isLocked: !el.isLocked } : el));
  };

  const moveLayerUp = (index: number) => {
    if (index >= elements.length - 1) return;
    const newEls = [...elements];
    const temp = newEls[index];
    newEls[index] = newEls[index + 1];
    newEls[index + 1] = temp;
    setElements(newEls);
  };

  const moveLayerDown = (index: number) => {
    if (index <= 0) return;
    const newEls = [...elements];
    const temp = newEls[index];
    newEls[index] = newEls[index - 1];
    newEls[index - 1] = temp;
    setElements(newEls);
  };

  const groupSelectedLayers = () => {
    if (selectedLayerIds.length < 2) return;
    const newGroupId = crypto.randomUUID();
    setElements(elements.map(el => selectedLayerIds.includes(el.id) ? { ...el, groupId: newGroupId } : el));
  };

  const ungroupSelectedLayers = () => {
    if (selectedLayerIds.length === 0) return;
    setElements(elements.map(el => selectedLayerIds.includes(el.id) ? { ...el, groupId: undefined } : el));
  };

  const alignLayers = (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (selectedLayerIds.length < 2) return;
    
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    const targets = elements.filter(el => selectedLayerIds.includes(el.id));
    
    targets.forEach(el => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      const w = el.type === 'image' ? el.width : 50; // Approximated width for text
      const h = el.type === 'image' ? el.height : (el as TextElement).fontSize || 16;
      maxX = Math.max(maxX, el.x + w);
      maxY = Math.max(maxY, el.y + h);
    });

    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    setElements(elements.map(el => {
      if (!selectedLayerIds.includes(el.id)) return el;
      let newX = el.x;
      let newY = el.y;
      const w = el.type === 'image' ? el.width : 50;
      const h = el.type === 'image' ? el.height : (el as TextElement).fontSize || 16;
      
      switch (alignment) {
        case 'left': newX = minX; break;
        case 'center': newX = midX - w / 2; break;
        case 'right': newX = maxX - w; break;
        case 'top': newY = minY; break;
        case 'middle': newY = midY - h / 2; break;
        case 'bottom': newY = maxY - h; break;
      }
      return { ...el, x: newX, y: newY };
    }));
  };

  const distributeLayers = (direction: 'horizontal' | 'vertical' | 'horizontal-space' | 'vertical-space') => {
    if (selectedLayerIds.length < 3) return;

    let targets = elements.filter(el => selectedLayerIds.includes(el.id));
    const getW = (el: CanvasElement) => el.type === 'image' ? el.width : 50; 
    const getH = (el: CanvasElement) => el.type === 'image' ? el.height : ((el as TextElement).fontSize || 16);

    let newElementsMap = new Map<string, Partial<CanvasElement>>();

    if (direction === 'horizontal') {
      targets.sort((a, b) => a.x - b.x);
      const startX = targets[0].x;
      const endX = targets[targets.length - 1].x;
      const interval = (endX - startX) / (targets.length - 1);
      
      targets.forEach((t, i) => {
        if (i > 0 && i < targets.length - 1) {
          newElementsMap.set(t.id, { x: startX + interval * i });
        }
      });
    } else if (direction === 'vertical') {
      targets.sort((a, b) => a.y - b.y);
      const startY = targets[0].y;
      const endY = targets[targets.length - 1].y;
      const interval = (endY - startY) / (targets.length - 1);
      
      targets.forEach((t, i) => {
        if (i > 0 && i < targets.length - 1) {
          newElementsMap.set(t.id, { y: startY + interval * i });
        }
      });
    } else if (direction === 'horizontal-space') {
      targets.sort((a, b) => a.x - b.x);
      const first = targets[0];
      const last = targets[targets.length - 1];
      const totalWidth = targets.reduce((sum, el) => sum + getW(el), 0);
      const startX = first.x;
      const endX = last.x + getW(last);
      const totalSpace = (endX - startX) - totalWidth;
      const gap = totalSpace / (targets.length - 1);
      
      let currX = startX + getW(first) + gap;
      targets.forEach((t, i) => {
        if (i > 0 && i < targets.length - 1) {
          newElementsMap.set(t.id, { x: currX });
          currX += getW(t) + gap;
        }
      });
    } else if (direction === 'vertical-space') {
      targets.sort((a, b) => a.y - b.y);
      const first = targets[0];
      const last = targets[targets.length - 1];
      const totalHeight = targets.reduce((sum, el) => sum + getH(el), 0);
      const startY = first.y;
      const endY = last.y + getH(last);
      const totalSpace = (endY - startY) - totalHeight;
      const gap = totalSpace / (targets.length - 1);
      
      let currY = startY + getH(first) + gap;
      targets.forEach((t, i) => {
        if (i > 0 && i < targets.length - 1) {
          newElementsMap.set(t.id, { y: currY });
          currY += getH(t) + gap;
        }
      });
    }

    if (newElementsMap.size > 0) {
      setElements(elements.map(el => {
        const update = newElementsMap.get(el.id);
        return update ? { ...el, ...update } as CanvasElement : el;
      }));
    }
  };

  const exportPDF = () => {
    // jsPDF uses pt/mm. Let's use mm since we use mm for canvasSize.
    const pdf = new jsPDF({
      orientation: canvasSize.width > canvasSize.height ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [canvasSize.width, canvasSize.height]
    });

    // We must sort elements to paint base images first, then text, or simply keep their array order (z-index)
    elements.forEach(el => {
      const xMm = pxToMm(el.x);
      const yMm = pxToMm(el.y);

      if (el.type === 'image') {
        const wMm = pxToMm(el.width);
        const hMm = pxToMm(el.height);
        // Extract format from src if possible
        const isPNG = el.src.startsWith('data:image/png');
        pdf.addImage(el.src, isPNG ? 'PNG' : 'JPEG', xMm, yMm, wMm, hMm);
      } else if (el.type === 'text') {
        pdf.setFont(el.fontFamily, el.fontStyle === 'italic' ? 'italic' : 'normal', el.fontWeight === 'bold' ? 'bold' : 'normal');
        pdf.setFontSize(el.fontSize); // jsPDF uses pt for font size, which corresponds nicely to web px essentially for roughly 72dpi. 
        // Actually, jsPDF font size is in pt. Web typically is px. 
        // Let's just pass fontSize directly, it treats it as pt.
        pdf.setTextColor(el.color);
        
        // Alignment
        const align = el.align === 'center' ? 'center' : el.align === 'right' ? 'right' : 'left';
        
        pdf.text(el.text.replace(/<[^>]*>?/gm, ''), xMm, yMm + pxToMm(el.fontSize), { // jsPDF y is baseline, web typically top. Adding fontSize offsets it well enough.
          align: align as any
        });
      }
    });

    pdf.save('scientific-figure.pdf');
  };

  const exportSVG = () => {
    let svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pxWidth}" height="${pxHeight}" viewBox="0 0 ${pxWidth} ${pxHeight}">\n`;
    
    // Create a plain white background boundary to match visual canvas representation
    svgContent += `  <rect width="100%" height="100%" fill="white"/>\n`;

    // Sort to replicate standard PDF Z-Index tracking behavior
    const sortedEls = [...elements]; // Assuming rendering array already preserves z-index sequence naturally
    
    sortedEls.forEach(el => {
      if (el.type === 'image') {
        svgContent += `  <image href="${el.src}" x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" />\n`;
      } else if (el.type === 'text') {
        // Strip rich HTML components and transform to T-Spans cleanly
        const plainText = el.text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>?/gm, '');
        const lines = plainText.split('\n');
        
        let startX = el.x;
        // Text Anchor shifts mapping logic slightly from CSS left bounds
        const svgAnchorMap: Record<string, string> = { left: 'start', center: 'middle', right: 'end' };
        const anchor = svgAnchorMap[el.align] || 'start';
        
        if (el.align === 'center') {
          // Approximate standard 50px offset mapping if centering raw text bounds
          startX += 50; 
        } else if (el.align === 'right') {
          startX += 100;
        }

        const escapedColor = el.color.startsWith('#') || el.color.startsWith('rgb') ? el.color : 'black';
        
        svgContent += `  <text x="${startX}" y="${el.y + el.fontSize * 0.9}" font-family="${el.fontFamily}" font-size="${el.fontSize}" font-weight="${el.fontWeight}" font-style="${el.fontStyle}" fill="${escapedColor}" text-anchor="${anchor}">\n`;
        lines.forEach((line, index) => {
            svgContent += `    <tspan x="${startX}" dy="${index === 0 ? 0 : 1.2}em">${line}</tspan>\n`;
        });
        svgContent += `  </text>\n`;
      }
    });

    svgContent += `</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'scientific_diagram.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const selectedEl = elements.find(el => el.id === selectedId);

  return (
    <div className="grid h-screen w-full bg-bg-app text-text-main font-ui overflow-hidden" style={{ gridTemplateRows: '48px 1fr 24px', gridTemplateColumns: '260px 1fr 300px' }}>
      
      {/* Header */}
      <header className="col-span-full bg-bg-panel border-b border-border-subtle flex items-center px-4 justify-between">
        <div className="font-bold text-[14px] tracking-[0.05em] text-[#ffd700] flex items-center gap-4">
          NANOBANANA ILLUSTRATOR / PRO
          <div className="flex border-l border-border-subtle pl-4 ml-2 gap-1 gap-1">
            <button 
              onClick={undo} 
              disabled={!canUndo} 
              className="p-1 rounded hover:bg-[#38383a] text-text-main disabled:opacity-30 disabled:hover:bg-transparent"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button 
              onClick={redo} 
              disabled={!canRedo} 
              className="p-1 rounded hover:bg-[#38383a] text-text-main disabled:opacity-30 disabled:hover:bg-transparent"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-text-dim mr-3">Scientific_Drawing.nbb</span>
          <button className="bg-[#38383a] border border-border-subtle text-text-main px-3 py-1 rounded text-[12px] cursor-pointer hover:bg-[#4a4a4d]">Layer Settings</button>
          <div className="flex gap-2">
            <button onClick={exportSVG} className="bg-transparent border border-border-subtle hover:border-[#4a4a4d] hover:bg-[#38383a] text-white px-3 py-1 rounded text-[12px] cursor-pointer shadow-none flex items-center gap-1 font-normal transition-colors"><Download className="w-3 h-3" /> Export SVG</button>
            <button onClick={exportPDF} className="bg-accent border border-accent hover:bg-[#005bb5] text-white px-3 py-1 rounded text-[12px] cursor-pointer shadow-none flex items-center gap-1 font-normal transition-colors"><Download className="w-3 h-3" /> Export Layered PDF</button>
          </div>
        </div>
      </header>

      {/* Left Sidebar - Canvas & Tools */}
      <nav className="flex flex-col bg-bg-panel border-r border-border-subtle p-4 gap-6 overflow-y-auto overflow-x-hidden row-start-2 col-start-1">

        <div className="flex flex-col gap-2">
          <h2 className="text-[10px] uppercase tracking-[0.1em] text-text-dim font-normal">Document Size</h2>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-text-dim uppercase mb-1 block">Width (mm)</label>
              <input 
                type="number" 
                value={canvasSize.width} 
                onChange={e => setCanvasSize({ ...canvasSize, width: Number(e.target.value) })}
                className="w-full bg-[#1a1a1b] border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-dim uppercase mb-1 block">Height (mm)</label>
              <input 
                type="number" 
                value={canvasSize.height} 
                onChange={e => setCanvasSize({ ...canvasSize, height: Number(e.target.value) })}
                className="w-full bg-[#1a1a1b] border border-border-subtle rounded px-2 py-1 text-[11px] font-mono text-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button onClick={() => setCanvasSize({ width: 89, height: 100 })} className="bg-[#38383a] border border-border-subtle text-text-main py-1 rounded text-[11px] cursor-pointer hover:bg-[#4a4a4d]">1-Col (89mm)</button>
            <button onClick={() => setCanvasSize({ width: 183, height: 150 })} className="bg-[#38383a] border border-border-subtle text-text-main py-1 rounded text-[11px] cursor-pointer hover:bg-[#4a4a4d]">2-Col (183mm)</button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-[10px] uppercase tracking-[0.1em] text-text-dim font-normal">Generate Graphic</h2>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <select 
                value={aiImgModel}
                onChange={e => setAiImgModel(e.target.value)}
                className="flex-1 bg-[#1a1a1b] border border-border-subtle rounded px-1 py-1 text-[10px] font-mono text-white"
              >
                <option value="gemini-3.1-flash-image-preview">Flash (Fast)</option>
                <option value="gemini-3-pro-image-preview">Pro (High Quality)</option>
              </select>
              <select 
                value={aiImgSize}
                onChange={e => setAiImgSize(e.target.value)}
                className="w-16 bg-[#1a1a1b] border border-border-subtle rounded px-1 py-1 text-[10px] font-mono text-white"
              >
                <option value="1K">1K</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </select>
            </div>
            <textarea 
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder="Describe your diagram..."
              className="w-full bg-[#1a1a1b] border border-border-subtle rounded px-2 py-2 text-[11px] font-mono text-white min-h-[60px]"
              disabled={isGenerating}
            />
            <button 
              onClick={generateImage} 
              disabled={isGenerating || !aiPrompt}
              className="w-full flex items-center justify-center gap-2 px-3 py-1 bg-accent border border-accent text-white rounded text-[12px] cursor-pointer disabled:opacity-50 hover:bg-[#005bb5]"
            >
              {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              {isGenerating ? 'Generating...' : 'Generate Image'}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-[10px] uppercase tracking-[0.1em] text-text-dim font-normal">Insert Elements</h2>
          <div className="flex flex-col gap-2">
            <button onClick={addPanelLabel} className="bg-[#38383a] border border-border-subtle text-text-main py-1 px-3 rounded text-[12px] cursor-pointer flex items-center gap-2 hover:bg-[#4a4a4d]">
              <Bold className="w-3 h-3 text-text-dim" />
              Panel Label (A, B...)
            </button>
            <button onClick={addText} className="bg-[#38383a] border border-border-subtle text-text-main py-1 px-3 rounded text-[12px] cursor-pointer flex items-center gap-2 hover:bg-[#4a4a4d]">
              <TypeIcon className="w-3 h-3 text-text-dim" />
              Text Annotation
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="bg-[#38383a] border border-border-subtle text-text-main py-1 px-3 rounded text-[12px] cursor-pointer flex items-center gap-2 hover:bg-[#4a4a4d]">
              <ImageIcon className="w-3 h-3 text-text-dim" />
              Import Image (PNG/JPG)
            </button>
            <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/png, image/jpeg, image/svg+xml" className="hidden" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-[10px] uppercase tracking-[0.1em] text-text-dim font-normal">Task Intelligence</h2>
          <div className="flex flex-col gap-2">
            <textarea 
              value={assistantPrompt}
              onChange={e => setAssistantPrompt(e.target.value)}
              placeholder="Ask AI to analyze layout, align labels, or generate text..."
              className="w-full bg-[#1a1a1b] border border-border-subtle rounded px-2 py-2 text-[11px] font-mono text-white min-h-[60px]"
              disabled={isThinking}
            />
            <div className="flex gap-2">
              <button 
                onClick={() => handleAiAssistant(false)} 
                disabled={isThinking || !assistantPrompt}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-[#38383a] border border-border-subtle text-text-main rounded text-[11px] cursor-pointer hover:bg-[#4a4a4d] disabled:opacity-50"
              >
                {isThinking ? <Loader2 className="w-3 h-3 animate-spin"/> : <Sparkles className="w-3 h-3"/>}
                Fast
              </button>
              <button 
                onClick={() => handleAiAssistant(true)} 
                disabled={isThinking || !assistantPrompt}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-accent border border-accent text-white rounded text-[11px] cursor-pointer hover:bg-[#005bb5] disabled:opacity-50"
              >
                {isThinking ? <Loader2 className="w-3 h-3 animate-spin"/> : <Brain className="w-3 h-3"/>}
                High Thinking
              </button>
            </div>
            
            <button 
              onClick={() => handleAiAssistant(true, "Analyze the current canvas elements and apply strict scientific layout improvements. Optimize spacing and distances between logically grouped elements. Align disparate text labels smoothly together (e.g., panel A and panel B texts). Use semantic structural grouping logic for orphaned items. Do NOT delete or heavily scale main images. Clean up alignments to enhance overall visual clarity and scientific rigor and return the cleanly spaced elements.")}
              disabled={isThinking || elements.length === 0}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 mt-1 bg-[#38383a] border border-[#5a5a5d] text-white rounded text-[12px] cursor-pointer hover:bg-[#4a4a4d] disabled:opacity-50 transition-colors"
            >
              {isThinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LayoutTemplate className="w-3.5 h-3.5" />}
              Auto-Improve Layout (AI)
            </button>
          </div>
        </div>

      </nav>

      {/* Main Canvas Area */}
      <main className="relative flex items-center justify-center overflow-auto bg-[#121212] row-start-2 col-start-2">
        <div className="relative p-[30px]" style={{ width: pxWidth + 60, height: pxHeight + 60 }}>
          {/* Top Ruler */}
          <div
            className="absolute top-0 left-[30px] right-[30px] h-[30px] bg-[#1a1a1b] border-b border-border-subtle cursor-row-resize select-none overflow-hidden"
            onPointerDown={(e) => {
              const newId = crypto.randomUUID();
              const canvasEl = document.getElementById('main-canvas-area');
              const y = canvasEl ? e.clientY - canvasEl.getBoundingClientRect().top : 0;
              setGuides([...guides, { id: newId, type: 'horizontal', pos: y }]);
              setDraggingGuide(newId);
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            style={{
              backgroundImage: `linear-gradient(to right, #4a4a4d 1px, transparent 1px), linear-gradient(to right, #7a7a7d 1px, transparent 1px)`,
              backgroundSize: `${mmToPx(1)}px 10px, ${mmToPx(10)}px 24px`,
              backgroundRepeat: 'repeat-x',
              backgroundPosition: '0 bottom',
            }}
          />

          {/* Left Ruler */}
          <div
            className="absolute left-0 top-[30px] bottom-[30px] w-[30px] bg-[#1a1a1b] border-r border-border-subtle cursor-col-resize select-none overflow-hidden"
            onPointerDown={(e) => {
              const newId = crypto.randomUUID();
              const canvasEl = document.getElementById('main-canvas-area');
              const x = canvasEl ? e.clientX - canvasEl.getBoundingClientRect().left : 0;
              setGuides([...guides, { id: newId, type: 'vertical', pos: x }]);
              setDraggingGuide(newId);
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            style={{
              backgroundImage: `linear-gradient(to bottom, #4a4a4d 1px, transparent 1px), linear-gradient(to bottom, #7a7a7d 1px, transparent 1px)`,
              backgroundSize: `10px ${mmToPx(1)}px, 24px ${mmToPx(10)}px`,
              backgroundRepeat: 'repeat-y',
              backgroundPosition: 'right 0',
            }}
          />

          {/* The Actual Canvas Map */}
          <div 
            id="main-canvas-area"
            ref={canvasRef}
            className="relative overflow-visible bg-bg-canvas shadow-[0_10px_30px_rgba(0,0,0,0.5)] cursor-crosshair ml-auto mr-auto"
            style={{ 
              width: `${pxWidth}px`, 
              height: `${pxHeight}px`,
            }}
            onClick={() => setSelectedId(null)}
          >
            {/* Guide Elements */}
            {guides.map(g => (
              <div
                key={g.id}
                className={cn(
                  "absolute z-[60] flex items-center justify-center pointer-events-auto transition-colors",
                  activeSnapGuides.includes(g.id) ? 'bg-red-500' : 'bg-cyan-400',
                  g.type === 'horizontal' ? 'left-[-30px] right-[-30px] cursor-row-resize' : 'top-[-30px] bottom-[-30px] cursor-col-resize',
                  activeSnapGuides.includes(g.id) ? (g.type === 'horizontal' ? 'h-[2px]' : 'w-[2px]') : (g.type === 'horizontal' ? 'h-[1px]' : 'w-[1px]')
                )}
                style={{
                  ...(g.type === 'horizontal' ? { top: g.pos } : { left: g.pos })
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDraggingGuide(g.id);
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                }}
                onPointerUp={(e) => {
                  if (draggingGuide === g.id) {
                    setDraggingGuide(null);
                    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
                    const canvasEl = document.getElementById('main-canvas-area');
                    if (canvasEl) {
                      const rect = canvasEl.getBoundingClientRect();
                      const pos = g.type === 'horizontal' ? e.clientY - rect.top : e.clientX - rect.left;
                      const limit = g.type === 'horizontal' ? rect.height : rect.width;
                      if (pos < -20 || pos > limit + 20) {
                        setGuides(guides.filter(guide => guide.id !== g.id));
                      }
                    }
                  }
                }}
              />
            ))}

            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: `linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)`,
              backgroundSize: `${mmToPx(10)}px ${mmToPx(10)}px`
            }}></div>
            {elements.map((el) => {
            const isSelected = selectedId === el.id;
            const isDraggingThis = elementDrag && (elementDrag.groupId ? el.groupId === elementDrag.groupId : el.id === elementDrag.id);
            const currentX = el.x + (isDraggingThis ? elementDrag.dx : 0);
            const currentY = el.y + (isDraggingThis ? elementDrag.dy : 0);

            return (
              <motion.div
                key={el.id}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSelectedId(el.id);
                  if (el.isLocked) return;
                  setElementDrag({
                    id: el.id,
                    groupId: el.groupId,
                    ptrStartX: e.clientX,
                    ptrStartY: e.clientY,
                    dx: 0,
                    dy: 0
                  });
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                }}
                className={cn(
                  "absolute cursor-move origin-top-left border-2 transition-colors",
                  isSelected ? "border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.5)] z-50" : "z-10 hover:border-blue-300",
                  !isSelected && el.groupId ? `border-dashed ${getGroupStyle(el.groupId).split(' ')[0]}` : (!isSelected ? "border-transparent" : ""),
                  isDraggingThis && activeSnapGuides.length > 0 && "!border-red-500 !shadow-[0_0_15px_rgba(239,68,68,0.6)] !z-[70]"
                )}
                style={{ 
                  left: currentX, 
                  top: currentY,
                  x: 0,
                  y: 0 
                }}
              >
                {el.groupId && (
                  <div className={cn(
                    "absolute -top-3 -left-0.5 px-1 py-0.5 rounded-t-sm text-[8px] font-bold uppercase tracking-wider transition-opacity",
                    isSelected ? "opacity-100" : "opacity-30",
                    getGroupStyle(el.groupId).split(' ')[1] || "bg-[#38383a]", 
                    getGroupStyle(el.groupId).split(' ')[2] || "text-white"
                  )}>
                    Group
                  </div>
                )}
                {el.type === 'text' ? (
                  <div
                    style={{
                      fontSize: `${el.fontSize}px`,
                      fontFamily: el.fontFamily,
                      fontWeight: el.fontWeight,
                      fontStyle: el.fontStyle,
                      color: el.color,
                      textAlign: el.align,
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.2
                    }}
                    className="p-1 outline-none"
                    dangerouslySetInnerHTML={{ __html: el.text }}
                  />
                ) : (
                  <img 
                    src={el.src} 
                    alt="figure element" 
                    className="block object-contain pointer-events-none"
                    style={{ width: `${el.width}px`, height: `${el.height}px` }} 
                  />
                )}
              </motion.div>
            );
          })}
        </div>
        </div>
      </main>

      {/* Right Sidebar - Properties & Layers */}
      <aside className="bg-bg-panel border-l border-border-subtle flex flex-col row-start-2 col-start-3 overflow-hidden">
        <div className="flex border-b border-border-subtle bg-[#1a1a1b] shrink-0">
          <button 
            className={cn("flex-1 py-3 text-[10px] uppercase tracking-[0.1em] font-semibold border-r border-border-subtle transition-colors flex items-center justify-center gap-1", rightTab === 'properties' ? "bg-bg-panel text-white" : "text-text-dim hover:text-white")}
            onClick={() => setRightTab('properties')}
          >
            Properties
          </button>
          <button 
            className={cn("flex-1 py-3 text-[10px] uppercase tracking-[0.1em] font-semibold transition-colors flex items-center justify-center gap-1", rightTab === 'layers' ? "bg-bg-panel text-white" : "text-text-dim hover:text-white")}
            onClick={() => setRightTab('layers')}
          >
            Layer Settings
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {rightTab === 'properties' ? (
            selectedEl ? (
              <>
                <div className="flex justify-between items-center">
                  <div className="text-[12px] font-semibold flex justify-between uppercase tracking-[0.1em]">Label Properties</div>
                  <button 
                    onClick={deleteSelected}
                    className="text-text-dim hover:text-red-500 transition-colors"
                    title="Delete element"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="flex flex-col gap-2 pt-2">
                  {selectedEl.type === 'text' && (
                    <>
                      <div className="flex flex-col gap-1 mb-2">
                        <div className="flex justify-between items-center text-[11px]">
                          <span>Content</span>
                          <div className="flex gap-1 bg-[#1a1a1b] p-0.5 rounded-sm border border-border-subtle">
                            <button onClick={() => handleTextFormat('sub')} className="p-1 hover:bg-[#38383a] text-text-dim hover:text-white rounded-sm transition-colors" title="Subscript"><Subscript className="w-3 h-3" /></button>
                            <button onClick={() => handleTextFormat('sup')} className="p-1 hover:bg-[#38383a] text-text-dim hover:text-white rounded-sm transition-colors" title="Superscript"><Superscript className="w-3 h-3" /></button>
                            <button onClick={() => handleTextFormat('s')} className="p-1 hover:bg-[#38383a] text-text-dim hover:text-white rounded-sm transition-colors" title="Strikethrough"><Strikethrough className="w-3 h-3" /></button>
                          </div>
                        </div>
                        <textarea
                          id="text-content-editor"
                          value={selectedEl.text}
                          onChange={(e) => updateSelected({ text: e.target.value })}
                          className="bg-[#1a1a1b] border border-border-subtle text-white w-full px-2 py-1 font-mono text-[10px] min-h-[50px] rounded-sm"
                        />
                      </div>

                      <div className="flex justify-between items-center mb-2 text-[11px]">
                        <span>Font Family</span>
                        <select
                          value={selectedEl.fontFamily}
                          onChange={(e) => updateSelected({ fontFamily: e.target.value })}
                          className="bg-[#1a1a1b] border border-border-subtle text-white w-[80px] px-1 py-1 font-mono text-[10px] rounded-sm"
                        >
                          <option value="helvetica">Helvetica</option>
                          <option value="times">Times</option>
                          <option value="courier">Courier</option>
                        </select>
                      </div>
                      
                      <div className="flex justify-between items-center mb-2 text-[11px]">
                        <span>Font Size</span>
                        <input
                          type="number"
                          value={selectedEl.fontSize}
                          onChange={(e) => updateSelected({ fontSize: Number(e.target.value) })}
                          className="bg-[#1a1a1b] border border-border-subtle text-white w-[60px] px-1 py-1 font-mono text-[10px] rounded-sm"
                        />
                      </div>

                      <div className="flex justify-between items-center mb-2 text-[11px]">
                        <span>Format</span>
                        <div className="flex gap-1 bg-[#1a1a1b] border border-border-subtle p-0.5 rounded-sm">
                          <button 
                            onClick={() => updateSelected({ fontWeight: selectedEl.fontWeight === 'bold' ? 'normal' : 'bold' })}
                            className={cn("p-1 rounded-sm", selectedEl.fontWeight === 'bold' ? "bg-accent" : "text-text-dim")}
                          ><Bold className="w-3 h-3" /></button>
                          <button 
                            onClick={() => updateSelected({ fontStyle: selectedEl.fontStyle === 'italic' ? 'normal' : 'italic' })}
                            className={cn("p-1 rounded-sm", selectedEl.fontStyle === 'italic' ? "bg-accent" : "text-text-dim")}
                          ><Italic className="w-3 h-3" /></button>
                          <button 
                            onClick={() => updateSelected({ align: 'left' })}
                            className={cn("p-1 rounded-sm", selectedEl.align === 'left' ? "bg-accent" : "text-text-dim")}
                          ><AlignLeft className="w-3 h-3" /></button>
                          <button 
                            onClick={() => updateSelected({ align: 'center' })}
                            className={cn("p-1 rounded-sm", selectedEl.align === 'center' ? "bg-accent" : "text-text-dim")}
                          ><AlignCenter className="w-3 h-3" /></button>
                        </div>
                      </div>
                      
                      <div className="flex justify-between items-center mb-2 text-[11px]">
                        <span>Color</span>
                        <input
                          type="color"
                          value={selectedEl.color}
                          onChange={(e) => updateSelected({ color: e.target.value })}
                          className="w-10 h-6 cursor-pointer border-0 p-0 rounded-sm bg-transparent"
                        />
                      </div>
                    </>
                  )}

                  {selectedEl.type === 'image' && (
                    <>
                      <div className="flex flex-col mb-4 gap-2 border border-border-subtle p-2 rounded-sm bg-[#1a1a1b]">
                        <span className="text-[10px] text-text-dim uppercase tracking-[0.05em]">AI Image Editor</span>
                        <select
                          value={aiEditMode}
                          onChange={e => setAiEditMode(e.target.value)}
                          className="bg-[#28282a] border border-border-subtle text-white w-full px-2 py-1 font-mono text-[10px] rounded-sm"
                          disabled={isEditingImage}
                        >
                          <option value="general">General Edit</option>
                          <option value="remove">Remove Object</option>
                          <option value="color">Adjust Colors</option>
                          <option value="style">Style Transfer</option>
                        </select>
                        <textarea 
                          value={aiEditPrompt}
                          onChange={e => setAiEditPrompt(e.target.value)}
                          placeholder={
                            aiEditMode === 'remove' ? "e.g. 'the blue cell'" :
                            aiEditMode === 'color' ? "e.g. 'make it warmer'" :
                            aiEditMode === 'style' ? "e.g. 'watercolor painting'" :
                            "e.g. 'Add a red arrow pointing right'"
                          }
                          className="bg-[#28282a] border border-border-subtle text-white w-full px-2 py-1 font-mono text-[10px] rounded-sm min-h-[40px]"
                          disabled={isEditingImage}
                        />
                        <button 
                          onClick={editSelectedImage}
                          disabled={isEditingImage || !aiEditPrompt}
                          className="flex items-center justify-center gap-1 w-full bg-accent hover:bg-[#005bb5] disabled:opacity-50 text-white py-1 rounded-sm text-[10px] cursor-pointer"
                        >
                          {isEditingImage ? <Loader2 className="w-3 h-3 animate-spin"/> : <Wand2 className="w-3 h-3"/>}
                          {isEditingImage ? 'Editing...' : 'Edit Image'}
                        </button>
                      </div>
                      <div className="flex justify-between items-center mb-2 text-[11px]">
                        <span>Width (px)</span>
                        <input
                          type="number"
                          value={Math.round(selectedEl.width)}
                          onChange={(e) => updateSelected({ width: Number(e.target.value) })}
                          className="bg-[#1a1a1b] border border-border-subtle text-white w-[60px] px-1 py-1 font-mono text-[10px] rounded-sm"
                        />
                      </div>
                      <div className="flex justify-between items-center mb-2 text-[11px]">
                        <span>Height (px)</span>
                        <input
                          type="number"
                          value={Math.round(selectedEl.height)}
                          onChange={(e) => updateSelected({ height: Number(e.target.value) })}
                          className="bg-[#1a1a1b] border border-border-subtle text-white w-[60px] px-1 py-1 font-mono text-[10px] rounded-sm"
                        />
                      </div>
                    </>
                  )}

                  <div className="mt-4 pt-4 border-t border-border-subtle">
                     <div className="flex justify-between items-center mb-2 text-[11px]">
                        <span>Anchor X</span>
                        <input
                          type="number"
                          value={Math.round(selectedEl.x)}
                          onChange={(e) => updateSelected({ x: Number(e.target.value) })}
                          className="bg-[#1a1a1b] border border-border-subtle text-white w-[60px] px-1 py-1 font-mono text-[10px] rounded-sm"
                        />
                      </div>
                     <div className="flex justify-between items-center mb-2 text-[11px]">
                        <span>Anchor Y</span>
                        <input
                          type="number"
                          value={Math.round(selectedEl.y)}
                          onChange={(e) => updateSelected({ y: Number(e.target.value) })}
                          className="bg-[#1a1a1b] border border-border-subtle text-white w-[60px] px-1 py-1 font-mono text-[10px] rounded-sm"
                        />
                      </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-dim text-center mt-10">
                No element selected
              </div>
            )
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center pb-2 border-b border-border-subtle">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.1em]">Layer Management</div>
                </div>
                
                <div className="flex gap-2">
                  <button 
                    onClick={groupSelectedLayers}
                    disabled={selectedLayerIds.length < 2}
                    className="flex-1 py-1.5 bg-[#38383a] hover:bg-[#4a4a4d] disabled:opacity-50 disabled:hover:bg-[#38383a] border border-border-subtle text-white rounded-sm text-[10px] flex items-center justify-center gap-1 cursor-pointer transition-colors"
                  >
                    <Users className="w-3 h-3" />
                    Group
                  </button>
                  <button 
                    onClick={ungroupSelectedLayers}
                    disabled={selectedLayerIds.length === 0}
                    className="flex-1 py-1.5 bg-[#38383a] hover:bg-[#4a4a4d] disabled:opacity-50 disabled:hover:bg-[#38383a] border border-border-subtle text-white rounded-sm text-[10px] flex items-center justify-center gap-1 cursor-pointer transition-colors"
                  >
                    <UserX className="w-3 h-3" />
                    Ungroup
                  </button>
                </div>

                {selectedLayerIds.length >= 2 && (
                  <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-border-subtle">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-dim">Align & Distribute</div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex gap-1 bg-[#1a1a1b] p-1 rounded-sm border border-border-subtle">
                        <button onClick={() => alignLayers('left')} className="flex-1 py-0.5 hover:bg-[#38383a] text-center text-white text-[10px] rounded-sm transition-colors cursor-pointer">L</button>
                        <button onClick={() => alignLayers('center')} className="flex-1 py-0.5 hover:bg-[#38383a] text-center text-white text-[10px] rounded-sm transition-colors cursor-pointer">C</button>
                        <button onClick={() => alignLayers('right')} className="flex-1 py-0.5 hover:bg-[#38383a] text-center text-white text-[10px] rounded-sm transition-colors cursor-pointer">R</button>
                      </div>
                      <div className="flex gap-1 bg-[#1a1a1b] p-1 rounded-sm border border-border-subtle">
                        <button onClick={() => alignLayers('top')} className="flex-1 py-0.5 hover:bg-[#38383a] text-center text-white text-[10px] rounded-sm transition-colors cursor-pointer">Top</button>
                        <button onClick={() => alignLayers('middle')} className="flex-1 py-0.5 hover:bg-[#38383a] text-center text-white text-[10px] rounded-sm transition-colors cursor-pointer">Mid</button>
                        <button onClick={() => alignLayers('bottom')} className="flex-1 py-0.5 hover:bg-[#38383a] text-center text-white text-[10px] rounded-sm transition-colors cursor-pointer">Bot</button>
                      </div>
                      {selectedLayerIds.length >= 3 && (
                        <div className="flex flex-col gap-1 mt-1">
                          <div className="flex gap-1">
                            <button onClick={() => distributeLayers('horizontal')} className="flex-1 py-1 bg-[#38383a] hover:bg-[#4a4a4d] border border-border-subtle text-white text-[9px] rounded-sm transition-colors cursor-pointer" title="Distribute Horizontal Centers">Dist. X-Center</button>
                            <button onClick={() => distributeLayers('vertical')} className="flex-1 py-1 bg-[#38383a] hover:bg-[#4a4a4d] border border-border-subtle text-white text-[9px] rounded-sm transition-colors cursor-pointer" title="Distribute Vertical Centers">Dist. Y-Center</button>
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => distributeLayers('horizontal-space')} className="flex-1 py-1 bg-[#38383a] hover:bg-[#4a4a4d] border border-border-subtle text-white text-[9px] rounded-sm transition-colors cursor-pointer" title="Distribute Equal Horizontal Space">Equal X-Space</button>
                            <button onClick={() => distributeLayers('vertical-space')} className="flex-1 py-1 bg-[#38383a] hover:bg-[#4a4a4d] border border-border-subtle text-white text-[9px] rounded-sm transition-colors cursor-pointer" title="Distribute Equal Vertical Space">Equal Y-Space</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                <div className="flex flex-col gap-1 mt-2 border-t border-border-subtle pt-2">
                  {[...elements].reverse().map((layer, reverseIndex) => {
                    const originalIndex = elements.length - 1 - reverseIndex;
                    const isSelected = selectedLayerIds.includes(layer.id);
                    
                    return (
                      <div 
                        key={layer.id} 
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-sm border cursor-pointer group select-none transition-colors",
                          isSelected ? "bg-accent/20 border-accent" : "bg-[#1a1a1b] border-border-subtle hover:border-[#4a4a4d]",
                          layer.groupId && `border-l-[4px] ${getGroupStyle(layer.groupId).split(' ')[0].replace('border-', 'border-l-')}`
                        )}
                        onClick={() => {
                          if (selectedLayerIds.includes(layer.id)) {
                            setSelectedLayerIds(selectedLayerIds.filter(id => id !== layer.id));
                          } else {
                            setSelectedLayerIds([...selectedLayerIds, layer.id]);
                          }
                        }}
                      >
                        <div className="flex-1 flex flex-col overflow-hidden">
                          <span className="text-[11px] font-semibold text-white truncate" title={layer.name}>
                            {layer.name || (layer.type === 'image' ? 'Image Layer' : 'Text Layer')}
                          </span>
                          {layer.type === 'text' && (
                            <span className="text-[9px] text-text-dim truncate">
                              "{layer.text}"
                            </span>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                          <button 
                            className="p-1 hover:text-white hover:bg-[#38383a] rounded" 
                            title={layer.isLocked ? "Unlock layer" : "Lock layer"}
                            onClick={(e) => { e.stopPropagation(); toggleLayerLock(layer.id); }}
                          >
                            {layer.isLocked ? <Lock className="w-3.5 h-3.5 text-red-400" /> : <Unlock className="w-3.5 h-3.5 text-text-dim" />}
                          </button>
                          <div className="flex flex-col gap-0.5">
                            <button 
                              className={cn("p-0.5 rounded hover:bg-[#38383a]", originalIndex === elements.length - 1 ? "opacity-30 cursor-not-allowed" : "hover:text-white text-text-dim")}
                              onClick={(e) => { e.stopPropagation(); moveLayerUp(originalIndex); }}
                              disabled={originalIndex === elements.length - 1}
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button 
                              className={cn("p-0.5 rounded hover:bg-[#38383a]", originalIndex === 0 ? "opacity-30 cursor-not-allowed" : "hover:text-white text-text-dim")}
                              onClick={(e) => { e.stopPropagation(); moveLayerDown(originalIndex); }}
                              disabled={originalIndex === 0}
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {elements.length === 0 && (
                    <div className="text-[11px] text-text-dim text-center py-4">No layers found</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Footer */}
      <footer className="col-span-full bg-bg-panel border-t border-border-subtle flex items-center px-4 text-[10px] text-text-dim font-mono row-start-3">
        <span className="bg-[#3e3e40] px-2 py-0.5 rounded-full text-white mr-4">READY</span>
        {selectedEl && (
          <>
            <span className="mr-4">X: {Math.round(selectedEl.x)} px</span>
            <span className="mr-4">Y: {Math.round(selectedEl.y)} px</span>
          </>
        )}
        <span className="mr-4">Canvas: {pxWidth}x{pxHeight} px (300 DPI)</span>
        <span className="ml-auto">Rendering Engine: NanoBanana-Core v2.5</span>
      </footer>

    </div>
  );
}

