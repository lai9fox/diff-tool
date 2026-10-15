import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Text } from '@codemirror/state';
import { Chunk } from '@codemirror/merge';
import { diffConfig } from '../src/lib/editor.ts';

const chunks = (a, b, ignore = false) => Chunk.build(Text.of(a.split('\n')), Text.of(b.split('\n')), diffConfig(ignore));

test('identical texts produce 0 diff chunks (A01)', () => {
  assert.equal(chunks('hello world\nline 2', 'hello world\nline 2').length, 0);
  assert.equal(chunks('', '').length, 0);
});

test('outer whitespace is ignored without ignoring interior whitespace or blank lines (A09)', () => {
  assert.equal(chunks('  hello  \n\tworld\n', 'hello\nworld\n', true).length, 0);
  assert.ok(chunks('  hello  \nworld\n', 'hello\nworld\n').length);
  assert.ok(chunks('hello world', 'helloworld', true).length);
  assert.ok(chunks('hello\n\nworld', 'hello\nworld', true).length);
});

test('CRLF and LF are treated as identical line endings without ignoring blank lines (A10)', () => {
  assert.equal(chunks('line 1\r\nline 2\r\n', 'line 1\nline 2\n').length, 0);
  assert.ok(chunks('line 1\r\n\r\nline 2', 'line 1\nline 2').length > 0);
});

test('chinese character-level diff marks only changed characters (A03)', () => {
  const cnA = '这是第一段很长很长的中文文本，里面包含了许多文字和内容，今天天气真不错。';
  const cnB = '这是第一段很长很长的中文文本，里面包含了许多文字和内容，今天天气真糟糕。';
  const diffs = chunks(cnA, cnB);
  assert.equal(diffs.length, 1);
  const chunk = diffs[0];
  assert.equal(chunk.changes.length, 1);
  const change = chunk.changes[0];
  const changedTextA = cnA.slice(chunk.fromA + change.fromA, chunk.fromA + change.toA);
  const changedTextB = cnB.slice(chunk.fromB + change.fromB, chunk.fromB + change.toB);
  assert.equal(changedTextA, '不错');
  assert.equal(changedTextB, '糟糕');
});

test('JSON text with different field order is compared as raw text (A14)', () => {
  const jsonA = '{\n  "name": "Diff",\n  "version": 1\n}';
  const jsonB = '{\n  "version": 1,\n  "name": "Diff"\n}';
  const diffs = chunks(jsonA, jsonB);
  assert.ok(diffs.length > 0);
});

test('mapped changes remain in original text coordinates', () => {
  const left = '  配置为浅色  \n  wrap: false', right = '配置为深色\nwrap: true  ';
  const differences = chunks(left, right, true);
  assert.ok(differences.length);
  for (const chunk of differences) {
    for (const change of chunk.changes) {
      assert.ok(chunk.fromA + change.fromA >= 0);
      assert.ok(chunk.fromA + change.toA <= left.length);
      assert.ok(chunk.fromB + change.toB <= right.length);
    }
  }
});

// Statistics count complete logical lines, independently of highlight granularity.
test('line statistics distinguish insertions, deletions, and paired replacements', async () => {
  const { diffStats } = await import('../src/lib/diff.ts');
  assert.deepEqual(diffStats('', ''), { added: 0, modified: 0, deleted: 0 });
  assert.deepEqual(diffStats('', 'first\nsecond'), { added: 2, modified: 0, deleted: 0 });
  assert.deepEqual(diffStats('first\nsecond', ''), { added: 0, modified: 0, deleted: 2 });
  assert.deepEqual(diffStats('old one\nold two', 'new one\nnew two\nnew three'), { added: 1, modified: 2, deleted: 0 });
  assert.deepEqual(diffStats('old one\nold two\nold three', 'new one'), { added: 0, modified: 1, deleted: 2 });
  assert.deepEqual(diffStats('start\nremove\nkeep\nold\nend', 'start\nkeep\nnew\nextra\nend'), { added: 1, modified: 1, deleted: 1 });
});

