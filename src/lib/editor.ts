import { Change, Chunk, diff, type DiffConfig } from '@codemirror/merge';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { yaml } from '@codemirror/lang-yaml';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { markdown } from '@codemirror/lang-markdown';

// Prevent @codemirror/merge from treating continuous CJK ideographs as single long words
// which would incorrectly expand 2-character changes to entire 50-character sentences.
const isCjk = (str: unknown): boolean => {
  if (typeof str !== 'string' || !str.length) return false;
  const code = str.charCodeAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x3040 && code <= 0x30ff) || // Hiragana & Katakana
    (code >= 0xac00 && code <= 0xd7af)    // Hangul Syllables
  );
};

const origRegExpTest = RegExp.prototype.test;
RegExp.prototype.test = function (str: string) {
  if (this.source && this.source.includes('Alphabetic') && isCjk(str)) {
    return false;
  }
  return origRegExpTest.call(this, str);
};

export function detectLanguage(text: string, filename = '') {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'json' || /^[\s]*[\[{]/.test(text)) return 'JSON';
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext || '') || /(^|\n)\s*(import |export |const |let |function )/.test(text)) return 'JavaScript';
  if (['yml', 'yaml'].includes(ext || '') || /(^|\n)\s*[\w.-]+:\s+[^\n]+/.test(text)) return 'YAML';
  if (['html', 'vue', 'xml', 'svg'].includes(ext || '') || /^\s*</.test(text)) return 'HTML';
  if (ext === 'css') return 'CSS';
  if (ext === 'py' || /(^|\n)(def |from \w+ import )/.test(text)) return 'Python';
  if (ext === 'sql' || /^\s*(SELECT|CREATE TABLE|INSERT INTO)\b/i.test(text)) return 'SQL';
  if (ext === 'md' || /^#{1,6} /.test(text)) return 'Markdown';
  return 'text';
}

export function languageExtension(name: string) {
  switch (name) {
    case 'JSON': return json();
    case 'JavaScript': return javascript({ typescript: true, jsx: true });
    case 'YAML': return yaml();
    case 'HTML': return html();
    case 'CSS': return css();
    case 'Python': return python();
    case 'SQL': return sql();
    case 'Markdown': return markdown();
    default: return [];
  }
}

// Map text to handle CRLF/LF equivalency and optional outer whitespace trimming.
// All resulting diff coordinates are mapped back to original text coordinates.
export function mapText(input: string, ignoreWhitespace: boolean) {
  let text = '';
  const positions: number[] = [];
  const lines = input.split(/\r?\n/);
  let rawOffset = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const origLen = line.length;
    let newlineLen = 0;
    if (rawOffset + origLen < input.length) {
      if (input.slice(rawOffset + origLen, rawOffset + origLen + 2) === '\r\n') {
        newlineLen = 2;
      } else if (input[rawOffset + origLen] === '\n') {
        newlineLen = 1;
      }
    }

    if (ignoreWhitespace) {
      const leadingLen = line.length - line.trimStart().length;
      const trimmed = line.trim();
      for (let j = 0; j < trimmed.length; j++) {
        positions.push(rawOffset + leadingLen + j);
      }
      text += trimmed;
    } else {
      for (let j = 0; j < line.length; j++) {
        positions.push(rawOffset + j);
      }
      text += line;
    }

    if (index < lines.length - 1) {
      positions.push(rawOffset + origLen);
      text += '\n';
    }
    rawOffset += origLen + newlineLen;
  }

  positions.push(input.length);
  return { text, positions };
}

export function diffConfig(ignoreWhitespace: boolean): DiffConfig {
  const limits = { scanLimit: 10000, timeout: 150 };
  return {
    ...limits,
    override(a, b) {
      if (!ignoreWhitespace && !a.includes('\r') && !b.includes('\r')) {
        return diff(a, b, limits);
      }
      const left = mapText(a, ignoreWhitespace);
      const right = mapText(b, ignoreWhitespace);
      return diff(left.text, right.text, limits).map(c => new Change(
        left.positions[c.fromA] ?? a.length,
        left.positions[c.toA] ?? a.length,
        right.positions[c.fromB] ?? b.length,
        right.positions[c.toB] ?? b.length,
      ));
    },
  };
}

export const activeDiffLine = Decoration.line({ class: 'cm-active-diff-chunk' });
export const setActiveChunkEffect = StateEffect.define<DecorationSet>();

export const activeChunkField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setActiveChunkEffect)) {
        return effect.value;
      }
    }
    return deco.map(tr.changes);
  },
  provide: f => EditorView.decorations.from(f),
});

