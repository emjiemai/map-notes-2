# Map Notes 📍

A field-visit logging and honest transportation reimbursement web & mobile application designed for B2B sales teams.

---

## Features

- **Interactive Map with Pins & Visitor Avatars**: Real-time map powered by OpenStreetMap displaying custom pins with the initials and avatar color of the latest rep who visited.
- **Category Filters**: Filter locations instantly by `All`, `Hotel`, `Medical`, `Restaurant`, and `Other`.
- **50-Meter Duplicate Prevention**: Dropping a pin within roughly 50 meters of an existing venue automatically attaches the visit to that location instead of creating duplicate clutter.
- **Place History & Follow-Up Logs**: Full chronological visit history with exact timestamps (no vague "2 days ago"), notes, and attached photos. Add follow-up logs directly to existing places.
- **Own-Data Control**: Reps can delete their own mistaken visits (not anyone else's). Deleting the last remaining visit automatically removes the place from the map.
- **Friction-Free Authentication**: Name + 4-digit PIN only. Re-entering the same credentials deterministically restores the rep's identity, visits, and team associations even after reinstalling the app or clearing the cache.
- **Route Tracking for Transportation Reimbursement**:
  - Operates only during shift working hours (e.g. 11:00–16:00).
  - Distance-based logging ($\ge 15\text{m}$, never a raw timer) to avoid inflating distance with stationary GPS jitter.
  - Durable offline queue (IndexedDB) commits points to local storage first, surviving screen lock and signal dead zones.
  - Insert-only, immutable server storage with an automatic 14-day rolling window purge.
- **Day-by-Day Route Auditor**: Pick any rep and date to inspect their travel trail with audited mileage (km & miles), 10-minute time labels, and visual gap breaks for jumps $> 30\text{m}$.
- **Teams & Unanimous Deletion**: Teams share all pins. Deleting a team requires 100% unanimous agreement from every member with live progress tracking ("2/3 agreed").

---

## Getting Started

### Prerequisites
- Node.js v20+ or v24+ (uses Node's built-in SQLite engine).

### Installation & Run
```bash
# Install dependencies
npm install

# Start the application server
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Running Automated Tests
```bash
npm test
```
Executes the test suite covering geospatial Haversine math, 50-meter duplicate clustering, deterministic auth, own-data deletion security, and route integrity.

---

## Android App Release (Capacitor)

The repository includes a ready-to-build native Android project in the `android/` directory.

### Build Android APK:
1. Ensure Android SDK / Android Studio is installed.
2. Sync the web assets to Android:
   ```bash
   npm run sync:android
   ```
3. Open in Android Studio:
   ```bash
   npx cap open android
   ```
4. Or build directly via command line:
   ```bash
   cd android
   ./gradlew assembleDebug
   ```
   The output APK will be located at `android/app/build/outputs/apk/debug/app-debug.apk`.

---

## Database Configuration

By default, Map Notes uses SQLite with WAL mode in `data/mapnotes.db`. You can configure a custom database path using the `DB_PATH` environment variable:
```bash
DB_PATH=/path/to/custom/mapnotes.db npm start
```
