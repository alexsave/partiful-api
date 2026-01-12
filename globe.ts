// loading extension this doesn't do shit as of 11/11/25 ish
// BE SURE TO LOAD the extension INTO CHROME manually, and reload as you change it
// Also it's easier to just have chrome open already
const { initializeServer, sendCommand } = require('./utils/webutils');

const path = require('path');
const fs = require('fs');

const SAVE_FILE = path.resolve(__dirname, './pools.json');

// ============ GEOGRAPHIC HELPERS ============

// Haversine distance in meters between two lat/lon points
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters
    const toRad = (x: number) => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// Normalize longitude to [-180, 180)
function normLon(lon: number): number {
    let x = ((lon + 180) % 360 + 360) % 360 - 180;
    return x === 180 ? -180 : x;
}

// Check if longitude is within interval, handling dateline wrap
function lonInInterval(lon: number, lonMin: number, lonMax: number): boolean {
    lon = normLon(lon);
    lonMin = normLon(lonMin);
    lonMax = normLon(lonMax);

    if (lonMin <= lonMax) return lon >= lonMin && lon < lonMax;
    // crosses dateline
    return lon >= lonMin || lon < lonMax;
}

// ============ LAT/LON CELL CLASS ============

interface CellData {
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;
}

class LatLonCell {
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;

    constructor(latMin: number, latMax: number, lonMin: number, lonMax: number) {
        this.latMin = latMin;
        this.latMax = latMax;
        this.lonMin = lonMin;
        this.lonMax = lonMax;
    }

    static fromData(data: CellData): LatLonCell {
        return new LatLonCell(data.latMin, data.latMax, data.lonMin, data.lonMax);
    }

    toData(): CellData {
        return {
            latMin: this.latMin,
            latMax: this.latMax,
            lonMin: this.lonMin,
            lonMax: this.lonMax
        };
    }

    center(): [number, number] {
        const lat = (this.latMin + this.latMax) / 2;
        const lonMinN = normLon(this.lonMin);
        const lonMaxN = normLon(this.lonMax);
        let lon: number;
        if (lonMinN <= lonMaxN) {
            lon = (lonMinN + lonMaxN) / 2;
        } else {
            // crosses dateline: treat lonMax as lonMax+360
            lon = normLon((lonMinN + (lonMaxN + 360)) / 2);
        }
        return [lat, lon];
    }

    contains(lat: number, lon: number): boolean {
        if (lat < this.latMin || lat >= this.latMax) return false;
        return lonInInterval(lon, this.lonMin, this.lonMax);
    }

    // Upper bound on max distance from (qLat, qLon) to any point in cell
    // Uses corners + edge midpoints (8 points) for safety on a sphere
    radiusUpperBoundMeters(qLat: number, qLon: number): number {
        const latMid = (this.latMin + this.latMax) / 2;
        const lonMid = this.center()[1];

        const pts: [number, number][] = [
            // 4 corners
            [this.latMin, this.lonMin], [this.latMin, this.lonMax],
            [this.latMax, this.lonMin], [this.latMax, this.lonMax],
            // 4 edge midpoints
            [this.latMin, lonMid], [this.latMax, lonMid],
            [latMid, this.lonMin], [latMid, this.lonMax],
        ];

        let maxD = 0;
        for (const [lat, lon] of pts) {
            maxD = Math.max(maxD, haversineMeters(qLat, qLon, lat, lon));
        }
        return maxD;
    }

    subdivide4(): LatLonCell[] {
        const latMid = (this.latMin + this.latMax) / 2;

        const lonMinN = normLon(this.lonMin);
        const lonMaxN = normLon(this.lonMax);
        let lonMid: number;
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
}

// Compute Rhat(q) = max distance from query point to any of the returned pins
function RhatFromPins(qLat: number, qLon: number, pins: { Latitude: number; Longitude: number }[]): number {
    let maxD = 0;
    for (const p of pins) {
        const d = haversineMeters(qLat, qLon, p.Latitude, p.Longitude);
        if (d > maxD) maxD = d;
    }
    return maxD;
}

// Generate initial 6x12 grid of cells (30 deg lat x 30 deg lon each)
function generateInitialCells(): CellData[] {
    const cells: CellData[] = [];
    const latStep = 30;
    const lonStep = 30;

    for (let lat = -90; lat < 90; lat += latStep) {
        for (let lon = -180; lon < 180; lon += lonStep) {
            cells.push({
                latMin: lat,
                latMax: lat + latStep,
                lonMin: lon,
                lonMax: lon + lonStep
            });
        }
    }
    return cells;
}

// ============ DATA STORE ============

interface PoolInfo {
    id: string;
    name: string;
    urlSuffix: string;
    latitude: number;
    longitude: number;
    length: string;
    public: string;
    hotel: string;
}

interface DataStore {
    poolInfo: { [id: string]: PoolInfo };
    cells: CellData[];
    completedAreaKm2: number;
}

let dataStore: DataStore = {
    poolInfo: {},
    cells: generateInitialCells(),
    completedAreaKm2: 0
};

try {
    if (fs.existsSync(SAVE_FILE)) {
        const raw = fs.readFileSync(SAVE_FILE, 'utf8').trim();
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                dataStore = {
                    poolInfo: parsed.poolInfo || {},
                    cells: parsed.cells || generateInitialCells(),
                    completedAreaKm2: parsed.completedAreaKm2 || 0
                };
            }
        }
    }
} catch (e) { }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const SAFETY_MARGIN = 1.05; // 5% margin for Rhat > S check

