import type { Locale } from './i18n';

export type Theme = 'light' | 'dark';
export type Layout = 'split' | 'inline';

export const SIDEBAR_DRAWER_BREAKPOINT = 920;

export function parsePreferences(raw: string | null, language: string, dark: boolean) {
  let saved: Record<string, unknown> = {};
  try {
    const value = JSON.parse(raw || '{}');
    if (value && typeof value === 'object') saved = value;
  } catch {}
  return {
    locale: (saved.locale === 'zh' || saved.locale === 'en' ? saved.locale : language.toLowerCase().startsWith('zh') ? 'zh' : 'en') as Locale,
    theme: (saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : dark ? 'dark' : 'light') as Theme,
    layout: (saved.layout === 'inline' || saved.layout === 'unified' ? 'inline' : 'split') as Layout,
    wrap: typeof saved.wrap === 'boolean' ? saved.wrap : true,
    collapse: typeof saved.collapse === 'boolean' ? saved.collapse : true,
    explicitLocale: saved.locale === 'zh' || saved.locale === 'en',
    explicitTheme: saved.theme === 'light' || saved.theme === 'dark',
  };
}
