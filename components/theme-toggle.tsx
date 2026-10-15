'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

import { appCopy, type AppLanguage } from '@/app/i18n';
import { Button } from '@ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui/tooltip';

type Theme = 'light' | 'dark';

const themeStorageKey = 'theme';
const themeCookieName = 'theme';
const themeChangeEvent = 'smartstore-theme-change';
let themeCommitFrame: number | null = null;
let cancelPendingPersistence: (() => void) | undefined;

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') {
    return;
  }

  const shouldUseDarkTheme = theme === 'dark';
  const root = document.documentElement;

  if (root.classList.contains('dark') === shouldUseDarkTheme && root.style.colorScheme === theme) {
    return;
  }

  if (themeCommitFrame !== null) window.cancelAnimationFrame(themeCommitFrame);
  root.setAttribute('data-theme-switching', '');
  root.classList.toggle('dark', shouldUseDarkTheme);
  root.style.colorScheme = theme;

  // Commit final colors under the guard before restoring hover transitions.
  void window.getComputedStyle(root).color;
  themeCommitFrame = window.requestAnimationFrame(() => {
    themeCommitFrame = window.requestAnimationFrame(() => {
      root.removeAttribute('data-theme-switching');
      themeCommitFrame = null;
    });
  });
}

function persistTheme(theme: Theme) {
  try {
    localStorage.setItem(themeStorageKey, theme);
  } catch {
    // A blocked preference store must not undo the visible theme.
  }
  try {
    document.cookie = `${themeCookieName}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    // Cookies may be unavailable independently of local storage.
  }
}

function persistThemeSoon(theme: Theme) {
  cancelPendingPersistence?.();
  const persist = () => {
    cancelPendingPersistence = undefined;
    if (readTheme() === theme) persistTheme(theme);
  };

  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(persist, { timeout: 800 });
    cancelPendingPersistence = () => window.cancelIdleCallback(id);
    return;
  }

  const id = globalThis.setTimeout(persist, 0);
  cancelPendingPersistence = () => globalThis.clearTimeout(id);
}

function readTheme(): Theme {
  if (typeof document === 'undefined') {
    return 'light';
  }

  // The head script initializes this before paint; persistence can lag behind it.
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function subscribe(callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== themeStorageKey && event.key !== null) return;
    const theme = isTheme(event.newValue)
      ? event.newValue
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(theme);
    callback();
  };
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

  const toggleTheme = useCallback(() => {
    const nextTheme: Theme = readTheme() === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme);
    window.dispatchEvent(new Event(themeChangeEvent));
    persistThemeSoon(nextTheme);
  }, []);

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
    <Tooltip delayDuration={300}>
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
