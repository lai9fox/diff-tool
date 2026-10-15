import { Change, diff, type DiffConfig } from '@codemirror/merge';

export type ComparisonMethod = 'line' | 'word' | 'character';
export interface DiffStats {
  added: number;
  modified: number;
  deleted: number;
}

const limits = { scanLimit: 10000, timeout: 150 };
const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const words = new Intl.Segmenter('zh', { granularity: 'word' });

// Encode complete tokens so the diff cannot split a grapheme or a logical line.
function tokenDiff(a: string[], b: string[]): readonly Change[] {
  const dictionary = new Map<string, string>();
  const encode = (tokens: string[]) => {
    let text = '';
    const positions: number[] = [];
    for (const [index, token] of tokens.entries()) {
      let symbol = dictionary.get(token);
      if (symbol === undefined) {
        let code = dictionary.size + 0x1000;
        if (code >= 0xd800) code += 0x800;
        symbol = String.fromCodePoint(code);
        dictionary.set(token, symbol);
      }
      for (let i = 0; i < symbol.length; i++) positions.push(index);
      text += symbol;
    }
    positions.push(tokens.length);
    return { text, positions };
  };
  const left = encode(a), right = encode(b);
  return diff(left.text, right.text, limits).map(change => new Change(
    left.positions[change.fromA]!, left.positions[change.toA]!, right.positions[change.fromB]!, right.positions[change.toB]!,
  ));
}

// Keep original coordinates when normalizing CRLF and optionally outer whitespace.
function mapText(input: string, ignoreWhitespace: boolean) {
  let text = '';
  const positions: number[] = [];
  const lines = input.split(/\r?\n/);
  let rawOffset = 0;
  for (const [index, line] of lines.entries()) {
    const leading = ignoreWhitespace ? line.length - line.trimStart().length : 0;
    const content = ignoreWhitespace ? line.trim() : line;
    for (let j = 0; j < content.length; j++) positions.push(rawOffset + leading + j);
    text += content;
    if (index < lines.length - 1) {
      positions.push(rawOffset + line.length);
      text += '\n';
    }
    rawOffset += line.length + (input[rawOffset + line.length] === '\r' ? 2 : 1);
  }
  positions.push(input.length);
  return { text, positions };
}

function characterChanges(a: string, b: string) {
  if (a === b) return [];
  const tokenize = (text: string) => {
    const segments = Array.from(graphemes.segment(text));
    return { tokens: segments.map(s => s.segment), positions: [...segments.map(s => s.index), text.length] };
  };
  const left = tokenize(a), right = tokenize(b);
  return tokenDiff(left.tokens, right.tokens).map(c => new Change(
    left.positions[c.fromA]!, left.positions[c.toA]!, right.positions[c.fromB]!, right.positions[c.toB]!,
  ));
}

function wordChanges(changes: readonly Change[], a: string, b: string) {
  const wordSpans = (text: string) => Array.from(words.segment(text))
    .filter(s => s.isWordLike).map(s => ({ from: s.index, to: s.index + s.segment.length }));
  const left = wordSpans(a), right = wordSpans(b);
  const containing = (spans: ReturnType<typeof wordSpans>, pos: number) => {
    let low = 0, high = spans.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (spans[mid]!.to <= pos) low = mid + 1;
      else high = mid;
    }
    const span = spans[low];
    return span && span.from <= pos ? span : undefined;
  };
  const expanded: Change[] = [];
  changes.forEach((c, index) => {
    const previous = changes[index - 1], next = changes[index + 1];
    const before = Math.min(
      Math.max(c.fromA - (containing(left, c.fromA)?.from ?? c.fromA), c.fromB - (containing(right, c.fromB)?.from ?? c.fromB)),
      c.fromA - (previous?.toA ?? 0),
      c.fromB - (previous?.toB ?? 0),
    );
    const after = Math.min(
      Math.max((c.toA > c.fromA ? containing(left, c.toA - 1)?.to ?? c.toA : c.toA) - c.toA,
        (c.toB > c.fromB ? containing(right, c.toB - 1)?.to ?? c.toB : c.toB) - c.toB),
      (next?.fromA ?? a.length) - c.toA,
      (next?.fromB ?? b.length) - c.toB,
    );
    const change = new Change(c.fromA - before, c.toA + after, c.fromB - before, c.toB + after);
    const last = expanded.at(-1);
    if (last && last.toA >= change.fromA && last.toB >= change.fromB) {
      expanded[expanded.length - 1] = new Change(last.fromA, change.toA, last.fromB, change.toB);
    } else {
      expanded.push(change);
    }
  });
  return expanded;
}

const logicalLines = (text: string) => (text === '' ? [] : text.split('\n'));

function comparisonChanges(a: string, b: string, method: ComparisonMethod) {
  const left = logicalLines(a), right = logicalLines(b);
  const offsets = (lines: string[], length: number) => {
    let pos = 0;
    return [...lines.map(line => {
      const from = pos;
      pos += line.length + 1;
      return from;
    }), length];
  };
  const offsetsA = offsets(left, a.length), offsetsB = offsets(right, b.length);
  const result: Change[] = [];
  for (const lineChange of tokenDiff(left, right)) {
    let fromA = offsetsA[lineChange.fromA]!, fromB = offsetsB[lineChange.fromB]!;
    const toA = offsetsA[lineChange.toA]!, toB = offsetsB[lineChange.toB]!;
    // Appending after the final logical line also inserts its missing delimiter.
    if (lineChange.fromA === left.length && left.length && fromB > 0) fromB--;
    if (lineChange.fromB === right.length && right.length && fromA > 0) fromA--;
    const rowsA = a.slice(fromA, toA).match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const rowsB = b.slice(fromB, toB).match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const paired = Math.min(rowsA.length, rowsB.length);
    for (let index = 0; index < paired; index++) {
      const rowA = rowsA[index]!, rowB = rowsB[index]!;
      let changes = characterChanges(rowA, rowB);
      if (method === 'word') changes = wordChanges(changes, rowA, rowB);
      for (const change of changes) {
        result.push(new Change(fromA + change.fromA, fromA + change.toA, fromB + change.fromB, fromB + change.toB));
      }
      fromA += rowA.length;
      fromB += rowB.length;
    }
    if (fromA < toA || fromB < toB) result.push(new Change(fromA, toA, fromB, toB));
  }
  return result;
}

export function diffConfig(ignoreWhitespace: boolean, method: ComparisonMethod = 'character'): DiffConfig {
  return {
    ...limits,
    // Local dependency patch prevents CodeMirror from overriding explicit granularity.
    preserveChanges: true,
    override(a, b) {
      const left = mapText(a, ignoreWhitespace), right = mapText(b, ignoreWhitespace);
      return comparisonChanges(left.text, right.text, method).map(c => new Change(
        left.positions[c.fromA]!, left.positions[c.toA]!, right.positions[c.fromB]!, right.positions[c.toB]!,
      ));
    },
  };
}

export function diffStats(a: string, b: string, ignoreWhitespace = false): DiffStats {
  const lines = (text: string) => logicalLines(mapText(text, ignoreWhitespace).text);
  const stats: DiffStats = { added: 0, modified: 0, deleted: 0 };
  for (const change of tokenDiff(lines(a), lines(b))) {
    const removed = change.toA - change.fromA, inserted = change.toB - change.fromB;
    const modified = Math.min(removed, inserted);
    stats.modified += modified;
    stats.added += inserted - modified;
    stats.deleted += removed - modified;
  }
  return stats;
}
