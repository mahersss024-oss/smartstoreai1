'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, MapPin, Search } from 'lucide-react';

import { saudiMarketplaceCities } from '@/lib/marketplace/cities';
import { cn } from '@/lib/utils';

type CitySelectorProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  allValue?: string;
  allLabel?: string;
  disabled?: boolean;
  name?: string;
  className?: string;
  popoverClassName?: string;
};

function normalizeArabicSearch(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('ar')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

export function CitySelector({
  value,
  onValueChange,
  placeholder = 'اختر المدينة',
  allValue,
  allLabel = 'كل المناطق',
  disabled = false,
  name,
  className,
  popoverClassName,
}: CitySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const root = rootRef.current;
    const popover = popoverRef.current;
    if (!root || !popover) return;
    const viewport = window.visualViewport;
    const positionPopover = (event?: Event) => {
      if (event?.target instanceof Node && popover.contains(event.target)) return;
      const rect = root.getBoundingClientRect();
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const popoverWidth = Math.min(Math.max(256, rect.width), width - 16);
      const anchorTop = Math.min(bottom - 8, Math.max(top + 8, rect.top - 4));
      const anchorBottom = Math.min(bottom - 8, Math.max(top + 8, rect.bottom + 4));
      const below = Math.max(0, bottom - anchorBottom - 8);
      const above = Math.max(0, anchorTop - top - 8);
      const openAbove = below < 160 && above > below;
      popover.style.width = `${popoverWidth}px`;
      popover.style.left = `${Math.max(left + 8, Math.min(rect.left, left + width - popoverWidth - 8))}px`;
      popover.style.top = `${openAbove ? anchorTop : anchorBottom}px`;
      popover.style.transform = openAbove ? 'translateY(-100%)' : 'none';
      popover.style.maxHeight = `${openAbove ? above : below}px`;
    };
    positionPopover();
    // Anchored options must track a moving trigger, only while they are open.
    document.addEventListener('scroll', positionPopover, true);
    window.addEventListener('resize', positionPopover);
    viewport?.addEventListener('resize', positionPopover);
    viewport?.addEventListener('scroll', positionPopover);
    return () => {
      document.removeEventListener('scroll', positionPopover, true);
      window.removeEventListener('resize', positionPopover);
      viewport?.removeEventListener('resize', positionPopover);
      viewport?.removeEventListener('scroll', positionPopover);
    };
  }, [isOpen]);

  const cities = useMemo(() => {
    const normalizedQuery = normalizeArabicSearch(query);
    const options = saudiMarketplaceCities.includes(value)
      ? saudiMarketplaceCities
      : value && value !== allValue
        ? [value, ...saudiMarketplaceCities]
        : saudiMarketplaceCities;

    return normalizedQuery
      ? options.filter((city) =>
          normalizeArabicSearch(city).includes(normalizedQuery),
        )
      : options;
  }, [allValue, query, value]);

  useEffect(() => {
    if (!isOpen) return;

    if (window.matchMedia('(pointer: fine)').matches) {
      searchRef.current?.focus({ preventScroll: true });
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node) &&
          !popoverRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const selectValue = (nextValue: string) => {
    onValueChange(nextValue);
    setQuery('');
    setIsOpen(false);
  };

  const visibleLabel = value === allValue ? allLabel : value || placeholder;

  return (
    <div
      className={cn('relative min-w-0', isOpen && 'z-50', className)}
      ref={rootRef}
    >
      {name ? <input name={name} type="hidden" value={value} /> : null}
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="flex h-10 w-full items-center gap-2 rounded-md border bg-background px-3 text-right text-sm outline-none transition-colors hover:bg-accent focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => {
          setQuery('');
          setIsOpen((current) => !current);
        }}
        type="button"
      >
        <MapPin className="size-4 shrink-0 text-blue-600" />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            !value && 'text-muted-foreground',
          )}
        >
          {visibleLabel}
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen ? createPortal(
        <div
          ref={popoverRef}
          className={cn(
            'fixed z-[90] flex min-h-0 flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg [contain:layout_paint]',
            popoverClassName,
          )}
          dir="rtl"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex shrink-0 items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              aria-label="البحث عن مدينة"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث عن مدينة"
              ref={searchRef}
              type="search"
              value={query}
            />
          </div>
          <div className="min-h-0 max-h-64 overflow-y-auto overscroll-contain p-1" role="listbox">
            {allValue !== undefined && !query ? (
              <button
                aria-selected={value === allValue}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-right text-sm hover:bg-accent"
                onClick={() => selectValue(allValue)}
                role="option"
                type="button"
              >
                <Check
                  className={cn('size-4', value !== allValue && 'invisible')}
                />
                <span>{allLabel}</span>
              </button>
            ) : null}
            {cities.map((city) => (
              <button
                aria-selected={value === city}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-right text-sm hover:bg-accent"
                key={city}
                onClick={() => selectValue(city)}
                role="option"
                type="button"
              >
                <Check
                  className={cn('size-4', value !== city && 'invisible')}
                />
                <span>{city}</span>
              </button>
            ))}
            {cities.length === 0 ? (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">
                لا توجد مدينة مطابقة
              </p>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
