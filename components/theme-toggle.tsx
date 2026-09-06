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

  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

function persistTheme(theme: Theme) {
  localStorage.setItem(themeStorageKey, theme);
  document.cookie = `${themeCookieName}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
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
};

function ThemeToggle({ language = 'ar' }: ThemeToggleProps) {
  const theme = useTheme();
  const copy = appCopy[language];
  const label = theme === 'light' ? copy.themeToDark : copy.themeToLight;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const nextTheme: Theme = theme === 'light' ? 'dark' : 'light';
    persistTheme(nextTheme);
    applyTheme(nextTheme);
    window.dispatchEvent(new Event(themeChangeEvent));
  }, [theme]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={label}
        >
          {theme === 'dark' ? <Moon className="size-5" /> : <Sun className="size-5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export { ThemeToggle };
