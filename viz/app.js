// Initialize the map
const map = L.map('map', {
    center: [20, 0],
    zoom: 2,
    minZoom: 2,
    maxZoom: 18,
    worldCopyJump: true
});

// Dark tile layer (CartoDB Dark Matter)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
}).addTo(map);

// Earth surface area in km²
const EARTH_SURFACE_AREA_KM2 = 510100000;

// Custom pool marker icon
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

// Layer groups
const poolsLayer = L.layerGroup().addTo(map);
const cellsLayer = L.layerGroup().addTo(map);

// Store current data globally for filtering
let currentData = null;

// Filter elements
const filterPublic = document.getElementById('filter-public');
const filterLength = document.getElementById('filter-length');

// Listen for filter changes
filterPublic.addEventListener('change', () => applyFilters());
filterLength.addEventListener('change', () => applyFilters());

function applyFilters() {
    if (!currentData) return;
    poolsLayer.clearLayers();
    cellsLayer.clearLayers();
    displayData(currentData, false);
}

function populateFilterOptions(pools) {
    // Preserve current selections
    const currentPublic = filterPublic.value;
    const currentLength = filterLength.value;
    
    const publicValues = new Set();
    const lengthValues = new Set();
    
    Object.values(pools).forEach(pool => {
        if (pool.public) publicValues.add(pool.public);
        if (pool.length) lengthValues.add(pool.length);
    });
    
    // Sort and populate public filter
    const sortedPublic = [...publicValues].sort();
    filterPublic.innerHTML = '<option value="">All</option>';
    sortedPublic.forEach(val => {
        filterPublic.innerHTML += `<option value="${val}">${val}</option>`;
    });
    
    // Sort lengths intelligently (meters before yards, numerically)
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
    
    // Restore selections if they still exist
    if (currentPublic && publicValues.has(currentPublic)) {
        filterPublic.value = currentPublic;
    }
    if (currentLength && lengthValues.has(currentLength)) {
        filterLength.value = currentLength;
    }
}

// Load and display the data
async function loadData() {
    const loading = document.getElementById('loading');
    
    try {
        const response = await fetch('../pools.json');
        if (!response.ok) {
            throw new Error(`Failed to load pools.json: ${response.status}`);
        }
        
        const data = await response.json();
        loading.style.display = 'none';
        
        currentData = data;
        populateFilterOptions(data.poolInfo || {});
        displayData(data);
    } catch (error) {
        loading.innerHTML = `
            <div class="error">
                <p>❌ Error loading data</p>
                <p style="font-size: 11px; margin-top: 10px; color: #888;">
                    ${error.message}<br><br>
                    Make sure to run a local server:<br>
                    <code style="color: #00d4ff;">cd viz && python3 -m http.server 8080</code>
                </p>
            </div>
        `;
        console.error('Error loading pools.json:', error);
    }
}

function displayData(data, fitToData = true) {
    const pools = data.poolInfo || {};
    const cells = data.cells || [];
    const completedAreaKm2 = data.completedAreaKm2 || 0;
    
    // Get current filter values
    const publicFilter = filterPublic.value;
    const lengthFilter = filterLength.value;
    
    // Filter pools
    const filteredPools = Object.values(pools).filter(pool => {
        if (publicFilter && pool.public !== publicFilter) return false;
        if (lengthFilter && pool.length !== lengthFilter) return false;
        return true;
    });
    
    // Update stats (show filtered / total)
    const totalCount = Object.keys(pools).length;
    const filteredCount = filteredPools.length;
    const showingFiltered = publicFilter || lengthFilter;
    
    document.getElementById('pool-count').textContent = showingFiltered 
        ? `${filteredCount.toLocaleString()} / ${totalCount.toLocaleString()}`
        : totalCount.toLocaleString();
    document.getElementById('cell-count').textContent = cells.length.toLocaleString();
    
    const coveragePct = (completedAreaKm2 / EARTH_SURFACE_AREA_KM2 * 100).toFixed(2);
    document.getElementById('coverage').textContent = `${coveragePct}%`;
    
    // Add pool markers
    const poolMarkers = [];
    filteredPools.forEach(pool => {
        const marker = L.marker([pool.latitude, pool.longitude], { icon: poolIcon })
            .bindPopup(`
                <div class="pool-popup">
                    <h3>${pool.name || 'Unknown Pool'}</h3>
                    <p><strong>Length:</strong> ${pool.length || 'N/A'}</p>
                    <p><strong>Public:</strong> ${pool.public || 'N/A'}</p>
                    <p><strong>Hotel:</strong> ${pool.hotel || 'N/A'}</p>
                    <p><strong>ID:</strong> ${pool.id}</p>
                </div>
            `);
        poolMarkers.push(marker);
        poolsLayer.addLayer(marker);
    });
    
    // Add remaining cells as rectangles
    cells.forEach(cell => {
        const bounds = [
            [cell.latMin, cell.lonMin],
            [cell.latMax, cell.lonMax]
        ];
        
        const rect = L.rectangle(bounds, {
            color: '#ff6b6b',
            weight: 1,
            fillColor: '#ff6b6b',
            fillOpacity: 0.15,
            interactive: false
        });
        
        cellsLayer.addLayer(rect);
    });
    
    // Fit bounds to show all pools only on initial load
    if (fitToData && poolMarkers.length > 0) {
        const group = L.featureGroup(poolMarkers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
    
    console.log(`Loaded ${poolCount} pools and ${cells.length} remaining cells`);
}

// Reload data every 30 seconds to see updates
function startAutoRefresh() {
    setInterval(async () => {
        try {
            const response = await fetch('../pools.json');
            if (response.ok) {
                const data = await response.json();
                
                // Update stored data and refresh filter options
                currentData = data;
                populateFilterOptions(data.poolInfo || {});
                
                // Clear existing layers
                poolsLayer.clearLayers();
                cellsLayer.clearLayers();
                
                // Redisplay without resetting zoom
                displayData(data, false);
            }
        } catch (e) {
            console.log('Auto-refresh failed, will retry...');
        }
    }, 15000);
}

// Start
loadData().then(() => {
    startAutoRefresh();
});
