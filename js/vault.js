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

  /** Lazily give a person a vault. Older records predate this file. */
  of(person) {
    if (!person) return null;
    if (!person.vault) {
      person.vault = { notes: [], topics: [], visits: [], rotate: 0 };
      // the original single memory string becomes the first note
      if (person.memory) {
        person.vault.notes.push({
          id: 'n0', text: person.memory, source: 'family',
          ts: person.created || Date.now(), pinned: true,
        });
      }
    }
    if (!person.vault.notes)  person.vault.notes  = [];
    if (!person.vault.topics) person.vault.topics = [];
    if (!person.vault.visits) person.vault.visits = [];
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
    const totalMin = Math.round(month.reduce((n, x) => n + x.durationMs, 0) / 60000);
    return {
      notes: v.notes.length,
      typed: v.notes.filter(n => n.source === 'family').length,
      learned: v.notes.filter(n => n.source === 'conversation').length,
      topics: v.topics.filter(t => t.count >= 3).slice(0, 5),
      visitsWeek: week.length,
      visitsMonth: month.length,
      minutesMonth: totalMin,
      lastVisit: v.visits[0] ? v.visits[0].ts : null,
    };
  },
};

window.Vault = Vault;
