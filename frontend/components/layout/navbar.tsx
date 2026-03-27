export default function Navbar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-800 bg-slate-900/95 px-6 backdrop-blur">
      <div>
        <h1 className="text-lg font-semibold text-white">Studio Workspace</h1>
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
          Writing pipelines, media production, and promo orchestration
        </p>
      </div>
      <div className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-300">
        Local coordinator
      </div>
    </header>
  );
}
