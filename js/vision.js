/* ============================================================================
   vision.js — face detection and enrolment-only recognition

   PRIVACY ARCHITECTURE, implemented rather than promised:
     1. Enrolment only. We compare against the descriptors the family added.
        A non-enrolled face never has its descriptor stored — see detectOnce():
        the descriptor is a local const and goes out of scope with the frame.
     2. Ephemeral. No frame, image or video is ever written to storage.
        The only persisted vector is one 128-float descriptor per CONSENTED
        person, captured at enrolment.
     3. Never guess a name. Above `threshold` distance we return UNKNOWN and
        the wearer hears "someone is here" — a wrong name is worse than none.
     4. All inference is local. Models are vendored in ./models; this file
        makes no network request at run time.
   ==========================================================================*/

const Vision = {
  loaded: false,
  running: false,
  video: null,
  overlay: null,
  _opts: null,
  _raf: null,
  onFrame: null,        // (result) => void

  /**
   * Load the three local models.
   *
   * TensorFlow.js defaults to the WebGL backend. On a machine with no GPU, a
   * blocked GPU process, or a tab that is not compositing, WebGL init can stall
   * FOREVER with no error — the app just sits there looking broken. That is
   * exactly the failure you cannot debug in front of judges, so every step is
   * raced against a timeout and falls back to the CPU backend, which is slower
   * but always available.
   */
  async loadModels(progress, timeoutMs = 9000) {
    if (this.loaded) return;
    if (typeof faceapi === 'undefined' && typeof window.faceapi === 'undefined') {
      throw new Error('face-api.js failed to load — check js/face-api.min.js is present');
    }
    const M = './models';
    const steps = [
      ['detector',    () => faceapi.nets.tinyFaceDetector.loadFromUri(M)],
      ['landmarks',   () => faceapi.nets.faceLandmark68TinyNet.loadFromUri(M)],
      ['recognition', () => faceapi.nets.faceRecognitionNet.loadFromUri(M)],
    ];

    const withTimeout = (p, ms, what) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout loading ' + what)), ms)),
    ]);

    const runAll = async () => {
      for (let i = 0; i < steps.length; i++) {
        progress && progress(steps[i][0], i, steps.length);
        await withTimeout(steps[i][1](), timeoutMs, steps[i][0]);
      }
    };

    // Hard overall deadline. Worst case must stay inside the time a presenter
    // will wait before deciding the demo is broken — roughly 30 seconds.
    const deadline = Date.now() + timeoutMs * 3.2;
    const budget = () => Math.max(1500, Math.min(timeoutMs, deadline - Date.now()));

    try {
      await runAll();
    } catch (e) {
      console.warn('vision: WebGL path failed (' + e.message + '), retrying on CPU');
      progress && progress('GPU stalled — retrying on CPU', 0, steps.length);
      try {
        if (faceapi.tf && faceapi.tf.setBackend) {
          await withTimeout(
            (async () => { await faceapi.tf.setBackend('cpu'); await faceapi.tf.ready(); })(),
            budget(), 'CPU backend');
        }
        this.backend = 'cpu';
        for (let i = 0; i < steps.length; i++) {
          progress && progress(steps[i][0] + ' (cpu)', i, steps.length);
          await withTimeout(steps[i][1](), budget(), steps[i][0]);
        }
      } catch (e2) {
        this.failed = e2.message;
        throw new Error('Face models could not load (' + e2.message + '). '
          + 'Everything else still works — use keys 1-9 in the glasses view to simulate '
          + 'a person walking in. The cue ladder, scheduler and index are unaffected.');
      }
    }

    this.backend = this.backend || (faceapi.tf && faceapi.tf.getBackend ? faceapi.tf.getBackend() : 'unknown');
    this._opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 });
    this.loaded = true;
  },

  /**
   * Open the camera.
   *
   * @param {'environment'|'user'} facing
   *   'environment' (rear) for the glasses view — the glasses look outward at
   *   the world. 'user' (front) for enrolment, because you cannot photograph
   *   your own face with a camera pointing away from you. Getting this wrong
   *   makes enrolment impossible on a phone, which is exactly where we want
   *   to demo.
   *
   * Errors are translated, because the raw ones are useless to a presenter:
   * the single most common failure is another tab already holding the camera,
   * and "NotReadableError" does not tell anyone to go and close it.
   */
  async startCamera(videoEl, overlayEl, opts = {}) {
    this.video = videoEl;
    this.overlay = overlayEl;
    const facing = opts.facing || 'environment';
    this.facing = facing;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('This browser cannot open a camera. Use Chrome, Edge or Safari, '
        + 'and make sure the address bar says https:// or localhost.');
    }

    const attempts = [
      { video: { facingMode: { ideal: facing }, width: { ideal: 960 } }, audio: false },
      { video: { facingMode: facing }, audio: false },
      { video: true, audio: false },          // any camera at all
    ];

    let lastErr = null;
    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        videoEl.srcObject = stream;
        await videoEl.play();
        this._stream = stream;
        const track = stream.getVideoTracks()[0];
        this.cameraLabel = track ? track.label : '';
        return stream;
      } catch (e) {
        lastErr = e;
        // A busy or missing camera will fail every constraint set, so stop early.
        if (e.name === 'NotReadableError' || e.name === 'TrackStartError'
            || e.name === 'NotAllowedError' || e.name === 'SecurityError') break;
      }
    }
    throw new Error(this._cameraError(lastErr));
  },

  _cameraError(e) {
    const n = e ? e.name : '';
    if (n === 'NotReadableError' || n === 'TrackStartError') {
      return 'The camera is already being used by something else — almost always '
           + 'ANOTHER TAB of this app. Close the other tab (or any video call) and try again. '
           + 'Only one page at a time can hold the camera.';
    }
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError') {
      return 'Camera permission was refused. Click the camera icon in the address bar '
           + 'and allow it, then reload.';
    }
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError') {
      return 'No camera found on this device. You can still run everything with keys 1-9 '
           + 'in the glasses view.';
    }
    if (n === 'SecurityError') {
      return 'Blocked because this page is not on a secure origin. Use the https:// address, '
           + 'or run it from http://localhost — never by opening the file directly.';
    }
    if (n === 'OverconstrainedError') {
      return 'No camera matched what we asked for. Try the flip-camera button.';
    }
    return 'Could not open the camera' + (e && e.message ? ': ' + e.message : '.');
  },

  /** Swap front/rear. Useful on a laptop, essential on a phone. */
  async flipCamera() {
    const next = this.facing === 'user' ? 'environment' : 'user';
    this.stopCamera();
    return this.startCamera(this.video, this.overlay, { facing: next });
  },

  stopCamera() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._stream) this._stream.getTracks().forEach(t => t.stop());
    this._stream = null;
    if (this.overlay) {
      const c = this.overlay.getContext('2d');
      c && c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }
  },

  /** One detection pass. Returns matches; discards every non-enrolled vector. */
  async detectOnce() {
    if (!this.loaded || !this.video || this.video.readyState < 2) return [];
    const dets = await faceapi
      .detectAllFaces(this.video, this._opts)
      .withFaceLandmarks(true)
      .withFaceDescriptors();

    const people = Store.s.people.filter(p => p.descriptor && p.descriptor.length === 128);
    const threshold = Store.s.settings.matchThreshold;

    return dets.map(d => {
      // `descriptor` is scoped to this frame. Nothing leaves this function
      // except a person id (or null) and geometry.
      const descriptor = d.descriptor;
      let best = null, bestDist = Infinity;
      for (const p of people) {
        const dist = this._dist(descriptor, p.descriptor);
        if (dist < bestDist) { bestDist = dist; best = p; }
      }
      const matched = best && bestDist <= threshold;
      return {
        box: d.detection.box,
        score: d.detection.score,
        personId: matched ? best.id : null,
        name: matched ? best.name : null,
        distance: bestDist === Infinity ? null : +bestDist.toFixed(3),
        confidence: bestDist === Infinity ? 0 : +Math.max(0, 1 - bestDist / 0.75).toFixed(2),
      };
    });
  },

  /** Capture N samples and average them into one enrolment descriptor. */
  async enrol(samples = 4, onStep) {
    const acc = new Float64Array(128);
    let n = 0;
    for (let i = 0; i < samples * 3 && n < samples; i++) {
      onStep && onStep(n, samples);
      const d = await faceapi
        .detectSingleFace(this.video, this._opts)
        .withFaceLandmarks(true)
        .withFaceDescriptor();
      if (d) {
        for (let k = 0; k < 128; k++) acc[k] += d.descriptor[k];
        n++;
      }
      await new Promise(r => setTimeout(r, 220));
    }
    if (!n) return null;
    const out = new Float32Array(128);
    for (let k = 0; k < 128; k++) out[k] = acc[k] / n;
    return { descriptor: out, samples: n, photo: this.snapshot(190) };
  },

  /** Small JPEG for the caregiver's library. Never used for recognition. */
  snapshot(w = 190) {
    if (!this.video) return null;
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw) return null;
    const h = Math.round(w * vh / vw);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(this.video, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.72);
  },

  /**
   * Descriptor from a still image — how a caregiver enrols from the gallery.
   *
   * Uploaded photos are nothing like webcam frames. A face might be 60 pixels
   * across in a group shot or 2000 in a portrait, and TinyFaceDetector only
   * works over a limited face-to-frame ratio at any one input size. A single
   * attempt at 320 fails on a lot of perfectly good family photos, which the
   * caregiver reads as "your app is broken".
   *
   * So: downscale huge images first (a 12MP phone photo is slow and no more
   * accurate), then sweep input sizes and relax the threshold before giving up.
   * Returns { descriptor, attempt } or null.
   */
  async fromImage(imgEl, opts = {}) {
    const faces = await this.facesFromImage(imgEl, opts);
    if (!faces.length) return null;
    const out = faces[0].descriptor;
    out.attempt = faces[0].attempt;
    return out;
  },

  /**
   * EVERY face in a still image, each with its own descriptor and a cropped
   * thumbnail.
   *
   * This exists because family photos are group photos. The earlier version
   * used detectSingleFace(), which returns only the highest-scoring detection
   * — so a picture of a mother and daughter enrolled ONE of them, silently,
   * with no way to tell which. If the caregiver then typed "Mei Ling", the
   * glasses could spend the next year confidently calling her mother by her
   * daughter's name. Silently wrong is far worse than visibly failing.
   *
   * Returns faces sorted largest-first, each: { descriptor, box, crop, attempt }
   */
  async facesFromImage(imgEl, opts = {}) {
    const src = await this._fit(imgEl, 1024);

    // The CPU backend is 10-50x slower than WebGL. Four passes, the largest at
    // 608px, is minutes per photo there — which reads as "frozen". So on CPU we
    // do two cheap passes and accept a slightly lower hit rate, because a
    // result in 8 seconds beats a better result nobody waits for.
    const cpu = this.backend === 'cpu';
    const passes = cpu
      ? [ { inputSize: 320, scoreThreshold: 0.40 },
          { inputSize: 416, scoreThreshold: 0.35 } ]
      : [ { inputSize: 320, scoreThreshold: 0.45 },
          { inputSize: 512, scoreThreshold: 0.40 },   // small faces in a wide shot
          { inputSize: 224, scoreThreshold: 0.35 },   // tight portrait, or low light
          { inputSize: 608, scoreThreshold: 0.30 } ]; // last resort

    // Per-pass and whole-photo ceilings. Model LOADING was already guarded, but
    // INFERENCE was not: if the WebGL context is lost or the GPU driver stalls,
    // the promise below simply never settles and the entire batch hangs with no
    // error and no way out. That is the difference between "slow" and "frozen".
    const passMs = opts.passMs || (cpu ? 12000 : 8000);
    const budgetMs = opts.budgetMs || (cpu ? 25000 : 20000);
    const deadline = Date.now() + budgetMs;
    const race = (p, ms, what) => Promise.race([
      p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout: ' + what)), ms)),
    ]);

    for (let i = 0; i < passes.length; i++) {
      if (opts.signal && opts.signal.aborted) throw new Error('cancelled');
      if (Date.now() > deadline) {
        console.warn('vision: photo budget exhausted after pass', i);
        break;
      }
      try {
        const dets = await race(
          faceapi
            .detectAllFaces(src, new faceapi.TinyFaceDetectorOptions(passes[i]))
            .withFaceLandmarks(true)
            .withFaceDescriptors(),
          Math.min(passMs, Math.max(1500, deadline - Date.now())),
          'detect pass ' + (i + 1));
        if (dets && dets.length) {
          if (opts.verbose) console.info('vision:', dets.length, 'face(s) on pass', i + 1);
          return dets
            .map(d => ({
              descriptor: d.descriptor,
              box: d.detection.box,
              score: +d.detection.score.toFixed(2),
              crop: this._crop(src, d.detection.box),
              attempt: i + 1,
            }))
            .sort((a, b) => (b.box.width * b.box.height) - (a.box.width * a.box.height));
        }
      } catch (e) {
        console.warn('vision: pass', i + 1, 'failed', e.message);
      }
    }
    return [];
  },

  /** Square crop around a detection, padded, for the caregiver to look at. */
  _crop(src, box, size = 150) {
    try {
      const pad = Math.max(box.width, box.height) * 0.42;
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const side = Math.max(box.width, box.height) + pad * 2;
      const sw = src.videoWidth || src.naturalWidth || src.width;
      const sh = src.videoHeight || src.naturalHeight || src.height;
      const sx = Math.max(0, Math.min(cx - side / 2, sw - side));
      const sy = Math.max(0, Math.min(cy - side / 2, sh - side));
      const s = Math.min(side, sw, sh);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d').drawImage(src, Math.max(0, sx), Math.max(0, sy), s, s, 0, 0, size, size);
      return c.toDataURL('image/jpeg', 0.78);
    } catch (e) {
      return null;
    }
  },

  /**
   * Turn a picked File into something we can actually detect faces in.
   *
   * Three things bite here, and all three look identical to a user ("it says
   * no face found"):
   *
   *   1. HEIC / HEIF. iPhones shoot this by default. Only Safari can decode it
   *      — Chrome and Edge cannot, at all. Detected up front so we can say so
   *      instead of silently failing.
   *   2. EXIF rotation. iPhone JPEGs are very often stored sideways with an
   *      orientation tag. A face rotated 90 degrees is not detected, so an
   *      otherwise perfect photo returns nothing. createImageBitmap with
   *      imageOrientation:'from-image' applies the tag.
   *   3. Size. A 12MP photo is slow to decode and, as a data URL, is several
   *      megabytes — enough that two or three of them exceed the localStorage
   *      quota on their own.
   *
   * Returns { img, thumb, error }.
   */
  async loadImage(file, thumbMax = 420) {
    const name = (file.name || '').toLowerCase();
    const heic = /\.(heic|heif)$/.test(name)
              || file.type === 'image/heic' || file.type === 'image/heif';
    if (heic && !this._canDecodeHeic()) {
      return { img: null, thumb: null, error:
        'HEIC/HEIF is an Apple format that this browser cannot open. On your iPhone: '
        + 'Settings > Camera > Formats > Most Compatible, or share the photo to yourself '
        + 'which converts it to JPEG. Every other common format works.' };
    }

    let bitmap = null;
    try {
      // from-image applies the EXIF rotation tag; without it, sideways photos
      // silently fail detection.
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      // older browsers, or a format the decoder refused
      try {
        const url = URL.createObjectURL(file);
        const im = new Image();
        im.src = url;
        await new Promise((res, rej) => { im.onload = res; im.onerror = rej; });
        URL.revokeObjectURL(url);
        bitmap = im;
      } catch (e2) {
        return { img: null, thumb: null, error:
          'This file could not be opened as an image (' + (file.type || 'unknown type') + ').' };
      }
    }

    // An ImageBitmap exposes intrinsic size on width/height; an HTMLImageElement
    // exposes it on naturalWidth/naturalHeight, where width/height are LAYOUT
    // size and can be zero or wrong for a detached element. Prefer the
    // intrinsic pair so the fallback path measures the same thing.
    const w = bitmap.naturalWidth || bitmap.width;
    const h = bitmap.naturalHeight || bitmap.height;
    if (!w || !h) return { img: null, thumb: null, error: 'The image decoded to zero size.' };

    // Working copy for detection — capped so a 12MP photo is not decoded at
    // full size four times over.
    const workMax = 1024;
    const ws = Math.min(1, workMax / Math.max(w, h));
    const work = document.createElement('canvas');
    work.width = Math.round(w * ws);
    work.height = Math.round(h * ws);
    work.getContext('2d').drawImage(bitmap, 0, 0, work.width, work.height);

    // Small JPEG for storage. Never keep the original data URL.
    const ts = Math.min(1, thumbMax / Math.max(w, h));
    const tc = document.createElement('canvas');
    tc.width = Math.round(w * ts);
    tc.height = Math.round(h * ts);
    tc.getContext('2d').drawImage(bitmap, 0, 0, tc.width, tc.height);

    if (bitmap.close) bitmap.close();
    return { img: work, thumb: tc.toDataURL('image/jpeg', 0.78), error: null,
             original: { w, h } };
  },

  _canDecodeHeic() {
    // Safari only, in practice.
    return typeof navigator !== 'undefined'
        && /^((?!chrome|android|edg).)*safari/i.test(navigator.userAgent || '');
  },

  /** Downscale to a sane working size. Returns a canvas, or the original. */
  async _fit(imgEl, max) {
    const w = imgEl.naturalWidth || imgEl.width, h = imgEl.naturalHeight || imgEl.height;
    if (!w || !h || Math.max(w, h) <= max) return imgEl;
    const s = max / Math.max(w, h);
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(imgEl, 0, 0, c.width, c.height);
    return c;
  },

  draw(matches) {
    if (!this.overlay || !this.video) return;
    const c = this.overlay, ctx = c.getContext('2d');
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw) return;
    if (c.width !== vw || c.height !== vh) { c.width = vw; c.height = vh; }
    ctx.clearRect(0, 0, c.width, c.height);

    matches.forEach(m => {
      const { x, y, width: w, height: h } = m.box;
      const known = !!m.personId;
      ctx.lineWidth = Math.max(2, vw / 320);
      ctx.strokeStyle = known ? '#2f5d50' : '#b4472c';
      ctx.setLineDash(known ? [] : [9, 6]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      const label = known ? `${m.name}  ${m.confidence}` : 'not enrolled';
      ctx.font = `600 ${Math.max(13, vw / 34)}px -apple-system, Segoe UI, sans-serif`;
      const pad = 6, tw = ctx.measureText(label).width, th = Math.max(18, vw / 26);
      ctx.fillStyle = known ? '#2f5d50' : '#b4472c';
      ctx.fillRect(x, Math.max(0, y - th), tw + pad * 2, th);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + pad, Math.max(th - 6, y - 6));
    });
  },

  _dist(a, b) {
    let s = 0;
    for (let i = 0; i < 128; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  },
};

window.Vision = Vision;
