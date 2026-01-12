// ============ GLOBE VIEW (lazy init) ============
const globeContainer = document.getElementById('globe-container');
let globe = null;

function initGlobe() {
    if (globe) return;
    
    globe = Globe()
        .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
        .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
        .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
        .showAtmosphere(true)
        .atmosphereColor('#00d4ff')
        .atmosphereAltitude(0.15)
        // Pool points
        .pointsData([])
        .pointLat('latitude')
        .pointLng('longitude')
        .pointColor(() => '#00d4ff')
        .pointAltitude(0.01)
        .pointRadius(0.15)
        .pointLabel(d => `
            <div style="background: rgba(10,10,15,0.95); border: 1px solid #0f4c75; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; color: #e0e0e0;">
                <div style="color: #00d4ff; font-weight: bold; margin-bottom: 8px;">${d.name || 'Unknown Pool'}</div>
                <div>Length: ${d.length || 'N/A'}</div>
                <div>Public: ${d.public || 'N/A'}</div>
                <div>Hotel: ${d.hotel || 'N/A'}</div>
            </div>
        `)
        .pointsTransitionDuration(1000)
        // Remaining cells as polygons
        .polygonsData([])
        .polygonGeoJsonGeometry(d => d.geometry)
        .polygonCapColor(() => 'rgba(255, 107, 107, 0.35)')
        .polygonSideColor(() => 'rgba(0, 0, 0, 0)')
        .polygonStrokeColor(() => '#ff6b6b')
        .polygonAltitude(0.008)
        .polygonCapCurvatureResolution(5)
        // Smooth transitions for data updates
        .pointsMerge(true)
        .polygonsTransitionDuration(1000)
        (globeContainer);

    globe.pointOfView({ lat: 30, lng: 0, altitude: 2.5 });
    globe.controls().autoRotate = true;
    globe.controls().autoRotateSpeed = 0.3;
    globe.controls().addEventListener('start', () => {
        globe.controls().autoRotate = false;
    });
}

// ============ MAP VIEW (Leaflet) ============
const mapContainer = document.getElementById('map-container');
let leafletMap = null;
let poolsLayer = null;
let cellsLayer = null;

