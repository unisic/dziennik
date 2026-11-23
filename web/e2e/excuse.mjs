// The excuse's lines (src/excuse.js): node e2e/excuse.mjs, also in CI.
import assert from 'node:assert/strict';
import { lines } from '../src/excuse.js';

// Friday 6 and Monday 9 November around a weekend, Tuesday 10 with lesson 3 attended, Wednesday 11 a school day.
const lessons = (n) => Array.from({ length: n }, (_, i) => ({ no: String(i + 1) }));
const days = new Map([['2026-11-05', lessons(5)], ['2026-11-06', lessons(4)], ['2026-11-09', lessons(5)], ['2026-11-10', lessons(5)], ['2026-11-11', lessons(5)], ['2026-11-12', lessons(5)]]);
const d = { days, dates: [...days.keys()] };
const all = (date, reason) => ({ reason, nos: days.get(date).map((x) => x.no) });

assert.deepEqual(lines(d, {}), []);
assert.deepEqual(lines(d, { '2026-11-05': all('2026-11-05', 'choroba') }), ['05.11.2026 - choroba']);
// Whole days across a weekend make one line; a day missed in part names its lessons, runs joined.
assert.deepEqual(
  lines(d, { '2026-11-06': all('2026-11-06', 'choroba'), '2026-11-09': all('2026-11-09', 'choroba'), '2026-11-10': { reason: 'choroba', nos: ['1', '2', '4', '5'] } }),
  ['06.11.2026 - 09.11.2026 - choroba', '10.11.2026, lekcje 1-2, 4-5 - choroba'],
);
// Another reason, or a school day between them left out, breaks the run.
assert.deepEqual(lines(d, { '2026-11-05': all('2026-11-05', 'choroba'), '2026-11-06': all('2026-11-06', 'wyjazd') }), ['05.11.2026 - choroba', '06.11.2026 - wyjazd']);
assert.deepEqual(lines(d, { '2026-11-09': all('2026-11-09', 'choroba'), '2026-11-11': all('2026-11-11', 'choroba') }), ['09.11.2026 - choroba', '11.11.2026 - choroba']);
// A ticked day with no lesson left ticked says nothing; one lesson is "lekcja".
assert.deepEqual(lines(d, { '2026-11-11': { reason: 'choroba', nos: [] }, '2026-11-12': { reason: 'choroba', nos: ['3'] } }), ['12.11.2026, lekcja 3 - choroba']);
console.log('excuse: ok');
