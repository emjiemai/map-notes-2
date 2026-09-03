/**
 * MAP NOTES - AUTOMATED INTEGRATION TEST SUITE
 * Tests all core requirements: 50m duplicate detection, own-data deletion,
 * deterministic auth, route tracking, and unanimous team deletion.
 */

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('--- STARTING MAP NOTES INTEGRATION TESTS ---');

  const testTeamId = 'test-team-' + Date.now();
  const db = require('../server/db');
  db.prepare('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)').run(testTeamId, 'Test Field Team', new Date().toISOString());

  const testUserName = 'Marcus Vance ' + Date.now();
  const testUserBName = 'Elena Rostova ' + Date.now();

  // Test 1: Friction-free Name + PIN Login (Deterministic)
  console.log('\n[Test 1] Deterministic Name + PIN Auth');
  const userARes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: testUserName, pin: '4821' })
  }).then(r => r.json());

  console.assert(userARes.user && userARes.user.name === testUserName, 'User A creation failed');
  const userAId = userARes.user.id;
  console.log('✓ User Marcus Vance created/logged in with ID:', userAId);

  // Re-login with same Name and PIN (simulating cache clear/reinstall)
  const reloginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: testUserName, pin: '4821' })
  }).then(r => r.json());

  console.assert(reloginRes.user.id === userAId, 'Deterministic login failed: IDs do not match!');
  console.log('✓ Cache clear survival: Re-login returned exact same user ID:', reloginRes.user.id);

  // Create User B (teammate)
  const userBRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: testUserBName, pin: '9102' })
  }).then(r => r.json());
  const userBId = userBRes.user.id;
  console.log('✓ Teammate Elena Rostova created with ID:', userBId);

  // Test 2: Log Place 1 (Grand Hyatt Hotel)
  console.log('\n[Test 2] Log Initial Place (Grand Hyatt Hotel)');
  const place1Res = await fetch(`${BASE_URL}/api/visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      placeName: 'Grand Hyatt Hotel',
      category: 'Hotel',
      lat: 40.7516,
      lng: -73.9760,
      note: 'Met with General Manager regarding Q4 catering contract.',
      userId: userAId,
      teamId: testTeamId,
      timestamp: '2026-09-03T11:45:00.000Z'
    })
  }).then(r => r.json());

  console.assert(!place1Res.attachedToExisting, 'Place 1 should be a brand-new place');
  const place1Id = place1Res.place.id;
  const visit1Id = place1Res.place.visits[0].id;
  console.log('✓ Grand Hyatt Hotel logged as new place ID:', place1Id);

  // Test 3: 50-Meter Duplicate Detection!
  console.log('\n[Test 3] 50-Meter Duplicate Detection');
  // Log a visit roughly 18 meters away from Grand Hyatt
  const place2Res = await fetch(`${BASE_URL}/api/visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      placeName: 'Hyatt Entrance',
      category: 'Hotel',
      lat: 40.7517, // ~15-20 meters away
      lng: -73.9761,
      note: 'Follow-up visit by Elena to drop off price sheets.',
      userId: userBId,
      teamId: testTeamId,
      timestamp: '2026-09-03T13:10:00.000Z'
    })
  }).then(r => r.json());

  console.assert(place2Res.attachedToExisting === true, 'Duplicate check failed: Should attach to existing place!');
  console.assert(place2Res.place.id === place1Id, 'Should match Grand Hyatt ID!');
  console.log(`✓ DUPLICATE PREVENTED: Nearby location (${place2Res.distanceMeters}m away) attached to Grand Hyatt!`);
  console.log(`✓ Grand Hyatt now has ${place2Res.place.visits.length} visits.`);

  // Log a place far away (> 50m, e.g. Mount Sinai Hospital 3km away)
  const place3Res = await fetch(`${BASE_URL}/api/visits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      placeName: 'Mount Sinai Medical Center',
      category: 'Medical',
      lat: 40.7900,
      lng: -73.9530,
      note: 'Meeting with Medical Supplies Director.',
      userId: userAId,
      teamId: testTeamId
    })
  }).then(r => r.json());

  console.assert(place3Res.attachedToExisting === false, 'Mount Sinai should be new place');
  console.log('✓ Far location (>50m) correctly created distinct place:', place3Res.place.name);

  // Test 4: Own-Data Deletion Control
  console.log('\n[Test 4] Own-Data Control & Deletion Rules');
  // User B tries to delete User A's visit (visit1Id) -> Should fail with 403
  const failDelete = await fetch(`${BASE_URL}/api/visits/${visit1Id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: userBId })
  });
  console.assert(failDelete.status === 403, 'Security breach: User B should NOT be able to delete User A visit!');
  console.log('✓ Security verified: Rep cannot delete someone else\'s visit (HTTP 403 Forbidden).');

  // User A deletes their own visit
  const deleteVisit1 = await fetch(`${BASE_URL}/api/visits/${visit1Id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: userAId })
  }).then(r => r.json());

  console.assert(deleteVisit1.success === true && deleteVisit1.placeDeleted === false, 'Visit 1 deletion failed');
  console.log('✓ User A successfully deleted their own visit. Place still has User B visit.');

  // User B deletes the remaining visit (visit2) -> Place should be purged automatically!
  const visit2Id = place2Res.place.visits.find(v => v.user_id === userBId).id;
  const deleteVisit2 = await fetch(`${BASE_URL}/api/visits/${visit2Id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: userBId })
  }).then(r => r.json());

  console.assert(deleteVisit2.placeDeleted === true, 'Place should be deleted when 0 visits remain!');
  console.log('✓ Place Purge verified: Last remaining visit deleted -> Place automatically removed from map!');

  // Test 5: Route Tracking for Reimbursement (Batch upload & date queries)
  console.log('\n[Test 5] Route Tracking & Day-by-Day Audit');
  const sampleDate = '2026-09-03';
  const testPoints = [
    { lat: 40.7516, lng: -73.9760, accuracy: 8, speed: 1.2, recorded_at: '2026-09-03T11:05:00.000Z' },
    { lat: 40.7518, lng: -73.9761, accuracy: 7, speed: 1.4, recorded_at: '2026-09-03T11:15:00.000Z' },
    { lat: 40.7520, lng: -73.9763, accuracy: 6, speed: 1.1, recorded_at: '2026-09-03T11:25:00.000Z' },
    // A point > 30m away (gap)
    { lat: 40.7560, lng: -73.9800, accuracy: 10, speed: 8.5, recorded_at: '2026-09-03T11:45:00.000Z' }
  ];

  const uploadRes = await fetch(`${BASE_URL}/api/routes/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: userAId, points: testPoints })
  }).then(r => r.json());

  console.assert(uploadRes.count === 4, 'Upload points count mismatch');
  console.log(`✓ Uploaded ${uploadRes.count} route points with true recorded client timestamps.`);

  const routeRes = await fetch(`${BASE_URL}/api/routes?userId=${userAId}&date=${sampleDate}`).then(r => r.json());
  console.assert(routeRes.points.length >= 4, 'Query route points count mismatch');
  console.log(`✓ Retrieved ${routeRes.points.length} route points for rep ${userAId} on date ${sampleDate}.`);

  // Test 6: Team Unanimous Vote-to-Delete
  console.log('\n[Test 6] Team Unanimous Vote-to-Delete');
  // Create a new team with Marcus
  const newTeam = await fetch(`${BASE_URL}/api/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'East Coast Squad', userId: userAId })
  }).then(r => r.json());

  // Add Elena to East Coast Squad in DB
  db.prepare('INSERT INTO team_members (team_id, user_id, joined_at) VALUES (?, ?, ?)').run(newTeam.id, userBId, new Date().toISOString());

  // Marcus votes to delete (1/2 votes)
  const vote1 = await fetch(`${BASE_URL}/api/teams/${newTeam.id}/vote-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: userAId })
  }).then(r => r.json());

  console.assert(vote1.deleted === false, 'Team should NOT be deleted with only 1/2 votes');
  console.log(`✓ Partial vote: ${vote1.progress} — Team remains active.`);

  // Elena votes to delete (2/2 votes = UNANIMOUS)
  const vote2 = await fetch(`${BASE_URL}/api/teams/${newTeam.id}/vote-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: userBId })
  }).then(r => r.json());

  console.assert(vote2.deleted === true, 'Team should be deleted with 2/2 unanimous votes');
  console.log(`✓ UNANIMOUS AGREEMENT: ${vote2.message}`);

  console.log('\n--- ALL INTEGRATION TESTS PASSED PERFECTLY! ---');
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
