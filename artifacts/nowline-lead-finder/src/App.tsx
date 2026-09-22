import { useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Form } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  BarChart3,
  ChevronDown,
  CircleAlert,
  Download,
  ExternalLink,
  Filter,
  Gauge,
  Globe2,
  Layers3,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Radar,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Target,
  X,
} from 'lucide-react';
import {
  useDiscoverLeads,
  useHealthCheck,
  type Lead,
  type LeadDiscoveryResult,
} from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

const searchSchema = z.object({
  location: z.string().trim().min(1, 'Add a city, region, or postal code.').max(200),
  sectorCount: z.coerce.number().min(1).max(32),
  maxPerSector: z.coerce.number().min(1).max(30),
  topN: z.coerce.number().min(1).max(200),
});

type SearchFormValues = z.infer<typeof searchSchema>;
type SortKey = 'score' | 'rating' | 'reviewsCount';

function formatCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function safeUrl(url: string | null) {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function downloadCsv(leads: Lead[]) {
  const headers = ['Name', 'Category', 'Score', 'Rating', 'Reviews', 'Email', 'Phone', 'Website', 'Address', 'Notes'];
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = leads.map((lead) => [
    lead.name,
    lead.category,
    lead.score,
    lead.rating,
    lead.reviewsCount,
    lead.email,
    lead.phone,
    lead.website,
    lead.address,
    lead.notes.join(' · '),
  ].map(escape).join(','));
  const csv = [headers.map(escape).join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'nowline-prospects.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3" data-testid="brand-nowline">
      <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--foreground))] shadow-[0_6px_16px_hsl(43_95%_56%_/_0.2)]">
        <Radar className="h-[19px] w-[19px]" strokeWidth={2.5} />
        <span className="absolute right-[7px] top-[7px] h-1.5 w-1.5 rounded-full bg-[hsl(var(--secondary))]" />
      </div>
      <div>
        <div className="text-[15px] font-extrabold tracking-[-0.03em] text-[hsl(var(--sidebar-foreground))]">nowline</div>
        <div className="font-mono text-[9px] uppercase tracking-[0.19em] text-[hsl(var(--sidebar-foreground)/.45)]">lead intelligence</div>
      </div>
    </div>
  );
}

function Sidebar({ result, onReset }: { result?: LeadDiscoveryResult; onReset: () => void }) {
  return (
    <aside className="hidden min-h-[100dvh] w-[238px] shrink-0 flex-col bg-[hsl(var(--sidebar))] px-5 py-6 text-[hsl(var(--sidebar-foreground))] lg:flex">
      <BrandMark />
      <div className="mt-12">
        <div className="mb-3 px-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[hsl(var(--sidebar-foreground)/.38)]">Workspace</div>
        <button
          type="button"
          onClick={onReset}
          data-testid="button-nav-discover"
          className="flex w-full items-center gap-3 rounded-xl bg-[hsl(var(--sidebar-accent))] px-3 py-3 text-left text-sm font-semibold text-[hsl(var(--sidebar-foreground))] transition hover:bg-[hsl(var(--sidebar-accent)/.8)]"
        >
          <Target className="h-4 w-4 text-[hsl(var(--sidebar-primary))]" />
          Discover leads
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[hsl(var(--sidebar-primary))]" />
        </button>
        <div className="mt-2 flex items-center gap-3 px-3 py-3 text-sm text-[hsl(var(--sidebar-foreground)/.43)]">
          <BarChart3 className="h-4 w-4" />
          Signal history
          <span className="ml-auto rounded-md border border-[hsl(var(--sidebar-border))] px-1.5 py-0.5 font-mono text-[9px]">soon</span>
        </div>
      </div>
      <div className="mt-auto">
        <div className="mb-3 rounded-2xl border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.6)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="signal-ring h-2 w-2 rounded-full bg-[hsl(var(--sidebar-primary))]" />
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[hsl(var(--sidebar-foreground)/.58)]">API connection</span>
          </div>
          <div className="text-xs leading-5 text-[hsl(var(--sidebar-foreground)/.62)]">Find businesses with a signal worth acting on.</div>
        </div>
        <div className="flex items-center justify-between px-2 text-[10px] text-[hsl(var(--sidebar-foreground)/.36)]">
          <span>v0.1 workspace</span>
          {result ? <span>{result.returned} loaded</span> : <span>ready</span>}
        </div>
      </div>
    </aside>
  );
}

