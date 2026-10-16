'use client';

import dynamic from 'next/dynamic';
import type { ApexOptions } from 'apexcharts';
import type { AdminWorkspace } from '@/lib/admin/workspace';

const ReactApexChart = dynamic(() => import('react-apexcharts'), {
  ssr: false,
  loading: () => (
    <div
      className="grid h-[280px] place-items-center text-sm text-muted-foreground"
      role="status"
    >
      جارٍ تحميل الرسم...
    </div>
  ),
});

// TailAdmin chart composition, with marketplace theme and real daily visit data.
export function WorkspaceCharts({ data }: { data: AdminWorkspace }) {
  const options: ApexOptions = {
    chart: {
      type: 'bar',
      height: 280,
      fontFamily: 'inherit',
      toolbar: { show: false },
      animations: { enabled: false },
      foreColor: 'var(--muted-foreground)',
    },
    colors: ['#3a6fb8', '#159a83'],
    plotOptions: { bar: { borderRadius: 3, columnWidth: '55%' } },
    dataLabels: { enabled: false },
    xaxis: {
      categories: data.visits.map((row) => row.day.slice(8)),
      title: { text: 'اليوم' },
    },
    yaxis: {
      min: 0,
      forceNiceScale: true,
      labels: {
        formatter: (value) =>
          new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 0 }).format(
            value,
          ),
      },
    },
    legend: { position: 'top', horizontalAlign: 'right' },
    grid: { borderColor: 'var(--border)' },
    tooltip: {
      theme: 'light',
      x: {
        formatter: (_value, context) =>
          data.visits[context?.dataPointIndex ?? -1]?.day ?? '',
      },
    },
    noData: { text: 'لا توجد زيارات مسجلة لهذه الفترة' },
  };
  return (
    <section className="admin-panel" aria-label="مؤشرات الزيارات">
      <h2 className="admin-panel-heading">زيارات الموقع</h2>
      <div className="admin-panel-body">
        <div className="admin-chart" aria-hidden="true">
          <ReactApexChart
            options={options}
            series={[
              { name: 'الزيارات', data: data.visits.map((row) => row.visits) },
              {
                name: 'الزوار الفريدون يوميًا',
                data: data.visits.map((row) => row.uniqueVisitors),
              },
            ]}
            type="bar"
            height={280}
          />
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-primary">
            عرض أرقام الزيارات
          </summary>
          <div className="mt-3 max-h-64 overflow-auto">
            <table className="w-full text-start text-xs">
              <caption className="sr-only">زيارات الموقع اليومية</caption>
              <thead>
                <tr>
                  <th scope="col" className="p-2 text-start">
                    التاريخ
                  </th>
                  <th scope="col">الزيارات</th>
                  <th scope="col">الزوار الفريدون يوميًا</th>
                </tr>
              </thead>
              <tbody>
                {data.visits.map((row) => (
                  <tr key={row.day} className="border-t">
                    <th scope="row" className="p-2 text-start font-normal">
                      {row.day}
                    </th>
                    <td className="text-center">{row.visits}</td>
                    <td className="text-center">{row.uniqueVisitors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.visits.length === 0 && (
              <p className="py-3 text-muted-foreground">
                لا توجد زيارات مسجلة لهذه الفترة.
              </p>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
