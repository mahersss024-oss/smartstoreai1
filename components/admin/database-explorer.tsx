'use client';

import { useCallback, useEffect, useState } from 'react';
import { Database, RefreshCw, Search } from 'lucide-react';
import { Button } from '@ui/button';
import { Input } from '@ui/input';

type ModelInfo = {
  name: string;
  table: string;
  label: string;
  estimatedRows: number | null;
  fields: Array<{ name: string; type: string; redacted: boolean }>;
};
type RowPage = {
  label: string;
  columns: Array<{ name: string; type: string; redacted: boolean }>;
  page: number;
  pageSize: number;
  total: number;
  rows: Array<Record<string, unknown>>;
};
type Compatibility = {
  checkedAt: string;
  migrations: { historyAvailable: boolean; filesAvailable: boolean; expected: number; applied: number; pending: string[]; failed: string[]; unknownApplied: string[] };
  schema: { tablesChecked: number; missingTables: string[]; missingColumns: string[]; extraColumns: string[]; extraTables: string[] };
  databaseObjects: { expectedFunctions: string[]; missingFunctions: string[]; expectedTriggers: string[]; missingTriggers: string[]; expectedExtensions: string[]; missingExtensions: string[] };
};

function valueText(value: unknown) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value, null, 2); } catch { return '[غير قابل للعرض]'; }
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{title}</span><strong>{items.length}</strong>
      </div>
      {items.length > 0 && <ul className="mt-2 max-h-36 overflow-auto text-xs text-muted-foreground" dir="ltr">{items.map((item) => <li key={item}>{item}</li>)}</ul>}
    </div>
  );
}

