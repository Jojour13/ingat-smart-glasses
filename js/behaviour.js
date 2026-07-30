/* ============================================================================
   behaviour.js — the two behavioural signals worth measuring

   The Trajectory Index measures COGNITION: could he retrieve the name. That is
   not the whole picture, and arguably not even the earliest part of it.

   ---------------------------------------------------------------------------
   1. SOCIAL ENGAGEMENT — the most under-measured early sign
   ---------------------------------------------------------------------------
   Apathy predicts the onset of dementia YEARS before other symptoms. A
   two-year study of 600 people found apathy appeared early, worsened over
   time, and predicted decline in people who were otherwise healthy — which
   the authors describe as a window of opportunity. Longitudinally, apathy
   predicts functional decline, pre-dementia syndromes and dementia itself.
   The Alzheimer's Society calls the gradual reduction in participation and
   communication one of the most under-recognised early signs.

   And the reason it matters for THIS product specifically: withdrawal is not
   only a symptom, it is a mechanism. He stops talking because losing the
   thread in front of people is humiliating, and the less he talks the faster
   he declines. The conversation layer already knows who he spoke to, for how
   long, and how often — so this is measurable at zero extra cost, and no
   competing product measures it at all.

   ---------------------------------------------------------------------------
   2. THE SUNDOWNING CLOCK — WHEN, not just how much
   ---------------------------------------------------------------------------
   Confusion in dementia is not evenly distributed through the day. Sundowning
   — a rise in agitation and confusion in the late afternoon and evening —
   clusters roughly 4pm to 7pm and affects about 20% of people living with
   dementia in the community. Repetitive requests for attention peak in the
   late morning and afternoon.

   A daily total hides this completely. "He needed nine prompts today" is not
   actionable. "Seven of his nine prompts were between 4 and 7" is: it points
   at light, at activity, at when the hard tasks should be scheduled, and at
   medication timing. That is a conversation a GP can have.

   Note honestly that some researchers question whether sundowning is a
   distinct syndrome at all, or whether the same symptoms simply land harder
   on tired carers in the evening. Either way the pattern is worth surfacing —
   we describe the observation and do not diagnose it.
   ==========================================================================*/

