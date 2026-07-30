/* ============================================================================
   schedule.js — the time-based half of the product

   Face recognition is the half everyone demos. This is the half that runs the
   other eight hours: medication at 1pm, the clinic on Thursday, the morning
   briefing, one reminiscence moment a day.

   It also fills a real gap in the hardware. Huawei AI Glasses ships with no
   calendar access and no schedule-based reminders — the assistant cannot read
   an upcoming appointment. That is precisely the layer we are.

   Everything fires ONCE per day per key (Store.hasFired / markFired), so a
   reload does not re-nag. Nagging a person with dementia is not a minor bug:
   a repeated prompt he has already acted on makes him doubt himself.
   ==========================================================================*/

const Schedule = {
  _timer: null,
  onFire: null,          // (kind, payload) => void, for the UI log

  start(intervalMs = 20000) {
    this.stop();
    this.tick();
    this._timer = setInterval(() => this.tick(), intervalMs);
  },
  stop() { if (this._timer) clearInterval(this._timer); this._timer = null; },

  /* --------------------------------------------------------------- tick */
  async tick() {
    if (!Store.s.settings.scheduler) return;
    if (Cues._busy) return;              // never talk over a retrieval window
    const now = new Date();

    try {
      if (await this.briefing(now)) return;
      if (await this.medication(now)) return;
      if (await this.appointments(now)) return;
      if (await this.reminiscence(now)) return;
    } catch (e) { console.warn('schedule', e); }
  },

  /* ------------------------------------------------------------ briefing
     First time he puts the glasses on after 07:00: what day it is, who is
     coming, what is on. Orientation is the single cheapest intervention in
     early dementia and it costs one sentence. */
  async briefing(now) {
    if (now.getHours() < 7) return false;
    const key = 'briefing';
    if (Store.hasFired(key)) return false;
    if (Store.wearMsToday() < 5000) return false;     // only once he is wearing them

    Store.markFired(key);
    const day = now.toLocaleDateString('en-GB', { weekday: 'long' });
    const parts = [`Good morning. Today is ${day}.`];

    const today = Store.s.appointments
      .filter(a => new Date(a.when).toDateString() === now.toDateString() && a.when >= now.getTime())
      .sort((a, b) => a.when - b.when);
    if (today.length) {
      const a = today[0];
      parts.push(`${a.title} at ${Fmt.hm(a.when)}${a.place ? ', ' + a.place : ''}.`);
      if (today.length > 1) parts.push(`You have ${today.length} things on today.`);
    } else {
      parts.push('Nothing on your calendar today.');
    }
    const nextMed = this._nextMedToday(now);
    if (nextMed) parts.push(`Your ${nextMed.name} at ${nextMed.time}.`);

    const text = parts.join(' ');
    Store.log(EV.BRIEFING, { detail: text });
    this.onFire && this.onFire('briefing', { text });
    await Speech.say(text, { tag: 'briefing' });
    return true;
  },

  /* ---------------------------------------------------------- medication */
  async medication(now) {
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    for (const m of Store.s.meds) {
      if (!m.time) continue;
      const due = this._minutes(m.time);
      const mins = now.getHours() * 60 + now.getMinutes();
      // fire in the minute it falls due, and re-prompt once 15 minutes later
      const first = mins === due;
      const chase = mins === due + 15;
      const key = 'med:' + m.id + (chase ? ':chase' : '');
      if (!(first || chase) || Store.hasFired(key)) continue;
      if (chase && Store.hasFired('medok:' + m.id)) continue;   // already confirmed

      Store.markFired(key);
      const text = chase
        ? `Your ${m.name} is still waiting. ${m.desc}.`
        : `It is ${m.time.replace(':', ' ')}. Time for your ${m.name}, ${m.desc}.`;
      Store.log(EV.MED_PROMPT, { detail: m.id });
      this.onFire && this.onFire('med', { med: m, text, chase });
      await Speech.say(text, { tag: 'med' });
      return true;
    }
    return false;
  },

  /** Confirm a dose — called when he says so, or the caregiver marks it. */
  confirmMed(id) {
    Store.markFired('medok:' + id);
    Store.log(EV.MED_OK, { detail: id });
  },

  /* -------------------------------------------------------- appointments
     Reminders at the offsets on each appointment (default: a day before, and
     an hour before). The day-before reminder is for the caregiver's benefit
     as much as his — it is what stops a missed clinic slot. */
  async appointments(now) {
    const t = now.getTime();
    for (const a of Store.s.appointments) {
      for (const mins of (a.remind || [])) {
        const at = a.when - mins * 60000;
        if (t < at || t > at + 60000) continue;        // inside a 1-minute window
        const key = `appt:${a.id}:${mins}`;
        if (Store.hasFired(key)) continue;

        Store.markFired(key);
        const when = mins >= 1440
          ? `tomorrow at ${Fmt.hm(a.when)}`
          : mins >= 60 ? `in ${Math.round(mins / 60)} hour${mins >= 120 ? 's' : ''}`
          : `in ${mins} minutes`;
        let text = `${a.title} ${when}`;
        if (a.place) text += `, at ${a.place}`;
        if (a.withWhom) text += `, with ${a.withWhom}`;
        text += '.';
        Store.log(EV.APPT_REMIND, { detail: a.title });
        this.onFire && this.onFire('appt', { appt: a, text, mins });
        await Speech.say(text, { tag: 'appointment' });
        return true;
      }
    }
    return false;
  },

  /* -------------------------------------------------------- reminiscence
     One per day, after 15:00 — late afternoon is when restlessness and
     "sundowning" tend to build. Individual reminiscence is the delivery mode
     the evidence supports; across 14 RCTs a significant cognitive effect
     appeared only for individual, not group, delivery. */
  async reminiscence(now) {
    if (now.getHours() < 15) return false;
    const key = 'reminisce';
    if (Store.hasFired(key)) return false;
    const bank = Store.s.lifeStory;
    if (!bank.length) return false;
    if (Store.wearMsToday() < 5000) return false;

    Store.markFired(key);
    // rotate by day-of-year so he does not hear the same memory every day
    const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const item = bank[doy % bank.length];
    const opener = { work: 'Do you remember', home: 'Do you remember',
                     song: 'Do you remember this one', event: 'Do you remember' }[item.kind] || 'Do you remember';
    const text = `${opener} — ${item.label}. ${item.detail}`;
    Store.log(EV.REMINISCE, { detail: item.label });
    this.onFire && this.onFire('reminisce', { item, text });
    await Speech.say(text, { tag: 'reminiscence' });
    return true;
  },

  /* -------------------------------------------------------------- helpers */
  _minutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  },
  _nextMedToday(now) {
    const mins = now.getHours() * 60 + now.getMinutes();
    return Store.s.meds
      .filter(m => m.time && this._minutes(m.time) > mins)
      .sort((a, b) => this._minutes(a.time) - this._minutes(b.time))[0] || null;
  },

  /** Preview for the caregiver: exactly what he will hear, and when. */
  previewToday() {
    const now = new Date();
    const out = [];
    const day = now.toLocaleDateString('en-GB', { weekday: 'long' });
    out.push({ time: '07:00', kind: 'briefing', text: `Good morning. Today is ${day}. …` });
    Store.s.meds.forEach(m => out.push({
      time: m.time, kind: 'med',
      text: `It is ${(m.time || '').replace(':', ' ')}. Time for your ${m.name}, ${m.desc}.`,
    }));
    Store.s.appointments
      .filter(a => new Date(a.when).toDateString() === now.toDateString())
      .forEach(a => (a.remind || []).forEach(mins => {
        if (mins >= 1440) return;
        out.push({
          time: Fmt.hm(a.when - mins * 60000), kind: 'appt',
          text: `${a.title} in ${mins >= 60 ? Math.round(mins / 60) + ' hour' : mins + ' minutes'}${a.place ? ', at ' + a.place : ''}.`,
        });
      }));
    if (Store.s.lifeStory.length) {
      const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
      const it = Store.s.lifeStory[doy % Store.s.lifeStory.length];
      out.push({ time: '15:00', kind: 'reminisce', text: `Do you remember — ${it.label}. ${it.detail}` });
    }
    return out.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  },
};

window.Schedule = Schedule;
