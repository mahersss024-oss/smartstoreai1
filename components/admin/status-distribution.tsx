import Link from 'next/link';
import type { CSSProperties } from 'react';

const colors = [
  '#3a6fb8',
  '#159a83',
  '#ca8a04',
  '#9f5077',
  '#64748b',
  '#0891b2',
  '#dc6060',
];
export function StatusDistribution({
  title,
  rows,
  labels,
  href,
  source,
  empty,
}: {
  title: string;
  rows: Array<{ status: string; count: number }>;
  labels: Record<string, string>;
  href: (status: string) => string;
  source: string;
  empty: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  let offset = 0;
  const stops = rows.map((row, index) => {
    const start = offset;
    offset += total > 0 ? (row.count / total) * 100 : 0;
    return `${colors[index % colors.length]} ${start}% ${offset}%`;
  });
  return (
    <section className="admin-section" aria-label={title}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold">{title}</h2>
        <span className="text-xs text-muted-foreground">الحالة الحالية</span>
      </header>
      {total > 0 ? (
        <div className="admin-distribution">
          <div
            className="admin-donut"
            style={{ background: `conic-gradient(${stops.join(',')})` }}
            aria-hidden="true"
          >
            <span>{new Intl.NumberFormat('ar-SA').format(total)}</span>
          </div>
          <dl className="grid min-w-0 gap-3">
            {rows.map((row, index) => (
              <div key={row.status}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <dt>
                    <Link
                      href={href(row.status)}
                      prefetch={false}
                      className="hover:text-primary hover:underline"
                    >
                      {labels[row.status] ?? row.status}
                    </Link>
                  </dt>
                  <dd>{new Intl.NumberFormat('ar-SA').format(row.count)}</dd>
                </div>
                <div className="admin-status-track" aria-hidden="true">
                  <span
                    style={
                      {
                        width: `${(row.count / total) * 100}%`,
                        background: colors[index % colors.length],
                      } as CSSProperties
                    }
                  />
                </div>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="py-6 text-sm text-muted-foreground">{empty}</p>
      )}
      <p className="text-xs text-muted-foreground">{source}</p>
    </section>
  );
}
