'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

import { appCopy, type AppLanguage } from '@/app/i18n';
import { Button } from '@ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui/tooltip';

type Theme = 'light' | 'dark';

const themeStorageKey = 'theme';
const themeCookieName = 'theme';
const themeChangeEvent = 'smartstore-theme-change';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') {
    return;
  }

  const shouldUseDarkTheme = theme === 'dark';

  if (document.documentElement.classList.contains('dark') !== shouldUseDarkTheme) {
    document.documentElement.classList.toggle('dark', shouldUseDarkTheme);
  }

  if (document.documentElement.style.colorScheme !== theme) {
    document.documentElement.style.colorScheme = theme;
  }
}

function persistTheme(theme: Theme) {
  localStorage.setItem(themeStorageKey, theme);
  document.cookie = `${themeCookieName}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function persistThemeSoon(theme: Theme) {
  const persist = () => persistTheme(theme);

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(persist, { timeout: 800 });
    return;
  }

  globalThis.setTimeout(persist, 0);
}

function readTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const storedTheme = localStorage.getItem(themeStorageKey);

  if (isTheme(storedTheme)) {
    return storedTheme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function subscribe(callback: () => void) {
  const handleStorage = () => callback();
  const handleThemeChange = () => callback();

  window.addEventListener('storage', handleStorage);
  window.addEventListener(themeChangeEvent, handleThemeChange);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(themeChangeEvent, handleThemeChange);
  };
}

function useTheme(): Theme {
  return useSyncExternalStore<Theme>(subscribe, readTheme, () => 'light');
}

type ThemeToggleProps = {
  language?: AppLanguage;
  variant?: 'icon' | 'switch';
};

function ThemeToggle({ language = 'ar', variant = 'icon' }: ThemeToggleProps) {
  const theme = useTheme();
  const copy = appCopy[language];
  const label = theme === 'light' ? copy.themeToDark : copy.themeToLight;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const nextTheme: Theme = theme === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme);
    persistThemeSoon(nextTheme);
    globalThis.setTimeout(() => {
      window.dispatchEvent(new Event(themeChangeEvent));
    }, 0);
  }, [theme]);

  if (variant === 'switch') {
    const isDark = theme === 'dark';

    return (
      <button
        aria-label={label}
        aria-pressed={isDark}
        className={`relative inline-flex h-11 w-20 shrink-0 items-center rounded-full border p-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
          isDark
            ? 'border-blue-500/40 bg-blue-600'
            : 'border-slate-200 bg-blue-600'
        }`}
        onClick={toggleTheme}
        type="button"
      >
        <span
          className={`grid size-9 place-items-center rounded-full bg-white text-blue-600 shadow-sm transition-transform duration-200 ${
            isDark ? '-translate-x-9' : 'translate-x-0'
          }`}
        >
          {isDark ? <Moon className="size-5" /> : <Sun className="size-5" />}
        </span>
      </button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-md p-0"
          onClick={toggleTheme}
          aria-label={label}
        >
          <span className="grid size-5 place-items-center">
            {theme === 'dark' ? (
              <Moon className="size-5" />
            ) : (
              <Sun className="size-5" />
            )}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export { ThemeToggle };
