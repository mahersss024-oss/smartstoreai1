'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

import { appCopy, type AppLanguage } from '@/app/i18n';
import { Button } from '@ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui/tooltip';

type Theme = 'light' | 'dark';

const themeStorageKey = 'theme';
const themeChangeEvent = 'smartstore-theme-change';

function readTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return (localStorage.getItem(themeStorageKey) as Theme | null) === 'dark'
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

function useTheme() {
  return useSyncExternalStore(subscribe, readTheme, () => 'light');
}

type ThemeToggleProps = {
  language?: AppLanguage;
};

function ThemeToggle({ language = 'ar' }: ThemeToggleProps) {
  const theme = useTheme();
  const copy = appCopy[language];
  const label = theme === 'light' ? copy.themeToDark : copy.themeToLight;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const nextTheme: Theme = theme === 'light' ? 'dark' : 'light';
    localStorage.setItem(themeStorageKey, nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
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
