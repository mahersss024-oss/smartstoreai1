'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
}: CitySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

    searchRef.current?.focus();
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
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
    <div className={cn('relative min-w-0', className)} ref={rootRef}>
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

      {isOpen ? (
        <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center gap-2 border-b px-3">
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
          <div className="max-h-64 overflow-y-auto p-1" role="listbox">
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
        </div>
      ) : null}
    </div>
  );
}
