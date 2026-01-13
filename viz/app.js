// ============ GEOGRAPHIC HELPERS (from globe.ts) ============

const EARTH_RADIUS_KM = 6371;
const EARTH_SURFACE_AREA_KM2 = 4 * Math.PI * EARTH_RADIUS_KM ** 2;
const SAFETY_MARGIN = 1.05;

function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function normLon(lon) {
    let x = ((lon + 180) % 360 + 360) % 360 - 180;
    return x === 180 ? -180 : x;
}

function lonInInterval(lon, lonMin, lonMax) {
    lon = normLon(lon);
    lonMin = normLon(lonMin);
    lonMax = normLon(lonMax);
    if (lonMin <= lonMax) return lon >= lonMin && lon < lonMax;
    return lon >= lonMin || lon < lonMax;
}

// ============ LAT/LON CELL CLASS ============

class LatLonCell {
    constructor(latMin, latMax, lonMin, lonMax) {
        this.latMin = latMin;
        this.latMax = latMax;
        this.lonMin = lonMin;
        this.lonMax = lonMax;
    }

    center() {
        const lat = (this.latMin + this.latMax) / 2;
        const lonMinN = normLon(this.lonMin);
        const lonMaxN = normLon(this.lonMax);
        let lon;
        if (lonMinN <= lonMaxN) {
            lon = (lonMinN + lonMaxN) / 2;
        } else {
            lon = normLon((lonMinN + (lonMaxN + 360)) / 2);
        }
        return [lat, lon];
    }

    contains(lat, lon) {
        if (lat < this.latMin || lat >= this.latMax) return false;
        return lonInInterval(lon, this.lonMin, this.lonMax);
    }

    radiusUpperBoundMeters(qLat, qLon) {
        const latMid = (this.latMin + this.latMax) / 2;
        const lonMid = this.center()[1];
        const pts = [
            [this.latMin, this.lonMin], [this.latMin, this.lonMax],
            [this.latMax, this.lonMin], [this.latMax, this.lonMax],
            [this.latMin, lonMid], [this.latMax, lonMid],
            [latMid, this.lonMin], [latMid, this.lonMax],
        ];
        let maxD = 0;
        for (const [lat, lon] of pts) {
            maxD = Math.max(maxD, haversineMeters(qLat, qLon, lat, lon));
        }
        return maxD;
    }

    subdivide4() {
        const latMid = (this.latMin + this.latMax) / 2;
        const lonMinN = normLon(this.lonMin);
        const lonMaxN = normLon(this.lonMax);
        let lonMid;
        if (lonMinN <= lonMaxN) {
            lonMid = (lonMinN + lonMaxN) / 2;
        } else {
            lonMid = normLon((lonMinN + (lonMaxN + 360)) / 2);
        }
        return [
            new LatLonCell(this.latMin, latMid, this.lonMin, lonMid),
            new LatLonCell(this.latMin, latMid, lonMid, this.lonMax),
            new LatLonCell(latMid, this.latMax, this.lonMin, lonMid),
            new LatLonCell(latMid, this.latMax, lonMid, this.lonMax),
        ];
    }

    areaKm2() {
        const toRad = x => x * Math.PI / 180;
        let lonSpan = normLon(this.lonMax) - normLon(this.lonMin);
        if (lonSpan < 0) lonSpan += 360;
        return EARTH_RADIUS_KM ** 2 * 
            Math.abs(Math.sin(toRad(this.latMax)) - Math.sin(toRad(this.latMin))) * 
            toRad(lonSpan);
    }

    toData() {
        return {
            latMin: this.latMin,
            latMax: this.latMax,
            lonMin: this.lonMin,
            lonMax: this.lonMax
        };
    }
}

function generateInitialCells() {
    const cells = [];
    const latStep = 30;
    const lonStep = 30;
    for (let lat = -90; lat < 90; lat += latStep) {
        for (let lon = -180; lon < 180; lon += lonStep) {
            cells.push(new LatLonCell(lat, lat + latStep, lon, lon + lonStep));
        }
    }
    return cells;
}

