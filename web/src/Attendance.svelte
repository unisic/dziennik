<script>
  import { synergia, lookup, resource, byId, prefill } from './api.svelte.js';
  import { schoolPlan } from './data.js';
  import { fmtDate, fmtDay, fmtPercent, choiceOf, ATTENDANCE, parse, today, shift, plural } from './util.js';
  import Async from './Async.svelte';
  import Icon from './Icon.svelte';
  import { swipe } from './swipe.js';
  import { lines } from './excuse.js';
  import { t, locale } from './i18n.js';

  let { login } = $props();

  // Standard attendance types in Synergia; school-defined types point at one through StandardType.
  const PRESENCE = 100;
  const UNEXCUSED = 1;
  const ABSENCES = new Set([UNEXCUSED, 3]);
  /** The tint of a kind's mark, as picked in "Ustawienia" (util.js); a kind a school made up is grey. */
  const tones = new Map([...ATTENDANCE].map(([std, kind]) => [std, choiceOf(kind)]));
  const tone = (std) => tones.get(std) ?? 'g0';
  const pct = (absent, all) => (all ? fmtPercent((all - absent) / all) : '');

  async function load(login) {
    const [a, ty, ls, s] = await Promise.all([
      synergia(login, 'Attendances'),
      lookup(login, 'Attendances/Types'),
      lookup(login, 'Lessons'),
      lookup(login, 'Subjects'),
    ]);
    const [types, lessons, subjects] = [byId(ty.Types), byId(ls.Lessons), byId(s.Subjects)];
    const all = (a.Attendances ?? []).map((x) => {
      const type = types.get(String(x.Type?.Id));
      const std = Number(type ? (type.Standard ? type.Id : type.StandardType?.Id) : x.Type?.Id);
      const subject = subjects.get(String(lessons.get(String(x.Lesson?.Id))?.Subject?.Id))?.Name ?? t('Inne');
      return { id: x.Id, date: x.Date, no: x.LessonNo, std, subject, sem: Number(x.Semester) === 2 ? 2 : 1, name: type?.Name ?? t('Nieznany'), short: type?.Short ?? '?' };
    });
    const entries = all
      .filter((x) => x.std !== PRESENCE)
      .sort((p, q) => q.date.localeCompare(p.date) || Number(q.no) - Number(p.no));
    // Both kinds of absence are always listed, a zero included: whether any is unexcused is what the screen is for.
    const kinds = new Map([...ATTENDANCE].map(([std, k]) => [std, { std, label: k.label, word: k.word, short: types.get(String(std))?.Short ?? '', n: 0 }]));
    for (const e of entries) {
      // A kind this list does not know keeps the school's own name for it.
      if (!kinds.has(e.std)) kinds.set(e.std, { std: e.std, label: e.name, short: e.short, n: 0 });
      kinds.get(e.std).n++;
    }
    const per = new Map();
    for (const x of all) {
      // Lessons held and missed: in the whole year, then in the first and the second semester.
      const v = per.get(x.subject) ?? { counts: [[0, 0], [0, 0], [0, 0]], unexcused: 0 };
      for (const c of [v.counts[0], v.counts[x.sem]]) {
        c[0]++;
        if (ABSENCES.has(x.std)) c[1]++;
      }
      if (x.std === UNEXCUSED) v.unexcused++;
      per.set(x.subject, v);
    }
    const absent = all.filter((x) => ABSENCES.has(x.std)).length;
    // Each day's lessons in their order, presence included, for the calendar.
    const days = new Map();
    for (const x of [...all].sort((p, q) => Number(p.no) - Number(q.no))) (days.get(x.date) ?? days.set(x.date, []).get(x.date)).push(x);
    const dates = [...days.keys()].sort();
    return {
      days,
      dates,
      last: dates.at(-1),
      missed: dates.filter((d) => days.get(d).some((x) => x.std === UNEXCUSED)).reverse(),
      total: pct(absent, all.length),
      kinds: [...kinds.values()].filter((k) => k.n || ABSENCES.has(k.std)),
      subjects: [...per]
        .map(([name, { counts, unexcused }]) => ({ name, counts, unexcused, excused: counts[0][1] - unexcused, pct: pct(counts[0][1], counts[0][0]) }))
        .sort((p, q) => q.unexcused - p.unexcused || q.excused - p.excused || p.name.localeCompare(q.name, 'pl')),
      entries,
    };
  }

  const data = resource(() => load(login), () => `attendance/${login}`);
  const plan = resource(() => schoolPlan(login), () => `school-plan/${login}`);

  /**
   * The calculator's periods: the current semester when the class has the end of the first one, then the year. Each
   * with its end, its school days left from tomorrow, and per subject the lessons attended, missed and left, and how
   * many of those can still be missed with absences at most half of all (over half, a student may stay unclassified
   * in the subject: art. 44k ustawy o systemie oświaty). The least to spare comes first.
   */
  function periods(subjects, p) {
    const sem = p.half && today() > p.half ? 2 : 1;
    const end = p.dates.at(-1) ?? '';
    const list = [...(p.half ? [[sem, sem === 1 ? p.half : end, sem === 1 ? t('I semestr') : t('II semestr')]] : []), [0, end, t('Rok')]];
    return list.map(([k, until, label]) => {
      const dates = p.dates.filter((d) => d <= until);
      const left = new Map();
      for (const d of dates) for (const name of p.plan[parse(d).getDay()] ?? []) left.set(name, (left.get(name) ?? 0) + 1);
      const held = new Map(subjects.map((s) => [s.name, s.counts[k]]));
      // Only subjects still in the plan: for the rest nothing is left to decide.
      const rows = [...left].map(([name, rest]) => {
        const [all, absent] = held.get(name) ?? [0, 0];
        return { name, present: all - absent, absent, left: rest, skip: Math.floor((all + rest) / 2) - absent };
      });
      const spare = (r) => (r.skip >= r.left ? Infinity : r.skip);
      rows.sort((p, q) => spare(p) - spare(q) || p.name.localeCompare(q.name, 'pl'));
      return { label, until: dates.at(-1), days: dates.length, rows };
    });
  }
  /** The period the calculator shows, by its place in `periods`. */
  let period = $state(0);
  /** The kind the list of entries is narrowed to, or null for all of them. */
  let only = $state(null);

  const todayIso = today();
  const ym = (d) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) });
  const WEEKDAYS = [t('Pn'), t('Wt'), t('Śr'), t('Cz'), t('Pt'), t('So'), t('Nd')];
  /** The calendar's month as picked; none: this one, or the last with entries once the school year is over. */
  let month = $state(null);
  const last = $derived(data.data?.last);
  const shown = $derived(month ?? ym(last && last < todayIso ? last : todayIso));
  /** The day whose lessons are listed under the month. */
  let picked = $state(null);
  const cal = $derived.by(() => {
    const first = `${shown.y}-${String(shown.m).padStart(2, '0')}-01`;
    const days = Array.from({ length: new Date(shown.y, shown.m, 0).getDate() }, (_, i) => shift(first, i));
    // Monday first: the empty cells before the 1st and after the last day.
    const lead = (parse(first).getDay() + 6) % 7;
    return { days, lead, trail: (7 - ((lead + days.length) % 7)) % 7, label: parse(first).toLocaleDateString(locale, { month: 'long', year: 'numeric' }) };
  });
  function move(delta) {
    const d = new Date(shown.y, shown.m - 1 + delta, 1);
    month = { y: d.getFullYear(), m: d.getMonth() + 1 };
    picked = null;
  }
  const dayLabel = (d, list) => [fmtDay(d), ...list.filter((e) => e.std !== PRESENCE).map((e) => `${e.subject}: ${e.name}`)].join(', ');

  /** The message's own words, in Polish whatever the screen's language: it goes to a Polish school. */
  const REASONS = [
    ['choroba', t('choroba')],
    ['złe samopoczucie', t('złe samopoczucie')],
    ['wizyta u lekarza', t('wizyta u lekarza')],
    ['sprawy rodzinne', t('sprawy rodzinne')],
    ['wyjazd', t('wyjazd')],
    ['inne', t('inne')],
  ];
  /** The excuse being put together: per day ticked, its reason (`other`: the words typed for "inne") and lessons. */
  let excuse = $state({});
  /** The excuse with each "inne" in the words typed for it. */
  const worded = (excuse) =>
    Object.fromEntries(Object.entries(excuse).map(([date, x]) => [date, { ...x, reason: x.reason === 'inne' ? x.other.trim() || 'inne' : x.reason }]));
  function tick(date, nos, on) {
    if (on) excuse[date] = { reason: REASONS[0][0], other: '', nos };
    else delete excuse[date];
  }
  function tickLesson(date, no, on) {
    const x = excuse[date];
    x.nos = on ? [...x.nos, no] : x.nos.filter((n) => n !== no);
  }
  /** Opens a new message to the class tutor with the excuse in it, to be read over and sent by hand. */
  async function writeExcuse(text) {
    // Without the class or the people the message opens with no receiver, to be picked in the form.
    const [c, u] = await Promise.all([lookup(login, 'Classes'), lookup(login, 'Users')]).catch(() => [{}, {}]);
    const users = byId(u.Users ?? []);
    const to = (c.Class?.ClassTutors ?? []).map((x) => users.get(String(x.Id))).filter(Boolean).map((p) => `${p.FirstName} ${p.LastName}`);
    prefill.set({ subject: 'Usprawiedliwienie nieobecności', body: `Dzień dobry,\nproszę o usprawiedliwienie nieobecności:\n\n${text}\n\nZ poważaniem`, to });
    location.hash = '#/wiadomosci/nowa';
  }

  let below = $state();
  // On a phone the picked day is under the month, out of sight: scrolled up just enough to be seen.
  $effect(() => {
    if (picked) below?.scrollIntoView({ block: 'nearest' });
  });
