import test from 'node:test';
import assert from 'node:assert/strict';
import { stableStringify, formatDuration, wrapLine, chunkLines } from '../src/lib/core.js';

test('stableStringify sorts object keys deterministically', () => {
  const a = stableStringify({ b: 2, a: 1, nested: { z: 9, c: 3 } });
  const b = stableStringify({ nested: { c: 3, z: 9 }, a: 1, b: 2 });
  assert.equal(a, b);
});

test('formatDuration renders hh:mm:ss', () => {
  assert.equal(formatDuration(3661), '01:01:01');
});

test('wrapLine wraps long text', () => {
  const out = wrapLine('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau', 20);
  assert.ok(out.length > 2);
  assert.ok(out.every((line) => line.length <= 20));
});

test('chunkLines chunks predictably', () => {
  const pages = chunkLines(['a', 'b', 'c', 'd', 'e'], 2);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages[0], ['a', 'b']);
});
