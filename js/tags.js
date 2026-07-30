/* ============================================================================
   tags.js — Bluetooth tags on the things he loses

   "Where is my phone?" is the question. The honest answer is usually not a
   place — it is a sound. A tag that beeps solves finding better than any
   camera can, works inside a drawer or under a cushion, costs a few dollars,
   and needs no recognition model.

   REAL WEB BLUETOOTH, where the browser allows it:
     navigator.bluetooth.requestDevice() → pair
     GATT → Immediate Alert Service (0x1802) → write 0x02 → the tag beeps
   That is the actual standard "find me" profile used by commercial trackers,
   so this is not a mock — it will ring a real BLE tag that implements IAS.

   WHAT IS HONESTLY NOT POSSIBLE IN A BROWSER:
     · AirTags and Tile are locked to their own apps and cannot be paired here.
     · Continuous background scanning is not exposed to web pages, so a tag
       cannot be tracked passively — every ring needs a user gesture.
     · Safari and Firefox have no Web Bluetooth at all.
   Where the API is missing we degrade to a simulated ring and SAY SO in the
   interface, because a fake success indistinguishable from a real one is the
   worst thing a demo can contain.
   ==========================================================================*/

const Tags = {
  IMMEDIATE_ALERT: 0x1802,
  ALERT_LEVEL: 0x2a06,
  HIGH_ALERT: 0x02,

  _connections: new Map(),      // tagId -> BluetoothDevice

  get available() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  },

  /** Some browsers expose the API but refuse in an insecure context. */
  async ready() {
    if (!this.available) return false;
    try {
      if (navigator.bluetooth.getAvailability) return await navigator.bluetooth.getAvailability();
      return true;
    } catch (_) { return false; }
  },

  /**
   * Pair a new tag. MUST be called from a click — the browser shows its own
   * device chooser and will throw otherwise.
   * @returns {Promise<{deviceId, deviceName}>}
   */
  async pair() {
    if (!this.available) throw new Error(this._noApi());
    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        // Anything that can be rung, plus anything at all as a fallback so the
        // chooser is not empty when a tag advertises an odd service set.
        filters: [{ services: [this.IMMEDIATE_ALERT] }],
        optionalServices: [this.IMMEDIATE_ALERT, 'battery_service', 'device_information'],
      });
    } catch (e) {
      if (e && e.name === 'NotFoundError') {
        // user closed the chooser, or nothing advertised the alert service
        device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [this.IMMEDIATE_ALERT, 'battery_service', 'device_information'],
        });
      } else {
        throw new Error(this._err(e));
      }
    }
    return { deviceId: device.id, deviceName: device.name || 'Unnamed tag', _device: device };
  },

  /**
   * Make a tag beep. Returns how it went, honestly.
   * @returns {Promise<{rang:boolean, real:boolean, reason?:string, rssi?:number}>}
   */
  async ring(tag) {
    if (!this.available) {
      return { rang: true, real: false, reason: this._noApi() };
    }
    try {
      const device = this._connections.get(tag.id);
      if (!device) {
        return { rang: true, real: false,
                 reason: 'Not connected in this session. A browser cannot silently reconnect to a Bluetooth device — pair it again to ring it for real.' };
      }
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(this.IMMEDIATE_ALERT);
      const ch = await service.getCharacteristic(this.ALERT_LEVEL);
      await ch.writeValue(new Uint8Array([this.HIGH_ALERT]));
      return { rang: true, real: true };
    } catch (e) {
      return { rang: false, real: false, reason: this._err(e) };
    }
  },

  /** Remember the live device object for this session so ring() can use it. */
  remember(tagId, device) {
    if (device) this._connections.set(tagId, device);
  },

  connected(tagId) { return this._connections.has(tagId); },

  /**
   * Turn signal strength into something a person can act on. Distance from
   * RSSI is notoriously unreliable indoors, so this deliberately reports
   * coarse bands rather than a number pretending to be metres.
   */
  proximity(rssi) {
    if (rssi === null || rssi === undefined) return { band: 'unknown', words: 'somewhere in the flat' };
    if (rssi > -55) return { band: 'here',  words: 'very close — within arm’s reach' };
    if (rssi > -70) return { band: 'near',  words: 'in this room' };
    if (rssi > -85) return { band: 'far',   words: 'in the next room' };
    return { band: 'edge', words: 'a long way off, or the battery is low' };
  },

  _noApi() {
    return 'This browser has no Web Bluetooth. Chrome or Edge on Android, Windows or macOS can ring a real tag; '
         + 'Safari and iOS cannot, and no browser can pair with an AirTag or a Tile.';
  },

  _err(e) {
    if (!e) return 'Bluetooth failed.';
    if (e.name === 'NotFoundError')      return 'No tag was chosen.';
    if (e.name === 'SecurityError')      return 'Bluetooth needs a secure page — use the https:// address.';
    if (e.name === 'NotSupportedError')  return 'That device does not support the find-me profile, so it cannot be rung.';
    if (e.name === 'NetworkError')       return 'Lost the connection to the tag. It may be out of range or asleep.';
    if (e.name === 'NotAllowedError')    return 'Bluetooth permission was refused.';
    return e.message || 'Bluetooth failed.';
  },
};

window.Tags = Tags;
