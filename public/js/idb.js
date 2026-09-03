/**
 * MAP NOTES - DURABLE CLIENT STORAGE (IndexedDB)
 * Ensures route points survive browser suspension, app backgrounding, and signal dead zones.
 */

class RouteIDB {
  constructor() {
    this.dbName = 'MapNotesLocalDB';
    this.version = 1;
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('route_points_queue')) {
          const store = db.createObjectStore('route_points_queue', { keyPath: 'client_id' });
          store.createIndex('synced', 'synced', { unique: false });
          store.createIndex('recorded_at', 'recorded_at', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error('[IndexedDB] Open error:', e);
        reject(e);
      };
    });
  }

  // Save a recorded point immediately to disk
  async addPoint(point) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('route_points_queue', 'readwrite');
      const store = tx.objectStore('route_points_queue');
      const item = {
        client_id: point.client_id || 'pt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
        lat: point.lat,
        lng: point.lng,
        accuracy: point.accuracy,
        speed: point.speed,
        recorded_at: point.recorded_at, // True client-recorded timestamp
        synced: 0
      };

      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = (err) => reject(err);
    });
  }

  // Get all points waiting to be uploaded
  async getPendingPoints(limit = 100) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('route_points_queue', 'readonly');
      const store = tx.objectStore('route_points_queue');
      const index = store.index('synced');
      const req = index.getAll(IDBKeyRange.only(0));

      req.onsuccess = () => {
        const items = req.result || [];
        resolve(items.slice(0, limit));
      };
      req.onerror = (err) => reject(err);
    });
  }

  // Confirm server sync before removing or marking synced
  async markPointsSynced(clientIds) {
    if (!clientIds || clientIds.length === 0) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('route_points_queue', 'readwrite');
      const store = tx.objectStore('route_points_queue');

      let completed = 0;
      clientIds.forEach(id => {
        const delReq = store.delete(id);
        delReq.onsuccess = () => {
          completed++;
          if (completed === clientIds.length) resolve();
        };
        delReq.onerror = (e) => reject(e);
      });
    });
  }

  // Get total pending queue count
  async getPendingCount() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('route_points_queue', 'readonly');
      const store = tx.objectStore('route_points_queue');
      const index = store.index('synced');
      const countReq = index.count(IDBKeyRange.only(0));

      countReq.onsuccess = () => resolve(countReq.result);
      countReq.onerror = (err) => reject(err);
    });
  }
}

window.routeIDB = new RouteIDB();
