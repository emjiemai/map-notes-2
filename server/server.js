/**
 * MAP NOTES - EXPRESS REST API SERVER
 * Field-visit logging, 50m duplicate resolution, tamper-proof route tracking
 */

const express = require('express');
const cors = require('cors');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' })); // Allow photo uploads in visit logs
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helper: Haversine distance in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
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

// Helper: Generate Avatar Color & Initials
function generateAvatar(name) {
  const colors = [
    '#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED',
    '#DB2777', '#0891B2', '#4F46E5', '#0D9488', '#EA580C'
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = colors[Math.abs(hash) % colors.length];

  const words = name.trim().split(/\s+/);
  let initials = words[0] ? words[0][0].toUpperCase() : 'U';
  if (words.length > 1) {
    initials += words[words.length - 1][0].toUpperCase();
  }
  return { color, initials };
}

// 14-day rolling purge for route points (server-side automatic maintenance)
function purgeOldRoutes() {
  try {
    const configRow = db.prepare("SELECT value FROM app_config WHERE key = 'rolling_purge_days'").get();
    const days = parseInt(configRow ? configRow.value : '14', 10);
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const result = db.prepare("DELETE FROM route_points WHERE recorded_at < ?").run(cutoffDate);
    if (result.changes > 0) {
      console.log(`[Purge] Auto-purged ${result.changes} route points older than ${days} days.`);
    }
  } catch (err) {
    console.error('[Purge Error]', err);
  }
}
setInterval(purgeOldRoutes, 3600 * 1000);
purgeOldRoutes();

/* =========================================================================
   AUTH API (Name + PIN, Deterministic, Friction-Free)
   ========================================================================= */
app.post('/api/auth/login', (req, res) => {
  const { name, pin } = req.body;
  if (!name || !name.trim() || !pin) {
    return res.status(400).json({ error: 'Name and 4-digit PIN are required.' });
  }

  const cleanName = name.trim();
  const cleanPin = pin.trim();

  // Find user by name (case-insensitive)
  const existing = db.prepare('SELECT * FROM users WHERE name = ?').get(cleanName);

  if (existing) {
    if (existing.pin !== cleanPin) {
      return res.status(401).json({ error: 'Incorrect PIN for this sales representative.' });
    }

    // Get user's active team
    let memberRow = db.prepare('SELECT team_id FROM team_members WHERE user_id = ? LIMIT 1').get(existing.id);
    let teamId = memberRow ? memberRow.team_id : 'default-team';

    return res.json({
      user: {
        id: existing.id,
        name: existing.name,
        avatarColor: existing.avatar_color,
        avatarInitials: existing.avatar_initials,
        createdAt: existing.created_at
      },
      teamId
    });
  }

  // Create new user deterministically
  const userId = crypto.randomUUID();
  const { color, initials } = generateAvatar(cleanName);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, name, pin, avatar_color, avatar_initials, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, cleanName, cleanPin, color, initials, now);

  // Auto-join default team
  db.prepare(`
    INSERT OR IGNORE INTO team_members (team_id, user_id, joined_at)
    VALUES (?, ?, ?)
  `).run('default-team', userId, now);

  return res.json({
    user: {
      id: userId,
      name: cleanName,
      avatarColor: color,
      avatarInitials: initials,
      createdAt: now
    },
    teamId: 'default-team'
  });
});

/* =========================================================================
   PLACES & VISITS API (50m Duplicate Detection & Deletion Rules)
   ========================================================================= */

// GET Places for a Team (Optionally filtered by category)
app.get('/api/places', (req, res) => {
  const teamId = req.query.teamId || 'default-team';
  const category = req.query.category; // 'All', 'Hotel', 'Medical', 'Restaurant', 'Other'

  let query = `
    SELECT p.*,
           COUNT(v.id) as visit_count
    FROM places p
    LEFT JOIN visits v ON p.id = v.place_id
    WHERE p.team_id = ?
  `;
  const params = [teamId];

  if (category && category !== 'All') {
    query += ` AND p.category = ?`;
    params.push(category);
  }

  query += ` GROUP BY p.id ORDER BY p.last_activity_at DESC`;
  const places = db.prepare(query).all(...params);

  // Attach full visit history and latest visitor avatar to each place
  const fullPlaces = places.map(p => {
    const visits = db.prepare(`
      SELECT v.*, u.name as user_name, u.avatar_color, u.avatar_initials
      FROM visits v
      JOIN users u ON v.user_id = u.id
      WHERE v.place_id = ?
      ORDER BY v.timestamp DESC
    `).all(p.id);

    const latestVisit = visits[0] || null;

    return {
      id: p.id,
      teamId: p.team_id,
      name: p.name,
      category: p.category,
      lat: p.lat,
      lng: p.lng,
      createdBy: p.created_by,
      createdAt: p.created_at,
      lastActivityAt: p.last_activity_at,
      visitCount: visits.length,
      latestVisitor: latestVisit ? {
        name: latestVisit.user_name,
        avatarColor: latestVisit.avatar_color,
        avatarInitials: latestVisit.avatar_initials,
        timestamp: latestVisit.timestamp
      } : null,
      visits
    };
  });

  res.json({ places: fullPlaces });
});