test('line statistics preserve blank lines and respect the existing comparison rules', async () => {
  const { diffStats } = await import('../src/lib/diff.ts');
  const zero = { added: 0, modified: 0, deleted: 0 };
  assert.deepEqual(diffStats('a\r\nb\r\n', 'a\nb\n'), zero);
  assert.deepEqual(diffStats('  a \n\tb ', 'a\nb', true), zero);
  assert.deepEqual(diffStats('', ' \t ', true), zero);
  assert.deepEqual(diffStats('a\n\nb', 'a\nb', true), { added: 0, modified: 0, deleted: 1 });
  assert.deepEqual(diffStats('a b', 'ab', true), { added: 0, modified: 1, deleted: 0 });
  assert.deepEqual(diffStats('a', 'a\n'), { added: 1, modified: 0, deleted: 0 });
});

const chunksWithMethod = (a, b, method) => Chunk.build(Text.of(a.split('\n')), Text.of(b.split('\n')), diffConfig(false, method));

const markedText = (a, b, method) => chunksWithMethod(a, b, method).flatMap(chunk =>
  chunk.changes.map(c => [
    a.slice(chunk.fromA + c.fromA, chunk.fromA + c.toA),
    b.slice(chunk.fromB + c.fromB, chunk.fromB + c.toB),
  ]),
);

test('character mode preserves exact changes and word mode highlights complete words', () => {
  assert.deepEqual(markedText('color = 12', 'colour = 13', 'character'), [['', 'u'], ['2', '3']]);
  assert.deepEqual(markedText('color = 12', 'colour = 13', 'word'), [['color', 'colour'], ['12', '13']]);
  assert.deepEqual(markedText('cat', 'cats', 'word'), [['cat', 'cats']]);
  assert.deepEqual(markedText('hello world', 'hello brave world', 'word'), [['', 'brave ']]);
  assert.deepEqual(markedText('abcdef', 'abXdeY', 'word'), [['abcdef', 'abXdeY']]);
});

test('character mode keeps emoji sequences and combining characters intact', () => {
  assert.deepEqual(markedText('👍🏻', '👍🏽', 'character'), [['👍🏻', '👍🏽']]);
  assert.deepEqual(markedText('e\u0301', 'e\u0300', 'character'), [['e\u0301', 'e\u0300']]);
  assert.equal(/\p{Alphabetic}/u.test('中'), true, 'diff code must not modify global RegExp behavior');
});

test('switching highlight methods preserves changed line ranges', () => {
  const a = 'start\ncolor = 12\nkeep\nremove\nend';
  const b = 'start\ncolour = 13\nkeep\nend\nnew';
  const ranges = method => chunksWithMethod(a, b, method).map(c => [c.fromA, c.toA, c.fromB, c.toB]);
  assert.deepEqual(ranges('word'), ranges('line'));
  assert.deepEqual(ranges('character'), ranges('line'));
});

test('granularity changes keep unchanged gaps aligned and coordinates valid', () => {
  const samples = ['', 'cat', 'cats', 'cat dog', '你好世界', '你好，世界', '👍🏻 e\u0301', 'a\nb\nc', 'a\n\nb', 'a\n', '\n', 'a\n\nb\n'];
  for (const a of samples) {
    for (const b of samples) {
      for (const method of ['word', 'character']) {
        const changes = diffConfig(false, method).override(a, b);
        let posA = 0, posB = 0;
        for (const c of changes) {
          assert.ok(c.fromA >= posA && c.toA >= c.fromA && c.toA <= a.length);
          assert.ok(c.fromB >= posB && c.toB >= c.fromB && c.toB <= b.length);
          assert.equal(a.slice(posA, c.fromA), b.slice(posB, c.fromB));
          posA = c.toA;
          posB = c.toB;
        }
        assert.equal(a.slice(posA), b.slice(posB));
      }
    }
  }
});

test('inline highlights follow line alignment across deletions and later insertions', () => {
  const a = 'const theme = \'light\';\nconst retries = 3;\nconst legacy = true;\n\nexport const enabled = true;';
  const b = 'const theme = \'dark\';\nconst retries = 5;\n\nexport const enabled = true;\nexport const timeout = 5000;';
  const config = diffConfig(false, 'character');
  const changes = config.override(a, b);
  const unchangedA = a.indexOf('export const enabled');
  const unchangedB = b.indexOf('export const enabled');
  for (const change of changes) {
    assert.ok(change.toA <= unchangedA || change.fromA >= unchangedA + 'export const enabled = true;'.length);
    assert.ok(change.toB <= unchangedB || change.fromB >= unchangedB + 'export const enabled = true;'.length);
  }
});
