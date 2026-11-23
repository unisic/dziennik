// The excuse put together on Frekwencja (Attendance.svelte), as the lines of the message to the class tutor.

const dmy = (d) => d.split('-').reverse().join('.');

/** "1-3, 5": the lesson numbers, runs in a row joined. */
const span = (nos) =>
  nos
    .map(Number)
    .sort((p, q) => p - q)
    .reduce((runs, n) => (runs.at(-1)?.at(-1) === n - 1 ? runs.at(-1).push(n) : runs.push([n]), runs), [])
    .map((r) => (r.length > 1 ? `${r[0]}-${r.at(-1)}` : `${r[0]}`))
    .join(', ');

/**
 * The excuse's lines: "data - powód", a day missed in part with its lessons, and whole days in a row with one reason
 * as "od - do - powód". In a row: no school day between them, a day with no entries (a weekend, a break) not being one.
 * `d.days`: each school day's entries, `d.dates`: those days in order; `excuse`: per day ticked, its reason and lessons.
 */
export function lines(d, excuse) {
  const runs = [];
  for (const date of Object.keys(excuse).sort()) {
    const { reason, nos } = excuse[date];
    if (!nos.length) continue;
    const whole = nos.length === d.days.get(date).length;
    const prev = runs.at(-1);
    if (whole && prev?.whole && prev.reason === reason && d.dates[d.dates.indexOf(prev.to) + 1] === date) prev.to = date;
    else runs.push({ from: date, to: date, whole, reason, nos });
  }
  return runs.map((r) =>
    r.from !== r.to
      ? `${dmy(r.from)} - ${dmy(r.to)} - ${r.reason}`
      : r.whole
        ? `${dmy(r.from)} - ${r.reason}`
        : `${dmy(r.from)}, ${r.nos.length > 1 ? 'lekcje' : 'lekcja'} ${span(r.nos)} - ${r.reason}`,
  );
}
