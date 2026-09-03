/**
 * MAP NOTES - DAY-BY-DAY ROUTE VIEWER
 * 1. Visualizes recorded travel trails for any rep on any selected date.
 * 2. Segmented Polylines: Breaks connections if consecutive points are >30m apart.
 * 3. Time labels placed periodically (every ~10 minutes) for clear chronological auditing.
 * 4. Total distance calculations (kilometers & miles).
 */

class RouteViewer {
  constructor(mapInstance) {
    this.map = mapInstance;
    this.routeLayerGroup = L.layerGroup();
    this.gapThresholdMeters = 30; // 30 meters gap break threshold
  }

  init() {
    this.routeLayerGroup.addTo(this.map);
  }

  // Calculate distance between two lat/lng points
  getDistance(lat1, lon1, lat2, lon2) {
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

  clear() {
    this.routeLayerGroup.clearLayers();
  }

  // Render the day's route on the map
  renderRoute(points) {
    this.clear();

    if (!points || points.length === 0) {
      return { totalDistanceMeters: 0, pointCount: 0, segmentsCount: 0 };
    }

    // Sort chronologically by recorded_at
    const sorted = [...points].sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

    let totalDistanceMeters = 0;
    const segments = [];
    let currentSegment = [sorted[0]];

    // Partition points into segments broken when distance > gapThresholdMeters (30m)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];

      const dist = this.getDistance(prev.lat, prev.lng, curr.lat, curr.lng);

      if (dist <= this.gapThresholdMeters) {
        totalDistanceMeters += dist;
        currentSegment.push(curr);
      } else {
        // Break! The distance gap is too large to assume a continuous straight walk/drive
        segments.push(currentSegment);
        currentSegment = [curr];
      }
    }
    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }

    // 1. Draw each continuous segment with distinct polyline
    segments.forEach(segment => {
      if (segment.length > 1) {
        const latLngs = segment.map(p => [p.lat, p.lng]);
        const polyline = L.polyline(latLngs, {
          color: '#2563EB',
          weight: 4,
          opacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round'
        });
        this.routeLayerGroup.addLayer(polyline);
      } else if (segment.length === 1) {
        // Single isolated point (stopped here or isolated ping)
        const p = segment[0];
        const dot = L.circleMarker([p.lat, p.lng], {
          radius: 4,
          color: '#2563EB',
          fillColor: '#60A5FA',
          fillOpacity: 0.9,
          weight: 2
        });
        this.routeLayerGroup.addLayer(dot);
      }
    });

    // 2. Add time labels along the trail at ~10-minute intervals
    let lastLabeledTime = null;
    sorted.forEach((p, idx) => {
      const pTime = new Date(p.recorded_at).getTime();
      const isStart = idx === 0;
      const isEnd = idx === sorted.length - 1;

      // Add label if start, end, or at least 10 minutes (600,000 ms) passed since last label
      if (isStart || isEnd || !lastLabeledTime || (pTime - lastLabeledTime >= 10 * 60 * 1000)) {
        lastLabeledTime = pTime;
        const timeStr = new Date(p.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const timeIcon = L.divIcon({
          className: 'route-time-pill-icon',
          html: `<div class="time-pill ${isStart ? 'start' : (isEnd ? 'end' : '')}">${timeStr}</div>`,
          iconSize: [50, 20],
          iconAnchor: [25, 10]
        });

        const marker = L.marker([p.lat, p.lng], { icon: timeIcon });
        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 13px;">
            <strong>${isStart ? '🟢 Shift Departure' : (isEnd ? '🏁 Latest Point' : '⏱️ Timestamp')}</strong><br/>
            ${new Date(p.recorded_at).toLocaleTimeString()}<br/>
            <small style="color: #64748B;">Speed: ${p.speed ? Math.round(p.speed * 3.6) + ' km/h' : 'N/A'}</small>
          </div>
        `);
        this.routeLayerGroup.addLayer(marker);
      }
    });

    // Fit map bounds to show full trail
    const allLatLngs = sorted.map(p => [p.lat, p.lng]);
    if (allLatLngs.length > 0) {
      this.map.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40] });
    }

    return {
      totalDistanceMeters,
      totalDistanceKm: (totalDistanceMeters / 1000).toFixed(2),
      totalDistanceMiles: (totalDistanceMeters * 0.000621371).toFixed(2),
      pointCount: sorted.length,
      segmentsCount: segments.length
    };
  }
}

window.RouteViewer = RouteViewer;
