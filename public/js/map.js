/**
 * MAP NOTES - INTERACTIVE MAP & PIN MANAGER
 * 1. Default starts at user's true GPS or Tashkent, Uzbekistan [41.2995, 69.2401].
 * 2. Live pulsing user location indicator ("Blue Dot") + Floating "Locate Me" button.
 * 3. Human-readable place & address resolution via OpenStreetMap Nominatim.
 * 4. Dual-mode Pinning: Interactive center-screen crosshair targeting OR direct map tap.
 * 5. 50-meter duplicate detection preview and auto-attachment.
 * 6. Place detail history sheet with follow-up comment logging and own-data deletion.
 */

class MapNotesMap {
  constructor() {
    this.map = null;
    this.places = [];
    this.markersGroup = null;
    this.activeCategory = 'All';
    this.selectedPlace = null;
    this.activeMarker = null;

    this.pendingLocation = null; // { lat, lng }
    this.currentLocationMarker = null;
    this.currentLocationAccuracyCircle = null;
    this.isCenterCrosshairActive = false;
    this.hasCenteredInitialGPS = false;
  }

  init(containerId = 'mapView') {
    // Default center: Tashkent, Uzbekistan [41.2995, 69.2401]
    const defaultCenter = [41.2995, 69.2401];

    this.map = L.map(containerId, {
      zoomControl: false,
      tap: false
    }).setView(defaultCenter, 13);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // OpenStreetMap Standard Tiles (100% Free, Public, Zero API Key Required)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(this.map);

    this.markersGroup = L.layerGroup().addTo(this.map);

    // Map click handler for dropping pin manually
    this.map.on('click', (e) => {
      this.handleMapClick(e.latlng.lat, e.latlng.lng);
    });

    // When panning map in center-crosshair mode, update pending coordinates dynamically
    this.map.on('move', () => {
      if (this.isCenterCrosshairActive) {
        const center = this.map.getCenter();
        this.setLocationForVisit(center.lat, center.lng, false);
      }
    });

    // Auto-resolve real GPS position immediately on startup
    this.requestInitialGPS();
  }

  // Request high-accuracy GPS on load
  requestInitialGPS() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          this.updateLiveUserMarker(latitude, longitude, accuracy);

