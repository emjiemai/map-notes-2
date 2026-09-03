/**
 * MAP NOTES - ROUTE TRACKER FOR REIMBURSEMENT
 * 1. Strictly distance-based (15m+), NEVER timer-based (prevents GPS jitter inflation).
 * 2. Active during configured working hours only (e.g. 11:00–16:00).
 * 3. Commits to IndexedDB first before sync, surviving dead zones and suspensions.
 * 4. Preserves true client-recorded timestamp.
 * 5. Screen Wake Lock & Battery Optimization guidance.
 */

class RouteTracker {
  constructor() {
    this.watchId = null;
    this.isTracking = false;
    this.lastRecordedPoint = null;
    this.distanceThresholdMeters = 15; // 15 meters
    this.workingHoursStart = '11:00';
    this.workingHoursEnd = '16:00';
    this.wakeLock = null;
    this.syncInterval = null;
    this.syncing = false;

    this.onStatusChange = null;
    this.onPointLogged = null;
  }

  async init(config = {}) {
    if (config.working_hours_start) this.workingHoursStart = config.working_hours_start;
    if (config.working_hours_end) this.workingHoursEnd = config.working_hours_end;
    if (config.distance_threshold_meters) this.distanceThresholdMeters = parseFloat(config.distance_threshold_meters);

    // Sync pending queue whenever browser re-gains connectivity or app becomes visible
    window.addEventListener('online', () => this.flushPendingQueue());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.flushPendingQueue();
        this.reacquireWakeLock();
      }
    });

    // Run background sync flusher every 20 seconds
    this.syncInterval = setInterval(() => this.flushPendingQueue(), 20000);
  }

  // Calculate distance between two GPS coordinates
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // meters
    const toRad = deg => (deg * Math.PI) / 180;
    const phi1 = toRad(lat1);
    const phi2 = toRad(lat2);
    const deltaPhi = toRad(lat2 - lat1);
    const deltaLambda = toRad(lon2 - lon1);

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  // Check if current time is within configured working hours (e.g. 11:00 to 16:00)
  isWithinWorkingHours() {
    const now = new Date();
    const [startH, startM] = this.workingHoursStart.split(':').map(Number);
    const [endH, endM] = this.workingHoursEnd.split(':').map(Number);

    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  async start() {
    if (!('geolocation' in navigator)) {
      alert('Geolocation is not supported by your browser.');
      return false;
    }

    this.isTracking = true;
    this.notifyStatus();

    // 1. Request Screen Wake Lock if available (keeps mobile screen awake during field shift)
    await this.requestWakeLock();

    // 2. Start high-accuracy GPS watch
    const options = {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    };

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePositionUpdate(pos),
      (err) => {
        console.warn('[RouteTracker] GPS watchPosition error:', err.message);
        this.notifyStatus(`GPS Warning: ${err.message}`);
      },
      options
    );

    return true;
  }

  stop() {
    this.isTracking = false;
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.releaseWakeLock();
    this.notifyStatus();
  }

  toggle() {
    if (this.isTracking) {
      this.stop();
    } else {
      this.start();
    }
    return this.isTracking;
  }

  async handlePositionUpdate(pos) {
    if (!this.isTracking) return;

    // A. Check Working Hours: Never log outside shift hours
    if (!this.isWithinWorkingHours()) {
      this.notifyStatus(`Shift Idle (Runs ${this.workingHoursStart}–${this.workingHoursEnd})`);
      return;
    }

    const { latitude, longitude, accuracy, speed } = pos.coords;
    const recordedAt = new Date(pos.timestamp || Date.now()).toISOString();

    // Reject bad accuracy readings (> 45 meters) to avoid false jumps
    if (accuracy && accuracy > 45) {
      console.log('[RouteTracker] Ignored low accuracy point:', accuracy);
      return;
    }

    // B. Distance-Based Check: Must have moved at least threshold (e.g. 15m)
    if (this.lastRecordedPoint) {
      const dist = this.calculateDistance(
        this.lastRecordedPoint.lat,
        this.lastRecordedPoint.lng,
        latitude,
        longitude
      );

      if (dist < this.distanceThresholdMeters) {
        // Stationary or micro GPS jitter — IGNORE to prevent fake mileage inflation!
        return;
      }
    }

    // C. Valid Movement Logged!
    const point = {
      lat: latitude,
      lng: longitude,
      accuracy: accuracy || null,
      speed: speed || null,
      recorded_at: recordedAt // True client recorded timestamp
    };

    this.lastRecordedPoint = point;

    // D. DURABLE PERSISTENCE: Write to IndexedDB FIRST before attempting upload!
    try {
      if (window.routeIDB) {
        await window.routeIDB.addPoint(point);
      }
    } catch (e) {
      console.error('[RouteTracker] Failed to commit point to IndexedDB:', e);
    }

    if (this.onPointLogged) {
      this.onPointLogged(point);
    }

    this.notifyStatus('Active (Tracking Movement)');

    // E. Attempt immediate sync in background
    this.flushPendingQueue();
  }

  // Flush pending points from IndexedDB to server
  async flushPendingQueue() {
    if (this.syncing || !window.routeIDB || !window.api || !window.api.currentUser) return;
    this.syncing = true;

    try {
      const pending = await window.routeIDB.getPendingPoints(60);
      if (pending.length === 0) {
        this.syncing = false;
        return;
      }

      // Upload to server (preserves client true recorded_at timestamps)
      const res = await window.api.uploadRouteBatch(pending);

      if (res && res.success) {
        // ONLY mark as synced / delete on device after server confirms receipt!
        const clientIds = pending.map(p => p.client_id);
        await window.routeIDB.markPointsSynced(clientIds);
        console.log(`[RouteTracker] Synced ${res.count} route points to server.`);
      }
    } catch (err) {
      console.warn('[RouteTracker] Offline or server unreachable. Points safely queued in IndexedDB.');
    } finally {
      this.syncing = false;
    }
  }

  async requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      } catch (err) {
        console.warn('[WakeLock] Could not acquire:', err.name, err.message);
      }
    }
  }

  async reacquireWakeLock() {
    if (this.isTracking && !this.wakeLock) {
      await this.requestWakeLock();
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  notifyStatus(customMsg) {
    if (this.onStatusChange) {
      let msg = customMsg;
      if (!msg) {
        if (!this.isTracking) msg = 'Tracking Inactive';
        else if (!this.isWithinWorkingHours()) msg = `Shift Idle (Hours: ${this.workingHoursStart}–${this.workingHoursEnd})`;
        else msg = 'Active (Logging Movement ≥15m)';
      }
      this.onStatusChange(this.isTracking, msg);
    }
  }
}

window.tracker = new RouteTracker();