const Behaviour = {
  /* The documented sundowning window. */
  SUNDOWN_FROM: 16,
  SUNDOWN_TO: 19,

  /** 16 -> "4pm". The constants are 24-hour; the family is not. */
  _clockWord(h) {
    if (h === 0) return 'midnight';
    if (h === 12) return 'noon';
    return (h > 12 ? h - 12 : h) + (h >= 12 ? 'pm' : 'am');
  },

  /** Metres -> what a person would say. Never "873 m". */
  _dist(m) {
    return m >= 950 ? (m / 1000).toFixed(1) + ' km'
         : Math.round(m / 50) * 50 + ' m';
  },

  /** Events that indicate he was struggling at that moment. */
  CONFUSION: null,   // filled on first use, EV is defined after this file loads

  _confusionTypes() {
    if (!this.CONFUSION) {
      this.CONFUSION = new Set([
        EV.TELL_AGAIN,     // asked for the prompt again
        EV.MISSED,         // could not retrieve a name
        EV.ASSISTED,       // needed the answer supplied
        EV.THREAD_HELD,    // lost the thread mid-conversation
        EV.OBJ_ASK,        // could not find something
        EV.FACT_MISSED,
        EV.GEO_LEFT,
      ]);
    }
    return this.CONFUSION;
  },

  /* ====================================================== the day's shape */

  /**
   * Confusion events bucketed by hour, over the last `days` days.
   * @returns {{hours:number[], peak:{hour,count}|null, sundownShare:number, total:number}}
   */
  clock(days = 7) {
    const since = Date.now() - days * 86400000;
    const types = this._confusionTypes();
    const hours = new Array(24).fill(0);
    let total = 0;

    Store.s.events.forEach(e => {
      if (e.ts < since || !types.has(e.type)) return;
      hours[new Date(e.ts).getHours()]++;
      total++;
    });

    let peak = null;
    hours.forEach((n, h) => { if (!peak || n > peak.count) peak = { hour: h, count: n }; });
    if (peak && !peak.count) peak = null;

    let sundown = 0;
    for (let h = this.SUNDOWN_FROM; h < this.SUNDOWN_TO; h++) sundown += hours[h];

    return {
      hours, peak, total,
      sundownShare: total ? sundown / total : 0,
      sundownCount: sundown,
      days,
    };
  },

  /**
   * Is there a late-afternoon pattern worth telling the family about?
   * Deliberately conservative: three hours out of a waking sixteen is about
   * 19% of the day, so we only speak up when it is well beyond that AND there
   * is enough data for the share to mean anything.
   */
  sundowning(days = 7) {
    const c = this.clock(days);
    if (c.total < 8) return { flagged: false, reason: 'not enough yet', clock: c };
    const expected = (this.SUNDOWN_TO - this.SUNDOWN_FROM) / 16;   // ~0.19
    if (c.sundownShare < expected * 1.9) return { flagged: false, clock: c };
    return {
      flagged: true,
      clock: c,
      share: c.sundownShare,
      text: `${c.sundownCount} of his ${c.total} difficult moments this week were between `
          + `${this._clockWord(this.SUNDOWN_FROM)} and ${this._clockWord(this.SUNDOWN_TO)}. Late afternoon is a known `
          + `pattern in dementia. It is worth trying more light in the flat around then, `
          + `keeping that hour calm and unhurried, and mentioning the timing at his next appointment.`,
    };
  },

  /* ================================================== social engagement */

  /**
   * How much he is still talking to people, and to how many different people.
   * Variety matters separately from volume: talking to one person for an hour
   * is not the same as seeing four people.
   */
  social(days = 7) {
    const since = Date.now() - days * 86400000;
    const people = Store.s.people;
    let minutes = 0, visits = 0;
    const seen = new Set();

    people.forEach(p => {
      const v = (p.vault && p.vault.visits) || [];
      v.forEach(x => {
        if (x.ts < since) return;
        visits++;
        minutes += x.durationMs / 60000;
        seen.add(p.id);
      });
    });

    return {
      days,
      visits,
      minutes: Math.round(minutes),
      distinctPeople: seen.size,
      perDay: +(visits / days).toFixed(1),
    };
  },

  /**
   * Compare this week to the four before it — HIS baseline, not a population
   * norm. A 40% drop is the threshold; below that it is just a quiet week.
   */
  withdrawal() {
    const now = Store.s.people;
    const week = this.social(7);
    const prior = { visits: 0, minutes: 0, people: new Set() };

    const from = Date.now() - 35 * 86400000, to = Date.now() - 7 * 86400000;
    now.forEach(p => {
      ((p.vault && p.vault.visits) || []).forEach(x => {
        if (x.ts < from || x.ts >= to) return;
        prior.visits++;
        prior.minutes += x.durationMs / 60000;
        prior.people.add(p.id);
      });
    });

    const baselineVisits = prior.visits / 4;      // four weeks
    const baselineMinutes = prior.minutes / 4;

    if (prior.visits < 4) {
      return { known: false, week, reason: 'no baseline yet — needs a few weeks' };
    }

    const dropVisits = baselineVisits ? 1 - (week.visits / baselineVisits) : 0;
    const dropMinutes = baselineMinutes ? 1 - (week.minutes / baselineMinutes) : 0;
    const drop = Math.max(dropVisits, dropMinutes);

    return {
      known: true,
      week,
      baseline: { visits: +baselineVisits.toFixed(1), minutes: Math.round(baselineMinutes) },
      drop: +drop.toFixed(2),
      flagged: drop >= 0.4,
      text: drop >= 0.4
        ? `He has been talking with people about ${Math.round(drop * 100)}% less this week than `
        + `he usually does. Pulling back from conversation is one of the earliest changes in `
        + `dementia, and it tends to feed on itself. It is often worth a visit rather than a call.`
        : `He is talking with people about as much as usual.`,
    };
  },

  /* ======================================================================
     3. REST-ACTIVITY RHYTHM — the strongest evidence in this whole file

     Standard nonparametric actigraphy. These three measures come out of
     wrist-worn accelerometry and have been run against very large cohorts:

       IV  intradaily variability — how fragmented a day is. Hourly naps and
           night waking push it up. Highest quartile: HR 1.82 for incident
           cognitive impairment.
       IS  interdaily stability — how alike one day is to the next. Lowest
           quartile: HR 1.36.
       RA  relative amplitude — the gap between his most active ten hours
           (M10) and his least active five (L5). Lowest quartile: HR 1.85;
           in one cohort the lowest tertile carried HR 5.08 for dementia.

     A UK Biobank analysis of over 91,000 people found dementia and MCI risk
     rose with lower M10, higher L5, lower amplitude and higher IV. The
     authors' conclusion is the useful one: less stable, more fragmented
     rest-activity rhythms may be an EARLY biomarker — visible before the
     cognitive tests move.

     We have an accelerometer and it is already running for wear detection,
     so this costs one number every five minutes and nothing else.
     ====================================================================*/

  /**
   * Epochs as a continuous series, plus each one's bin WITHIN THE LOCAL DAY.
   *
   * The epoch index counts five-minute blocks since the unix epoch, which is
   * UTC. Taking `index % binsPerDay` therefore aligns the daily profile to UTC
   * midnight, not to his midnight — eight hours out in Singapore. That does
   * not affect IS or IV, which only care about spacing, but it puts M10 and L5
   * at the wrong clock time, which is the one part of this a caregiver reads.
   */
  _epochs(days = 7) {
    const per = 24 * 60 / Store.EPOCH_MIN;
    const now = Store.epochIndex();
    const from = now - days * per;
    const byIndex = new Map();
    Store.s.activity.forEach(e => { if (e.t >= from) byIndex.set(e.t, e.v); });
    const series = [], bins = [];
    for (let t = from; t <= now; t++) {
      series.push(byIndex.has(t) ? byIndex.get(t) : 0);
      bins.push(this.localBin(t));
    }
    return { series, bins, per, covered: byIndex.size };
  },

  /** Which five-minute bin of HIS day an epoch index falls in. */
  localBin(t) {
    const d = new Date(t * Store.EPOCH_MIN * 60000);
    return Math.floor((d.getHours() * 60 + d.getMinutes()) / Store.EPOCH_MIN);
  },

  /**
   * @returns {{IS,IV,RA,M10,L5,hours,enough}|null}
   */
  rhythm(days = 7) {
    const { series, bins, per, covered } = this._epochs(days);
    // Two full days is the floor at which IS means anything at all.
    const enough = covered >= (2 * per * 0.4);
    if (series.length < per * 2) return { enough: false, covered, need: per * 2 };

    const n = series.length;
    const mean = series.reduce((a, b) => a + b, 0) / n;
    const ss = series.reduce((a, x) => a + (x - mean) ** 2, 0);
    if (!ss) return { enough: false, covered, need: per * 2 };

    // IV — mean squared difference between consecutive epochs, normalised
    let diff = 0;
    for (let i = 1; i < n; i++) diff += (series[i] - series[i - 1]) ** 2;
    const IV = (n * diff) / ((n - 1) * ss);

    // IS — variance of the average 24h profile against total variance
    const profile = new Array(per).fill(0), counts = new Array(per).fill(0);
    series.forEach((v, i) => { const b = bins[i]; profile[b] += v; counts[b]++; });
    for (let h = 0; h < per; h++) profile[h] = counts[h] ? profile[h] / counts[h] : 0;
    const psd = profile.reduce((a, x) => a + (x - mean) ** 2, 0);
    const IS = (n * psd) / (per * ss);

    // M10 / L5 — the most active ten and least active five consecutive hours,
    // taken on the averaged daily profile
    const win = (h) => {
      const w = h * 60 / Store.EPOCH_MIN;
      let best = -Infinity, worst = Infinity, bAt = 0, wAt = 0;
      for (let s = 0; s < per; s++) {
        let sum = 0;
        for (let k = 0; k < w; k++) sum += profile[(s + k) % per];
        const m = sum / w;
        if (m > best) { best = m; bAt = s; }
        if (m < worst) { worst = m; wAt = s; }
      }
      return { best, worst, bAt, wAt };
    };
    const m10 = win(10).best, w10 = win(10).bAt;
    const l5o = win(5), l5 = l5o.worst;
    const RA = (m10 + l5) ? (m10 - l5) / (m10 + l5) : 0;

    const toHour = i => Math.round(i * Store.EPOCH_MIN / 60) % 24;
    return {
      enough,
      IS: +IS.toFixed(3),
      IV: +IV.toFixed(3),
      RA: +RA.toFixed(3),
      M10: +m10.toFixed(3), M10at: toHour(w10),
      L5: +l5.toFixed(3),   L5at: toHour(l5o.wAt),
      covered, days,
      profile,
    };
  },

  /** Plain-language reading of the rhythm. Descriptive, never diagnostic. */
  rhythmNote(days = 7) {
    const r = this.rhythm(days);
    if (!r || !r.enough) {
      return { level: 'none',
               text: 'Not enough movement data yet. A few days of wearing them and his daily rhythm will show here.' };
    }
    const flags = [];
    if (r.IV > 0.9) flags.push('his days are quite broken up');
    if (r.IS < 0.4) flags.push('one day looks quite different from the next');
    if (r.RA < 0.8) flags.push('the difference between his busiest and quietest hours is smaller than it might be');

    if (!flags.length) {
      return { level: 'ok', r,
      // M10at and L5at are where each WINDOW starts, not a single moment, so
      // the sentence has to say "from", or "quietest around 10pm" reads as a
      // claim that he is asleep at ten and awake again by eleven.
               text: `He keeps a steady daily rhythm — his busiest ten hours start around `
                   + `${this._clockWord(r.M10at)}, and his quietest five from around `
                   + `${this._clockWord(r.L5at)}.` };
    }
    return {
      level: 'watch', r,
      text: `Looking at his movement this week, ${flags.join(', and ')}. `
          + `Broken-up and irregular daily rhythms are worth mentioning at his next appointment — `
          + `they often respond to simple things like daylight in the morning and a consistent bedtime.`,
    };
  },

  /* ======================================================================
     4. LIFE-SPACE — how much of the world he still moves through

     Life-space mobility predicts cognitive decline and the development of
     Alzheimer's. GPS-derived area, perimeter and mean distance from home are
     all smaller in mild-to-moderate AD than in controls, and area and
     perimeter alone separate the two groups. People with restricted
     life-space decline measurably faster.

     What we deliberately do NOT do is keep a track. The daily numbers are
     derived at the point of measurement and the route is never stored, so
     this reports that his world is shrinking without recording where he went.
     ====================================================================*/

  lifespace(days = 7) {
    const cut = Date.now() - days * 86400000;
    const rows = Store.s.lifespace.filter(d => new Date(d.day).getTime() >= cut);
    if (!rows.length) return { enough: false, days };
    const maxM = Math.max(...rows.map(d => d.maxM));
    const meanM = rows.reduce((a, d) => a + (d.fixes ? d.sumM / d.fixes : 0), 0) / rows.length;
    const cells = new Set();
    rows.forEach(d => d.cells.forEach(c => cells.add(c)));
    const awayMin = rows.reduce((a, d) => a + d.awayMin, 0);
    return {
      enough: rows.length >= 3,
      days,
      daysWithData: rows.length,
      furthestM: Math.round(maxM),
      meanM: Math.round(meanM),
      places: cells.size,
      hoursOut: +(awayMin / 60).toFixed(1),
      daysOut: rows.filter(d => d.awayMin > 5).length,
    };
  },

  /** This week's world against the four before it. His own baseline again. */
  lifespaceTrend() {
    const wk = this.lifespace(7);
    const cutA = Date.now() - 35 * 86400000, cutB = Date.now() - 7 * 86400000;
    const prior = Store.s.lifespace.filter(d => {
      const t = new Date(d.day).getTime();
      return t >= cutA && t < cutB;
    });
    if (!wk.enough || prior.length < 6) {
      return { known: false, week: wk,
               text: 'Still learning how far he usually goes. After a few weeks this will compare each week against his own usual.' };
    }
    // Places must be counted PER WEEK and then averaged. Taking distinct cells
    // across the whole four weeks and dividing by four undercounts badly,
    // because he visits the same places every week — the same four cells over
    // four weeks would read as one place a week, and this week's two would
    // then look like an improvement.
    const weekOf = d => Math.floor((cutB - new Date(d.day).getTime()) / (7 * 86400000));
    const perWeek = new Map();
    prior.forEach(d => {
      const w = weekOf(d);
      if (!perWeek.has(w)) perWeek.set(w, new Set());
      d.cells.forEach(c => perWeek.get(w).add(c));
    });
    const weekCounts = [...perWeek.values()].map(s => s.size);
    const priorPlacesPerWeek = weekCounts.length
      ? weekCounts.reduce((a, b) => a + b, 0) / weekCounts.length : 0;
    const priorFurthest = Math.max(...prior.map(d => d.maxM));

    const dropPlaces = priorPlacesPerWeek ? 1 - (wk.places / priorPlacesPerWeek) : 0;
    const dropRange = priorFurthest ? 1 - (wk.furthestM / priorFurthest) : 0;
    const drop = Math.max(dropPlaces, dropRange);

    // Say which measure actually moved. Reporting a range contraction as
    // "fewer places" is the kind of small dishonesty that costs a family's
    // trust the first time they check it against what they know.
    const parts = [];
    if (dropPlaces >= 0.25)
      parts.push(`he went to about ${Math.round(dropPlaces * 100)}% fewer places than usual`);
    if (dropRange >= 0.25)
      parts.push(`he did not get as far from home — ${this._dist(wk.furthestM)} at the furthest, `
               + `against ${this._dist(priorFurthest)} in the four weeks before`);

    return {
      known: true, week: wk, drop: +drop.toFixed(2), flagged: drop >= 0.4,
      dropPlaces: +dropPlaces.toFixed(2), dropRange: +dropRange.toFixed(2),
      baseline: { places: +priorPlacesPerWeek.toFixed(1), furthestM: Math.round(priorFurthest) },
      text: drop >= 0.4
        ? `His world has got smaller this week — ${parts.join(', and ')}. `
        + `A shrinking range is one of the changes that tends to come before other things do, `
        + `and it is often practical rather than medical: a bus route, the heat, or having nobody to go with.`
        : `He is getting out about as much as usual.`,
    };
  },

  /* ========================================================= for the UI */

  /**
   * The averaged 24-hour movement profile, with M10 and L5 marked. This is
   * the picture actigraphy papers print, and it is the one that makes
   * "his days are broken up" legible to someone who is not a clinician.
   */
  rhythmChart(days = 7, o = {}) {
    const r = this.rhythm(days);
    const W = o.w || 560, H = o.h || 110;
    const pad = { l: 10, r: 10, t: 10, b: 20 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

    if (!r || !r.enough || !r.profile) {
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Not enough movement data yet">
        <text x="${W / 2}" y="${H / 2}" font-size="13" fill="#6e6660" text-anchor="middle"
          font-family="-apple-system,Segoe UI,sans-serif">Not enough movement data yet</text></svg>`;
    }

    const p = r.profile, n = p.length;
    const max = Math.max(...p) || 1;
    const x = i => pad.l + (i / (n - 1)) * iw;
    const y = v => pad.t + ih - (v / max) * ih;
    const path = p.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = path + ` L${x(n - 1).toFixed(1)},${pad.t + ih} L${x(0).toFixed(1)},${pad.t + ih} Z`;

    const perHour = 60 / Store.EPOCH_MIN;
    const band = (startHour, hours, fill, label) => {
      const bx = pad.l + (startHour * perHour / n) * iw;
      const bw = (hours * perHour / n) * iw;
      return `<rect x="${bx.toFixed(1)}" y="${pad.t}" width="${bw.toFixed(1)}" height="${ih}"
                fill="${fill}" opacity="0.13"/>
              <text x="${(bx + bw / 2).toFixed(1)}" y="${pad.t + 11}" font-size="9" fill="${fill}"
                text-anchor="middle" font-family="ui-monospace,monospace">${label}</text>`;
    };

    const ticks = [0, 6, 12, 18].map(h =>
      `<text x="${x(h * perHour).toFixed(1)}" y="${H - 6}" font-size="9" fill="#57504a"
         text-anchor="middle" font-family="ui-monospace,monospace">${this._clockWord(h)}</text>`).join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet"
              role="img" aria-label="His average day: most active around ${this._clockWord(r.M10at)}, quietest around ${this._clockWord(r.L5at)}">
      ${band(r.M10at, 10, '#2f5d50', 'most active')}
      ${band(r.L5at, 5, '#57504a', 'quietest')}
      <path d="${area}" fill="#b4472c" opacity="0.12"/>
      <path d="${path}" fill="none" stroke="#b4472c" stroke-width="2" stroke-linejoin="round"/>
      ${ticks}
    </svg>`;
  },

  /** Compact 24-hour bar chart. Hand-rolled SVG, no library. */
  clockChart(days = 7, o = {}) {
    const c = this.clock(days);
    const W = o.w || 560, H = o.h || 120;
    const pad = { l: 28, r: 10, t: 10, b: 22 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = Math.max(1, ...c.hours);
    const bw = iw / 24;

    const bars = c.hours.map((n, h) => {
      const x = pad.l + h * bw;
      const bh = (n / max) * ih;
      const inWindow = h >= this.SUNDOWN_FROM && h < this.SUNDOWN_TO;
      return `<rect x="${(x + 1).toFixed(1)}" y="${(pad.t + ih - bh).toFixed(1)}"
                width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}"
                fill="${inWindow ? '#b4472c' : '#8b9a94'}" rx="1.5"/>`;
    }).join('');

    // the documented late-afternoon window, shaded and labelled on the chart
    const wx = pad.l + this.SUNDOWN_FROM * bw;
    const ww = (this.SUNDOWN_TO - this.SUNDOWN_FROM) * bw;
    const band = `<rect x="${wx.toFixed(1)}" y="${pad.t}" width="${ww.toFixed(1)}" height="${ih}"
                    fill="#b4472c" opacity="0.07"/>
                  <text x="${(wx + ww / 2).toFixed(1)}" y="${pad.t + 10}" font-size="9"
                    fill="#b4472c" text-anchor="middle" font-family="ui-monospace,monospace">4–7pm</text>`;

    const ticks = [0, 6, 12, 18, 23].map(h =>
      `<text x="${(pad.l + h * bw + bw / 2).toFixed(1)}" y="${H - 7}" font-size="9"
         fill="#57504a" text-anchor="middle" font-family="ui-monospace,monospace">${h}</text>`).join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet"
              role="img" aria-label="When during the day he needed help, over the last ${days} days">
      ${band}${bars}${ticks}
      <line x1="${pad.l}" y1="${pad.t + ih}" x2="${W - pad.r}" y2="${pad.t + ih}"
        stroke="#ddd5cc" stroke-width="1"/>
    </svg>`;
  },
};

window.Behaviour = Behaviour;
