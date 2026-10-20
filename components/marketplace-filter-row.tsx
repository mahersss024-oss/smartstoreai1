'use client';

import { useLayoutEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getMarketplaceCategoryOptions } from '@/lib/marketplace/category-options';
import { getMarketplaceCarModels } from '@/lib/marketplace/car-models';

type MarketplaceFilterRowProps = {
  level: 'groups' | 'categories' | 'options' | 'models';
  label: string;
  options?: readonly { id: string; label: string }[];
  value: string;
  compact?: boolean;
  active?: boolean;
  scope?: string;
  onChange: (value: string) => void;
};

function MarketplaceFilterRow({ level, label, options = [], value, compact = false, active = true, onChange }: MarketplaceFilterRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const selected = row?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!active || !row || !selected) return;
    const bounds = row.getBoundingClientRect();
    const button = selected.getBoundingClientRect();
    // Reveal the selection within its row without moving the page or listing feed.
    const delta = button.left < bounds.left ? button.left - bounds.left : button.right > bounds.right ? button.right - bounds.right : 0;
    if (delta) row.scrollBy({ left: delta, behavior: 'instant' });
  }, [value, active]);

  if (!options.length) return null;
  const buttonClass = cn('shrink-0 rounded-full', compact ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-xs');
  return (
    <div ref={rowRef} role="group" aria-label={label} dir="rtl" data-marketplace-filter-row={level}
      aria-hidden={!active || undefined} inert={!active} data-row-active={active}
      className={cn('flex min-w-0 touch-pan-x gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', compact ? 'h-7' : 'h-8')}>
      {level === 'groups' && (
        <Button type="button" size="sm" variant={value === 'all' ? 'default' : 'outline'} aria-pressed={value === 'all'}
          className={buttonClass} onClick={() => onChange('all')}>الكل</Button>
      )}
      {options.map(option => (
        <Button key={option.id} type="button" size="sm" variant={value === option.id ? 'default' : 'outline'} aria-pressed={value === option.id}
          className={buttonClass} onClick={() => onChange(option.id)}>{option.label}</Button>
      ))}
    </div>
  );
}

export function MarketplaceFilterRows({ rows, category, brand, start: requestedStart, onStartChange }: {
  rows: readonly MarketplaceFilterRowProps[];
  category: string;
  brand: string;
  start: number;
  onStartChange: (start: number) => void;
}) {
  const windowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const positionedRef = useRef(false);
  const availableRows = rows.map(row => ({ ...row, options: row.level === 'options' ? getMarketplaceCategoryOptions(category)
    : row.level === 'models' ? category === 'cars' ? getMarketplaceCarModels(brand) : [] : row.options ?? [] }))
    .filter(row => row.options.length);
  const start = Math.max(0, Math.min(requestedStart, availableRows.length - 2));

  useLayoutEffect(() => {
    const viewport = windowRef.current;
    const track = trackRef.current;
    const children = track ? Array.from(track.children) as HTMLElement[] : [];
    if (!viewport || !track || !children.length) return;
    const height = children.slice(0, 2).reduce((sum, row) => sum + row.offsetHeight, 0)
      + (children.length > 1 ? 4 : 0);
    viewport.style.height = `${height}px`;
    if (!positionedRef.current) track.style.transition = 'none';
    track.style.transform = `translate3d(0, -${children[start].offsetTop}px, 0)`;
    if (!positionedRef.current) {
      // Restore the saved window before paint; only subsequent choices animate.
      void track.offsetHeight;
      track.style.removeProperty('transition');
      positionedRef.current = true;
    }
  }, [start, availableRows.length]);

  return (
    <div ref={windowRef} className="marketplace-category-window" data-category-window-start={start}>
      <div ref={trackRef} className="marketplace-category-track">
        {availableRows.map((row, index) => (
          <MarketplaceFilterRow key={`${row.level}:${row.scope ?? ''}`} {...row} active={index >= start && index < start + 2}
            onChange={value => {
              row.onChange(value);
              onStartChange(index === start && start > 0 ? start - 1
                : index === start + 1 ? Math.min(2, start + 1) : 0);
            }} />
        ))}
      </div>
    </div>
  );
}
