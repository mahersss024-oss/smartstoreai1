import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@ui/button';

export function AdminResultsTable({
  columns,
  rows,
  selectedId,
  onOpen,
}: {
  columns: string[];
  rows: Array<{
    id: string;
    label: string;
    cells: ReactNode[];
    dirty?: boolean;
  }>;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="admin-results">
      <table>
        <caption className="sr-only">نتائج الإدارة</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
            <th scope="col">
              <span className="sr-only">الإجراءات</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="admin-result-row"
              data-selected={selectedId === row.id}
            >
              {row.cells.map((cell, index) => (
                <td key={columns[index]} data-label={columns[index]}>
                  {index === 0 ? (
                    <button
                      type="button"
                      className="admin-result-title"
                      onClick={() => onOpen(row.id)}
                      aria-label={`فتح ${row.label}`}
                    >
                      {cell}
                    </button>
                  ) : (
                    cell
                  )}
                </td>
              ))}
              <td className="admin-result-open">
                {row.dirty && (
                  <span className="text-xs text-amber-700 dark:text-amber-300">
                    مسودة
                  </span>
                )}
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`معاينة ${row.label}`}
                  title="المعاينة والتعديل"
                  onClick={() => onOpen(row.id)}
                >
                  <ChevronLeft className="size-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