// ============ SIMULATED API ============

let allPoolsArray = []; // Loaded from pools.json

// Simulates querying for the N closest pools to a point
function queryClosestPools(lat, lon, limit = 50) {
    const poolsWithDistance = allPoolsArray.map(pool => ({
        pool,
        distance: haversineMeters(lat, lon, pool.latitude, pool.longitude)
    }));
    poolsWithDistance.sort((a, b) => a.distance - b.distance);
    return poolsWithDistance.slice(0, limit).map(p => p.pool);
}

function RhatFromPools(qLat, qLon, pools) {
    let maxD = 0;
    for (const p of pools) {
        const d = haversineMeters(qLat, qLon, p.latitude, p.longitude);
        if (d > maxD) maxD = d;
    }
    return maxD;
}

// ============ SIMULATION STATE ============

let simState = {
    cells: [],
    discoveredPools: new Map(), // id -> pool
    completedAreaKm2: 0,
    running: false,
    queryCount: 0,
    subdivideCount: 0,
    traversalMode: 'random', // 'pop', 'shift', 'random'
    speed: 200,
    currentCellData: null
};

function resetSimulation() {
    simState.cells = generateInitialCells();
    simState.discoveredPools = new Map();
    simState.completedAreaKm2 = 0;
    simState.running = false;
    simState.queryCount = 0;
    simState.subdivideCount = 0;
    simState.currentCellData = null;
    
    // Clear persistent maps to force fresh render
    clearPersistentMaps();
    
    updateStats();
    renderVisualization();
    updateSimUI();
}

function pickNextCell() {
    if (simState.cells.length === 0) return null;
    
    let idx;
    switch (simState.traversalMode) {
        case 'pop':
            idx = simState.cells.length - 1;
            break;
        case 'shift':
            idx = 0;
            break;
        case 'random':
        default:
            idx = Math.floor(Math.random() * simState.cells.length);
    }
    
    return simState.cells.splice(idx, 1)[0];
}

async function simulationStep() {
    if (!simState.running || simState.cells.length === 0) {
        simState.running = false;
        simState.currentCellData = null;
        updateSimUI();
        renderVisualization();
        if (simState.cells.length === 0) {
            console.log(`Simulation complete! Found ${simState.discoveredPools.size} pools.`);
        }
        return;
    }
    
    const cell = pickNextCell();
    if (!cell) {
        simState.running = false;
        updateSimUI();
        return;
    }
    
    simState.currentCellData = cell.toData();
    const [lat, lon] = cell.center();
    const thisCellArea = cell.areaKm2();
    
    simState.queryCount++;
    
    // Query the 50 closest pools
    const closestPools = queryClosestPools(lat, lon, 50);
    
    if (closestPools.length === 0) {
        // No pools anywhere near, cell is complete
        simState.completedAreaKm2 += thisCellArea;
        console.log(`[${simState.queryCount}] Cell complete (no pools). Coverage: ${coveragePct()}%`);
    } else {
        const Rhat = RhatFromPools(lat, lon, closestPools);
        const S = cell.radiusUpperBoundMeters(lat, lon);
        
        // Add discovered pools
        for (const pool of closestPools) {
            if (!simState.discoveredPools.has(pool.id)) {
                simState.discoveredPools.set(pool.id, pool);
            }
        }
        
        if (Rhat > SAFETY_MARGIN * S) {
            // Cell complete
            simState.completedAreaKm2 += thisCellArea;
            console.log(`[${simState.queryCount}] Cell complete. Rhat=${(Rhat/1000).toFixed(1)}km > S=${(S/1000).toFixed(1)}km. Coverage: ${coveragePct()}%`);
        } else {
            // Subdivide
            simState.subdivideCount++;
            const subCells = cell.subdivide4();
            for (const sub of subCells) {
                simState.cells.push(sub);
            }
            console.log(`[${simState.queryCount}] Subdividing. Rhat=${(Rhat/1000).toFixed(1)}km <= S=${(S/1000).toFixed(1)}km. Cells: ${simState.cells.length}`);
        }
    }
    
    updateStats();
    renderVisualization();
    
    // Schedule next step
    setTimeout(simulationStep, simState.speed);
}

