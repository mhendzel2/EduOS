# EduOS

> Multi-agent science publishing studio for evidence-grounded educational content on cell biology.

## Overview

EduOS is a multi-agent science publishing studio that produces evidence-grounded educational content for the CellNucleus project (cellnucleus.com). It targets cell biology, chromatin organization, and nuclear architecture topics with mandatory accuracy gates on all outputs. The system coordinates 42+ agents across writing, media, review, and promo workforces to transform research into compelling, accurate educational narratives.

## Architecture

EduOS uses a workforce-based architecture with specialized agent teams. The **DirectorAgent** orchestrates execution across four primary workforces: Writing (outline, narrative, and editorial), Media (scripting, video, visual assets), Review (multi-agent validation), and Promo (campaign planning). An **accuracy_reviewer_agent** serves as a mandatory gate—no content passes without accuracy verification. Evidence is tracked through a provenance system that indexes sources throughout the pipeline. Browser automation via Playwright enables live research and document upload.

## Agent Roster

**Coordination:**
| Agent | Model | Role |
|-------|-------|------|
| director_agent | (varies) | Orchestrates all workforce execution |

**Writing Workforce (10):**
| Agent | Model | Role |
|-------|-------|------|
| writer_agent | (varies) | Primary narrative generation |
| outline_agent | (varies) | Content structure and outlining |
| narrative_agent | (varies) | Story-driven explanations |
| character_agent | (varies) | Character and persona development |
| developmental_editor_agent | (varies) | Structural critique and revision |
| line_editor_agent | (varies) | Line-level prose editing |
| style_monitor_agent | (varies) | Consistency and style enforcement |
| worldbuilding_agent | (varies) | Background and context development |
| critique_agent | (varies) | Adversarial content review |
| ingestion_agent | (varies) | Document import and processing |

**Media Workforce (16):**
| Agent | Model | Role |
|-------|-------|------|
| accuracy_reviewer_agent | (varies) | **MANDATORY gate** - science fact checking |
| scriptwriter_agent | (varies) | Video script generation |
| shorts_editor_agent | (varies) | Short-form video editing |
| video_critic_agent | (varies) | Video quality assessment |
| script_critic_agent | (varies) | Script quality review |
| visual_critic_agent | (varies) | Visual asset critique |
| thumbnail_brief_agent | (varies) | Thumbnail brief generation |
| seo_agent | (varies) | SEO optimization |
| channel_brand_agent | (varies) | Brand consistency management |
| distribution_manager_agent | (varies) | Content distribution planning |
| brand_manager_agent | (varies) | Brand asset management |
| audio_planner_agent | (varies) | Audio/voiceover planning |
| assembly_planner_agent | (varies) | Video assembly coordination |
| research_agent | (varies) | Research and fact-finding |
| site_manager_agent | (varies) | Website management |
| browser_toolkit | (Playwright) | Browser automation for research |

**Review Workforce (5):**
| Agent | Model | Role |
|-------|-------|------|
| review_planner_agent | (varies) | Coordinate review process |
| reviewer_a_agent | (varies) | Independent review (reviewer 1) |
| reviewer_b_agent | (varies) | Independent review (reviewer 2) |
| review_synthesizer_agent | (varies) | Synthesize reviews to decision |
| review_publisher_agent | (varies) | Publish reviewed content |

**Promo Workforce (4):**
| Agent | Model | Role |
|-------|-------|------|
| campaign_planner_agent | (varies) | Campaign strategy and planning |
| promo_adapter_agent | (varies) | Adapt content for promotion |
| story_hook_extractor_agent | (varies) | Extract promotional hooks |
| spoiler_guardian_agent | (varies) | Avoid spoilers in promotion |

## API Endpoints

- `POST /api/v1/execute` — Execute task through BaseOS pipeline
- `POST /api/v1/chat` — Interactive chat with context
- `POST /api/v1/evaluate` — Evaluate content quality
- `WS /ws/telemetry` — Real-time telemetry

## Frontend

- `/workspace` — Main workspace
- `/writing-studio` — Writing workflow
- `/media-studio` — Media production
- `/promo-studio` — Promotion campaigns
- `/story-bible` — Story universe reference
- `/brand-bible` — Brand guidelines
- `/pipeline` — Pipeline visualization
- `/memory` — Knowledge base
- `/prompt-library` — Prompt templates
- `/provenance` — Source tracking

## Tech Stack

- **Language:** Python 3.11+
- **Backend:** FastAPI, Uvicorn
- **Frontend:** Next.js, React
- **Database:** SQLAlchemy, SQLite
- **Memory:** ChromaDB
- **AI/Agents:** litellm
- **Browser Automation:** Playwright
- **Document Processing:** PyMuPDF

## Ports

- **Backend:** 8090
- **Frontend:** 3090

## Configuration

Environment variables:
- `ACCURACY_GATE_REQUIRED` — Enable/disable mandatory accuracy review
- `PROVENANCE_TRACKING` — Enable source tracking
- `BROWSER_HEADLESS` — Run Playwright in headless mode

## Dependencies

- **BaseOS:** baseos (local; inherited 11-step pipeline)
- **AI:** litellm>=1.34.0
- **Memory:** chromadb>=0.4.0
- **Document:** PyMuPDF>=1.23.0
- **Communication:** python-telegram-bot>=21.0.0
- **Browser:** playwright
- **MCP:** mcp>=1.2.0

## Key Features

**Mandatory Accuracy Gate:** The accuracy_reviewer_agent is a blocking checkpoint. No content advances without accuracy verification against CellNucleus scientific standards.

**Evidence Anchoring:** All claims are anchored to source documents. The provenance system tracks evidence through the entire pipeline—writing, media, and review.

**Uncertainty Language:** Enforces distinction between established facts and hypotheses. Maintains scientific rigor while remaining accessible.

**Workforce Coordination:** Four specialized workforces operate in sequence or parallel:
1. **Writing:** Outline → Narrative → Edit → Style Check
2. **Media:** Script → Video → Assets → SEO
3. **Review:** Multi-agent validation with synthesized decision
4. **Promo:** Campaign planning and adaptation

**Browser Automation:** Playwright-based research toolkit enables live document lookup, fact-checking, and asset acquisition.

**Artifact Persistence:** All outputs (drafts, scripts, approved content) stored with full provenance links.

---

*EduOS extends BaseOS with 42+ science communication specialists, mandatory accuracy gates, and evidence tracking for educational publishing.*