function initLeafletMap() {
    if (leafletMap) return;
    
    leafletMap = L.map(mapContainer, {
        center: [20, 0],
        zoom: 2,
        minZoom: 2,
        maxZoom: 18,
        worldCopyJump: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(leafletMap);

    poolsLayer = L.layerGroup().addTo(leafletMap);
    cellsLayer = L.layerGroup().addTo(leafletMap);
}

// Custom pool marker icon for Leaflet
const poolIcon = L.divIcon({
    className: 'pool-marker',
    html: `<div style="
        width: 12px;
        height: 12px;
        background: #00d4ff;
        border: 2px solid #0099ff;
        border-radius: 50%;
        box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
});

// ============ VIEW TOGGLE ============
let currentView = 'map'; // 'globe' or 'map'
const btnGlobe = document.getElementById('btn-globe');
const btnMap = document.getElementById('btn-map');

btnGlobe.addEventListener('click', () => switchView('globe'));
btnMap.addEventListener('click', () => switchView('map'));

function switchView(view) {
    currentView = view;
    
    // Clear persistent maps on view switch to force fresh render
    persistentPoolMap.clear();
    persistentCellMap.clear();
    
    if (view === 'globe') {
        globeContainer.classList.remove('hidden');
        mapContainer.classList.add('hidden');
        btnGlobe.classList.add('active');
        btnMap.classList.remove('active');
        
        initGlobe();
        setTimeout(() => {
            globe.width(window.innerWidth);
            globe.height(window.innerHeight);
        }, 100);
    } else {
        globeContainer.classList.add('hidden');
        mapContainer.classList.remove('hidden');
        btnGlobe.classList.remove('active');
        btnMap.classList.add('active');
        
        initLeafletMap();
        setTimeout(() => leafletMap.invalidateSize(), 100);
    }
    
    // Re-render data for the active view
    if (currentData) {
        displayData(currentData, false);
    }
}

// ============ DATA & FILTERS ============
const EARTH_SURFACE_AREA_KM2 = 510100000;
let currentData = null;
let isFirstLoad = true;

// Track last rendered state to avoid unnecessary re-renders
let lastPublicFilter = '';
let lastLengthFilter = '';

// Persistent object maps - Globe.gl needs same object references to avoid re-init
const persistentPoolMap = new Map();  // id -> pool object
const persistentCellMap = new Map();  // key -> polygon object

// The actual arrays passed to Globe.gl (we mutate these in-place)
const globePoolsArray = [];
const globePolygonsArray = [];

const filterPublic = document.getElementById('filter-public');
const filterLength = document.getElementById('filter-length');

filterPublic.addEventListener('change', () => applyFilters());
filterLength.addEventListener('change', () => applyFilters());

function applyFilters() {
    if (!currentData) return;
    displayData(currentData, false);
}

function populateFilterOptions(pools) {
    const currentPublic = filterPublic.value;
    const currentLength = filterLength.value;
    
    const publicValues = new Set();
    const lengthValues = new Set();
    
    Object.values(pools).forEach(pool => {
        if (pool.public) publicValues.add(pool.public);
        if (pool.length) lengthValues.add(pool.length);
    });
    
    const sortedPublic = [...publicValues].sort();
    filterPublic.innerHTML = '<option value="">All</option>';
    sortedPublic.forEach(val => {
        filterPublic.innerHTML += `<option value="${val}">${val}</option>`;
    });
    
    const sortedLength = [...lengthValues].sort((a, b) => {
        const parseLen = (s) => {
            const match = s.match(/(\d+)(m|y)/);
            if (!match) return { num: 999, unit: 'z', raw: s };
            return { num: parseInt(match[1]), unit: match[2], raw: s };
        };
        const pa = parseLen(a), pb = parseLen(b);
        if (pa.unit !== pb.unit) return pa.unit.localeCompare(pb.unit);
        return pa.num - pb.num;
    });
    
    filterLength.innerHTML = '<option value="">All</option>';
    sortedLength.forEach(val => {
        filterLength.innerHTML += `<option value="${val}">${val}</option>`;
    });
    
    if (currentPublic && publicValues.has(currentPublic)) filterPublic.value = currentPublic;
    if (currentLength && lengthValues.has(currentLength)) filterLength.value = currentLength;
}

// Convert cells to GeoJSON for globe polygons (counter-clockwise winding)
function cellsToGeoJSON(cells) {
    return cells.map(cell => ({
        geometry: {
            type: 'Polygon',
            coordinates: [[
                [cell.lonMin, cell.latMin],  // bottom-left
                [cell.lonMin, cell.latMax],  // top-left
                [cell.lonMax, cell.latMax],  // top-right
                [cell.lonMax, cell.latMin],  // bottom-right
                [cell.lonMin, cell.latMin]   // close
            ]]
        }
    }));
}

async function loadData() {
    const loading = document.getElementById('loading');
    
    try {
        const response = await fetch('../pools.json');
        if (!response.ok) throw new Error(`Failed to load pools.json: ${response.status}`);
        
        const data = await response.json();
        loading.style.display = 'none';
        
        currentData = data;
        populateFilterOptions(data.poolInfo || {});
        displayData(data, isFirstLoad);
        isFirstLoad = false;
    } catch (error) {
        loading.innerHTML = `
            <div class="error">
                <p>❌ Error loading data</p>
                <p style="font-size: 11px; margin-top: 10px; color: #888;">
                    ${error.message}<br><br>
                    Run a local server:<br>
                    <code style="color: #00d4ff;">python3 -m http.server 8080</code>
                </p>
            </div>
        `;
    }
}

function displayData(data, fitToData = false) {
    const pools = data.poolInfo || {};
    const cells = data.cells || [];
    const completedAreaKm2 = data.completedAreaKm2 || 0;
    
    const publicFilter = filterPublic.value;
    const lengthFilter = filterLength.value;
    
    const filteredPools = Object.values(pools).filter(pool => {
        if (publicFilter && pool.public !== publicFilter) return false;
        if (lengthFilter && pool.length !== lengthFilter) return false;
        return true;
    });
    
    const totalCount = Object.keys(pools).length;
    const filteredCount = filteredPools.length;
    const showingFiltered = publicFilter || lengthFilter;
    
    document.getElementById('pool-count').textContent = showingFiltered 
        ? `${filteredCount.toLocaleString()} / ${totalCount.toLocaleString()}`
        : totalCount.toLocaleString();
    document.getElementById('cell-count').textContent = cells.length.toLocaleString();
    document.getElementById('coverage').textContent = `${(completedAreaKm2 / EARTH_SURFACE_AREA_KM2 * 100).toFixed(2)}%`;
    
    if (currentView === 'globe' && globe) {
        // Update pools in-place (reuse existing objects to prevent Globe.gl re-init)
        const currentPoolIds = new Set(filteredPools.map(p => p.id));
        
        // Remove pools no longer present
        for (const [id, obj] of persistentPoolMap) {
            if (!currentPoolIds.has(id)) {
                persistentPoolMap.delete(id);
            }
        }
        
        // Add/update pools
        for (const pool of filteredPools) {
            let obj = persistentPoolMap.get(pool.id);
            if (!obj) {
                obj = {};
                persistentPoolMap.set(pool.id, obj);
            }
            // Update properties in-place
            obj.id = pool.id;
            obj.latitude = pool.latitude;
            obj.longitude = pool.longitude;
            obj.name = pool.name;
            obj.length = pool.length;
            obj.public = pool.public;
            obj.hotel = pool.hotel;
        }
        
        // Update cells in-place
        const currentCellKeys = new Set(cells.map(c => `${c.latMin},${c.lonMin},${c.latMax},${c.lonMax}`));
        
        // Remove cells no longer present
        for (const [key, obj] of persistentCellMap) {
            if (!currentCellKeys.has(key)) {
                persistentCellMap.delete(key);
            }
        }
        
        // Add cells (cells don't change, they just appear/disappear)
        for (const cell of cells) {
            const key = `${cell.latMin},${cell.lonMin},${cell.latMax},${cell.lonMax}`;
            if (!persistentCellMap.has(key)) {
                persistentCellMap.set(key, {
                    geometry: {
                        type: 'Polygon',
                        coordinates: [[
                            [cell.lonMin, cell.latMin],
                            [cell.lonMin, cell.latMax],
                            [cell.lonMax, cell.latMax],
                            [cell.lonMax, cell.latMin],
                            [cell.lonMin, cell.latMin]
                        ]]
                    }
                });
            }
        }
        
        // Rebuild arrays from maps (keeping object references stable)
        globePoolsArray.length = 0;
        for (const obj of persistentPoolMap.values()) {
            globePoolsArray.push(obj);
        }
        
        globePolygonsArray.length = 0;
        for (const obj of persistentCellMap.values()) {
            globePolygonsArray.push(obj);
        }
        
        console.log('[globe] Updating - pools:', globePoolsArray.length, 'cells:', globePolygonsArray.length);
        
        globe.pointsData(globePoolsArray);
        globe.polygonsData(globePolygonsArray);
        
        lastPublicFilter = publicFilter;
        lastLengthFilter = lengthFilter;
    } else if (currentView === 'map' && leafletMap) {
        // Update Leaflet map
        poolsLayer.clearLayers();
        cellsLayer.clearLayers();
        
        const markers = [];
        filteredPools.forEach(pool => {
            const marker = L.marker([pool.latitude, pool.longitude], { icon: poolIcon })
                .bindPopup(`
                    <div class="pool-popup">
                        <h3>${pool.name || 'Unknown Pool'}</h3>
                        <p><strong>Length:</strong> ${pool.length || 'N/A'}</p>
                        <p><strong>Public:</strong> ${pool.public || 'N/A'}</p>
                        <p><strong>Hotel:</strong> ${pool.hotel || 'N/A'}</p>
                    </div>
                `);
            markers.push(marker);
            poolsLayer.addLayer(marker);
        });
        
        cells.forEach(cell => {
            const rect = L.rectangle([
                [cell.latMin, cell.lonMin],
                [cell.latMax, cell.lonMax]
            ], {
                color: '#ff6b6b',
                weight: 1,
                fillColor: '#ff6b6b',
                fillOpacity: 0.15,
                interactive: false
            });
            cellsLayer.addLayer(rect);
        });
        
        if (fitToData && markers.length > 0) {
            leafletMap.fitBounds(L.featureGroup(markers).getBounds().pad(0.1));
        }
        
        // Update tracking for map view too
        lastPublicFilter = publicFilter;
        lastLengthFilter = lengthFilter;
    }
    
    console.log(`Loaded ${filteredCount} pools and ${cells.length} cells`);
}

function startAutoRefresh() {
    setInterval(async () => {
        console.log('[autoRefresh] Fetching data...');
        try {
            const response = await fetch('../pools.json');
            if (response.ok) {
                const data = await response.json();
                console.log('[autoRefresh] Got data - pools:', Object.keys(data.poolInfo || {}).length, 'cells:', (data.cells || []).length);
                currentData = data;
                populateFilterOptions(data.poolInfo || {});
                displayData(data, false);
            }
        } catch (e) {
            console.log('[autoRefresh] Failed:', e);
        }
    }, 15000);
}

window.addEventListener('resize', () => {
    if (globe) {
        globe.width(window.innerWidth);
        globe.height(window.innerHeight);
    }
    if (leafletMap) leafletMap.invalidateSize();
});

// Initialize map on load since it's the default view
initLeafletMap();
loadData().then(() => startAutoRefresh());
