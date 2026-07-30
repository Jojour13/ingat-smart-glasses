/* ============================================================================
   geo.js — a safe zone, not a map with a dot on it

   Two reasons this is not "track grandad on a map".

   1. CARA already owns safe return in Singapore. It is national, free, run by
      Dementia Singapore, and it has a physical card with a QR code that any
      member of the public can scan. Competing with it would be stupid;
      the sane move is to raise the alarm earlier and hand off to it.

   2. Live location tracking is the most surveillance-shaped feature this
      product could possibly have. A working daughter does not want to watch a
      map all day — she wants to be told when something is wrong. A geofence
      gives her that and gives him his afternoon back.

   So: no continuous position display. A home zone, an alert when he leaves it,
   and — the part that matters — a bearing home spoken into HIS ear, so the
   same sensor that reassures her also helps him.
   ==========================================================================*/

const Geo = {
  watching: false,
  onEvent: null,             // (kind, payload)
  _watchId: null,
  _lastAnnounce: 0,

  get available() {
    return typeof navigator !== 'undefined' && !!navigator.geolocation;
  },

  /** Location is its own PDPA purpose, separately revocable. */
  get permitted() {
    const c = Store.s.consent;
    return !!(c && c.purposes && c.purposes.location
              && c.assent.status === 'active' && c.donor.signedTs);
  },

  /** One reading. Used to drop a home pin during setup. */
  fix(timeout = 12000) {
    return new Promise((resolve, reject) => {
      if (!this.available) return reject(new Error('This device has no location sensor.'));
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude,
                       acc: Math.round(p.coords.accuracy), ts: Date.now() }),
        e => reject(new Error(this._err(e))),
        { enableHighAccuracy: true, timeout, maximumAge: 0 });
    });
  },

  start() {
    if (!this.available || !this.permitted || this.watching) return false;
    this._watchId = navigator.geolocation.watchPosition(
      p => this._onFix({ lat: p.coords.latitude, lng: p.coords.longitude,
                         acc: Math.round(p.coords.accuracy), ts: Date.now() }),
      e => this.onEvent && this.onEvent('error', { message: this._err(e) }),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
    this.watching = true;
    return true;
  },

  stop() {
    if (this._watchId !== null) navigator.geolocation.clearWatch(this._watchId);
    this._watchId = null;
    this.watching = false;
  },

  _onFix(fix) {
    Store.s.geo.lastFix = fix;
    // Life-space, derived at the point of measurement. The coordinates are
    // used and discarded; only distance-from-home and a coarse cell survive,
    // so his route is never reconstructable from what we keep.
    const home = Store.s.zones[0];
    if (home && Store.recordFix) Store.recordFix(fix, home);
    const zone = this.nearestZone(fix);
    const inside = !!zone;
    const was = Store.s.geo.inZone;

    if (was === null) {
      Store.s.geo.inZone = inside;
      Store.save();
      return;
    }
    if (inside === was) { Store.save(); return; }

    Store.s.geo.inZone = inside;
    Store.s.geo.lastEvent = { ts: Date.now(), inside };
    Store.log(inside ? EV.GEO_BACK : EV.GEO_LEFT,
              { detail: inside ? (zone ? zone.label : 'safe zone') : this._describeExit(fix) });
    Store.save();
    this.onEvent && this.onEvent(inside ? 'returned' : 'left', { fix, zone });
  },

  /** The zone he is currently inside, or null. */
  nearestZone(fix) {
    for (const z of Store.s.zones) {
      if (this.distance(fix, z) <= (z.radiusM || 250)) return z;
    }
    return null;
  },

  _describeExit(fix) {
    const home = Store.s.zones[0];
    if (!home) return 'left the safe zone';
    const d = Math.round(this.distance(fix, home));
    return `${d} m from ${home.label}`;
  },

  /** Haversine, metres. */
  distance(a, b) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  },

  /** Compass bearing from a to b, in plain words. */
  bearing(a, b) {
    const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
    const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
    const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat))
            - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
    const deg = (toDeg(Math.atan2(y, x)) + 360) % 360;
    const names = ['north', 'north-east', 'east', 'south-east',
                   'south', 'south-west', 'west', 'north-west'];
    return { deg: Math.round(deg), word: names[Math.round(deg / 45) % 8] };
  },

  /**
   * "Which way is home?" — the elder-facing half of this feature, and the
   * reason it is not merely monitoring. Rate-limited so it cannot nag.
   */
  async wayHome(force = false) {
    const home = Store.s.zones[0];
    const fix = Store.s.geo.lastFix;
    const lang = Store.s.patient.language;
    if (!home || !fix) {
      await Speech.say('I am not sure where you are just now.', { lang, tag: 'geo' });
      return null;
    }
    if (!force && Date.now() - this._lastAnnounce < 60000) return null;
    this._lastAnnounce = Date.now();

    const d = Math.round(this.distance(fix, home));
    const b = this.bearing(fix, home);
    const walk = Math.max(1, Math.round(d / 75));   // ~4.5 km/h
    const text = d < (home.radiusM || 250)
      ? `You are close to ${home.label}.`
      : `${home.label} is ${b.word} of here, about ${d < 950 ? d + ' metres' : (d / 1000).toFixed(1) + ' kilometres'} away. About ${walk} minute${walk === 1 ? '' : 's'} walk.`;
    Store.log(EV.GEO_HOME, { detail: text });
    await Speech.say(text, { lang, tag: 'geo' });
    return { d, bearing: b };
  },

  _err(e) {
    if (!e) return 'Location failed.';
    if (e.code === 1) return 'Location permission was refused. Allow it in the address bar, then reload.';
    if (e.code === 2) return 'Position unavailable — no GPS or network fix. Try outdoors.';
    if (e.code === 3) return 'Location timed out. Indoors this can take a while; try near a window.';
    return e.message || 'Location failed.';
  },

  /** For the caregiver: how far out, without showing a live map. */
  status() {
    const home = Store.s.zones[0];
    const fix = Store.s.geo.lastFix;
    if (!home) return { state: 'no-zone' };
    if (!fix) return { state: 'no-fix', home };
    const d = Math.round(this.distance(fix, home));
    return {
      state: d <= (home.radiusM || 250) ? 'inside' : 'outside',
      home, metres: d, accuracy: fix.acc, ts: fix.ts,
      bearing: this.bearing(home, fix),
    };
  },
};

window.Geo = Geo;