          // Center map directly on the user's real location!
          if (!this.hasCenteredInitialGPS) {
            this.map.setView([latitude, longitude], 16, { animate: true });
            this.hasCenteredInitialGPS = true;
          }
        },
        (err) => {
          console.log('[Map] GPS lookup unavailable or permission pending:', err.message);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
      );

      // Keep watching position to update live blue dot
      navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          this.updateLiveUserMarker(latitude, longitude, accuracy);
        },
        (err) => console.log('[Map] watchPosition error:', err.message),
        { enableHighAccuracy: true, maximumAge: 5000 }
      );
    }
  }

  // Live Pulsing Blue Dot Marker for the user's real-time position
  updateLiveUserMarker(lat, lng, accuracy) {
    const liveDotIcon = L.divIcon({
      className: 'live-user-dot-container',
      html: `<div class="live-user-dot" title="You are here"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    if (this.currentLocationMarker) {
      this.currentLocationMarker.setLatLng([lat, lng]);
    } else {
      this.currentLocationMarker = L.marker([lat, lng], {
        icon: liveDotIcon,
        zIndexOffset: 1000
      }).addTo(this.map);

      this.currentLocationMarker.bindPopup(`
        <div style="font-family: sans-serif; font-size: 13px;">
          <strong>📍 Your Live Location</strong><br/>
          <span style="color: #64748B;">GPS accuracy: ±${Math.round(accuracy || 10)}m</span>
        </div>
      `);
    }

    // Accuracy Circle
    if (accuracy && accuracy > 0) {
      if (this.currentLocationAccuracyCircle) {
        this.currentLocationAccuracyCircle.setLatLng([lat, lng]);
        this.currentLocationAccuracyCircle.setRadius(accuracy);
      } else {
        this.currentLocationAccuracyCircle = L.circle([lat, lng], {
          radius: accuracy,
          color: '#2563EB',
          fillColor: '#60A5FA',
          fillOpacity: 0.12,
          weight: 1
        }).addTo(this.map);
      }
    }
  }

  // "Locate Me" button action: smooth zoom & center on user's live position
  locateMe() {
    if (!('geolocation' in navigator)) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        this.updateLiveUserMarker(latitude, longitude, accuracy);
        this.map.setView([latitude, longitude], 16, { animate: true });

        // If logging visit modal is open, set location to current GPS
        const modal = document.getElementById('logVisitModal');
        if (modal && modal.classList.contains('active')) {
          this.setLocationForVisit(latitude, longitude, true);
        }
      },
      (err) => {
        alert('Could not determine your GPS location: ' + err.message + '\nPlease check location permissions in your browser/device settings.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // Reverse Geocode: Get human-readable street & city name via OpenStreetMap Nominatim
  async reverseGeocode(lat, lng) {
    const addressBox = document.getElementById('visitAddressDisplay');
    if (!addressBox) return;

    addressBox.textContent = 'Resolving street & city address...';

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();

      if (data && data.display_name) {
        // Build concise, readable address (Street, District, City, Country)
        const addr = data.address || {};
        const road = addr.road || addr.pedestrian || addr.suburb || '';
        const city = addr.city || addr.town || addr.state || addr.country || '';
        const readableStr = [road, city].filter(Boolean).join(', ') || data.display_name.split(',').slice(0, 3).join(',');

        addressBox.innerHTML = `📍 <strong>${readableStr}</strong>`;

        // Pre-fill Place Name input if currently empty
        const nameInput = document.getElementById('visitPlaceName');
        if (nameInput && (!nameInput.value || nameInput.value.includes('Location'))) {
          nameInput.value = readableStr;
        }
      } else {
        addressBox.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      }
    } catch (err) {
      console.warn('Reverse geocode error:', err);
      addressBox.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }

  // Calculate distance between two points in meters
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
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

  // Find nearby place within 50 meters
  findNearbyPlace(lat, lng) {
    let closest = null;
    let minDist = Infinity;

    for (const p of this.places) {
      const d = this.calculateDistance(lat, lng, p.lat, p.lng);
      if (d < minDist) {
        minDist = d;
        closest = p;
      }
    }

    if (closest && minDist <= 50) {
      return { place: closest, distance: Math.round(minDist) };
    }
    return null;
  }

  setPlaces(places) {
    this.places = places;
    this.renderMarkers();
  }

  setCategoryFilter(category) {
    this.activeCategory = category;
    this.renderMarkers();
  }

  renderMarkers() {
    this.markersGroup.clearLayers();

    const filtered = this.places.filter(p => {
      return this.activeCategory === 'All' || p.category === this.activeCategory;
    });

    filtered.forEach(place => {
      const visitor = place.latestVisitor || {
        avatarColor: '#475569',
        avatarInitials: '?'
      };

      // Category color stripe
      const catColors = {
        'Hotel': '#3B82F6',
        'Medical': '#10B981',
        'Restaurant': '#F59E0B',
        'Other': '#8B5CF6'
      };
      const catColor = catColors[place.category] || '#64748B';

      // Custom HTML Marker showing visitor avatar
      const markerHtml = `
        <div class="custom-pin-marker" style="--cat-color: ${catColor}; --avatar-color: ${visitor.avatarColor}">
          <div class="pin-avatar">${visitor.avatarInitials}</div>
          <div class="pin-needle"></div>
        </div>
      `;

      const icon = L.divIcon({
        className: 'pin-div-icon',
        html: markerHtml,
        iconSize: [38, 46],
        iconAnchor: [19, 46]
      });

      const marker = L.marker([place.lat, place.lng], { icon });

      marker.on('click', () => {
        this.openPlaceDetails(place);
      });

      this.markersGroup.addLayer(marker);
    });
  }

  handleMapClick(lat, lng) {
    const modal = document.getElementById('logVisitModal');
    if (modal && modal.classList.contains('active')) {
      this.setLocationForVisit(lat, lng, true);
    }
  }

  // Toggle center crosshair target mode
  setCenterCrosshairMode(active) {
    this.isCenterCrosshairActive = active;
    const crosshairEl = document.getElementById('mapCenterCrosshair');
    if (crosshairEl) {
      crosshairEl.classList.toggle('active', active);
    }

    if (active) {
      const center = this.map.getCenter();
      this.setLocationForVisit(center.lat, center.lng, true);
    }
  }

  setLocationForVisit(lat, lng, shouldReverseGeocode = true) {
    this.pendingLocation = { lat, lng };

    const locDisplay = document.getElementById('visitLocationDisplay');
    const dupAlert = document.getElementById('duplicateAlertBanner');
    const nameInput = document.getElementById('visitPlaceName');
    const categorySelect = document.getElementById('visitCategory');

    if (locDisplay) {
      locDisplay.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }

    // Check 50-meter duplicate detection
    const nearby = this.findNearbyPlace(lat, lng);
    if (nearby) {
      if (dupAlert) {
        dupAlert.innerHTML = `
          <strong>Nearby Location Found:</strong> "${nearby.place.name}" (${nearby.distance}m away).
          <br/><small>To prevent duplicate pins, your visit will automatically attach to this place's log.</small>
        `;
        dupAlert.style.display = 'block';
      }
      if (nameInput) {
        nameInput.value = nearby.place.name;
        nameInput.disabled = true; // Attached to existing place
      }
      if (categorySelect) {
        categorySelect.value = nearby.place.category;
        categorySelect.disabled = true;
      }
    } else {
      if (dupAlert) {
        dupAlert.style.display = 'none';
      }
      if (nameInput) {
        nameInput.disabled = false;
        if (nameInput.value.includes('Location') || !nameInput.value) {
          nameInput.value = '';
        }
      }
      if (categorySelect) {
        categorySelect.disabled = false;
      }
    }

    // Reverse geocode street & city name
    if (shouldReverseGeocode) {
      this.reverseGeocode(lat, lng);
    }
  }

  // Open Place Details Slide-over Sheet
  openPlaceDetails(place) {
    this.selectedPlace = place;
    const sheet = document.getElementById('placeDetailSheet');
    if (!sheet) return;

    // Header info
    document.getElementById('sheetPlaceName').textContent = place.name;
    document.getElementById('sheetCategoryBadge').textContent = place.category;
    document.getElementById('sheetCategoryBadge').className = `category-tag tag-${place.category.toLowerCase()}`;
    document.getElementById('sheetCoords').textContent = `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
    document.getElementById('sheetVisitCount').textContent = `${place.visitCount} visit${place.visitCount === 1 ? '' : 's'} logged`;

    // Render chronological visits list
    const listEl = document.getElementById('sheetVisitsList');
    listEl.innerHTML = '';

    const currentUserId = window.api.currentUser ? window.api.currentUser.id : null;

    place.visits.forEach(v => {
      const isOwnVisit = v.user_id === currentUserId;
      const card = document.createElement('div');
      card.className = 'visit-card';

      // Explicit full date and time formatting (not vague relative time)
      const fullDateStr = new Date(v.timestamp).toLocaleString([], {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      card.innerHTML = `
        <div class="visit-card-header">
          <div class="visitor-info">
            <div class="user-avatar-mini" style="background-color: ${v.avatar_color};">
              ${v.avatar_initials}
            </div>
            <div>
              <span class="visitor-name">${v.user_name}</span>
              <span class="visit-timestamp">${fullDateStr}</span>
            </div>
          </div>
          ${isOwnVisit ? `
            <button class="delete-visit-btn" data-visit-id="${v.id}" title="Delete your visit">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          ` : ''}
        </div>

        ${v.note ? `<p class="visit-note">${v.note}</p>` : ''}
        ${v.photo_data ? `<img src="${v.photo_data}" class="visit-photo" alt="Visit attachment"/>` : ''}
      `;

      // Bind Delete Button for Own Visits
      if (isOwnVisit) {
        const delBtn = card.querySelector('.delete-visit-btn');
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm('Are you sure you want to delete your logged visit? If this is the last remaining visit, the place will also be removed.')) {
            try {
              const res = await window.api.deleteVisit(v.id);
              if (res.placeDeleted) {
                alert('Visit deleted. As this was the place\'s last remaining visit, the place has been removed from the map.');
                sheet.classList.remove('active');
              } else {
                // Refresh place
                const updatedPlaces = await window.api.getPlaces(this.activeCategory);
                this.setPlaces(updatedPlaces.places);
                const reloadedPlace = updatedPlaces.places.find(p => p.id === place.id);
                if (reloadedPlace) this.openPlaceDetails(reloadedPlace);
              }
              if (window.mapNotesApp) window.mapNotesApp.reloadPlaces();
            } catch (err) {
              alert('Error deleting visit: ' + err.message);
            }
          }
        });
      }

      listEl.appendChild(card);
    });

    sheet.classList.add('active');
  }
}

window.mapManager = new MapNotesMap();
