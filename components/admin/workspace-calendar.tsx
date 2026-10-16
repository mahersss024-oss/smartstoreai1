'use client';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import themePlugin from '@fullcalendar/react/themes/classic';
import arLocale from '@fullcalendar/react/locales/ar';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/classic/theme.css';
import '@fullcalendar/react/themes/classic/palette.css';
import type { AdminWorkspace } from '@/lib/admin/workspace';
import Link from 'next/link';

export default function WorkspaceCalendar({ data }: { data: AdminWorkspace }) {
  return (
    <section className="admin-panel" aria-label="التقويم الإداري">
      <h2 className="admin-panel-heading">التقويم الإداري</h2>
      <div className="admin-panel-body">
        <div className="admin-calendar">
          <FullCalendar
            key={data.month}
            plugins={[themePlugin, dayGridPlugin]}
            initialView="dayGridMonth"
            initialDate={`${data.month}-01`}
            direction="rtl"
            locale={arLocale}
            timeZone="UTC"
            headerToolbar={false}
            height="auto"
            editable={false}
            selectable={false}
            events={data.events.map((event) => ({
              id: event.id,
              title: event.title,
              start: event.date,
              allDay: true,
              url: event.href,
            }))}
            dayMaxEvents={2}
          />
        </div>
        <ul className="mt-4 grid gap-2 text-sm">
          {data.events.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b py-2"
            >
              <Link
                href={event.href}
                prefetch={false}
                className="text-primary underline-offset-4 hover:underline"
              >
                {event.title}
              </Link>
              <time
                className="text-xs text-muted-foreground"
                dateTime={event.date}
              >
                {event.date}
              </time>
            </li>
          ))}
        </ul>
        {data.events.length === 0 && (
          <p role="status" className="py-3 text-sm text-muted-foreground">
            لا توجد مواعيد مسجلة لهذا الشهر.
          </p>
        )}
        {data.hasMoreEvents && (
          <Link
            href="/admin/moderation"
            className="mt-3 block text-sm text-primary"
          >
            عرض بقية القضايا في البلاغات والأدلة
          </Link>
        )}
      </div>
    </section>
  );
}
