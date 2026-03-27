import type { ReactNode } from 'react';

import ApiTargetSettings from '@/components/settings/api-target-settings';
import OllamaQuickstart from '@/components/runtime/ollama-quickstart';
import TelegramControlCard from '@/components/runtime/telegram-control-card';
import Card from '@/components/ui/card';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-slate-400">
          Runtime configuration for StudioOS, including which backend the frontend should target.
        </p>
      </div>

      <Card
        title="API Targeting"
        description="Use the same runtime-configuration pattern as ResearchAgent: keep an automatic default, but allow an explicit backend override for local testing, alternate ports, or a different machine."
      >
        <ApiTargetSettings />
      </Card>

      <Card
        title="Local AI Runtime"
        description="Brand Bible, Memory, and natural-language workflow commands use the local Ollama runtime. If it is not running, start it here."
      >
        <OllamaQuickstart showSettingsLink={false} />
      </Card>

      <Card
        title="Telegram Control"
        description="Remote-control StudioOS from Telegram. Plain-text messages can run local workflow commands against the active project and scope."
      >
        <TelegramControlCard />
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <SettingCard title="Provider Keys">
          Configure at least one LLM provider in the repository root `.env`. `OPENROUTER_API_KEY`,
          `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` all work. Keep `backend/.env` only for
          backend-specific overrides. Project-derived autofill features such as Brand Bible and Memory autocomplete now
          use `LOCAL_AUTOFILL_MODEL` through Ollama even if cloud providers are configured. Natural-language workflow
          commands use `LOCAL_WORKFLOW_MODEL` and force local execution for command-driven runs.
        </SettingCard>
        <SettingCard title="Gate Policy">
          Hard gates block progression for writing critique, continuity, script review, visual review, brand review, and
          spoiler clearance.
        </SettingCard>
        <SettingCard title="Story / Brand Bibles">
          Story and brand bibles are stored on the project record and auto-updated from selected artifacts when pipeline
          runs succeed.
        </SettingCard>
        <SettingCard title="Runtime">
          Start the local stack from the repository root with `scripts/dev_backend.sh`, `scripts/dev_frontend.sh`, and
          `scripts/dev_redis.sh`. Telegram polling starts automatically on backend boot when `TELEGRAM_BOT_TOKEN` and
          `TELEGRAM_POLLING_ENABLED=true` are set.
        </SettingCard>
      </div>
    </div>
  );
}

function SettingCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-400">{children}</p>
    </section>
  );
}
