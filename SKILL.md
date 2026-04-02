---
name: eduos
description: "Evidence-grounded educational science content publishing studio. Use for: creating YouTube science education content for the CellNucleus channel (or equivalent), writing accurate science explainer scripts, producing evidence-grounded educational articles, planning media production workflows, generating SEO-optimized educational content, and managing educational brand identity. MANDATORY accuracy gate blocks all content before publication."
---

# EduOS — Educational Science Content Publishing Studio

## Mission

EduOS is a multi-agent content production studio designed to translate cutting-edge cell biology research into accurate, engaging educational content for public audiences (primary project: CellNucleus YouTube channel). It enforces a mandatory accuracy review gate — the `accuracy_reviewer_agent` — that blocks any content from advancing to production without verification against primary literature.

**Backend:** port 8090 | **Frontend:** port 3090

---

## The Accuracy Imperative

EduOS operates on the principle that science communication from a research PI carries reputational weight. Every factual claim in every piece of content produced by EduOS must be traceable to a primary source. The `accuracy_reviewer_agent` is a non-negotiable checkpoint in every content pipeline.

**Content without a passed accuracy review does not advance. Period.**

---

## Core Workflow Patterns

### Pattern 1: YouTube Science Video Pipeline
```
topic_input →
research_agent [primary literature review] →
outline_agent [content structure with evidence anchors] →
narrative_agent [engaging narrative draft] →
accuracy_reviewer_agent [MANDATORY GATE: every claim verified] →
scriptwriter_agent [production-ready script with timecodes] →
script_critic_agent [tone, pacing, clarity review] →
visual_critic_agent [visual description and b-roll plan] →
thumbnail_brief_agent [thumbnail concept per channel brand] →
seo_agent [title, description, tags, keywords] →
assembly_planner_agent [production checklist] →
distribution_manager_agent [upload schedule, cross-platform plan]
```

### Pattern 2: Educational Article / Blog Post
```
topic_input →
research_agent [literature grounding] →
outline_agent →
writer_agent [draft] →
line_editor_agent [clarity and readability] →
accuracy_reviewer_agent [MANDATORY GATE] →
style_monitor_agent [brand voice consistency] →
seo_agent [web optimization] →
site_manager_agent [CMS upload preparation]
```

### Pattern 3: Peer Review of Draft Content
```
draft_content_upload →
review_planner_agent [assigns review criteria] →
reviewer_a_agent [scientific accuracy focus] →
reviewer_b_agent [pedagogical effectiveness focus] →
review_synthesizer_agent [consolidated feedback] →
review_publisher_agent [formatted review report]
```

### Pattern 4: Campaign & Social Promotion
```
published_content →
story_hook_extractor_agent [identifies key message hooks] →
spoiler_guardian_agent [ensures hooks don't reveal punchlines] →
campaign_planner_agent [multi-platform campaign structure] →
promo_adapter_agent [platform-specific adaptations: Twitter/X, LinkedIn, Instagram, TikTok]
```

---

## Agent Roster (42+ agents across 4 workforces)

### Writing Workforce (10)

| Agent | Function |
|-------|----------|
| `writer_agent` | Primary content drafting |
| `outline_agent` | Evidence-anchored content structure |
| `narrative_agent` | Engaging narrative development |
| `character_agent` | Explanatory analogies and narrative characters |
| `developmental_editor_agent` | Big-picture structure and argument coherence |
| `line_editor_agent` | Sentence-level clarity, readability, precision |
| `style_monitor_agent` | Brand voice consistency (CellNucleus tone) |
| `worldbuilding_agent` | Analogical frameworks for complex concepts |
| `critique_agent` | Content quality critique |
| `ingestion_agent` | Source material processing and structuring |

### Media Workforce (16)

| Agent | Function |
|-------|----------|
| `accuracy_reviewer_agent` | **MANDATORY GATE** — claim verification against primary literature |
| `scriptwriter_agent` | Video script with timecodes, on-screen text, narration |
| `shorts_editor_agent` | YouTube Shorts / TikTok adaptation of long-form content |
| `video_critic_agent` | Video production quality assessment |
| `script_critic_agent` | Script pacing, hook strength, retention analysis |
| `visual_critic_agent` | Visual plan assessment and b-roll recommendations |
| `thumbnail_brief_agent` | Thumbnail concept and clickability assessment |
| `seo_agent` | SEO optimization: title, description, tags, chapters |
| `channel_brand_agent` | Channel identity and brand consistency |
| `distribution_manager_agent` | Upload scheduling and cross-platform distribution |
| `brand_manager_agent` | Overall brand strategy and evolution |
| `audio_planner_agent` | Music, sound design, and voiceover planning |
| `assembly_planner_agent` | Production checklist and timeline |
| `research_agent` | Primary literature sourcing for content claims |
| `site_manager_agent` | Website/CMS content management |
| `browser_toolkit` | Playwright automation for publishing tasks |

### Review Workforce (5)

| Agent | Function |
|-------|----------|
| `review_planner_agent` | Assigns review criteria and reviewers |
| `reviewer_a_agent` | Scientific accuracy perspective |
| `reviewer_b_agent` | Pedagogical effectiveness perspective |
| `review_synthesizer_agent` | Consolidated review feedback |
| `review_publisher_agent` | Formatted, actionable review report |

