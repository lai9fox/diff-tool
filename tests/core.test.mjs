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
  for (const chunk of differences) for (const change of chunk.changes) {
    assert.ok(chunk.fromA + change.fromA >= 0);
    assert.ok(chunk.fromA + change.toA <= left.length);
    assert.ok(chunk.fromB + change.toB <= right.length);
  }
});