export function buildActiveChunkDecoration(view: EditorView, chunk?: Chunk, isSideA?: boolean): DecorationSet {
  if (!chunk) return Decoration.none;
  const from = isSideA ? chunk.fromA : chunk.fromB;
  const to = isSideA ? chunk.endA : chunk.endB;
  const doc = view.state.doc;
  const startLine = doc.lineAt(Math.min(from, doc.length));
  const endLine = doc.lineAt(Math.min(to, doc.length));
  const builder: ReturnType<typeof activeDiffLine.range>[] = [];
  for (let l = startLine.number; l <= endLine.number; l++) {
    const line = doc.line(l);
    builder.push(activeDiffLine.range(line.from));
  }
  return Decoration.set(builder);
}

export function editorTheme(dark: boolean) {
  return [
    EditorView.theme({
      '&': { backgroundColor: 'var(--panel)', color: 'var(--text)', fontSize: '14px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-content': { fontFamily: 'var(--font-code)', padding: '20px 0', caretColor: 'var(--accent)', minHeight: '100%' },
      '.cm-line': { padding: '0 16px 0 12px', lineHeight: '22px' },
      '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '22px' },
      '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none', paddingTop: '0' },
      '.cm-lineNumbers .cm-gutterElement': { minWidth: '40px', padding: '0 10px 0 8px' },
      '.cm-cursor': { borderLeftColor: 'var(--accent)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
      '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
      '.cm-activeLineGutter': { color: 'var(--text)', backgroundColor: 'var(--active-line)' },

      // Diff styling for split and unified
      '&.cm-merge-a .cm-changedLine, .cm-deletedChunk, .cm-deletedLine': { backgroundColor: 'var(--remove-bg)' },
      '&.cm-merge-b .cm-changedLine, .cm-insertedLine': { backgroundColor: 'var(--add-bg)' },
      '.cm-changedLine': { backgroundColor: 'var(--add-bg)' },
      '&.cm-merge-a .cm-changedLine': { backgroundColor: 'var(--remove-bg)' },
      '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': { backgroundColor: 'var(--remove-mark)', backgroundImage: 'none' },
      '&.cm-merge-b .cm-changedText, .cm-changedText': { backgroundColor: 'var(--add-mark)', backgroundImage: 'none' },
      '&.cm-merge-a .cm-changedText': { backgroundColor: 'var(--remove-mark)' },

      '.cm-deletedChunk': { padding: '0 16px 0 12px', fontFamily: 'var(--font-code)' },
      '.cm-deletedLine': { lineHeight: '22px' },
      '.cm-collapsedLines': { margin: '6px 0', padding: '7px 12px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--muted)', fontFamily: 'var(--font-ui)', fontSize: '12px', cursor: 'pointer', transition: 'background-color 0.15s, color 0.15s' },
      '.cm-collapsedLines:hover': { color: 'var(--accent)', backgroundColor: 'var(--accent-soft)' },
      '.cm-changeGutter': { width: '18px' },
      '.cm-changedLineGutter, .cm-deletedLineGutter, .cm-inlineChangedLineGutter': { backgroundColor: 'transparent !important', color: 'var(--add)', textAlign: 'center', width: '18px', fontWeight: '600' },
      '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': { color: 'var(--remove)' },
      '.cm-changedLineGutter::before, .cm-insertedLineGutter::before': { content: '"+"' },
      '&.cm-merge-a .cm-changedLineGutter::before, .cm-deletedLineGutter::before': { content: '"−"' },

      // Active diff chunk indicator
      '.cm-active-diff-chunk': { boxShadow: 'inset 3.5px 0 0 var(--accent)' },
    }, { dark }),
    syntaxHighlighting(HighlightStyle.define([
      { tag: [tags.keyword, tags.modifier], color: dark ? '#B9A3F1' : '#7853A4' },
      { tag: [tags.string, tags.special(tags.string)], color: dark ? '#A8D2B4' : '#4C7353' },
      { tag: [tags.number, tags.bool, tags.null], color: dark ? '#E6BD8A' : '#A36529' },
      { tag: [tags.propertyName, tags.attributeName], color: dark ? '#A0BFEB' : '#375E8F' },
      { tag: tags.comment, color: dark ? '#9AA6B6' : '#788494' },
      { tag: [tags.tagName, tags.function(tags.variableName)], color: dark ? '#8ACFCC' : '#357675' },
    ])),
  ];
}

export const accessibleCollapse = ViewPlugin.fromClass(class {
  observer: MutationObserver;
  constructor(view: EditorView) {
    const enhance = () => {
      view.dom.querySelectorAll<HTMLElement>('.cm-collapsedLines:not([role])').forEach(element => {
        element.setAttribute('role', 'button');
        element.tabIndex = 0;
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            element.click();
          }
        });
      });
    };
    this.observer = new MutationObserver(enhance);
    this.observer.observe(view.dom, { childList: true, subtree: true });
    queueMicrotask(enhance);
  }
  destroy() { this.observer.disconnect(); }
});
