/* ============================================================================
   cti.js — Cognitive Trajectory Index

   The layer nobody else has. Every number below is derived from events the
   glasses already produced while HELPING — no extra test, no appointment, no
   effort from anyone. The therapy dose is the measurement.

   Five sub-scores, each 0-100 where 100 is best, combined into one index.
   The weights are a considered first pass, not a validated instrument: this
   is a prototype, and the honest position is that the weights would be fitted
   against MMSE/MoCA and clinician staging during the Phase 2 pilot.

     retrieval     0.35   unaided share of tested trials
     latency       0.20   how fast an unaided retrieval arrives
     independence  0.20   how far the cues have vanished
     repetition    0.15   "tell me again" rate per hour
     engagement    0.10   wear time against the 9-hour unsupervised window

   Escalation rule: a fall of >= 2 standard deviations against the trailing
   8-week mean triggers "bring the review forward". That is a triage signal,
   NOT a diagnosis — see README on regulatory staging.
   ==========================================================================*/

const CTI = {
  W: { retrieval: 0.35, latency: 0.20, independence: 0.20, repetition: 0.15, engagement: 0.10 },

  // Evidence gates. We refuse to publish an index we cannot support: a number
  // on a clinician's screen implies it means something. Below these thresholds
  // the UI shows "no live data" and the chart plots history only.
  MIN_TESTED: 3,          // tested retrieval trials before a live point exists
  MIN_WEAR_MS: 60000,     // 1 minute of wear before wear-derived scores count

  clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); },

  /** Do we have enough evidence to publish a live index? */
  sufficient(sig) {
    return (sig.raw.tested >= this.MIN_TESTED)
        && this.score(sig) !== null;
  },

  /** Sub-scores from whatever the live session has produced so far. */
  signals(opts = {}) {
    const since = opts.since || 0;
    const people = Store.s.people;
    const events = Store.s.events.filter(e => e.ts >= since);

    // --- retrieval: unaided share of TESTED trials (stage 0 is not a test)
    let unaided = 0, assisted = 0, missed = 0, latSum = 0, latN = 0;
    people.forEach(p => p.trials.forEach(t => {
      if (t.ts < since) return;
      if (t.outcome === 'unaided')  { unaided++;  if (t.latency) { latSum += t.latency; latN++; } }
      if (t.outcome === 'assisted') assisted++;
      if (t.outcome === 'missed')   missed++;
    }));
    const tested = unaided + assisted + missed;
    const retrieval = tested ? (unaided / tested) * 100 : null;

    // --- latency: 800 ms scores 100, 4800 ms scores 0
    const meanLat = latN ? latSum / latN : null;
    const latency = meanLat === null ? null : this.clamp(100 - (meanLat - 800) / 40);

    // --- independence: how far up the ladder the cues have vanished.
    // Only meaningful for people who have actually been trialled. A freshly
    // enrolled person sits at stage 0 because nothing has happened yet, not
    // because he is maximally dependent — counting them would report a
    // catastrophic score before the session has begun.
    const trialled = people.filter(p => p.trials.length > 0);
    const independence = trialled.length
      ? (trialled.reduce((s, p) => s + p.cue.stage, 0) / trialled.length) / (STAGES.length - 1) * 100
      : null;

    // --- repetition and engagement both need real wear time behind them.
    const wearMs = Store.wearMsToday();
    const worn = wearMs >= this.MIN_WEAR_MS;
    const wearH = Math.max(wearMs / 3600000, 0.05);
    const repeats = events.filter(e => e.type === EV.TELL_AGAIN).length;
    const perHour = repeats / wearH;
    const repetition = worn ? this.clamp(100 - perHour * 12) : null;
    const engagement = worn ? this.clamp(wearH / Store.s.patient.wakeHours * 100) : null;

    return {
      retrieval, latency, independence, repetition, engagement,
      raw: { unaided, assisted, missed, tested, meanLat, repeats, perHour: +perHour.toFixed(2), wearH: +wearH.toFixed(2) },
    };
  },

  /** Weighted index over whichever sub-scores we actually have data for. */
  score(sig) {
    let sum = 0, wsum = 0;
    for (const k of Object.keys(this.W)) {
      if (sig[k] === null || sig[k] === undefined || Number.isNaN(sig[k])) continue;
      sum += sig[k] * this.W[k];
      wsum += this.W[k];
    }
    if (!wsum) return null;
    return Math.round(sum / wsum);
  },

  /** Seeded history plus the live point, clearly separated. */
  series() {
    const hist = Store.s.weeks.map(w => ({ ...w }));
    const sig = this.signals();
    if (this.sufficient(sig)) {
      hist.push({ week: hist.length + 1, cti: this.score(sig), seeded: false, signals: sig });
    }
    return hist;
  },

  /** Trailing mean and SD, excluding the point being tested. */
  stats(series, excludeLast = true) {
    const v = (excludeLast ? series.slice(0, -1) : series).map(p => p.cti).slice(-8);
    if (v.length < 3) return null;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1;
    return { mean: +mean.toFixed(1), sd: +sd.toFixed(2), n: v.length };
  },

  /** The escalation decision. Returns null when nothing needs to happen. */
  flag(series) {
    if (series.length < 4) return null;
    const st = this.stats(series);
    if (!st) return null;
    const last = series[series.length - 1];
    const drop = st.mean - last.cti;
    const z = drop / st.sd;
    if (z >= 2) {
      return {
        level: 'escalate',
        z: +z.toFixed(1),
        drop: +drop.toFixed(1),
        text: `Declined ${drop.toFixed(0)} points — ${z.toFixed(1)} SD below the trailing ${st.n}-week mean. Bring the memory-clinic review forward and consider raising the care tier.`,
      };
    }
    if (z >= 1.2) {
      return {
        level: 'watch',
        z: +z.toFixed(1),
        drop: +drop.toFixed(1),
        text: `Down ${drop.toFixed(0)} points (${z.toFixed(1)} SD). Not yet actionable — watch for a second consecutive fall.`,
      };
    }
    // Recovery. Without this, a week that climbs back after a flagged fall
    // reads as "stable", which loses the most useful thing the index can tell
    // a clinician: that whatever was changed appears to be working.
    const prev = series[series.length - 2];
    if (prev) {
      const prevZ = (this.stats(series.slice(0, -1)) || { mean: prev.cti, sd: 1 });
      const prevDrop = (prevZ.mean - prev.cti) / (prevZ.sd || 1);
      if (prevDrop >= 1.2 && last.cti > prev.cti + 2) {
        return {
          level: 'recovered',
          z: +prevDrop.toFixed(1),
          drop: +(last.cti - prev.cti).toFixed(1),
          text: `Up ${(last.cti - prev.cti).toFixed(0)} points after last period's ${prevDrop.toFixed(1)} SD fall. Whatever changed appears to be helping — keep it and re-check next week.`,
        };
      }
    }
    return null;
  },

  /** Per-person recognition load: the "who is he forgetting?" view. */
  perPerson() {
    return Store.s.people.map(p => {
      const t = p.trials;
      const tested = t.filter(x => x.outcome !== 'scaffolded');
      const un = tested.filter(x => x.outcome === 'unaided');
      const lat = un.filter(x => x.latency).map(x => x.latency);
      return {
        id: p.id,
        name: p.name,
        relation: p.relation,
        photo: p.photo,
        stage: p.cue.stage,
        stageLabel: STAGES[p.cue.stage].short,
        intervalH: p.cue.intervalH,
        trials: t.length,
        tested: tested.length,
        unaidedPct: tested.length ? Math.round(un.length / tested.length * 100) : null,
        meanLatency: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
        promptsNeeded: t.filter(x => x.outcome === 'assisted' || x.outcome === 'missed').length,
        progress: Cues.progress(p),
      };
    }).sort((a, b) => (b.promptsNeeded - a.promptsNeeded) || (a.unaidedPct ?? 101) - (b.unaidedPct ?? 101));
  },

  /* ------------------------------------------------------------- chart */
  /**
   * Hand-rolled SVG line chart. No charting library: one less thing that can
   * fail to load in a competition venue.
   */
  chart(series, o = {}) {
    const W = o.w || 640, H = o.h || 210;
    const pad = { l: 34, r: 14, t: 14, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const lo = 45, hi = 90;
    const x = i => pad.l + (series.length <= 1 ? iw / 2 : (i / (series.length - 1)) * iw);
    const y = v => pad.t + ih - ((v - lo) / (hi - lo)) * ih;

    const grid = [50, 60, 70, 80, 90].map(v =>
      `<line x1="${pad.l}" y1="${y(v).toFixed(1)}" x2="${W - pad.r}" y2="${y(v).toFixed(1)}" stroke="#e6ded4" stroke-width="1"/>
       <text x="${pad.l - 7}" y="${(y(v) + 3.5).toFixed(1)}" font-size="9" fill="#9a938c" text-anchor="end" font-family="ui-monospace,monospace">${v}</text>`
    ).join('');

    const seeded = series.filter(p => p.seeded);
    const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${x(series.indexOf(p)).toFixed(1)},${y(p.cti).toFixed(1)}`).join(' ');

    const livePt = series.find(p => !p.seeded);
    let liveSeg = '';
    if (livePt) {
      const prev = seeded[seeded.length - 1];
      liveSeg = `<path d="M${x(series.indexOf(prev)).toFixed(1)},${y(prev.cti).toFixed(1)} L${x(series.indexOf(livePt)).toFixed(1)},${y(livePt.cti).toFixed(1)}"
                  fill="none" stroke="#b4472c" stroke-width="2.4" stroke-dasharray="5 4"/>`;
    }

    const dots = series.map((p, i) => {
      const live = !p.seeded;
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.cti).toFixed(1)}" r="${live ? 5 : 3.2}"
               fill="${live ? '#b4472c' : '#fff'}" stroke="${live ? '#b4472c' : '#2f5d50'}" stroke-width="2"/>`;
    }).join('');

    const labels = series.map((p, i) => {
      if (series.length > 8 && i % 2 && p.seeded) return '';
      return `<text x="${x(i).toFixed(1)}" y="${H - 8}" font-size="8.5" fill="#9a938c" text-anchor="middle"
               font-family="ui-monospace,monospace">${p.seeded ? 'w' + p.week : 'LIVE'}</text>`;
    }).join('');

    // shade the inflection region if we have one
    const fl = this.flag(series);
    let shade = '';
    if (fl && fl.level === 'escalate' && series.length > 2) {
      const from = x(series.length - 3), to = x(series.length - 1);
      shade = `<rect x="${from.toFixed(1)}" y="${pad.t}" width="${(to - from).toFixed(1)}" height="${ih}"
                fill="#9e2b25" opacity="0.07"/>`;
    }

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img"
                 aria-label="Cognitive Trajectory Index over time">
      ${shade}${grid}
      <path d="${path(seeded)}" fill="none" stroke="#2f5d50" stroke-width="2.2" stroke-linejoin="round"/>
      ${liveSeg}${dots}${labels}
    </svg>`;
  },
};

window.CTI = CTI;