function coveragePct() {
    return (simState.completedAreaKm2 / EARTH_SURFACE_AREA_KM2 * 100).toFixed(2);
}

function updateStats() {
    document.getElementById('pool-count').textContent = simState.discoveredPools.size.toLocaleString();
    document.getElementById('cell-count').textContent = simState.cells.length.toLocaleString();
    document.getElementById('coverage').textContent = `${coveragePct()}%`;
    document.getElementById('query-count').textContent = simState.queryCount;
    document.getElementById('subdivide-count').textContent = simState.subdivideCount;
    
    const progressPct = parseFloat(coveragePct());
    document.getElementById('progress-bar').style.width = `${progressPct}%`;
}

function updateSimUI() {
    const btnStart = document.getElementById('btn-start');
    if (simState.running) {
        btnStart.textContent = '⏸ Pause';
    } else if (simState.cells.length === 0) {
        btnStart.textContent = '✓ Done';
        btnStart.disabled = true;
    } else {
        btnStart.textContent = '▶ Start';
        btnStart.disabled = false;
    }
}

// ============ GLOBE VIEW ============

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
        .pointsTransitionDuration(300)
        .polygonsData([])
        .polygonGeoJsonGeometry(d => d.geometry)
        .polygonCapColor(d => d.isCurrent ? 'rgba(255, 204, 0, 0.5)' : 'rgba(255, 107, 107, 0.35)')
        .polygonSideColor(() => 'rgba(0, 0, 0, 0)')
        .polygonStrokeColor(d => d.isCurrent ? '#ffcc00' : '#ff6b6b')
        .polygonAltitude(d => d.isCurrent ? 0.015 : 0.008)
        .polygonCapCurvatureResolution(5)
        .pointsMerge(true)
        .polygonsTransitionDuration(300)
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
let currentCellLayer = null;

