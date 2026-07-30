/* ============================================================================
   vault.js — what the glasses know about one person, and how that grows

   A single "memory" string was always going to be too thin. A granddaughter is
   not one sentence. She is a job, a wedding, a concert you went to together,
   the fact that she always brings kaya toast, and the six things you talked
   about last time.

   Two ways things get in:

     TYPED    — the family writes what they know. Reliable, and it is there
                from day one, before any conversation has happened.
     LEARNED  — what he actually keeps talking about with this person, and how
                often they visit. This is the part that compounds: the more
                they talk, the better the greeting gets, without anyone having
                to sit down and fill in a form.

   The vault is per-person and it is used to BUILD THE PROMPT. Instead of the
   same fixed sentence forever, he hears the thing most worth hearing now —
   rotating, so the tenth greeting is not the first one again.

   Everything here is derived from facts a human confirmed and from topic words
   counted locally. No transcript is stored, here or anywhere else.
   ==========================================================================*/

const Vault = {
  MAX_NOTES: 40,
  MAX_TOPICS: 25,
  MAX_VISITS: 60,
  MAX_SESSIONS: 120,        // roughly a year of weekly visits
  SESSION_DAYS: 365,        // and nothing older than that, ever

  /** Lazily give a person a vault. Older records predate this file. */
  of(person) {
    if (!person) return null;
    if (!person.vault) {
      person.vault = { notes: [], topics: [], visits: [], sessions: [], rotate: 0 };
      // the original single memory string becomes the first note
      if (person.memory) {
        person.vault.notes.push({
          id: 'n0', text: person.memory, source: 'family',
          ts: person.created || Date.now(), pinned: true,
        });
      }
    }
    if (!person.vault.notes)    person.vault.notes    = [];
    if (!person.vault.topics)   person.vault.topics   = [];
    if (!person.vault.visits)   person.vault.visits   = [];
    if (!person.vault.sessions) person.vault.sessions = [];
    if (person.vault.rotate === undefined) person.vault.rotate = 0;
    return person.vault;
  },

  /* ------------------------------------------------------------- writing */

  /** The family types something they know. */
  addNote(personId, text, { pinned = false, source = 'family' } = {}) {
    const p = Store.person(personId);
    if (!p || !text) return null;
    const v = this.of(p);
    const note = { id: 'n' + Math.random().toString(36).slice(2, 8),
                   text: text.trim(), source, ts: Date.now(), pinned };
    v.notes.unshift(note);
    if (v.notes.length > this.MAX_NOTES) {
      // never drop something the family pinned
      const keep = v.notes.filter(n => n.pinned);
      const rest = v.notes.filter(n => !n.pinned).slice(0, this.MAX_NOTES - keep.length);
      v.notes = [...keep, ...rest];
    }
    Store.audit('vault.note', `${p.name}: ${note.text.slice(0, 60)}`);
    Store.save();
    return note;
  },

  removeNote(personId, noteId) {
    const p = Store.person(personId);
    if (!p) return;
    const v = this.of(p);
    v.notes = v.notes.filter(n => n.id !== noteId);
    Store.save();
  },

  /** A confirmed fact about a conversation becomes a note on everyone in it. */
  noteFromFact(fact) {
    const ids = fact.people && fact.people.length ? fact.people
              : (fact.personId ? [fact.personId] : []);
    ids.forEach(id => {
      const p = Store.person(id);
      if (!p) return;
      const v = this.of(p);
      if (v.notes.some(n => n.text === fact.text)) return;
      v.notes.unshift({ id: 'n' + fact.id, text: fact.text,
                        source: 'conversation', ts: fact.ts, pinned: false });
    });
    if (ids.length) Store.save();
  },

  /** What they keep talking about. Counts accumulate across visits. */
  learnTopics(personIds, topics) {
    if (!topics || !topics.length) return;
    (personIds || []).forEach(id => {
      const p = Store.person(id);
      if (!p) return;
      const v = this.of(p);
      topics.forEach(({ word, n }) => {
        const found = v.topics.find(t => t.word === word);
        if (found) { found.count += n; found.lastTs = Date.now(); }
        else v.topics.push({ word, count: n, lastTs: Date.now() });
      });
      v.topics.sort((a, b) => b.count - a.count);
      if (v.topics.length > this.MAX_TOPICS) v.topics.length = this.MAX_TOPICS;
    });
    Store.save();
  },

  /** A conversation happened. Length and recency are the behavioural signal. */
  recordVisit(session) {
    if (!session || !session.people) return;
    const durationMs = Math.max(0, (session.lastHeard || Date.now()) - (session.started || Date.now()));
    session.people.forEach(id => {
      const p = Store.person(id);
      if (!p) return;
      const v = this.of(p);
      v.visits.unshift({ ts: Date.now(), durationMs, fragments: (session.buf || []).length });
      if (v.visits.length > this.MAX_VISITS) v.visits.length = this.MAX_VISITS;
    });
    Store.save();
  },

  /* ==========================================================================
     CONVERSATION HISTORY — the part that makes this a vault and not a form

     Until now a finished conversation left three traces: any facts a human
     confirmed, a bump in the topic counts, and a row saying "they talked for
     14 minutes". You could not go back to the 12th of July and see what that
     Tuesday afternoon with his granddaughter was about.

     Now you can. Each conversation leaves ONE RECORD:

         who, when, how long, what it was about, what came out of it,
         and two sentences describing it.

     WHAT IS NOT IN IT: the conversation. No transcript, no audio, no quotes
     beyond the facts a human read and approved. The two sentences are written
     from the topics and the confirmed facts — the same material the caregiver
     can already see — so the record can never contain something the family
     has not seen and agreed to.

     This is the difference between a diary and a wiretap, and it is worth
     being pedantic about: a diary is written afterwards, from what mattered.
     ========================================================================*/

  /**
   * A conversation finished. Write it down.
   * @param {object} session  { people[], started, lastHeard, buf }
   * @param {object} extra    { topics[], facts[], summary, model }
   */
  addSession(session, extra = {}) {
    if (!session || !session.people || !session.people.length) return null;
    const ts = session.lastHeard || Date.now();
    const durationMin = Math.max(1, Math.round(
      ((session.lastHeard || ts) - (session.started || ts)) / 60000));
    const names = session.people
      .map(id => (Store.person(id) || {}).name).filter(Boolean);

    const rec = {
      id: 's' + ts.toString(36) + Math.random().toString(36).slice(2, 5),
      ts,
      day: Fmt.dayKey(ts),
      durationMin,
      people: session.people.slice(),
      names,
      topics: (extra.topics || []).map(t => t.word || t).slice(0, 6),
      facts: (extra.facts || []).map(f => ({ id: f.id, text: f.text })),
      summary: extra.summary || null,
      model: extra.model || null,
      // How much was heard, as a number only. Useful for judging how much the
      // record is worth; useless for reconstructing anything.
      fragments: (session.buf || []).length,
    };

    session.people.forEach(id => {
      const p = Store.person(id);
      if (!p) return;
      const v = this.of(p);
      v.sessions.unshift(rec);
      this._trimSessions(v);
    });
    Store.save();
    return rec;
  },

  _trimSessions(v) {
    const cut = Date.now() - this.SESSION_DAYS * 86400000;
    v.sessions = v.sessions.filter(s => s.ts >= cut);
    if (v.sessions.length > this.MAX_SESSIONS) v.sessions.length = this.MAX_SESSIONS;
  },

  /** Attach a summary written after the fact (the model answers async). */
  setSessionSummary(sessionId, summary, model) {
    let hit = null;
    Store.s.people.forEach(p => {
      const v = this.of(p);
      const s = v.sessions.find(x => x.id === sessionId);
      if (s) { s.summary = summary; s.model = model || null; hit = s; }
    });
    if (hit) Store.save();
    return hit;
  },

  /**
   * One person's conversation history, newest first, grouped by day.
   * This is the "go back to last Tuesday" view.
   */
  timeline(personId, days = 90) {
    const p = Store.person(personId);
    if (!p) return [];
    const cut = Date.now() - days * 86400000;
    const rows = this.of(p).sessions.filter(s => s.ts >= cut);
    const byDay = new Map();
    rows.forEach(s => {
      if (!byDay.has(s.day)) byDay.set(s.day, []);
      byDay.get(s.day).push(s);
    });
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, sessions]) => ({
        day,
        label: this._dayLabel(day),
        sessions: sessions.sort((a, b) => b.ts - a.ts),
        minutes: sessions.reduce((n, s) => n + s.durationMin, 0),
      }));
  },

  /** Everyone's conversations on one day — the household view. */
  dayAcrossPeople(day) {
    const seen = new Set(), out = [];
    Store.s.people.forEach(p => {
      this.of(p).sessions.forEach(s => {
        if (s.day !== day || seen.has(s.id)) return;
        seen.add(s.id);
        out.push(s);
      });
    });
    return out.sort((a, b) => b.ts - a.ts);
  },

  /** Free-text search over what is KEPT — topics, facts, summaries. */
  search(q) {
    const needle = (q || '').trim().toLowerCase();
    if (needle.length < 2) return [];
    const seen = new Set(), out = [];
    Store.s.people.forEach(p => {
      this.of(p).sessions.forEach(s => {
        if (seen.has(s.id)) return;
        const hay = [s.topics.join(' '), s.facts.map(f => f.text).join(' '),
                     s.summary || '', s.names.join(' ')].join(' ').toLowerCase();
        if (!hay.includes(needle)) return;
        seen.add(s.id);
        out.push(s);
      });
    });
    return out.sort((a, b) => b.ts - a.ts).slice(0, 40);
  },

  _dayLabel(day) {
    const d = new Date(day + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  },

  /* ------------------------------------------------------------- reading */

  /**
   * The line he hears. Rotates through what is known so the same greeting is
   * not repeated forever — hearing "she brought kaya toast" for the ninetieth
   * time is how a helpful prompt turns into wallpaper he stops noticing.
   */
  greeting(person) {
    const v = this.of(person);
    const bits = [person.name];
    if (person.relation) bits.push(person.relation);
    let line = bits.join('. ') + '.';

    const candidates = [];
    // most recent conversation note first — it is the freshest shared ground
    const recent = v.notes.filter(n => n.source === 'conversation')[0];
    if (recent) candidates.push(recent.text);
    // then whatever the family pinned
    v.notes.filter(n => n.pinned).forEach(n => candidates.push(n.text));
    // then anything else typed
    v.notes.filter(n => n.source === 'family' && !n.pinned).forEach(n => candidates.push(n.text));

    if (candidates.length) {
      const pick = candidates[v.rotate % candidates.length];
      v.rotate = (v.rotate + 1) % Math.max(candidates.length, 1);
      line += ' ' + String(pick).replace(/\.?$/, '.');
    }
    return line;
  },

  /** A short "you two usually talk about…" line. */
  topicLine(person) {
    const v = this.of(person);
    const top = v.topics.filter(t => t.count >= 3).slice(0, 2).map(t => t.word);
    if (!top.length) return null;
    return `You and ${person.name} usually talk about ${top.join(' and ')}.`;
  },

  /** Everything known, for the caregiver's view of one person. */
  summary(person) {
    const v = this.of(person);
    const now = Date.now();
    const week = v.visits.filter(x => now - x.ts < 7 * 86400000);
    const month = v.visits.filter(x => now - x.ts < 30 * 86400000);
    // Minutes come from the SESSION records, not the visit rows, because the
    // per-person write-up counts them that way. Two numbers on one screen that
    // both claim to be "minutes this month" must agree or the family stops
    // trusting the cheap one and then stops trusting the expensive one.
    const monthSessions = v.sessions.filter(s => now - s.ts < 30 * 86400000);
    const totalMin = monthSessions.reduce((n, s) => n + s.durationMin, 0);
    return {
      notes: v.notes.length,
      typed: v.notes.filter(n => n.source === 'family').length,
      learned: v.notes.filter(n => n.source === 'conversation').length,
      topics: v.topics.filter(t => t.count >= 3).slice(0, 5),
      visitsWeek: week.length,
      visitsMonth: month.length,
      minutesMonth: totalMin,
      lastVisit: v.visits[0] ? v.visits[0].ts : null,
      conversations: v.sessions.length,
      firstSeen: v.sessions.length ? v.sessions[v.sessions.length - 1].ts : (person.created || null),
    };
  },

  /* ==========================================================================
     THE BRIEF — everything known about one person, in one place

     This is the answer to "what does it actually know about her?". It is the
     same material the greeting is built from, laid out so a family member can
     read it, correct it, and delete any line of it. A memory the family cannot
     inspect is not a memory aid, it is a rumour.
     ========================================================================*/
  brief(person) {
    const v = this.of(person);
    const s = this.summary(person);
    const known = s.firstSeen ? Math.max(1, Math.round((Date.now() - s.firstSeen) / 86400000)) : 0;

    const lines = [];
    if (person.relation) lines.push(`${person.name} is his ${person.relation.toLowerCase()}.`);
    if (known >= 14) {
      lines.push(`They have talked ${s.conversations} time${s.conversations === 1 ? '' : 's'} `
               + `since the glasses started listening, ${known} days ago.`);
    } else if (s.conversations) {
      lines.push(`They have talked ${s.conversations} time${s.conversations === 1 ? '' : 's'} so far.`);
    }
    if (s.topics.length) {
      lines.push(`They keep coming back to ${s.topics.slice(0, 3).map(t => t.word).join(', ')}.`);
    }
    const recent = v.notes.filter(n => n.source === 'conversation').slice(0, 3);
    if (recent.length) lines.push(`Most recently: ${recent.map(n => n.text.replace(/\.?$/, '')).join('; ')}.`);

    return {
      text: lines.join(' ') || `Nothing learned about ${person.name} yet — the glasses have not been in a conversation with her.`,
      lines,
      daysKnown: known,
      stats: s,
      notes: v.notes,
      topics: v.topics,
      sessions: v.sessions,
    };
  },

  /**
   * The whole vault as one paragraph, for the model that writes summaries.
   * Confirmed material only — this is what we are willing to hand to a model.
   */
  promptContext(person, limit = 6) {
    const v = this.of(person);
    const bits = [];
    if (person.relation) bits.push(`${person.name} is his ${person.relation}.`);
    v.notes.slice(0, limit).forEach(n => bits.push(n.text.replace(/\.?$/, '.')));
    const top = v.topics.filter(t => t.count >= 3).slice(0, 4).map(t => t.word);
    if (top.length) bits.push(`They often talk about ${top.join(', ')}.`);
    return bits.join(' ');
  },
};

window.Vault = Vault;