function MetricTile({ label, value, detail, accent = 'amber', icon: Icon }: { label: string; value: string; detail: string; accent?: 'amber' | 'teal' | 'blue'; icon: typeof Gauge }) {
  const colors = {
    amber: 'bg-[hsl(43_95%_56%/.13)] text-[hsl(35_75%_34%)]',
    teal: 'bg-[hsl(167_45%_88%)] text-[hsl(178_37%_28%)]',
    blue: 'bg-[hsl(226_52%_45%/.11)] text-[hsl(226_52%_39%)]',
  };
  return (
    <div className="rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card)/.86)] p-4 shadow-[var(--shadow-sm)]" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="mb-5 flex items-start justify-between">
        <span className="eyebrow">{label}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${colors[accent]}`}><Icon className="h-3.5 w-3.5" /></span>
      </div>
      <div className="font-mono text-[26px] font-medium tracking-[-0.07em] text-[hsl(var(--foreground))]">{value}</div>
      <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{detail}</div>
    </div>
  );
}

function SearchForm({ onSearch, pending }: { onSearch: (values: SearchFormValues) => void; pending: boolean }) {
  const form = useForm<SearchFormValues>({
    resolver: zodResolver(searchSchema),
    defaultValues: {
      location: 'United Arab Emirates',
      sectorCount: 12,
      maxPerSector: 8,
      topN: 50,
    },
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSearch)} className="relative z-10">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1.7fr)_repeat(3,minmax(108px,.65fr))_auto]">
          <label className="group block">
            <span className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.13em] text-[hsl(var(--muted-foreground))]"><MapPin className="h-3 w-3" /> Search location</span>
            <div className="flex h-12 items-center rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 transition focus-within:border-[hsl(var(--primary))] focus-within:ring-4 focus-within:ring-[hsl(var(--primary)/.13)]">
              <input {...form.register('location')} data-testid="input-location" aria-label="Search location" className="w-full bg-transparent text-sm font-semibold text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]" placeholder="City, region, or postal code" />
            </div>
            {form.formState.errors.location && <span className="mt-1 block text-[10px] text-[hsl(var(--destructive))]">{form.formState.errors.location.message}</span>}
          </label>
          {[
            { name: 'sectorCount' as const, label: 'Sectors', hint: '1–32' },
            { name: 'maxPerSector' as const, label: 'Per sector', hint: '1–30' },
            { name: 'topN' as const, label: 'Return top', hint: '1–200' },
          ].map((field) => (
            <label key={field.name} className="block">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.13em] text-[hsl(var(--muted-foreground))]">{field.label}</span>
              <div className="flex h-12 items-center rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 transition focus-within:border-[hsl(var(--primary))] focus-within:ring-4 focus-within:ring-[hsl(var(--primary)/.13)]">
                <input {...form.register(field.name, { valueAsNumber: true })} type="number" min={1} data-testid={`input-${field.name}`} aria-label={field.label} className="w-full bg-transparent font-mono text-sm font-medium text-[hsl(var(--foreground))] outline-none" />
                <span className="font-mono text-[9px] text-[hsl(var(--muted-foreground))]">{field.hint}</span>
              </div>
            </label>
          ))}
          <button type="submit" disabled={pending} data-testid="button-run-discovery" className="mt-[22px] flex h-12 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--secondary))] px-5 text-sm font-bold text-[hsl(var(--secondary-foreground))] shadow-[0_8px_18px_hsl(226_36%_14%/.17)] transition hover:-translate-y-0.5 hover:bg-[hsl(226_36%_19%)] disabled:cursor-wait disabled:opacity-70">
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {pending ? 'Scanning' : 'Find signals'}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
          <Sparkles className="h-3 w-3 text-[hsl(var(--primary))]" />
          Search maps, sites, and review signals. Results are ranked for outreach readiness.
        </div>
      </form>
    </Form>
  );
}

function ScanSkeleton() {
  return (
    <div className="space-y-3" data-testid="loading-results">
      {[1, 2, 3].map((item) => <div key={item} className="flex items-center gap-4 rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-5">
        <div className="skeleton h-10 w-10 rounded-xl" />
        <div className="flex-1 space-y-2"><div className="skeleton h-3 w-1/3 rounded" /><div className="skeleton h-2.5 w-2/3 rounded" /></div>
        <div className="skeleton h-8 w-16 rounded-lg" />
      </div>)}
    </div>
  );
}

function LeadCard({ lead, index }: { lead: Lead; index: number }) {
  const website = safeUrl(lead.website);
  const scoreTone = lead.score >= 80 ? 'bg-[hsl(167_45%_88%)] text-[hsl(178_37%_25%)]' : lead.score >= 60 ? 'bg-[hsl(43_95%_56%/.17)] text-[hsl(35_75%_34%)]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]';
  return (
    <article className="group rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-4 shadow-[var(--shadow-sm)] transition duration-200 hover:-translate-y-0.5 hover:border-[hsl(43_95%_56%/.55)] hover:shadow-[var(--shadow)]" data-testid={`card-lead-${index}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--secondary))] font-mono text-xs font-medium text-[hsl(var(--primary))]">{lead.name.slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-extrabold tracking-[-0.02em] text-[hsl(var(--foreground))]" data-testid={`text-lead-name-${index}`}>{lead.name}</h3>
            {lead.category && <span className="rounded-md bg-[hsl(var(--muted))] px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-[hsl(var(--muted-foreground))]">{lead.category}</span>}
          </div>
          <div className="mt-1 flex items-start gap-1.5 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]"><MapPin className="mt-0.5 h-3 w-3 shrink-0" /> <span className="line-clamp-1">{lead.address || 'Address not available'}</span></div>
        </div>
        <div className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 font-mono text-xs font-medium ${scoreTone}`} data-testid={`text-lead-score-${index}`}><span>{lead.score}</span><span className="text-[9px] opacity-70">/100</span></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[hsl(var(--border)/.7)] pt-3 text-[11px] text-[hsl(var(--muted-foreground))]">
        <span className="flex items-center gap-1.5"><Star className="h-3 w-3 fill-[hsl(var(--primary))] text-[hsl(var(--primary))]" /> {lead.rating ?? '—'} <span className="opacity-65">({formatCount(lead.reviewsCount ?? 0)})</span></span>
        {lead.email ? <a href={`mailto:${lead.email}`} data-testid={`link-email-${index}`} className="flex items-center gap-1.5 transition hover:text-[hsl(var(--foreground))]"><Mail className="h-3 w-3" /> Email</a> : <span className="flex items-center gap-1.5 opacity-40"><Mail className="h-3 w-3" /> No email</span>}
        {lead.phone ? <a href={`tel:${lead.phone}`} data-testid={`link-phone-${index}`} className="flex items-center gap-1.5 transition hover:text-[hsl(var(--foreground))]"><Phone className="h-3 w-3" /> {lead.phone}</a> : null}
        {website ? <a href={website} target="_blank" rel="noreferrer" data-testid={`link-website-${index}`} className="ml-auto flex items-center gap-1 font-semibold text-[hsl(226_52%_39%)] transition hover:text-[hsl(178_37%_28%)]">Visit site <ExternalLink className="h-3 w-3" /></a> : null}
      </div>
      {lead.notes.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{lead.notes.slice(0, 3).map((note, noteIndex) => <span key={`${note}-${noteIndex}`} className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-[10px] text-[hsl(var(--muted-foreground))]">{note}</span>)}</div>}
    </article>
  );
}

function Home() {
  const discover = useDiscoverLeads();
  const health = useHealthCheck();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortKey>('score');
  const [minScore, setMinScore] = useState(0);
  const result = discover.data;
  const categories = useMemo(() => Array.from(new Set((result?.leads ?? []).map((lead) => lead.category).filter(Boolean) as string[])).sort(), [result]);
  const filteredLeads = useMemo(() => {
    const leads = (result?.leads ?? []).filter((lead) => {
      const searchable = [lead.name, lead.category, lead.address, lead.email].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(query.toLowerCase()) && (category === 'all' || lead.category === category) && lead.score >= minScore;
    });
    return [...leads].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
  }, [category, minScore, query, result, sort]);
  const runSearch = (values: SearchFormValues) => {
    discover.mutate({ data: values });
  };
  const resetWorkspace = () => {
    discover.reset();
    setQuery('');
    setCategory('all');
    setMinScore(0);
    setSort('score');
  };
  const healthOk = health.data?.status?.toLowerCase() === 'ok' || health.data?.status?.toLowerCase() === 'healthy';
  const errorMessage = discover.error instanceof Error ? discover.error.message : 'The signal scan could not be completed.';

  return (
    <div className="flex min-h-[100dvh] bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <Sidebar result={result} onReset={resetWorkspace} />
      <main className="signal-grid min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-[hsl(var(--border)/.8)] bg-[hsl(var(--background)/.88)] px-5 py-4 backdrop-blur-md sm:px-8 lg:px-10">
          <div className="flex items-center gap-3 lg:hidden"><BrandMark /></div>
          <div className="hidden items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))] sm:flex"><span className={`h-2 w-2 rounded-full ${health.isError ? 'bg-[hsl(var(--destructive))]' : healthOk ? 'bg-[hsl(167_55%_37%)]' : 'bg-[hsl(var(--primary))]'}`} /> {health.isLoading ? 'Checking API' : health.isError ? 'API unavailable' : healthOk ? 'API operational' : 'API ready'}</div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))] md:inline">Operator workspace</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-xs font-bold text-[hsl(var(--secondary))]" data-testid="avatar-operator">OP</div>
          </div>
        </header>
        <div className="mx-auto max-w-[1440px] px-5 pb-16 pt-8 sm:px-8 lg:px-10">
          <section className="reveal-up mb-8">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-5">
              <div>
                <div className="eyebrow mb-3 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" /> discovery / 01</div>
                <h1 className="max-w-[590px] text-[clamp(2rem,4vw,3.45rem)] font-extrabold leading-[.99] tracking-[-0.065em] text-[hsl(var(--foreground))]">Find the businesses<br /><span className="text-[hsl(178_37%_31%)]">already asking for help.</span></h1>
                <p className="mt-4 max-w-[520px] text-sm leading-6 text-[hsl(var(--muted-foreground))]">Set the search perimeter. Nowline maps local operators, reads the weak signals, and puts the best conversations at the top.</p>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.7)] px-3 py-2 text-[10px] text-[hsl(var(--muted-foreground))] sm:flex"><Gauge className="h-3.5 w-3.5 text-[hsl(var(--primary))]" /> quality-ranked discovery</div>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card)/.9)] p-4 shadow-[var(--shadow)] sm:p-5">
              <SearchForm onSearch={runSearch} pending={discover.isPending} />
            </div>
          </section>

          {discover.isPending ? <section className="reveal-up-delay"><div className="mb-5 grid gap-3 sm:grid-cols-3"><MetricTile label="Scope" value="…" detail="Preparing sectors" accent="amber" icon={Layers3} /><MetricTile label="Found" value="…" detail="Scanning sources" accent="teal" icon={Globe2} /><MetricTile label="Quality" value="…" detail="Ranking signals" accent="blue" icon={Gauge} /></div><ScanSkeleton /></section> :
            discover.error ? <section className="reveal-up rounded-2xl border border-[hsl(var(--destructive)/.27)] bg-[hsl(var(--destructive)/.06)] p-8 text-center" data-testid="error-discovery"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]"><CircleAlert className="h-5 w-5" /></div><h2 className="mt-4 text-lg font-extrabold">The scan missed its signal.</h2><p className="mx-auto mt-2 max-w-md text-sm text-[hsl(var(--muted-foreground))]">{errorMessage}</p><div className="mt-5 flex justify-center gap-2"><button type="button" onClick={() => discover.reset()} data-testid="button-dismiss-error" className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-sm font-semibold transition hover:bg-[hsl(var(--muted))]">Clear</button><button type="button" onClick={() => { const values = document.querySelector<HTMLInputElement>('[data-testid="input-location"]')?.value; if (values) discover.mutate({ data: { location: values, sectorCount: 4, maxPerSector: 12, topN: 25 } }); }} data-testid="button-retry-discovery" className="flex items-center gap-2 rounded-xl bg-[hsl(var(--secondary))] px-4 py-2.5 text-sm font-bold text-[hsl(var(--secondary-foreground))]"><RotateCcw className="h-3.5 w-3.5" /> Retry scan</button></div></section> :
            result ? <section className="reveal-up-delay">
              <div className="mb-6 grid gap-3 sm:grid-cols-3">
                <MetricTile label="Scope" value={`${result.scannedSectors.length}`} detail={`${result.scannedSectors.join(' · ') || 'Sectors scanned'}`} accent="amber" icon={Layers3} />
                <MetricTile label="Found" value={formatCount(result.totalFound)} detail={`${formatCount(result.returned)} returned to workspace`} accent="teal" icon={Globe2} />
                <MetricTile label="Signal quality" value={result.leads.length ? `${Math.round(result.leads.reduce((sum, lead) => sum + lead.score, 0) / result.leads.length)}` : '—'} detail="Average outreach score / 100" accent="blue" icon={Gauge} />
              </div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                <div><div className="eyebrow">ranked prospects</div><h2 className="mt-1 text-xl font-extrabold tracking-[-0.04em]">Your next conversations <span className="font-mono text-sm font-normal text-[hsl(var(--muted-foreground))]">({filteredLeads.length})</span></h2></div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => downloadCsv(filteredLeads)} disabled={!filteredLeads.length} data-testid="button-export-csv" className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-xs font-bold transition hover:border-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-45"><Download className="h-3.5 w-3.5" /> Export CSV</button>
                  <button type="button" onClick={resetWorkspace} data-testid="button-new-scan" className="flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))] transition hover:-translate-y-0.5"><Search className="h-3.5 w-3.5" /> New scan</button>
                </div>
              </div>
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.76)] p-2.5">
                <div className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-transparent bg-[hsl(var(--background))] px-3 focus-within:border-[hsl(var(--primary))]"><Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" /><input value={query} onChange={(event) => setQuery(event.target.value)} data-testid="input-filter-leads" aria-label="Filter leads" placeholder="Filter by name, category, or address" className="w-full bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]" />{query && <button type="button" onClick={() => setQuery('')} data-testid="button-clear-filter" aria-label="Clear filter"><X className="h-3.5 w-3.5" /></button>}</div>
                <div className="flex items-center gap-2"><Filter className="ml-1 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" /><select value={category} onChange={(event) => setCategory(event.target.value)} data-testid="select-category" aria-label="Filter by category" className="h-9 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-xs font-semibold outline-none"><option value="all">All sectors</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
                <div className="flex items-center gap-2"><SlidersHorizontal className="ml-1 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" /><select value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} data-testid="select-min-score" aria-label="Minimum score" className="h-9 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 text-xs font-semibold outline-none"><option value={0}>Any score</option><option value={60}>60+ signal</option><option value={75}>75+ strong</option><option value={85}>85+ priority</option></select></div>
                <div className="relative flex items-center gap-2"><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} data-testid="select-sort-leads" aria-label="Sort leads" className="h-9 appearance-none rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] py-0 pl-3 pr-7 text-xs font-semibold outline-none"><option value="score">Sort: score</option><option value="rating">Sort: rating</option><option value="reviewsCount">Sort: reviews</option></select><ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" /></div>
              </div>
              {filteredLeads.length > 0 ? <div className="grid gap-3">{filteredLeads.map((lead, index) => <LeadCard key={`${lead.name}-${index}`} lead={lead} index={index} />)}</div> : <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] px-6 py-14 text-center" data-testid="empty-filter-results"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"><Search className="h-5 w-5" /></div><h3 className="mt-4 font-bold">No prospects match this cut.</h3><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Widen the filter or lower the signal threshold to see more.</p><button type="button" onClick={() => { setQuery(''); setCategory('all'); setMinScore(0); }} data-testid="button-reset-filters" className="mt-4 rounded-lg px-3 py-2 text-xs font-bold text-[hsl(178_37%_28%)] transition hover:bg-[hsl(var(--accent))]">Reset filters</button></div>}
            </section> :
            <section className="reveal-up-delay rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/.48)] px-6 py-14 text-center" data-testid="empty-workspace"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/.16)] text-[hsl(35_75%_34%)]"><Radar className="h-6 w-6" /></div><div className="eyebrow mt-5">awaiting perimeter</div><h2 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">Your signal board is clear.</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">Choose a location and run a scan to surface local businesses with a real opening for better messaging.</p><div className="mt-6 flex flex-wrap justify-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]"><span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5">Local search coverage</span><span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5">Website signals</span><span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5">Outreach scoring</span></div></section>}
        </div>
      </main>
    </div>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
