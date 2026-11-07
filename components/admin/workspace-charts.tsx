'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { ChartColumn, ChartLine } from 'lucide-react';
import { Button } from '@ui/button';
import type { ApexOptions } from 'apexcharts';
import type { AdminWorkspace } from '@/lib/admin/workspace';
import type { AppUsageStats } from '@/lib/analytics/site-visits';

const ReactApexChart = dynamic(() => import('react-apexcharts'), {
  ssr: false,
  loading: () => <div className="grid h-[280px] place-items-center text-sm text-muted-foreground" role="status">جارٍ تحميل الرسم...</div>,
});
const number = (value: number) => new Intl.NumberFormat('ar-SA').format(value);
const sources = { app: 'التطبيق · iOS وAndroid', ios: 'التطبيق · iOS', android: 'التطبيق · Android', web: 'الموقع' };
type Source = keyof typeof sources;

export function WorkspaceCharts({ data, appUsage }: { data: AdminWorkspace; appUsage?: AppUsageStats }) {
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');
  const [source, setSource] = useState<Source>('app');
  const days = new Map<string, { day: string; visits: number; uniqueVisitors: number }>();
  for (const row of data.visits) {
    const platform = row.platform ?? 'web';
    if (source === 'app' ? platform === 'web' : platform !== source) continue;
    const aggregate = days.get(row.day) ?? { day: row.day, visits: 0, uniqueVisitors: 0 };
    aggregate.visits += row.visits;
    aggregate.uniqueVisitors += row.uniqueVisitors;
    days.set(row.day, aggregate);
  }
  const visits = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  const uniqueLabel = source === 'web' ? 'زوار الموقع الفريدون يومياً' : 'أجهزة التطبيق النشطة يومياً';
  const visitLabel = source === 'web' ? 'زيارات الموقع' : 'جلسات استخدام التطبيق';
  const options: ApexOptions = {
    chart: { type: chartType, height: 280, fontFamily: 'inherit', toolbar: { show: false }, animations: { enabled: false }, foreColor: 'var(--muted-foreground)' },
    colors: ['#3a6fb8', '#159a83'],
    plotOptions: { bar: { borderRadius: 3, columnWidth: '55%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: visits.map(row => row.day.slice(8)), title: { text: 'اليوم' } },
    yaxis: { min: 0, forceNiceScale: true, labels: { formatter: value => number(Math.round(value)) } },
    legend: { position: 'top', horizontalAlign: 'right' },
    grid: { borderColor: 'var(--border)' },
    tooltip: { theme: 'light', x: { formatter: (_value, context) => visits[context?.dataPointIndex ?? -1]?.day ?? '' } },
    noData: { text: 'لا يوجد نشاط مسجل لهذه الفترة' },
  };
  return <section className="admin-panel" aria-label="نشاط التطبيق والموقع">
    <header className="admin-panel-heading flex flex-wrap items-center justify-between gap-3">
      <div><h2>نشاط التطبيق والموقع</h2><p className="mt-1 text-xs font-normal text-muted-foreground">{data.month} · توقيت السعودية · الأيام المسجلة فقط</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="analytics-source">مصدر النشاط</label>
        <select id="analytics-source" className="h-9 max-w-full rounded-md border bg-card px-2 text-xs font-normal" value={source} onChange={event => setSource(event.target.value as Source)}>
          {Object.entries(sources).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <div className="flex gap-1" role="group" aria-label="نوع رسم الزيارات">
          <Button variant={chartType === 'bar' ? 'secondary' : 'ghost'} size="icon" aria-label="عرض الزيارات بالأعمدة" aria-pressed={chartType === 'bar'} onClick={() => setChartType('bar')}><ChartColumn className="size-4" /></Button>
          <Button variant={chartType === 'line' ? 'secondary' : 'ghost'} size="icon" aria-label="عرض الزيارات بخط زمني" aria-pressed={chartType === 'line'} onClick={() => setChartType('line')}><ChartLine className="size-4" /></Button>
        </div>
      </div>
    </header>
    <div className="admin-panel-body">
      <dl className="mb-3 grid grid-cols-3 gap-3 border-b pb-3 text-xs" aria-label="أجهزة التطبيق النشطة">
        {([['today', 'اليوم'], ['last7Days', 'آخر 7 أيام'], ['last30Days', 'آخر 30 يوماً']] as const).map(([key, label]) => <div key={key}>
          <dt className="text-muted-foreground">أجهزة التطبيق النشطة · {label}</dt>
          <dd className="mt-1 text-xl font-bold">{appUsage ? number(appUsage[key]) : '—'}</dd>
          {appUsage && <p className="mt-1 text-muted-foreground">iOS {number(appUsage.platforms.ios[key])} · Android {number(appUsage.platforms.android[key])}</p>}
        </div>)}
      </dl>
      <p className="mb-3 text-xs text-muted-foreground">يشمل استخدام التطبيق للزوار والمسجلين بمعرّف تثبيت مجهول. يُحسب الجهاز مرة واحدة لكل فترة؛ وقد يستخدم الشخص أكثر من جهاز. تبدأ جلسة جديدة بعد 30 دقيقة في الخلفية. لا تمثل الأرقام متصلين الآن أو تنزيلات.</p>
      <div className="admin-chart" aria-hidden="true"><ReactApexChart options={options} series={[{ name: visitLabel, data: visits.map(row => row.visits) }, { name: uniqueLabel, data: visits.map(row => row.uniqueVisitors) }]} type={chartType} height={280} /></div>
      <p className="mt-3 text-xs text-muted-foreground">{sources[source]} · {visitLabel}: {number(visits.reduce((sum, row) => sum + row.visits, 0))}</p>
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-primary">عرض أرقام النشاط</summary>
        <div className="mt-3 max-h-64 overflow-auto"><table className="w-full text-start text-xs">
          <caption className="sr-only">{sources[source]} · النشاط اليومي</caption>
          <thead><tr><th scope="col" className="p-2 text-start">التاريخ</th><th scope="col">{visitLabel}</th><th scope="col">{uniqueLabel}</th></tr></thead>
          <tbody>{visits.map(row => <tr key={row.day} className="border-t"><th scope="row" className="p-2 text-start font-normal">{row.day}</th><td className="text-center">{number(row.visits)}</td><td className="text-center">{number(row.uniqueVisitors)}</td></tr>)}</tbody>
        </table>{!visits.length && <p className="py-3 text-muted-foreground">لا يوجد نشاط مسجل لهذه الفترة.</p>}</div>
      </details>
    </div>
  </section>;
}