// Earth's total surface area in km^2
const EARTH_RADIUS_KM = 6371;
const EARTH_SURFACE_AREA_KM2 = 4 * Math.PI * EARTH_RADIUS_KM ** 2; // ~510.1 million km^2

// Calculate area of a lat/lon cell on a sphere (in km^2)
function cellAreaKm2(cell: LatLonCell): number {
    const toRad = (x: number) => x * Math.PI / 180;
    
    // Handle dateline wrap for longitude span
    let lonSpan = normLon(cell.lonMax) - normLon(cell.lonMin);
    if (lonSpan < 0) lonSpan += 360; // crosses dateline
    
    // Area = R^2 * |sin(lat2) - sin(lat1)| * dLon (in radians)
    return EARTH_RADIUS_KM ** 2 * 
        Math.abs(Math.sin(toRad(cell.latMax)) - Math.sin(toRad(cell.latMin))) * 
        toRad(lonSpan);
}

// ah fuck we might need firefox
(async () => {

    initializeServer();

    const coveragePct = () => (dataStore.completedAreaKm2 / EARTH_SURFACE_AREA_KM2 * 100).toFixed(4);

    console.log(`Starting with ${dataStore.cells.length} cells and ${Object.keys(dataStore.poolInfo).length} pools (${coveragePct()}% covered)`);

    while (dataStore.cells.length > 0) {
        await sleep(15000);

        // Pop the next cell to process
        const cellData = dataStore.cells.shift()!;
        const cell = LatLonCell.fromData(cellData);
        const [latitude, longitude] = cell.center();
        const thisCellArea = cellAreaKm2(cell);

        console.log(`Processing cell: lat [${cell.latMin}, ${cell.latMax}], lon [${cell.lonMin}, ${cell.lonMax}]`);
        console.log(`  Query point: (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);

        const data = await sendCommand({ type: 'pool_load', latitude, longitude });

        const list = JSON.parse(data.result).Data;

        if (!list || list.length === 0) {
            // No pins returned - cell is done
            dataStore.completedAreaKm2 += thisCellArea;
            console.log(`  No pins returned. Cell complete. Coverage: ${coveragePct()}%`);
            fs.writeFileSync(SAVE_FILE, JSON.stringify(dataStore) + '\n');
            continue;
        }

        // Compute Rhat(q) = max distance from query point to any returned pin
        const Rhat = RhatFromPins(latitude, longitude, list);

        // Compute S(q, C) = upper bound on max distance from query point to any point in cell
        const S = cell.radiusUpperBoundMeters(latitude, longitude);

        console.log(`  Returned ${list.length} pins. Rhat=${(Rhat / 1000).toFixed(2)}km, S=${(S / 1000).toFixed(2)}km`);

        // Save ALL returned pools (even if outside current cell - we have the data)
        list.forEach((item: any) => {
            dataStore.poolInfo[item.MapPinID] = {
                id: item.MapPinID,
                name: item.MapMinName,
                urlSuffix: item.GeographyUrl + '/' + item.MapPinID,
                latitude: item.Latitude,
                longitude: item.Longitude,
                length: item.Label,
                public: item.PublicAccessType,
                hotel: item.HotelAccess
            };
        });

        if (Rhat > SAFETY_MARGIN * S) {
            // Cell is complete: all pins in this cell must be in the returned set
            const pinsInCell = list.filter((item: any) => cell.contains(item.Latitude, item.Longitude));

            dataStore.completedAreaKm2 += thisCellArea;

            console.log(`  Rhat > 1.05*S. Cell complete! ${pinsInCell.length} pins inside cell bounds. Coverage: ${coveragePct()}%`);
        } else {
            // Need to subdivide: we can't be sure we got all pins
            // No change to completedAreaKm2 - we're just splitting, not completing
            console.log(`  Rhat <= 1.05*S. Subdividing into 4 sub-cells. Coverage: ${coveragePct()}%`);

            const subCells = cell.subdivide4();
            for (const sub of subCells) {
                dataStore.cells.push(sub.toData());
            }
        }

        console.log(`  Remaining cells: ${dataStore.cells.length}, Total pools: ${Object.keys(dataStore.poolInfo).length}`);
        fs.writeFileSync(SAVE_FILE, JSON.stringify(dataStore) + '\n');
    }

    console.log(`\nDone! Collected ${Object.keys(dataStore.poolInfo).length} pools total. 100% coverage.`);

})();

