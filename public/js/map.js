/**
 * MAP NOTES - INTERACTIVE MAP & PIN MANAGER
 * 1. Shows pins for all logged places with latest visitor avatar.
 * 2. Category filters (Hotel / Medical / Restaurant / Other / All).
 * 3. 50-meter duplicate detection preview.
 * 4. Place detail history sheet with follow-up comment logging.
 * 5. Own-data deletion control (deleting last visit purges place).
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
  }

  init(containerId = 'mapView') {
    // Center initially on default coordinates (e.g., Manhattan / Chicago / London)
    this.map = L.map(containerId, {
      zoomControl: false,
      tap: false
    }).setView([40.7580, -73.9855], 14);

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

    // Try centering on rep's GPS location on load
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.map.setView([pos.coords.latitude, pos.coords.longitude], 15);
        },
        (err) => console.log('Initial location lookup declined/unavailable:', err.message),
        { enableHighAccuracy: false, timeout: 5000 }
      );
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
    // Check if visit modal is in "select location on map" mode
    const modal = document.getElementById('logVisitModal');
    if (modal && modal.classList.contains('active')) {
      this.setLocationForVisit(lat, lng);
    }
  }

  setLocationForVisit(lat, lng) {
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
