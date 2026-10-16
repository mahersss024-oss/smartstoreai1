import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin/admin-shell';
import './workspace.css';

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="admin-viewport"><AdminShell>{children}</AdminShell></div>;
}