// LOG A VISIT (Duplicates within ~50m automatically attached to existing place)
app.post('/api/visits', (req, res) => {
  const { placeName, category, lat, lng, note, photoData, timestamp, userId, teamId } = req.body;

  if (!lat || !lng || !userId) {
    return res.status(400).json({ error: 'Location coordinates and user ID are required.' });
  }

  const activeTeamId = teamId || 'default-team';
  const now = new Date().toISOString();
  const visitTimestamp = timestamp || now;

  // Scan all places in team to find closest place
  const allPlaces = db.prepare('SELECT id, name, category, lat, lng FROM places WHERE team_id = ?').all(activeTeamId);
  let closestPlace = null;
  let minDistance = Infinity;

  for (const p of allPlaces) {
    const dist = haversineDistance(lat, lng, p.lat, p.lng);
    if (dist < minDistance) {
      minDistance = dist;
      closestPlace = p;
    }
  }

  const visitId = crypto.randomUUID();
  let targetPlaceId;
  let attachedToExisting = false;

  // 50-meter threshold check
  if (closestPlace && minDistance <= 50) {
    // Attach visit to existing place
    targetPlaceId = closestPlace.id;
    attachedToExisting = true;

    // Update last activity timestamp of place
    db.prepare('UPDATE places SET last_activity_at = ? WHERE id = ?').run(now, targetPlaceId);
  } else {
    // Create brand-new place
    targetPlaceId = crypto.randomUUID();
    const finalCategory = (category && ['Hotel', 'Medical', 'Restaurant', 'Other'].includes(category))
      ? category
      : 'Other';
    const finalName = placeName && placeName.trim() ? placeName.trim() : `New ${finalCategory} Location`;

    db.prepare(`
      INSERT INTO places (id, team_id, name, category, lat, lng, created_by, created_at, last_activity_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(targetPlaceId, activeTeamId, finalName, finalCategory, lat, lng, userId, now, now);
  }

  // Record visit
  db.prepare(`
    INSERT INTO visits (id, place_id, user_id, timestamp, note, photo_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(visitId, targetPlaceId, userId, visitTimestamp, note || '', photoData || null, now);

  // Fetch updated place
  const updatedPlace = db.prepare('SELECT * FROM places WHERE id = ?').get(targetPlaceId);
  const visits = db.prepare(`
    SELECT v.*, u.name as user_name, u.avatar_color, u.avatar_initials
    FROM visits v
    JOIN users u ON v.user_id = u.id
    WHERE v.place_id = ?
    ORDER BY v.timestamp DESC
  `).all(targetPlaceId);

  res.json({
    attachedToExisting,
    distanceMeters: Math.round(minDistance),
    place: {
      ...updatedPlace,
      visits
    }
  });
});

// DELETE A VISIT (Own-data control: Rep can delete only their own visits; if last visit, place is purged)
app.delete('/api/visits/:id', (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required to verify ownership.' });
  }

  const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(id);
  if (!visit) {
    return res.status(404).json({ error: 'Visit record not found.' });
  }

  // Only the author can delete their own visit
  if (visit.user_id !== userId) {
    return res.status(403).json({ error: 'You can only delete your own logged visits.' });
  }

  const placeId = visit.place_id;

  // Delete the visit
  db.prepare('DELETE FROM visits WHERE id = ?').run(id);

  // Check if any visits remain at this place
  const remainingCount = db.prepare('SELECT COUNT(*) as count FROM visits WHERE place_id = ?').get(placeId).count;
  let placeDeleted = false;

  if (remainingCount === 0) {
    // Delete the place itself
    db.prepare('DELETE FROM places WHERE id = ?').run(placeId);
    placeDeleted = true;
  }

  res.json({
    success: true,
    deletedVisitId: id,
    placeId,
    placeDeleted,
    remainingVisits: remainingCount
  });
});

/* =========================================================================
   ROUTE TRACKING FOR REIMBURSEMENT (Insert-Only, Offline-Proof)
   ========================================================================= */

// BATCH UPLOAD OF ROUTE POINTS (Keeps true recorded client timestamps)
app.post('/api/routes/batch', (req, res) => {
  const { userId, points } = req.body;

  if (!userId || !Array.isArray(points) || points.length === 0) {
    return res.status(400).json({ error: 'User ID and non-empty points array are required.' });
  }

  const now = new Date().toISOString();
  const insertStmt = db.prepare(`
    INSERT INTO route_points (id, user_id, lat, lng, accuracy, speed, recorded_at, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let insertedCount = 0;
  for (const pt of points) {
    if (typeof pt.lat === 'number' && typeof pt.lng === 'number' && pt.recorded_at) {
      const pointId = crypto.randomUUID();
      insertStmt.run(
        pointId,
        userId,
        pt.lat,
        pt.lng,
        pt.accuracy || null,
        pt.speed || null,
        pt.recorded_at,
        now
      );
      insertedCount++;
    }
  }

  res.json({ success: true, count: insertedCount });
});

// GET ROUTE FOR A REP ON A SPECIFIC DAY
app.get('/api/routes', (req, res) => {
  const { userId, date } = req.query; // date in YYYY-MM-DD format
  if (!userId || !date) {
    return res.status(400).json({ error: 'User ID and date (YYYY-MM-DD) are required.' });
  }

  // Retrieve route points for specified day in chronological order
  const points = db.prepare(`
    SELECT id, lat, lng, accuracy, speed, recorded_at, uploaded_at
    FROM route_points
    WHERE user_id = ? AND strftime('%Y-%m-%d', recorded_at) = ?
    ORDER BY recorded_at ASC
  `).all(userId, date);

  res.json({ points });
});

// GET LIST OF REPS IN TEAM (For the route viewer selector)
app.get('/api/reps', (req, res) => {
  const teamId = req.query.teamId || 'default-team';
  const reps = db.prepare(`
    SELECT u.id, u.name, u.avatar_color, u.avatar_initials
    FROM users u
    JOIN team_members tm ON u.id = tm.user_id
    WHERE tm.team_id = ?
    ORDER BY u.name ASC
  `).all(teamId);

  res.json({ reps });
});

/* =========================================================================
   TEAMS & UNANIMOUS DELETION VOTING
   ========================================================================= */

// LIST TEAMS
app.get('/api/teams', (req, res) => {
  const teams = db.prepare('SELECT * FROM teams ORDER BY created_at ASC').all();

  const fullTeams = teams.map(t => {
    const members = db.prepare(`
      SELECT u.id, u.name, u.avatar_color, u.avatar_initials
      FROM users u
      JOIN team_members tm ON u.id = tm.user_id
      WHERE tm.team_id = ?
    `).all(t.id);

    const votes = db.prepare('SELECT user_id FROM team_delete_votes WHERE team_id = ?').all(t.id);
    const voteUserIds = votes.map(v => v.user_id);

    return {
      id: t.id,
      name: t.name,
      createdAt: t.created_at,
      members,
      deleteVotes: voteUserIds,
      voteCount: voteUserIds.length,
      memberCount: members.length,
      unanimous: members.length > 0 && voteUserIds.length === members.length
    };
  });

  res.json({ teams: fullTeams });
});

// CREATE TEAM
app.post('/api/teams', (req, res) => {
  const { name, userId } = req.body;
  if (!name || !name.trim() || !userId) {
    return res.status(400).json({ error: 'Team name and creator user ID are required.' });
  }

  const teamId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(teamId, name.trim(), now);
  db.prepare('INSERT INTO team_members (team_id, user_id, joined_at) VALUES (?, ?, ?)').run(teamId, userId, now);

  res.json({ id: teamId, name: name.trim(), createdAt: now });
});

// CAST VOTE TO DELETE TEAM (Unanimous Consent Rule)
app.post('/api/teams/:id/vote-delete', (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required to cast vote.' });
  }

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  if (!team) {
    return res.status(404).json({ error: 'Team not found.' });
  }

  // Ensure caller is a member
  const isMember = db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(id, userId);
  if (!isMember) {
    return res.status(403).json({ error: 'Only active team members can vote to delete a team.' });
  }

  // Record or toggle delete vote
  const existingVote = db.prepare('SELECT 1 FROM team_delete_votes WHERE team_id = ? AND user_id = ?').get(id, userId);
  if (existingVote) {
    db.prepare('DELETE FROM team_delete_votes WHERE team_id = ? AND user_id = ?').run(id, userId);
  } else {
    db.prepare('INSERT INTO team_delete_votes (team_id, user_id, voted_at) VALUES (?, ?, ?)').run(id, userId, new Date().toISOString());
  }

  // Check if all members have voted
  const memberCount = db.prepare('SELECT COUNT(*) as count FROM team_members WHERE team_id = ?').get(id).count;
  const voteCount = db.prepare('SELECT COUNT(*) as count FROM team_delete_votes WHERE team_id = ?').get(id).count;

  if (memberCount > 0 && voteCount === memberCount) {
    // Unanimous agreement reached: delete team completely
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
    return res.json({
      deleted: true,
      message: `Team deleted with unanimous agreement (${voteCount}/${memberCount} members agreed).`
    });
  }

  res.json({
    deleted: false,
    voteCount,
    memberCount,
    progress: `${voteCount}/${memberCount} agreed`
  });
});

/* =========================================================================
   CONFIG API (Working Hours, Distance Thresholds)
   ========================================================================= */
app.get('/api/config', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM app_config').all();
  const config = {};
  rows.forEach(r => { config[r.key] = r.value; });
  res.json(config);
});

app.post('/api/config', (req, res) => {
  const { working_hours_start, working_hours_end, distance_threshold_meters } = req.body;
  const updateStmt = db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)');

  if (working_hours_start) updateStmt.run('working_hours_start', working_hours_start);
  if (working_hours_end) updateStmt.run('working_hours_end', working_hours_end);
  if (distance_threshold_meters) updateStmt.run('distance_threshold_meters', String(distance_threshold_meters));

  res.json({ success: true });
});

// Fallback to index.html for SPA routing (Express 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Map Notes] Server listening on http://localhost:${PORT}`);
});