function initLeafletMap() {
    if (leafletMap) return;
    
    const canvasRenderer = L.canvas({ padding: 0.5 });
    
    leafletMap = L.map(mapContainer, {
        center: [20, 0],
        zoom: 2,
        minZoom: 2,
        maxZoom: 18,
        worldCopyJump: true,
        preferCanvas: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(leafletMap);

    poolsLayer = L.layerGroup().addTo(leafletMap);
    cellsLayer = L.layerGroup().addTo(leafletMap);
    currentCellLayer = L.layerGroup().addTo(leafletMap);
    
    leafletMap.canvasRenderer = canvasRenderer;
    
    leafletMap.on('zoomend', () => {
        const newRadius = getMarkerRadius(leafletMap.getZoom());
        poolsLayer.eachLayer(marker => {
            if (marker.setRadius) marker.setRadius(newRadius);
        });
    });
}

const poolMarkerStyle = {
    fillColor: '#00d4ff',
    color: '#0099ff',
    weight: 1,
    opacity: 1,
    fillOpacity: 0.8
};

function getMarkerRadius(zoom) {
    if (zoom <= 2) return 1;
    if (zoom <= 4) return 2;
    if (zoom <= 6) return 3;
    if (zoom <= 8) return 5;
    if (zoom <= 10) return 7;
    return 10;
}

// ============ VIEW TOGGLE ============

let currentView = 'map';
const btnGlobe = document.getElementById('btn-globe');
const btnMap = document.getElementById('btn-map');

btnGlobe.addEventListener('click', () => switchView('globe'));
btnMap.addEventListener('click', () => switchView('map'));

function switchView(view) {
    currentView = view;
    
    // Clear persistent maps on view switch to force fresh render
    clearPersistentMaps();
    
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
    
    renderVisualization();
}

// ============ VISUALIZATION RENDERING ============

// Persistent object maps - Globe.gl needs same object references to avoid re-init
const persistentPoolMap = new Map();  // id -> pool object for globe
const persistentCellMap = new Map();  // cellKey -> polygon object for globe

// The actual arrays passed to Globe.gl (we mutate these in-place)
const globePoolsArray = [];
const globePolygonsArray = [];

// Special object for current cell highlight (reused to avoid flicker)
let currentCellObject = null;

function getCellKey(cell) {
    const c = cell.toData ? cell.toData() : cell;
    return `${c.latMin},${c.lonMin},${c.latMax},${c.lonMax}`;
}

function cellToGeometry(cell) {
    const c = cell.toData ? cell.toData() : cell;
    return {
            type: 'Polygon',
            coordinates: [[
            [c.lonMin, c.latMin],
            [c.lonMin, c.latMax],
            [c.lonMax, c.latMax],
            [c.lonMax, c.latMin],
            [c.lonMin, c.latMin]
        ]]
    };
}

function clearPersistentMaps() {
    persistentPoolMap.clear();
    persistentCellMap.clear();
    globePoolsArray.length = 0;
    globePolygonsArray.length = 0;
    currentCellObject = null;
}

function renderVisualization() {
    const pools = Array.from(simState.discoveredPools.values());
    const cells = simState.cells;
    const currentCell = simState.currentCellData;
    
    // Apply filters
    const publicFilter = filterPublic.value;
    const lengthFilter = filterLength.value;
    
    const filteredPools = pools.filter(pool => {
        if (publicFilter && pool.public !== publicFilter) return false;
        if (lengthFilter && pool.length !== lengthFilter) return false;
        return true;
    });
    
    if (currentView === 'globe' && globe) {
        // Update pools in-place (reuse existing objects to prevent Globe.gl re-init)
        const currentPoolIds = new Set(filteredPools.map(p => p.id));
        
        // Remove pools no longer present
        for (const [id] of persistentPoolMap) {
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
        const currentCellKeys = new Set(cells.map(c => getCellKey(c)));
        
        // Remove cells no longer present
        for (const [key] of persistentCellMap) {
            if (!currentCellKeys.has(key)) {
                persistentCellMap.delete(key);
            }
        }
        
        // Add cells (update geometry for existing ones)
        for (const cell of cells) {
            const key = getCellKey(cell);
            let obj = persistentCellMap.get(key);
            if (!obj) {
                obj = { isCurrent: false, geometry: cellToGeometry(cell) };
                persistentCellMap.set(key, obj);
            }
            obj.isCurrent = false; // Regular cells are not current
        }
        
        // Handle current cell highlight
        if (currentCell) {
            const currentKey = getCellKey(currentCell);
            // Check if current cell is in the regular cells (it shouldn't be, but just in case)
            if (persistentCellMap.has(currentKey)) {
                persistentCellMap.get(currentKey).isCurrent = true;
                currentCellObject = null; // Don't need separate object
            } else {
                // Create/update separate current cell object
                if (!currentCellObject) {
                    currentCellObject = { isCurrent: true, geometry: null };
                }
                currentCellObject.geometry = cellToGeometry(currentCell);
                currentCellObject.isCurrent = true;
            }
        } else {
            currentCellObject = null;
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
        if (currentCellObject) {
            globePolygonsArray.push(currentCellObject);
        }
        
        globe.pointsData(globePoolsArray);
        globe.polygonsData(globePolygonsArray);
    } else if (currentView === 'map' && leafletMap) {
        poolsLayer.clearLayers();
        cellsLayer.clearLayers();
        currentCellLayer.clearLayers();
        
        const currentRadius = getMarkerRadius(leafletMap.getZoom());
        
        filteredPools.forEach(pool => {
            const marker = L.circleMarker([pool.latitude, pool.longitude], {
                ...poolMarkerStyle,
                radius: currentRadius,
                renderer: leafletMap.canvasRenderer
            }).bindPopup(`
                    <div class="pool-popup">
                        <h3>${pool.name || 'Unknown Pool'}</h3>
                        <p><strong>Length:</strong> ${pool.length || 'N/A'}</p>
                        <p><strong>Public:</strong> ${pool.public || 'N/A'}</p>
                        <p><strong>Hotel:</strong> ${pool.hotel || 'N/A'}</p>
                    </div>
                `);
            poolsLayer.addLayer(marker);
        });
        
        cells.forEach(cell => {
            const cellData = cell.toData ? cell.toData() : cell;
            const rect = L.rectangle([
                [cellData.latMin, cellData.lonMin],
                [cellData.latMax, cellData.lonMax]
            ], {
                color: '#ff6b6b',
                weight: 1,
                fillColor: '#ff6b6b',
                fillOpacity: 0.15,
                interactive: false
            });
            cellsLayer.addLayer(rect);
        });
        
        if (currentCell) {
            const currentRect = L.rectangle([
                [currentCell.latMin, currentCell.lonMin],
                [currentCell.latMax, currentCell.lonMax]
            ], {
                color: '#ffcc00',
                weight: 3,
                fillColor: '#ffcc00',
                fillOpacity: 0.3,
                interactive: false
            });
            currentCellLayer.addLayer(currentRect);
        }
    }
}

// ============ FILTERS ============

const filterPublic = document.getElementById('filter-public');
const filterLength = document.getElementById('filter-length');

filterPublic.addEventListener('change', renderVisualization);
filterLength.addEventListener('change', renderVisualization);

function populateFilterOptions(pools) {
    const currentPublic = filterPublic.value;
    const currentLength = filterLength.value;
    
    const publicValues = new Set();
    const lengthValues = new Set();
    
    pools.forEach(pool => {
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

// ============ SIMULATION CONTROLS ============

const modePop = document.getElementById('mode-pop');
const modeShift = document.getElementById('mode-shift');
const modeRandom = document.getElementById('mode-random');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');
const btnStart = document.getElementById('btn-start');
const btnReset = document.getElementById('btn-reset');

function setTraversalMode(mode) {
    simState.traversalMode = mode;
    modePop.classList.toggle('active', mode === 'pop');
    modeShift.classList.toggle('active', mode === 'shift');
    modeRandom.classList.toggle('active', mode === 'random');
}

modePop.addEventListener('click', () => setTraversalMode('pop'));
modeShift.addEventListener('click', () => setTraversalMode('shift'));
modeRandom.addEventListener('click', () => setTraversalMode('random'));

speedSlider.addEventListener('input', () => {
    simState.speed = parseInt(speedSlider.value);
    speedValue.textContent = `${simState.speed}ms`;
});

btnStart.addEventListener('click', () => {
    if (simState.running) {
        simState.running = false;
        updateSimUI();
    } else {
        simState.running = true;
        updateSimUI();
        simulationStep();
    }
});

btnReset.addEventListener('click', () => {
    resetSimulation();
});

// ============ INITIALIZATION ============

async function loadPoolData() {
    const loading = document.getElementById('loading');
    
        try {
            const response = await fetch('../pools.json');
        if (!response.ok) throw new Error(`Failed to load pools.json: ${response.status}`);
        
                const data = await response.json();
        loading.style.display = 'none';
        
        // Extract pools into array
        const poolInfo = data.poolInfo || {};
        allPoolsArray = Object.values(poolInfo);
        
        console.log(`Loaded ${allPoolsArray.length} pools for simulation`);
        
        // Populate filter options from full dataset
        populateFilterOptions(allPoolsArray);
        
        // Initialize simulation
        resetSimulation();
        
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

window.addEventListener('resize', () => {
    if (globe) {
        globe.width(window.innerWidth);
        globe.height(window.innerHeight);
    }
    if (leafletMap) leafletMap.invalidateSize();
});

// Start
initLeafletMap();
loadPoolData();
