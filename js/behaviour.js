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

  /* ========================================================= for the UI */

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