### Promo Workforce (4)

| Agent | Function |
|-------|----------|
| `campaign_planner_agent` | Multi-platform campaign strategy |
| `promo_adapter_agent` | Platform-specific content adaptation |
| `story_hook_extractor_agent` | Key message and hook identification |
| `spoiler_guardian_agent` | Ensures promotional content doesn't spoil key reveals |

---

## Recommended Additional Agents

| Agent | Priority | Rationale |
|-------|----------|-----------|
| `pedagogy_specialist_agent` | **HIGH** | Evaluates content against evidence-based learning principles: cognitive load theory, worked examples, interleaving, retrieval practice. Ensures content structure maximizes retention |
| `misconception_hunter_agent` | **HIGH** | Identifies and proactively addresses common student misconceptions about the topic (e.g., "DNA is always in chromosomes", "mitosis and cell division are the same thing") |
| `reading_level_calibrator_agent` | **HIGH** | Assesses and adjusts content for target audience (undergrad, general public, high school). Uses Flesch-Kincaid and domain-specific readability analysis |
| `accessibility_agent` | **HIGH** | Checks content for: closed caption readiness, hearing-impaired-friendly descriptions, colorblind-safe visual descriptions, screen-reader compatibility for web content |
| `fact_evolution_tracker_agent` | **MEDIUM** | Tracks which content claims are based on rapidly evolving findings (preprints, recent discoveries); flags content for update when foundational papers are revised or retracted |
| `quiz_generator_agent` | **MEDIUM** | Creates formative assessment questions (multiple choice, short answer) for companion educational resources; useful for course integration |
| `translation_coordination_agent` | **MEDIUM** | Coordinates multilingual content adaptation; maintains accuracy through back-translation verification |
| `comments_analyst_agent` | **MEDIUM** | Analyses YouTube comment patterns to identify: misconceptions raised by viewers, questions that indicate content gaps, topics generating high engagement |
| `copyright_clearance_agent` | **LOW** | Reviews image/video assets for copyright status; identifies Creative Commons/public domain alternatives; flags fair use boundaries |

---

## Model Routing

| Task | Recommended Model |
|------|------------------|
| Accuracy review (claim verification) | `claude-opus-4` or `openai/gpt-4o` — highest accuracy |
| Scientific research for content | `claude-opus-4` |
| Script writing | `claude-sonnet-4-5` or `google/gemini-2.5-flash` |
| SEO and distribution | `google/gemini-2.5-flash` |
| Creative narrative development | `mistralai/mistral-large` (strong creative) |
| Visual/thumbnail briefs | `openai/gpt-4o` (vision capability) |
| Shorts adaptation | `google/gemini-2.5-flash` |

---

## Quality Gates

1. **Accuracy Gate (MANDATORY):** `accuracy_reviewer_agent` must return a PASS before any content exits the pipeline. A PASS requires every factual claim to have an identified primary source. FAIL returns to writer with specific claims flagged.
2. **Misconception Gate:** Content must explicitly address (or carefully avoid reinforcing) the top 3 known misconceptions for the topic area.
3. **Brand Consistency Gate:** `style_monitor_agent` checks tone, vocabulary level, and visual style against CellNucleus brand guidelines before distribution.
4. **SEO Gate:** `seo_agent` must confirm target keyword placement before upload scheduling.

---

## CellNucleus Brand Standards

```
Tone: Authoritative but approachable; "knowledgeable professor who loves the subject"
Vocabulary level: Undergraduate biology; define jargon on first use
Accuracy standard: Primary literature only; no Wikipedia, no textbook-only claims
Visual style: Clean, minimal animation; cellular imagery; consistent color palette
Target audience: Pre-med, undergrad science, science-curious adults
Content length: Tutorial videos 8–20 min; Shorts 45–90 sec; Articles 800–1500 words
Hook structure: Open with a question or surprising fact; never with "In this video..."
```

---

## Available Connectors

| Connector | Capability | Status |
|-----------|-----------|--------|
| bioRxiv MCP | Latest preprint sourcing for content | **CONNECTED** |
| Google Drive MCP | Store scripts, drafts, assets | **CONNECTED** |
| Gmail MCP | Collaboration and distribution | **CONNECTED** |
| Playwright (browser_toolkit) | Automated publishing tasks | **INTEGRATED** |

### Recommended Additional Connectors

| Connector | Priority | Use Case |
|-----------|----------|---------|
| **YouTube Data API v3** | CRITICAL | Programmatic upload, chapter markers, description, tags, thumbnail; analytics retrieval; comment monitoring |
| **Canva MCP / API** | HIGH | Thumbnail design automation with brand templates; social media asset generation |
| **PubMed API** | HIGH | Real-time literature verification for accuracy review gate |
| **scite.ai** | HIGH | Citation context for claim verification — especially useful to flag contradicted claims |
| **Descript API** | MEDIUM | Automated transcript generation and subtitle editing |
| **Hootsuite/Buffer API** | MEDIUM | Scheduled cross-platform social media posting of promotional content |
| **Google Analytics API** | MEDIUM | Content performance tracking: watch time, click-through, audience retention |
