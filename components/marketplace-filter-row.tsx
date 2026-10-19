'use client';

import { useLayoutEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getMarketplaceCategoryOptions } from '@/lib/marketplace/category-options';
import { getMarketplaceCarModels } from '@/lib/marketplace/car-models';

type Props = {
  level: 'groups' | 'categories' | 'options' | 'models';
  label: string;
  options: readonly { id: string; label: string }[];
  value: string;
  compact?: boolean;
  onChange: (value: string) => void;
};

export function MarketplaceFilterRow({ level, label, options, value, compact = false, onChange }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const selected = row?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!row || !selected) return;
    const bounds = row.getBoundingClientRect();
    const button = selected.getBoundingClientRect();
    // Reveal the selection within its row without moving the page or listing feed.
    const delta = button.left < bounds.left ? button.left - bounds.left : button.right > bounds.right ? button.right - bounds.right : 0;
    if (delta) row.scrollBy({ left: delta, behavior: 'instant' });
  }, [value]);

  if (!options.length) return null;
  const buttonClass = cn('shrink-0 rounded-full', compact ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-xs');
  return (
    <div ref={rowRef} role="group" aria-label={label} dir="rtl" data-marketplace-filter-row={level}
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

export function MarketplaceCategoryOptionRow({ category, ...selection }: Pick<Props, 'value' | 'onChange'> & { category: string }) {
  return <MarketplaceFilterRow level="options" label="تفريعات التصنيف" compact options={getMarketplaceCategoryOptions(category)} {...selection} />;
}

export function MarketplaceCarModelRow({ category, brand, ...selection }: Pick<Props, 'value' | 'onChange'> & { category: string; brand: string }) {
  return <MarketplaceFilterRow level="models" label="تفريعات الخيار" compact options={category === 'cars' ? getMarketplaceCarModels(brand) : []} {...selection} />;
}
