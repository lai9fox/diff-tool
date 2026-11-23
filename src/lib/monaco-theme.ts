import type { editor } from 'monaco-editor/editor/editor.api.js';
import type { Theme } from './preferences';

export function normalizeColor(value: string, fallback = '#000000') {
  const color = value.trim();
  if (/^#[\da-f]{3}$/i.test(color)) return `#${ color.slice(1).split('').map(c => c + c).join('') }`.toLowerCase();
  return /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

export function monacoTheme(theme: Theme): editor.IStandaloneThemeData {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string) => normalizeColor(css.getPropertyValue(`--${ name }`));
  const dark = theme === 'dark';
  return {
    base: dark ? 'vs-dark' : 'vs', inherit: true, rules: [],
    colors: {
      focusBorder: color('accent'),
      'sash.hoverBorder': color('accent'),
      'editor.background': color('panel'), 'editorGutter.background': color('panel'),
      'editor.foreground': color('text'),
      'editorLineNumber.foreground': color('muted'), 'editorLineNumber.activeForeground': color('text'),
      'editorCursor.foreground': color('accent'), 'editor.selectionBackground': color('selection'),
      'editor.lineHighlightBackground': color('active-line'),
      'diffEditor.border': '#00000000',
      'diffEditor.diagonalFill': `${ color('border') }${ dark ? '75' : '99' }`,
      'diffEditor.insertedLineBackground': color('add-bg'), 'diffEditor.insertedTextBackground': color('add-mark'),
      'diffEditor.removedLineBackground': color('remove-bg'), 'diffEditor.removedTextBackground': color('remove-mark'),
      'diffEditorGutter.insertedLineBackground': color('add-bg'), 'diffEditorGutter.removedLineBackground': color('remove-bg'),
      'diffEditorOverview.insertedForeground': `${ color('add') }b8`, 'diffEditorOverview.removedForeground': `${ color('remove') }b8`,
      'diffEditor.unchangedRegionBackground': color('surface'), 'diffEditor.unchangedRegionForeground': color('muted'),
      'diffEditor.unchangedRegionShadow': '#00000000',
      'editorOverviewRuler.border': '#00000000',
      'editorWidget.background': color('panel'), 'editorWidget.border': color('border'),
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': `${ color('muted') }38`,
      'scrollbarSlider.hoverBackground': `${ color('muted') }66`,
      'scrollbarSlider.activeBackground': `${ color('muted') }8c`,
    },
  };
}
