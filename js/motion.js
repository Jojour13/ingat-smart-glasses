/* ============================================================================
   motion.js — is he actually wearing them?

   The original idea was simple and right: if the glasses have not moved for
   twenty minutes, power down and tell the family. Worn glasses are never
   perfectly still — a head micro-moves constantly, even sitting down. Twenty
   minutes of genuine stillness means they are on a table.

   The first version inferred movement from face detections, which is wrong in
   an obvious way: sit him in front of a blank wall and the system decides he
   has taken his glasses off. This uses the real accelerometer instead, and
   only falls back to camera activity when there is no sensor.

   On a phone over HTTPS this is a true hardware reading, which matters because
   the phone IS the Phase 1 device — it carries the camera while the Eyewear 2
   carries the audio.

   iOS 13+ requires an explicit permission prompt triggered by a user gesture,
   hence request().
   ==========================================================================*/

const Motion = {
  source: 'none',          // 'accelerometer' | 'camera' | 'none'
  lastMotionTs: 0,
  moving: false,
  magnitude: 0,            // smoothed movement energy, for the UI
  onWake: null,            // fired when movement resumes after a still period
  onStill: null,           // fired once the still threshold is crossed

  // m/s^2 of change that counts as "moved". Set low deliberately, because the
  // two failure modes are not symmetric:
  //   too high -> we decide he is not wearing them when he is. His medication
  //               prompt is then suppressed, and his daughter gets a false
  //               alert. A missed dose is real harm.
  //   too low  -> wear time is slightly overstated. Nobody is hurt.
  // So err toward "still on his face". Twenty minutes below even this is
  // genuinely a table, not a person sitting quietly.
  THRESHOLD: 0.18,
  _prev: null,
  _listening: false,
  _wasStill: false,
  _stillMs: 20 * 60 * 1000,

  get available() {
    return typeof window !== 'undefined' && typeof window.DeviceMotionEvent !== 'undefined';
  },

  /** iOS 13+ gates the sensor behind a permission prompt. */
  get needsPermission() {
    return this.available && typeof DeviceMotionEvent.requestPermission === 'function';
  },

  /**
   * Ask for sensor access. MUST be called from a click handler on iOS.
   * @returns {Promise<boolean>} granted
   */
  async request() {
    if (!this.available) return false;
    if (!this.needsPermission) return true;
    try {
      const res = await DeviceMotionEvent.requestPermission();
      return res === 'granted';
    } catch (e) {
      console.warn('motion: permission failed', e);
      return false;
    }
  },

  /** Begin listening. Falls back silently if there is no usable sensor. */
  async start(stillMs) {
    if (stillMs) this._stillMs = stillMs;
    this.lastMotionTs = Date.now();

    if (!this.available) { this.source = 'camera'; return this.source; }
    const ok = await this.request();
    if (!ok) { this.source = 'camera'; return this.source; }

    if (!this._listening) {
      this._handler = e => this._onMotion(e);
      window.addEventListener('devicemotion', this._handler, { passive: true });
      this._listening = true;
    }

    // A laptop reports the event but never fires it. Give it a moment; if
    // nothing arrives, quietly fall back rather than claiming a sensor we
    // do not have.
    this.source = 'accelerometer';
    this._probe = setTimeout(() => {
      if (!this._gotAny) {
        this.source = 'camera';
        console.info('motion: no accelerometer data, using camera activity');
      }
    }, 2500);

    return this.source;
  },

  stop() {
    if (this._listening) {
      window.removeEventListener('devicemotion', this._handler);
      this._listening = false;
    }
    clearTimeout(this._probe);
    this.source = 'none';
    this._prev = null;
    this._gotAny = false;
  },

  _onMotion(e) {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x === null) return;
    this._gotAny = true;

    const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    if (this._prev !== null) {
      const delta = Math.abs(mag - this._prev);
      // low-pass so a single jolt does not dominate, and jitter does not count
      this.magnitude = this.magnitude * 0.8 + delta * 0.2;
      if (delta > this.THRESHOLD) this._registerMovement();

      // Feed the actigraphy epoch. This is the same signal wrist actigraphy
      // records, and it is what interdaily stability, intradaily variability
      // and relative amplitude are computed from.
      if (typeof Store !== 'undefined' && Store.recordActivity) Store.recordActivity(delta);
    }
    this._prev = mag;
  },

  /** The camera fallback calls this when it sees a face. */
  noteCameraActivity() {
    if (this.source !== 'accelerometer') this._registerMovement();
  },

  _registerMovement() {
    const now = Date.now();
    this.moving = true;
    this.lastMotionTs = now;
    if (this._wasStill) {
      this._wasStill = false;
      this.onWake && this.onWake();      // picked up again — like a phone waking
    }
  },

  /** How long since anything moved. */
  stillFor() { return Date.now() - this.lastMotionTs; },

  /**
   * Poll this on a timer. Returns true the moment the still threshold is
   * crossed, once, so the caller can power down and notify.
   */
  checkStill() {
    if (this.stillFor() >= this._stillMs) {
      if (!this._wasStill) {
        this._wasStill = true;
        this.moving = false;
        this.onStill && this.onStill();
        return true;
      }
    }
    return false;
  },

  /** Human-readable, for the UI. */
  describe() {
    if (this.source === 'accelerometer') return 'motion sensor';
    if (this.source === 'camera') return 'inferred from camera';
    return 'not running';
  },
};

window.Motion = Motion;
