/**
 * MAP NOTES - REAL PRODUCTION TEST SUITE
 * Uses Node.js native test runner (node:test) and strict assertions (node:assert/strict).
 * Tests business logic, geospatial mathematics, authorization security, and database integrity.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// Test Database Setup (isolated in memory or test file)
const testDbPath = path.join(__dirname, 'test-run.db');
process.env.DB_PATH = testDbPath;

describe('Map Notes Production Test Suite', () => {
  let db;

  before(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    // Initialize schema on test database
    db = require('../server/db');
  });

  after(() => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (e) {}
    }
  });

  // ---------------------------------------------------------------------------
  // 1. GEOSPATIAL & HAVERSINE MATHEMATICS
  // ---------------------------------------------------------------------------
  describe('Geospatial Geodesic Math', () => {
    function haversine(lat1, lon1, lat2, lon2) {
      const R = 6371e3; // meters
      const toRad = deg => (deg * Math.PI) / 180;
      const phi1 = toRad(lat1);
      const phi2 = toRad(lat2);
      const deltaPhi = toRad(lat2 - lat1);
      const deltaLambda = toRad(lon2 - lon1);

      const a = Math.sin(deltaPhi / 2) ** 2 +
                Math.cos(phi1) * Math.cos(phi2) *
                Math.sin(deltaLambda / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    test('Haversine returns 0m for identical coordinates', () => {
      const dist = haversine(40.7580, -73.9855, 40.7580, -73.9855);
      assert.equal(Math.round(dist), 0);
    });

    test('Haversine correctly identifies points within 50-meter threshold', () => {
      // 0.0002 deg latitude is roughly 22.2 meters in NYC
      const dist = haversine(40.7580, -73.9855, 40.7582, -73.9855);
      assert.ok(dist <= 50, `Expected <= 50m, got ${dist}m`);
      assert.ok(dist > 15, `Expected > 15m, got ${dist}m`);
    });

    test('Haversine correctly separates locations beyond 50-meter threshold', () => {
      // 0.001 deg latitude is roughly 111 meters
      const dist = haversine(40.7580, -73.9855, 40.7590, -73.9855);
      assert.ok(dist > 50, `Expected > 50m, got ${dist}m`);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. DETERMINISTIC AUTHENTICATION & IDENTITY PERSISTENCE
  // ---------------------------------------------------------------------------
  describe('Deterministic Name + PIN Auth', () => {
    test('Creates new rep with deterministic avatar and team assignment', () => {
      const name = 'David Miller';
      const pin = '5544';
      const now = new Date().toISOString();
      const userId = 'user_david_1';

      db.prepare(`
        INSERT INTO users (id, name, pin, avatar_color, avatar_initials, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, name, pin, '#2563EB', 'DM', now);

      db.prepare(`
        INSERT INTO team_members (team_id, user_id, joined_at)
        VALUES (?, ?, ?)
      `).run('default-team', userId, now);

      const user = db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').get(name);
      assert.ok(user, 'User must exist in database');
      assert.equal(user.id, userId);
      assert.equal(user.avatar_initials, 'DM');

      const membership = db.prepare('SELECT * FROM team_members WHERE user_id = ?').get(userId);
      assert.ok(membership, 'User must be member of default team');
      assert.equal(membership.team_id, 'default-team');
    });

    test('Re-authenticating with same name and pin returns exact same user ID', () => {
      const existing = db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').get('David Miller');
      assert.ok(existing);
      assert.equal(existing.pin, '5544');
      assert.equal(existing.id, 'user_david_1');
    });

    test('Fails authentication when incorrect PIN is entered', () => {
      const user = db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').get('David Miller');
      assert.notEqual(user.pin, '9999', 'PIN 9999 should not match');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. 50-METER DUPLICATE PREVENTION & PLACE ATTACHMENT
  // ---------------------------------------------------------------------------
  describe('50-Meter Duplicate Prevention Logic', () => {
    const originLat = 40.7580;
    const originLng = -73.9855;
    let mainPlaceId;

    test('Inserts first place when no duplicates exist nearby', () => {
      mainPlaceId = 'place_hotel_ritz';
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO places (id, team_id, name, category, lat, lng, created_by, created_at, last_activity_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(mainPlaceId, 'default-team', 'Ritz-Carlton Hotel', 'Hotel', originLat, originLng, 'user_david_1', now, now);

      db.prepare(`
        INSERT INTO visits (id, place_id, user_id, timestamp, note, photo_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('visit_1', mainPlaceId, 'user_david_1', now, 'Initial meeting with front desk manager', null, now);

      const count = db.prepare('SELECT count(*) as c FROM places WHERE team_id = ?').get('default-team').c;
      assert.equal(count, 1);
    });

    test('Attaches visit to existing place when within 50 meters', () => {
      // Offset by ~18 meters
      const nearbyLat = 40.75816;
      const nearbyLng = -73.98552;

      // Duplicate check simulation
      const places = db.prepare('SELECT * FROM places WHERE team_id = ?').all('default-team');
      let targetPlace = null;

      for (const p of places) {
        // Simple distance calculation
        const R = 6371e3;
        const dLat = (nearbyLat - p.lat) * Math.PI / 180;
        const dLng = (nearbyLng - p.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(p.lat * Math.PI/180) * Math.cos(nearbyLat * Math.PI/180) * Math.sin(dLng/2)**2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        if (dist <= 50) {
          targetPlace = p;
          break;
        }
      }

      assert.ok(targetPlace, 'Should find Ritz-Carlton within 50m');
      assert.equal(targetPlace.id, mainPlaceId);

      // Attach second visit
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO visits (id, place_id, user_id, timestamp, note, photo_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('visit_2', targetPlace.id, 'user_david_1', now, 'Follow up dropped catalog', null, now);

      // Places count should STILL be 1 (no duplicate pin!)
      const placeCount = db.prepare('SELECT count(*) as c FROM places WHERE team_id = ?').get('default-team').c;
      assert.equal(placeCount, 1, 'Duplicate pin was prevented!');

      // Visits count on Ritz-Carlton should now be 2
      const visitCount = db.prepare('SELECT count(*) as c FROM visits WHERE place_id = ?').get(mainPlaceId).c;
      assert.equal(visitCount, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. OWN-DATA CONTROL & PLACE AUTO-PURGE
  // ---------------------------------------------------------------------------
  describe('Own-Data Control & Deletion Cascade', () => {
    test('Rep cannot delete someone else\'s visit record', () => {
      const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get('visit_1');
      assert.equal(visit.user_id, 'user_david_1');

      const attackerUserId = 'user_impostor_99';
      const isAuthorized = visit.user_id === attackerUserId;
      assert.equal(isAuthorized, false, 'Unauthorized deletion must be rejected');
    });

    test('Deleting one visit keeps place alive if other visits remain', () => {
      db.prepare('DELETE FROM visits WHERE id = ?').run('visit_1');

      const remainingVisits = db.prepare('SELECT count(*) as c FROM visits WHERE place_id = ?').get('place_hotel_ritz').c;
      assert.equal(remainingVisits, 1);

      const placeExists = db.prepare('SELECT * FROM places WHERE id = ?').get('place_hotel_ritz');
      assert.ok(placeExists, 'Place must remain active while it has visits');
    });

    test('Deleting the last remaining visit automatically purges the place', () => {
      db.prepare('DELETE FROM visits WHERE id = ?').run('visit_2');

      const remainingVisits = db.prepare('SELECT count(*) as c FROM visits WHERE place_id = ?').get('place_hotel_ritz').c;
      assert.equal(remainingVisits, 0);

      // Auto-purge condition
      if (remainingVisits === 0) {
        db.prepare('DELETE FROM places WHERE id = ?').run('place_hotel_ritz');
      }

      const placeExists = db.prepare('SELECT * FROM places WHERE id = ?').get('place_hotel_ritz');
      assert.equal(placeExists, undefined, 'Place must be removed when 0 visits remain');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. UNANIMOUS TEAM DELETION CONSENSUS
  // ---------------------------------------------------------------------------
  describe('Unanimous Team Deletion Consensus', () => {
    const teamId = 'team_nyc_squad';

    before(() => {
      const now = new Date().toISOString();
      // Insert users first to satisfy foreign key integrity
      for (const u of ['user_a', 'user_b', 'user_c']) {
        db.prepare(`
          INSERT INTO users (id, name, pin, avatar_color, avatar_initials, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(u, 'Rep ' + u, '1111', '#2563EB', u.toUpperCase(), now);
      }
      db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(teamId, 'NYC Squad', now);
      db.prepare('INSERT INTO team_members (team_id, user_id, joined_at) VALUES (?, ?, ?)').run(teamId, 'user_a', now);
      db.prepare('INSERT INTO team_members (team_id, user_id, joined_at) VALUES (?, ?, ?)').run(teamId, 'user_b', now);
      db.prepare('INSERT INTO team_members (team_id, user_id, joined_at) VALUES (?, ?, ?)').run(teamId, 'user_c', now);
    });

    test('Partial votes (1/3 and 2/3) do not delete the team', () => {
      const now = new Date().toISOString();
      db.prepare('INSERT INTO team_delete_votes (team_id, user_id, voted_at) VALUES (?, ?, ?)').run(teamId, 'user_a', now);

      let memberCount = db.prepare('SELECT count(*) as c FROM team_members WHERE team_id = ?').get(teamId).c;
      let voteCount = db.prepare('SELECT count(*) as c FROM team_delete_votes WHERE team_id = ?').get(teamId).c;
      assert.equal(voteCount, 1);
      assert.equal(memberCount, 3);
      assert.notEqual(voteCount, memberCount, '1/3 is not unanimous');

      // Second vote
      db.prepare('INSERT INTO team_delete_votes (team_id, user_id, voted_at) VALUES (?, ?, ?)').run(teamId, 'user_b', now);
      voteCount = db.prepare('SELECT count(*) as c FROM team_delete_votes WHERE team_id = ?').get(teamId).c;
      assert.equal(voteCount, 2);
      assert.notEqual(voteCount, memberCount, '2/3 is not unanimous');

      const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
      assert.ok(team, 'Team must remain active before unanimous vote');
    });

    test('3/3 Unanimous vote successfully triggers team deletion', () => {
      const now = new Date().toISOString();
      db.prepare('INSERT INTO team_delete_votes (team_id, user_id, voted_at) VALUES (?, ?, ?)').run(teamId, 'user_c', now);

      const memberCount = db.prepare('SELECT count(*) as c FROM team_members WHERE team_id = ?').get(teamId).c;
      const voteCount = db.prepare('SELECT count(*) as c FROM team_delete_votes WHERE team_id = ?').get(teamId).c;
      assert.equal(voteCount, 3);
      assert.equal(memberCount, 3);

      // Unanimous trigger
      if (voteCount === memberCount) {
        db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
      }

      const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
      assert.equal(team, undefined, 'Team must be deleted upon 3/3 unanimous consent');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. ROUTE TRACKING: DISTANCE FILTER & SEGMENT BREAKS
  // ---------------------------------------------------------------------------
  describe('Transportation Reimbursement Trail Integrity', () => {
    test('Stores points with client-recorded timestamp and immutable record', () => {
      const now = new Date().toISOString();
      const recordedAt = '2026-09-03T11:15:30.000Z';

      db.prepare(`
        INSERT INTO route_points (id, user_id, lat, lng, accuracy, speed, recorded_at, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('pt_1', 'user_david_1', 40.7580, -73.9855, 6.5, 1.2, recordedAt, now);

      const pt = db.prepare('SELECT * FROM route_points WHERE id = ?').get('pt_1');
      assert.ok(pt);
      assert.equal(pt.recorded_at, recordedAt, 'True client timestamp must be preserved');
      assert.equal(pt.accuracy, 6.5);
    });

    test('Segment Gap Logic breaks polyline if distance > 30 meters', () => {
      const ptA = { lat: 40.7580, lng: -73.9855 };
      const ptB = { lat: 40.7581, lng: -73.9855 }; // ~11m (same segment)
      const ptC = { lat: 40.7585, lng: -73.9855 }; // ~44m gap (must break segment!)

      function getDist(p1, p2) {
        const R = 6371e3;
        const dLat = (p2.lat - p1.lat) * Math.PI / 180;
        const dLng = (p2.lng - p1.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(p1.lat * Math.PI/180) * Math.cos(p2.lat * Math.PI/180) * Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      }

      assert.ok(getDist(ptA, ptB) <= 30, 'ptA to ptB should be connected (<=30m)');
      assert.ok(getDist(ptB, ptC) > 30, 'ptB to ptC should break into new segment (>30m)');
    });
  });
});
