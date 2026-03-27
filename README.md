# EduOS

EduOS is a review-first educational operating system for managing a scientific website and companion YouTube channel.

The starting brand for development and testing is **CellNucleus**:

- website: `https://www.cellnucleus.com`
- companion channel: `CellNucleus`
- content goal: rigorous, evidence-aware educational publishing for advanced biology learners

## Product Direction

EduOS is not meant to be a generic creative studio. The target workflow is:

1. define a scientific question or major hypothesis worth teaching
2. run a structured critical review process with explicit evidence standards
3. preserve the individual review artefacts
4. synthesize the result into a canonical educational review
5. package that review for website publication, YouTube production, and NotebookLM handoff

## Current Foundation

This repository currently starts from the StudioOS scaffold, with selected ResearchAgent-style infrastructure already ported:

- OpenRouter-first model routing with persisted agent and tier overrides
- model catalog refresh and routing settings endpoints
- project-based artifact persistence and pipeline execution
- memory, prompt library, media tools, and workflow-command surfaces

## Accuracy And Review Direction

EduOS is being hardened for educational accuracy using GrantOS-style rigor:

- research briefs are expected to separate established facts from hypotheses, caveats, and open questions
- script generation is instructed to preserve uncertainty instead of flattening it into false certainty
- media scripts pass through an `accuracy_reviewer` gate before downstream packaging
- review-oriented agents and artefact types are being added so critical reviews can be stored and reused
- a reusable strict educational accuracy policy is available in the prompt library

## CellNucleus Defaults

EduOS is being shaped around a CellNucleus-first publishing model:

- web and YouTube projects should default toward CellNucleus brand context
- output should be suitable for both `cellnucleus.com` articles and companion YouTube episodes
- educational outputs should remain evidence-grounded rather than market-speak driven
- NotebookLM-ready synthesis is a first-class downstream target

## Near-Term Build Targets

- replace remaining StudioOS-facing copy and routes with EduOS-specific language
- complete the dedicated critical-review pipeline for educational hypothesis analysis
- support two independent reviewer artefacts plus a final synthesis artefact
- tighten publication packaging for CellNucleus website and YouTube release flows
- surface model-selection controls cleanly through the ResearchAgent-style routing layer