export function DatabaseExplorer() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelName, setModelName] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [tablePage, setTablePage] = useState<RowPage | null>(null);
  const [compatibility, setCompatibility] = useState<Compatibility | null>(null);
  const [tab, setTab] = useState<'records' | 'compatibility'>('records');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/maintenance?resource=database', { cache: 'no-store' });
      if (!response.ok) throw new Error('تعذر تحميل قائمة الجداول.');
      const payload = await response.json() as { models: ModelInfo[] };
      setModels(payload.models);
      setModelName((current) => current || payload.models[0]?.name || '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر تحميل قاعدة البيانات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadModels(); }, [loadModels]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); setActiveSearch(search.trim()); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (tab !== 'records' || !modelName) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ resource: 'database', model: modelName, page: String(page), pageSize: '25' });
    if (activeSearch) params.set('search', activeSearch);
    void fetch(`/api/admin/maintenance?${params}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('تعذر قراءة سجلات هذا الجدول.');
        return response.json() as Promise<RowPage>;
      })
      .then((payload) => { if (!cancelled) setTablePage(payload); })
      .catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'تعذر قراءة الجدول.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeSearch, modelName, page, tab]);

  const loadCompatibility = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/maintenance?resource=database&view=compatibility', { cache: 'no-store' });
      if (!response.ok) throw new Error('تعذر فحص توافق قاعدة البيانات.');
      setCompatibility(await response.json() as Compatibility);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر فحص التوافق.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === 'compatibility' && !compatibility) void loadCompatibility(); }, [compatibility, loadCompatibility, tab]);

  const selectedModel = models.find((model) => model.name === modelName);
  const totalPages = tablePage ? Math.max(1, Math.ceil(tablePage.total / tablePage.pageSize)) : 1;
  const compatibilityIssueCount = compatibility
    ? compatibility.migrations.pending.length + compatibility.migrations.failed.length + compatibility.migrations.unknownApplied.length
      + compatibility.schema.missingTables.length + compatibility.schema.missingColumns.length + compatibility.schema.extraColumns.length + compatibility.schema.extraTables.length + compatibility.databaseObjects.missingFunctions.length
      + compatibility.databaseObjects.missingTriggers.length + compatibility.databaseObjects.missingExtensions.length
      + Number(!compatibility.migrations.historyAvailable || !compatibility.migrations.filesAvailable)
    : 0;

  return (
    <section className="admin-section grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Database className="mt-0.5 size-5 text-blue-700 dark:text-blue-300" />
          <div>
            <h2 className="text-sm font-bold">قاعدة البيانات</h2>
            <p className="mt-1 text-xs text-muted-foreground">قراءة مقسّمة لكل الجداول ومقارنة المخطط مع نماذج المشروع وترحيلاته. تُحجب المفاتيح والروابط الخاصة، وتبقى التغييرات عبر إجراءات النظام المسجلة.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setCompatibility(null); void loadModels(); if (tab === 'compatibility') void loadCompatibility(); }}>
          <RefreshCw className="size-4" /> تحديث
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="أدوات قاعدة البيانات">
        <Button variant={tab === 'records' ? 'default' : 'outline'} size="sm" role="tab" aria-selected={tab === 'records'} onClick={() => setTab('records')}>الجداول والبيانات</Button>
        <Button variant={tab === 'compatibility' ? 'default' : 'outline'} size="sm" role="tab" aria-selected={tab === 'compatibility'} onClick={() => setTab('compatibility')}>توافق قاعدة البيانات</Button>
      </div>

      {error && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">{error}</p>}

      {tab === 'records' ? (
        <>
          <div className="grid gap-3 md:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.3fr)]">
            <label className="grid gap-1 text-xs">القسم
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={modelName} onChange={(event) => { setModelName(event.target.value); setPage(1); }}>
                {models.map((model) => <option key={model.name} value={model.name}>{model.label} · {model.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs">بحث في الجدول
              <span className="relative"><Search className="absolute right-3 top-3 size-4 text-muted-foreground" /><Input className="pr-9" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} placeholder="ابحث في بيانات السجلات" /></span>
            </label>
          </div>

          {selectedModel && <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>الجدول: <b dir="ltr">{selectedModel.table}</b></span>
            <span>عدد تقريبي: <b>{selectedModel.estimatedRows === null ? 'غير متاح' : new Intl.NumberFormat('ar-SA').format(selectedModel.estimatedRows)}</b></span>
            <span>أعمدة: <b>{selectedModel.fields.length}</b></span>
          </div>}
          {selectedModel && <details className="rounded-md border bg-background p-3">
            <summary className="cursor-pointer text-xs font-semibold">عرض أعمدة المخطط المتوقع من Prisma</summary>
            <div className="mt-2 grid gap-1 text-xs" dir="ltr">
              {selectedModel.fields.map((field) => <div key={field.name} className="flex flex-wrap gap-x-3 border-b py-1 last:border-0">
                <code>{field.name}</code><span>{field.type}</span>{field.redacted && <span className="text-amber-700">القيمة محجوبة</span>}
              </div>)}
            </div>
          </details>}

          <div className="grid gap-2">
            {loading && <p className="text-xs text-muted-foreground">جارٍ تحميل البيانات...</p>}
            {!loading && tablePage?.rows.map((row, index) => {
              const identity = valueText(row.id ?? row.day ?? index + 1);
              return <details key={`${modelName}:${identity}:${index}`} className="rounded-md border bg-background p-3">
                <summary className="cursor-pointer text-sm font-semibold">{identity} <span className="font-normal text-muted-foreground">· {valueText(row.status ?? row.createdAt ?? '')}</span></summary>
                <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-5" dir="ltr">{valueText(row)}</pre>
              </details>;
            })}
            {!loading && tablePage?.rows.length === 0 && <p className="rounded-md border p-4 text-sm text-muted-foreground">لا توجد سجلات مطابقة.</p>}
          </div>

          {tablePage && <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>السجلات {new Intl.NumberFormat('ar-SA').format(tablePage.total)} · صفحة {page} من {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>السابق</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>التالي</Button>
            </div>
          </div>}
        </>
      ) : compatibility && (
          <div className="grid gap-3">
          <p className="text-xs text-muted-foreground">آخر فحص: {new Date(compatibility.checkedAt).toLocaleString('ar-SA')}</p>
          <p className={`rounded-md border p-3 text-sm font-semibold ${compatibilityIssueCount ? 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200' : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'}`}>
            {compatibilityIssueCount ? `تم العثور على ${compatibilityIssueCount} اختلافات تحتاج مراجعة.` : 'المخطط والترحيلات والدوال المتوقعة متطابقة مع الملفات المقروءة.'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-md border bg-background p-3 text-sm">الترحيلات: {compatibility.migrations.applied} مطبقة من {compatibility.migrations.expected}</div>
            <div className="rounded-md border bg-background p-3 text-sm">الجداول المفحوصة: {compatibility.schema.tablesChecked}</div>
            <div className="rounded-md border bg-background p-3 text-sm">حالة سجل الترحيلات: {compatibility.migrations.historyAvailable ? 'متاح' : 'غير موجود'}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <ResultList title="ترحيلات غير مطبقة" items={compatibility.migrations.pending} />
            <ResultList title="ترحيلات فاشلة" items={compatibility.migrations.failed} />
            <ResultList title="جداول مفقودة" items={compatibility.schema.missingTables} />
            <ResultList title="أعمدة مفقودة" items={compatibility.schema.missingColumns} />
            <ResultList title="أعمدة إضافية غير موجودة في Prisma" items={compatibility.schema.extraColumns} />
            <ResultList title="جداول إضافية غير موجودة في Prisma" items={compatibility.schema.extraTables} />
            <ResultList title="ترحيلات مطبقة غير موجودة في المستودع" items={compatibility.migrations.unknownApplied} />
            <ResultList title="دوال قاعدة البيانات المفقودة" items={compatibility.databaseObjects.missingFunctions} />
            <ResultList title="مشغلات قاعدة البيانات المفقودة" items={compatibility.databaseObjects.missingTriggers} />
            <ResultList title="امتدادات قاعدة البيانات المفقودة" items={compatibility.databaseObjects.missingExtensions} />
          </div>
        </div>
      )}
    </section>
  );
}
