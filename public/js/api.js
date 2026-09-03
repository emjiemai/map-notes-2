/**
 * MAP NOTES - API CLIENT & SESSION MANAGER
 * Friction-free Name + PIN session persistence across cache clears / app reloads
 */

class MapNotesAPI {
  constructor() {
    this.baseUrl = window.location.origin;
    this.currentUser = this.loadStoredUser();
    this.activeTeamId = localStorage.getItem('mapnotes_team_id') || 'default-team';
  }

  loadStoredUser() {
    try {
      const stored = localStorage.getItem('mapnotes_user');
      return stored ? JSON.parse(stored) : null;
    } catch (e) {
      console.warn('Failed to parse stored user:', e);
      return null;
    }
  }

  saveUser(user, teamId) {
    this.currentUser = user;
    this.activeTeamId = teamId || 'default-team';
    localStorage.setItem('mapnotes_user', JSON.stringify(user));
    localStorage.setItem('mapnotes_team_id', this.activeTeamId);
  }

  logout() {
    this.currentUser = null;
    localStorage.removeItem('mapnotes_user');
    window.location.reload();
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    try {
      const res = await fetch(url, { ...options, headers });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorMsg = data.error || `HTTP ${res.status}: ${res.statusText}`;
        console.error(`[API Request Failed] ${endpoint}:`, errorMsg);
        throw new Error(errorMsg);
      }

      return data;
    } catch (err) {
      console.error(`[Network/API Error] ${endpoint}:`, err.message);
      throw err;
    }
  }

  // Auth: Name + PIN
  async login(name, pin) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ name, pin })
    });
    this.saveUser(data.user, data.teamId);
    return data;
  }

  // Places
  async getPlaces(category = 'All') {
    let endpoint = `/api/places?teamId=${encodeURIComponent(this.activeTeamId)}`;
    if (category && category !== 'All') {
      endpoint += `&category=${encodeURIComponent(category)}`;
    }
    return this.request(endpoint);
  }

  // Visit logging with 50m duplicate resolution
  async logVisit({ placeName, category, lat, lng, note, photoData, timestamp }) {
    if (!this.currentUser) throw new Error('You must be signed in to log a visit.');

    return this.request('/api/visits', {
      method: 'POST',
      body: JSON.stringify({
        placeName,
        category,
        lat,
        lng,
        note,
        photoData,
        timestamp: timestamp || new Date().toISOString(),
        userId: this.currentUser.id,
        teamId: this.activeTeamId
      })
    });
  }

  // Delete own visit (Place deleted if last remaining visit)
  async deleteVisit(visitId) {
    if (!this.currentUser) throw new Error('You must be signed in.');

    return this.request(`/api/visits/${visitId}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId: this.currentUser.id })
    });
  }

  // Route upload batch (Insert-Only)
  async uploadRouteBatch(points) {
    if (!this.currentUser || !points || points.length === 0) return { count: 0 };

    return this.request('/api/routes/batch', {
      method: 'POST',
      body: JSON.stringify({
        userId: this.currentUser.id,
        points
      })
    });
  }

  // Get Route points for specified rep and date
  async getRoutes(userId, dateStr) {
    return this.request(`/api/routes?userId=${encodeURIComponent(userId)}&date=${encodeURIComponent(dateStr)}`);
  }

  // Reps list for route viewer
  async getReps() {
    return this.request(`/api/reps?teamId=${encodeURIComponent(this.activeTeamId)}`);
  }

  // Teams
  async getTeams() {
    return this.request('/api/teams');
  }

  async createTeam(name) {
    if (!this.currentUser) throw new Error('Must be signed in.');
    return this.request('/api/teams', {
      method: 'POST',
      body: JSON.stringify({ name, userId: this.currentUser.id })
    });
  }

  async voteDeleteTeam(teamId) {
    if (!this.currentUser) throw new Error('Must be signed in.');
    return this.request(`/api/teams/${teamId}/vote-delete`, {
      method: 'POST',
      body: JSON.stringify({ userId: this.currentUser.id })
    });
  }

  // Config
  async getConfig() {
    return this.request('/api/config');
  }
}

window.api = new MapNotesAPI();