</script>

<Async r={data}>
  {#snippet children(d)}
    {@const all = plan.data ? periods(d.subjects, plan.data).filter((x) => x.days) : []}
    {#if all.length}
      {@const p = all[Math.min(period, all.length - 1)]}
      <section class="card">
        <h2>{t('Ile możesz opuścić')}</h2>
        {#if all.length > 1}
          <div class="segmented" role="group" aria-label={t('Okres')}>
            {#each all as x, i (x.label)}<button aria-pressed={p === x} onclick={() => (period = i)}>{x.label}</button>{/each}
          </div>
        {/if}
        <p class="muted">{t('{n} {days} do {date}', { n: p.days, days: plural(p.days, ['dzień nauki', 'dni nauki', 'dni nauki']), date: fmtDate(p.until) })}</p>
        <ul class="skips">
          {#each p.rows as r (r.name)}
            {@const total = r.present + r.absent + r.left}
            {@const low = r.skip <= 0}
            <li>
              <span>{r.name}</span>
              <strong class:alert={low}>{Math.max(0, Math.min(r.skip, r.left))}</strong>
              <span class="meter" role="img" aria-label={t('obecności: {present}, nieobecności: {absent}, do końca: {left}', r)}
                ><span class="present" style:width="{(100 * r.present) / total}%"></span><span class="absent" style:width="{(100 * r.absent) / total}%"></span></span
              >
              <small class:alert={low}
                >{r.skip < 0
                  ? t('za dużo nieobecności, nie do nadrobienia')
                  : r.skip >= r.left
                    ? t('połowa obecności już pewna')
                    : t('musisz być na {need} z\u00a0{left}', { need: r.left - r.skip, left: r.left })}</small
              >
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    <section class="card">
      <h2>{t('Podsumowanie')}</h2>
      {#if d.total}<p class="figure"><strong>{d.total}</strong> {t('obecności')}</p>{/if}
      <ul class="totals">
        {#each d.kinds as k (k.std)}
          <li>
            <span class="kind"><span class="chip static {tone(k.std)}">{k.short}</span> {k.label}</span>
            <strong class:alert={k.std === UNEXCUSED && k.n > 0}>{k.n}</strong>
          </li>
        {/each}
      </ul>
      {#if !d.total}<p class="muted">{t('Brak wpisów frekwencji.')}</p>{/if}
    </section>
    {#if d.days.size}
      <!-- Not a section: the tests count the cards from the end of the page. -->
      <div>
        <h2 class="section">{t('Kalendarz')}</h2>
        <div class="pager">
          <button class="icon-btn" onclick={() => move(-1)} aria-label={t('Poprzedni miesiąc')} title={t('Poprzedni miesiąc')}><Icon name="left" /></button>
          <h3 class="range" aria-live="polite">{cal.label}</h3>
          <button class="icon-btn" onclick={() => move(1)} aria-label={t('Następny miesiąc')} title={t('Następny miesiąc')}><Icon name="right" /></button>
          <button class="secondary now" onclick={() => ((month = ym(todayIso)), (picked = null))} disabled={shown.y === ym(todayIso).y && shown.m === ym(todayIso).m && !picked}
            >{t('Dziś')}</button
          >
        </div>
        <div class="card month" use:swipe={{ prev: () => move(-1), next: () => move(1) }}>
          <div class="weekdays" aria-hidden="true">
            {#each WEEKDAYS as w (w)}<span>{w}</span>{/each}
          </div>
          <div class="grid" role="group" aria-label={t('Dni miesiąca')}>
            {#each { length: cal.lead }}<span></span>{/each}
            {#each cal.days as day (day)}
              {@const list = d.days.get(day) ?? []}
              <button
                class:weekend={parse(day).getDay() % 6 === 0}
                aria-pressed={day === picked}
                aria-current={day === todayIso ? 'date' : undefined}
                aria-label={dayLabel(day, list)}
                onclick={() => (picked = day === picked ? null : day)}
              >
                <span class="num">{parse(day).getDate()}</span>
                <span class="bars">{#each list as e (e.id)}<span class={e.std === PRESENCE ? 'present' : tone(e.std)}></span>{/each}</span>
              </button>
            {/each}
            {#each { length: cal.trail }}<span></span>{/each}
          </div>
        </div>
        {#if picked}
          {@const list = d.days.get(picked) ?? []}
          <div class="card" bind:this={below}>
            <h2 class="day">{fmtDay(picked)}</h2>
            {#if list.length}
              <ul class="entries">
                {#each list as e (e.id)}
                  <li>
                    <span class="chip static {e.std === PRESENCE ? '' : tone(e.std)}" title={e.name}>{e.short}</span>
                    <span>{e.subject}<small class="muted">{t('lekcja {no}', { no: e.no })}</small></span>
                    <span class="vh">{e.name}</span>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="muted">{t('Tego dnia nic nie ma.')}</p>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
    {#if d.missed.length}
      {@const text = lines(d, worded(excuse))}
      <div class="card excuse">
        <h2>{t('Usprawiedliwienie')}</h2>
        <p class="muted">{t('Zaznacz nieobecności nieusprawiedliwione i powód: aplikacja napisze z nich wiadomość do wychowawcy.')}</p>
        <ul>
          {#each d.missed as date (date)}
            {@const own = d.days.get(date).filter((e) => e.std === UNEXCUSED)}
            <li>
              <label class="check"><input type="checkbox" checked={!!excuse[date]} onchange={(e) => tick(date, own.map((x) => x.no), e.currentTarget.checked)} />{fmtDay(date)}</label>
              {#if excuse[date]}
                {#each own as e (e.id)}
                  <label class="check sub"
                    ><input type="checkbox" checked={excuse[date].nos.includes(e.no)} onchange={(x) => tickLesson(date, e.no, x.currentTarget.checked)} />{t('lekcja {no}', { no: e.no })}, {e.subject}</label
                  >
                {/each}
                <select aria-label={t('Powód: {day}', { day: fmtDay(date) })} bind:value={excuse[date].reason}>
                  {#each REASONS as [v, label] (v)}<option value={v}>{label}</option>{/each}
                </select>
                {#if excuse[date].reason === 'inne'}
                  <input aria-label={t('Inny powód: {day}', { day: fmtDay(date) })} placeholder={t('Wpisz powód')} maxlength="200" bind:value={excuse[date].other} />
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
        {#if text.length}
          <pre>{text.join('\n')}</pre>
          <button class="primary wide" onclick={() => writeExcuse(text.join('\n'))}>{t('Napisz do wychowawcy')}</button>
        {/if}
      </div>
    {/if}
    {#if d.subjects.length}
      <section class="card">
        <h2>{t('Obecność na przedmiotach')}</h2>
        <ul class="totals">
          {#each d.subjects as s (s.name)}
            <li>
              <span>{s.name}</span>
              <span class="muted">
                {#if s.unexcused}<span class="alert">{t('{n} nieuspr.', { n: s.unexcused })}</span>{/if}
                {#if s.excused}<span>{t('{n} uspr.', { n: s.excused })}</span>{/if}
                <span class="pct">{s.pct}</span>
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if d.entries.length}
      <section class="card">
        <h2>{t('Wpisy')}</h2>
        {#if d.kinds.filter((k) => k.n).length > 1}
          <!-- No counts (the summary above has them); words shortened on a phone and a tablet, so the usual kinds fit one row. -->
          <div class="segmented filter" role="group" aria-label={t('Rodzaj wpisu')}>
            <button aria-pressed={only === null} onclick={() => (only = null)}>{t('Wszystkie')}</button>
            {#each d.kinds.filter((k) => k.n) as k (k.std)}
              <button aria-pressed={only === k.std} aria-label={k.word ? `${k.word}, ${k.label}` : undefined} title={k.label} onclick={() => (only = k.std)}
                >{#if k.word}<span class="narrow">{k.word}</span><span class="wide">{k.label}</span>{:else}{k.label}{/if}</button
              >
            {/each}
          </div>
        {/if}
        <ul class="entries">
          {#each only === null ? d.entries : d.entries.filter((e) => e.std === only) as e (e.id)}
            <li>
              <span class="chip static {tone(e.std)}" title={e.name}>{e.short}</span>
              <span>{e.subject}<small class="muted">{fmtDate(e.date)}, {t('lekcja {no}', { no: e.no })}</small></span>
              <span class="vh">{e.name}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/snippet}
</Async>
