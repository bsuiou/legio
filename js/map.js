// Procedural parchment map with heightmap, forests, and hills
const GameMap = {
    width: 1920,
    height: 1080,
    heightData: null,
    gridSize: 4, // resolution of heightmap
    canvas: null,

    // Terrain feature zones
    forests: [],   // { x, y, radius }
    hills: [],     // derived peaks: { x, y, radius, elevation } — computed from heightmap
    peaks: [],     // same as hills — alias for clarity

    // Ditches dug by legion units during battle
    ditches: [],   // array of { points: [{x,y},...], width: number }

    // River map features
    mapType: 'grasslands',
    river: null,     // { points: [{x,y},...], width: number } or null
    bridges: [],     // [{ x, y, width, angle }]

    // Roman roads — paved paths that boost unit speed by 25%
    roads: [],       // array of { points: [{x,y},...], width: number }

    // Simple value noise implementation
    _seed: 12345,
    _perm: null,

    init(mapType, seed) {
        this.mapType = mapType || 'grasslands';
        this._seed = seed || Math.floor(Math.random() * 100000);
        this._generatePermutation();
        this.heightData = this._generateHeightmap();
        // Generate river before terrain so features avoid the river
        this.river = null;
        this.bridges = [];
        this.roads = [];
        this._twinRiverData = null;
        this._pendingHills = [];
        this._roadMask = null;
        // Pre-compute hill positions for grasslands (before road, so road steers around hills)
        if (this.mapType === 'grasslands') {
            this._precomputeHillPositions();
        }
        if (this.mapType === 'roman_road') {
            this._generateRomanRoad();
        }
        // Roads on other maps (generated after rivers so bridge positions are known)
        if (this.mapType === 'grasslands') {
            this._generateGrasslandsRoad();
        }
        if (this.mapType === 'river' || this.mapType === 'forest_river') {
            this._generateRiver();
            this._generateBridges();
        } else if (this.mapType === 'twin_rivers') {
            this._generateTwinRivers();
        }
        // Pre-compute hill positions for river (AFTER river exists, so hills avoid river)
        if (this.mapType === 'river') {
            this._precomputeHillPositions();
        }
        // Roads that depend on rivers/bridges being generated first
        if (this.mapType === 'river') {
            this._generateRiverCrossingRoad();
        } else if (this.mapType === 'twin_rivers') {
            this._generateTwinRiversRoad();
        } else if (this.mapType === 'narrow_pass') {
            this._generateNarrowPassRoad();
        } else if (this.mapType === 'dense_forest') {
            this._generateDenseForestRoad();
        }
        // Build road mask for forest tinting exclusion
        if (this.roads.length > 0) {
            this._buildRoadMask();
        }
        if (this.mapType === 'hillfort') {
            this._generateHillfortTerrain();
        } else if (this.mapType === 'dense_forest') {
            this._generateDenseForestTerrain();
        } else if (this.mapType === 'rolling_hills') {
            this._generateRollingHillsTerrain();
        } else if (this.mapType === 'narrow_pass') {
            this._generateNarrowPassTerrain();
        } else if (this.mapType === 'twin_rivers') {
            this._generateTwinRiversTerrain();
        } else if (this.mapType === 'forest_river') {
            this._generateForestRiverTerrain();
        } else if (this.mapType === 'scattered_rocks') {
            this._generateScatteredRocksTerrain();
        } else if (this.mapType === 'roman_road') {
            this._generateRomanRoadTerrain();
        } else if (this.mapType === 'ambush') {
            this._generateAmbushTerrain();
        } else {
            this._generateTerrainFeatures();
        }
        this._applyHillsToHeightmap();
        this.peaks = [];
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this._renderMap();
    },

    _generatePermutation() {
        this._perm = new Uint8Array(512);
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        let s = this._seed;
        for (let i = 255; i > 0; i--) {
            s = (s * 16807 + 0) % 2147483647;
            const j = s % (i + 1);
            [p[i], p[j]] = [p[j], p[i]];
        }
        for (let i = 0; i < 512; i++) this._perm[i] = p[i & 255];
    },

    _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); },
    _lerp(a, b, t) { return a + t * (b - a); },

    _grad(hash, x, y) {
        const h = hash & 3;
        const u = h < 2 ? x : -x;
        const v = h === 0 || h === 3 ? y : -y;
        return u + v;
    },

    _noise(x, y) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const xf = x - Math.floor(x);
        const yf = y - Math.floor(y);
        const u = this._fade(xf);
        const v = this._fade(yf);
        const p = this._perm;
        const aa = p[p[X] + Y];
        const ab = p[p[X] + Y + 1];
        const ba = p[p[X + 1] + Y];
        const bb = p[p[X + 1] + Y + 1];
        return this._lerp(
            this._lerp(this._grad(aa, xf, yf), this._grad(ba, xf - 1, yf), u),
            this._lerp(this._grad(ab, xf, yf - 1), this._grad(bb, xf - 1, yf - 1), u),
            v
        );
    },

    _fbm(x, y, octaves) {
        let val = 0, amp = 1, freq = 1, max = 0;
        for (let i = 0; i < octaves; i++) {
            val += this._noise(x * freq, y * freq) * amp;
            max += amp;
            amp *= 0.5;
            freq *= 2;
        }
        return val / max;
    },

    // Original heightmap for grasslands/river — gentle undulation
    _generateHeightmap() {
        const cols = Math.ceil(this.width / this.gridSize);
        const rows = Math.ceil(this.height / this.gridSize);
        const data = new Float32Array(cols * rows);
        const scale = 0.005;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                let h = this._fbm(x * this.gridSize * scale, y * this.gridSize * scale, 6);
                h = (h + 1) * 0.5;
                const cx = (x / cols - 0.5) * 2;
                const cy = (y / rows - 0.5) * 2;
                const edgeDist = Math.max(Math.abs(cx), Math.abs(cy));
                h = h * 0.7 + edgeDist * 0.15 + 0.15;
                h = Math.max(0, Math.min(1, h));
                data[y * cols + x] = h;
            }
        }
        this._cols = cols;
        this._rows = rows;
        return data;
    },

    // Split a total area budget into N pieces with varied sizes
    // Returns array of radii where π·r² sums to totalArea
    _splitAreaBudget(totalArea, count, noiseOffset) {
        if (count === 1) return [Math.sqrt(totalArea / Math.PI)];
        // Generate random weights, then scale radii so areas sum to totalArea
        const weights = [];
        for (let i = 0; i < count; i++) {
            weights.push(0.3 + Math.abs(this._noise(noiseOffset + i * 3.7, i * 2.1)) * 1.7);
        }
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        return weights.map(w => Math.sqrt((w / totalWeight) * totalArea / Math.PI));
    },

    // --- Polygon Utilities ---

    // Point-in-polygon test (ray casting)
    _pointInPolygon(px, py, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
                inside = !inside;
            }
        }
        return inside;
    },

    // Distance from point to nearest polygon edge
    _distToPolygonEdge(px, py, poly) {
        let minDist = Infinity;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const ax = poly[j].x, ay = poly[j].y;
            const bx = poly[i].x, by = poly[i].y;
            const dx = bx - ax, dy = by - ay;
            const lenSq = dx * dx + dy * dy;
            if (lenSq === 0) continue;
            const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
            const cx = ax + t * dx, cy = ay + t * dy;
            const d = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
            if (d < minDist) minDist = d;
        }
        return minDist;
    },

    // Signed distance: negative inside, positive outside
    _signedDistToPolygon(px, py, poly) {
        const d = this._distToPolygonEdge(px, py, poly);
        return this._pointInPolygon(px, py, poly) ? -d : d;
    },

    // Check if two polygons overlap (vertex-in-polygon test, good enough)
    _polygonsOverlap(polyA, polyB) {
        for (const p of polyA) {
            if (this._pointInPolygon(p.x, p.y, polyB)) return true;
        }
        for (const p of polyB) {
            if (this._pointInPolygon(p.x, p.y, polyA)) return true;
        }
        return false;
    },

    // Compute bounding radius from center to farthest polygon vertex
    _polyBoundingRadius(cx, cy, poly) {
        let maxR = 0;
        for (const p of poly) {
            const d = Math.sqrt((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy));
            if (d > maxR) maxR = d;
        }
        return maxR;
    },

    // --- Shape Generators ---
    // Each returns an array of {x,y} polygon vertices

    _shapeTypes: ['circle', 'oval', 'fat_oval', 'u_shape', 'crescent', 'blob'],

    _randomShapeType(seed) {
        const types = this._shapeTypes;
        const idx = Math.floor(Math.abs(this._noise(seed, seed * 0.7)) * types.length) % types.length;
        return types[idx];
    },

    // Generate polygon for a given shape type, with noise for organic edges
    _generateShapePolygon(cx, cy, size, shapeType, noiseSeed) {
        const ns = noiseSeed || cx * 0.01 + cy * 0.01;
        const pts = [];

        switch (shapeType) {
            case 'circle': {
                const n = 24;
                for (let i = 0; i < n; i++) {
                    const t = (i / n) * Math.PI * 2;
                    const n1 = this._noise(ns + Math.cos(t) * 3, ns + Math.sin(t) * 3) * 0.4;
                    const n2 = this._noise(ns * 2.7 + Math.cos(t * 2) * 2, ns * 1.3 + Math.sin(t * 2) * 2) * 0.15;
                    const noiseR = 1 + n1 + n2;
                    pts.push({ x: cx + Math.cos(t) * size * noiseR, y: cy + Math.sin(t) * size * noiseR });
                }
                break;
            }
            case 'oval': {
                const n = 24;
                const angle = this._noise(ns * 1.3, ns * 0.7) * Math.PI;
                const stretch = 1.8 + this._noise(ns * 2.1, 0) * 0.4;
                for (let i = 0; i < n; i++) {
                    const t = (i / n) * Math.PI * 2;
                    const n1 = this._noise(ns + Math.cos(t) * 2, ns + Math.sin(t) * 2) * 0.35;
                    const n2 = this._noise(ns * 3.1 + Math.cos(t * 2) * 1.5, ns * 2.1 + Math.sin(t * 2) * 1.5) * 0.15;
                    const noiseR = 1 + n1 + n2;
                    const rx = size * stretch * 0.7 * noiseR;
                    const ry = size * 0.7 * noiseR;
                    const lx = Math.cos(t) * rx;
                    const ly = Math.sin(t) * ry;
                    pts.push({
                        x: cx + lx * Math.cos(angle) - ly * Math.sin(angle),
                        y: cy + lx * Math.sin(angle) + ly * Math.cos(angle)
                    });
                }
                break;
            }
            case 'fat_oval': {
                const n = 24;
                const angle = this._noise(ns * 1.5, ns * 0.9) * Math.PI;
                for (let i = 0; i < n; i++) {
                    const t = (i / n) * Math.PI * 2;
                    const n1 = this._noise(ns + Math.cos(t) * 2.5, ns + Math.sin(t) * 2.5) * 0.35;
                    const n2 = this._noise(ns * 3.5 + Math.cos(t * 2) * 2, ns * 2.5 + Math.sin(t * 2) * 2) * 0.15;
                    const noiseR = 1 + n1 + n2;
                    const rx = size * 1.4 * noiseR;
                    const ry = size * 0.75 * noiseR;
                    const lx = Math.cos(t) * rx;
                    const ly = Math.sin(t) * ry;
                    pts.push({
                        x: cx + lx * Math.cos(angle) - ly * Math.sin(angle),
                        y: cy + lx * Math.sin(angle) + ly * Math.cos(angle)
                    });
                }
                break;
            }
            case 'triangle': {
                const angle = this._noise(ns * 1.7, 0) * Math.PI * 2;
                const corners = [];
                for (let i = 0; i < 3; i++) {
                    const t = angle + (i / 3) * Math.PI * 2;
                    corners.push({ x: cx + Math.cos(t) * size, y: cy + Math.sin(t) * size });
                }
                // Subdivide edges for roundness + noise
                for (let i = 0; i < 3; i++) {
                    const a = corners[i], b = corners[(i + 1) % 3];
                    const steps = 6;
                    for (let s = 0; s < steps; s++) {
                        const frac = s / steps;
                        const mx = a.x + (b.x - a.x) * frac;
                        const my = a.y + (b.y - a.y) * frac;
                        // Push outward slightly + noise
                        const dx = mx - cx, dy = my - cy;
                        const d = Math.sqrt(dx * dx + dy * dy) || 1;
                        const noiseR = this._noise(ns + mx * 0.01, ns + my * 0.01) * size * 0.15;
                        pts.push({ x: mx + (dx / d) * noiseR, y: my + (dy / d) * noiseR });
                    }
                }
                break;
            }
            case 'rectangle': {
                const angle = this._noise(ns * 1.9, 0) * Math.PI;
                const hw = size * 1.3, hh = size * 0.65;
                const cos = Math.cos(angle), sin = Math.sin(angle);
                const corners = [
                    { lx: -hw, ly: -hh }, { lx: hw, ly: -hh },
                    { lx: hw, ly: hh }, { lx: -hw, ly: hh }
                ];
                for (let i = 0; i < 4; i++) {
                    const a = corners[i], b = corners[(i + 1) % 4];
                    const steps = 5;
                    for (let s = 0; s < steps; s++) {
                        const frac = s / steps;
                        const lx = a.lx + (b.lx - a.lx) * frac;
                        const ly = a.ly + (b.ly - a.ly) * frac;
                        const noiseR = this._noise(ns + lx * 0.02, ns + ly * 0.02) * size * 0.12;
                        const wx = cx + lx * cos - ly * sin;
                        const wy = cy + lx * sin + ly * cos;
                        const dx = wx - cx, dy = wy - cy;
                        const d = Math.sqrt(dx * dx + dy * dy) || 1;
                        pts.push({ x: wx + (dx / d) * noiseR, y: wy + (dy / d) * noiseR });
                    }
                }
                break;
            }
            case 'l_shape': {
                const angle = this._noise(ns * 2.1, 0) * Math.PI;
                const cos = Math.cos(angle), sin = Math.sin(angle);
                const s = size * 0.65;
                // L-shape vertices (local coords)
                const verts = [
                    { lx: -s, ly: -s*1.5 }, { lx: s*0.4, ly: -s*1.5 },
                    { lx: s*0.4, ly: -s*0.2 }, { lx: s*1.3, ly: -s*0.2 },
                    { lx: s*1.3, ly: s*0.6 }, { lx: -s, ly: s*0.6 }
                ];
                for (let i = 0; i < verts.length; i++) {
                    const a = verts[i], b = verts[(i + 1) % verts.length];
                    const steps = 4;
                    for (let st = 0; st < steps; st++) {
                        const frac = st / steps;
                        const lx = a.lx + (b.lx - a.lx) * frac;
                        const ly = a.ly + (b.ly - a.ly) * frac;
                        const noiseR = this._noise(ns + lx * 0.03, ns + ly * 0.03) * size * 0.1;
                        const wx = cx + lx * cos - ly * sin;
                        const wy = cy + lx * sin + ly * cos;
                        const dx = wx - cx, dy = wy - cy;
                        const d = Math.sqrt(dx * dx + dy * dy) || 1;
                        pts.push({ x: wx + (dx / d) * noiseR, y: wy + (dy / d) * noiseR });
                    }
                }
                break;
            }
            case 'u_shape': {
                const angle = this._noise(ns * 2.3, 0) * Math.PI;
                const cos = Math.cos(angle), sin = Math.sin(angle);
                const s = size * 0.6;
                const verts = [
                    { lx: -s*1.2, ly: -s*1.2 }, { lx: -s*0.4, ly: -s*1.2 },
                    { lx: -s*0.4, ly: s*0.5 }, { lx: s*0.4, ly: s*0.5 },
                    { lx: s*0.4, ly: -s*1.2 }, { lx: s*1.2, ly: -s*1.2 },
                    { lx: s*1.2, ly: s*1.2 }, { lx: -s*1.2, ly: s*1.2 }
                ];
                for (let i = 0; i < verts.length; i++) {
                    const a = verts[i], b = verts[(i + 1) % verts.length];
                    const steps = 4;
                    for (let st = 0; st < steps; st++) {
                        const frac = st / steps;
                        const lx = a.lx + (b.lx - a.lx) * frac;
                        const ly = a.ly + (b.ly - a.ly) * frac;
                        const n1 = this._noise(ns + lx * 0.03, ns + ly * 0.03) * size * 0.25;
                        const n2 = this._noise(ns * 2.7 + lx * 0.05, ns * 1.9 + ly * 0.05) * size * 0.12;
                        const noiseR = n1 + n2;
                        const wx = cx + lx * cos - ly * sin;
                        const wy = cy + lx * sin + ly * cos;
                        const dx = wx - cx, dy = wy - cy;
                        const d = Math.sqrt(dx * dx + dy * dy) || 1;
                        pts.push({ x: wx + (dx / d) * noiseR, y: wy + (dy / d) * noiseR });
                    }
                }
                break;
            }
            case 'crescent': {
                const n = 28;
                const angle = this._noise(ns * 2.5, 0) * Math.PI * 2;
                const offsetDist = size * 0.5;
                for (let i = 0; i < n; i++) {
                    const t = (i / n) * Math.PI * 2;
                    const n1 = this._noise(ns + Math.cos(t) * 2, ns + Math.sin(t) * 2) * 0.35;
                    const n2 = this._noise(ns * 3.3 + Math.cos(t * 2) * 1.5, ns * 2.3 + Math.sin(t * 2) * 1.5) * 0.15;
                    const noiseR = 1 + n1 + n2;
                    const r = size * noiseR;
                    const px = cx + Math.cos(t) * r;
                    const py = cy + Math.sin(t) * r;
                    // Subtract inner circle (offset)
                    const icx = cx + Math.cos(angle) * offsetDist;
                    const icy = cy + Math.sin(angle) * offsetDist;
                    const dInner = Math.sqrt((px - icx) * (px - icx) + (py - icy) * (py - icy));
                    if (dInner < size * 0.85) {
                        // Push outward from inner circle
                        const pushDir = Math.atan2(py - icy, px - icx);
                        const pushAmt = size * 0.85 - dInner;
                        pts.push({ x: px + Math.cos(pushDir) * pushAmt * 0.7, y: py + Math.sin(pushDir) * pushAmt * 0.7 });
                    } else {
                        pts.push({ x: px, y: py });
                    }
                }
                break;
            }
            case 'blob': {
                // 3-4 overlapping circles merged
                const numBlobs = 3 + (Math.abs(this._noise(ns * 3.1, 0)) > 0.5 ? 1 : 0);
                const centers = [{ x: cx, y: cy }];
                for (let b = 1; b < numBlobs; b++) {
                    const bAngle = this._noise(ns + b * 4.1, b * 2.3) * Math.PI * 2;
                    const bDist = size * (0.3 + Math.abs(this._noise(ns + b * 5.3, 0)) * 0.4);
                    centers.push({ x: cx + Math.cos(bAngle) * bDist, y: cy + Math.sin(bAngle) * bDist });
                }
                const blobR = size * (0.5 + 0.2 / numBlobs);
                // Sample points around the merged boundary
                const n = 24;
                for (let i = 0; i < n; i++) {
                    const t = (i / n) * Math.PI * 2;
                    // Find max radius from center at this angle
                    let maxR = 0;
                    for (const bc of centers) {
                        const dx = bc.x - cx, dy = bc.y - cy;
                        const projDist = dx * Math.cos(t) + dy * Math.sin(t);
                        const perpDist = Math.abs(-dx * Math.sin(t) + dy * Math.cos(t));
                        if (perpDist < blobR) {
                            const reach = projDist + Math.sqrt(Math.max(0, blobR * blobR - perpDist * perpDist));
                            if (reach > maxR) maxR = reach;
                        }
                    }
                    const n1 = this._noise(ns + Math.cos(t) * 2, ns + Math.sin(t) * 2) * 0.3;
                    const n2 = this._noise(ns * 3.7 + Math.cos(t * 2) * 1.5, ns * 2.7 + Math.sin(t * 2) * 1.5) * 0.15;
                    const noiseR = 1 + n1 + n2;
                    maxR = Math.max(maxR, size * 0.3) * noiseR;
                    pts.push({ x: cx + Math.cos(t) * maxR, y: cy + Math.sin(t) * maxR });
                }
                break;
            }
            default: {
                // Fallback: circle
                const n = 20;
                for (let i = 0; i < n; i++) {
                    const t = (i / n) * Math.PI * 2;
                    pts.push({ x: cx + Math.cos(t) * size, y: cy + Math.sin(t) * size });
                }
            }
        }
        return pts;
    },

    // Create a terrain feature with polygon shape
    _createFeature(cx, cy, size, elevation, noiseSeed) {
        const shapeType = this._randomShapeType(noiseSeed || cx + cy);
        const polygon = this._generateShapePolygon(cx, cy, size, shapeType, noiseSeed);
        const radius = this._polyBoundingRadius(cx, cy, polygon);
        const feature = { x: cx, y: cy, radius, polygon };
        if (elevation !== undefined) {
            feature.elevation = elevation;
            feature.peaks = this._generatePeaks(cx, cy, size, polygon, noiseSeed || cx + cy);
        }
        return feature;
    },

    // Generate 1-3 peak positions within a hill polygon
    _generatePeaks(cx, cy, size, polygon, noiseSeed) {
        const numPeaks = size > 140 ? 3 : size > 90 ? 2 : 1;
        if (numPeaks === 1) return [{ x: cx, y: cy, strength: 1.0 }];

        // Find longest axis of polygon
        let maxDx = 0, maxDy = 0, maxD = 0;
        for (const p of polygon) {
            const d = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
            if (d > maxD) { maxD = d; maxDx = p.x - cx; maxDy = p.y - cy; }
        }
        const ax = maxDx / (maxD || 1), ay = maxDy / (maxD || 1);

        const peaks = [];
        for (let i = 0; i < numPeaks; i++) {
            const t = (i / (numPeaks - 1)) - 0.5; // -0.5 to 0.5
            const offset = maxD * 0.4 * t;
            const jitter = this._noise(noiseSeed + i * 5, noiseSeed * 0.7) * size * 0.15;
            peaks.push({
                x: cx + ax * offset + (-ay) * jitter,
                y: cy + ay * offset + ax * jitter,
                strength: i === Math.floor(numPeaks / 2) ? 1.0 : 0.75 // center peak is strongest
            });
        }
        return peaks;
    },

    // Try to place a hill, avoiding polygon overlap with existing hills
    _tryPlaceHill(cx, cy, size, elevation, noiseSeed, maxAttempts) {
        for (let attempt = 0; attempt < (maxAttempts || 8); attempt++) {
            // Increasing search radius with each attempt
            const spread = 80 + attempt * 40;
            const ax = cx + (attempt > 0 ? (this._noise(noiseSeed + attempt * 3, attempt) * spread) : 0);
            const ay = cy + (attempt > 0 ? (this._noise(attempt * 3, noiseSeed + attempt) * spread) : 0);
            const clamped_x = Math.max(size + 30, Math.min(this.width - size - 30, ax));
            const clamped_y = Math.max(size + 30, Math.min(this.height - size - 30, ay));
            const candidate = this._createFeature(clamped_x, clamped_y, size, elevation, noiseSeed + attempt);

            // Check polygon overlap with existing hills
            let overlaps = false;
            for (const h of this.hills) {
                const dx = candidate.x - h.x, dy = candidate.y - h.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > candidate.radius + h.radius + 30) continue;
                if (candidate.polygon && h.polygon && this._polygonsOverlap(candidate.polygon, h.polygon)) {
                    overlaps = true; break;
                }
            }
            // Check overlap with roads — hill should not sit on a road
            if (!overlaps) {
                for (const road of this.roads) {
                    const margin = road.width * 0.5 + size * 0.4 + 20;
                    for (const pt of road.points) {
                        const dx = candidate.x - pt.x, dy = candidate.y - pt.y;
                        if (dx * dx + dy * dy < margin * margin) {
                            overlaps = true; break;
                        }
                    }
                    if (overlaps) break;
                }
            }
            // Check overlap with river — use actual polygon radius
            if (!overlaps && this._isNearRiver(candidate.x, candidate.y, candidate.radius + 20)) {
                overlaps = true;
            }
            // Check proximity to bridges — keep 150px clearance from actual edge
            if (!overlaps) {
                for (const b of this.bridges) {
                    const dx = candidate.x - b.x, dy = candidate.y - b.y;
                    if (dx * dx + dy * dy < (candidate.radius + 150) * (candidate.radius + 150)) {
                        overlaps = true; break;
                    }
                }
            }
            if (!overlaps) {
                this.hills.push(candidate);
                return true;
            }
        }
        return false; // couldn't place without overlap
    },

    _generateTerrainFeatures() {
        const totalForestArea = 4 * Math.PI * 120 * 120;
        const forestPattern = Math.abs(this._noise(this._seed * 0.07, 0));
        const numForests = forestPattern < 0.3 ? 2 : forestPattern < 0.6 ? 3 : 4;
        const forestRadii = this._splitAreaBudget(totalForestArea, numForests, this._seed * 0.11);
        const clampR = (r, min, max) => Math.max(min, Math.min(max, r));

        // Generate forests — balanced left/right, avoiding river and bridges
        this.forests = [];
        for (let i = 0; i < numForests; i++) {
            const onLeft = (i % 2 === 0);
            const halfMin = onLeft ? 150 : this.width * 0.5;
            const halfMax = onLeft ? this.width * 0.5 : this.width - 150;
            const fr = clampR(forestRadii[i], 60, 200);
            let fx, fy, attempts = 0, valid = false;
            let rng = this._seed * 16807 + i * 12345;
            do {
                rng = (rng * 16807 + 1) % 2147483647;
                fx = halfMin + (rng / 2147483647) * (halfMax - halfMin);
                rng = (rng * 16807 + 1) % 2147483647;
                fy = 120 + (rng / 2147483647) * (this.height - 240);
                attempts++;
                valid = !this._isNearRiver(fx, fy, fr + 20) && !this._isNearBridge(fx, fy, fr + 80);
            } while (!valid && attempts < 50);
            if (valid) {
                const feature = this._createFeature(fx, fy, fr, undefined, fx * 0.01 + fy * 0.01 + fr);
                // Re-check with actual polygon radius (can be larger than requested fr)
                if (!this._isNearRiver(fx, fy, feature.radius + 20) && !this._isNearBridge(fx, fy, feature.radius + 80)) {
                    this.forests.push(feature);
                }
            }
        }

        // Generate discrete hills — use pre-computed positions if available
        this.hills = [];
        const pendingHills = this._pendingHills || [];
        const numHills = pendingHills.length;

        for (let i = 0; i < numHills; i++) {
            const ph = pendingHills[i];
            const hr = ph.radius;
            let hx = ph.x, hy = ph.y;
            const elev = 0.32 + Math.abs(this._noise(i * 1.9, i * 3.1)) * 0.20;

            // Push away from forests, but don't push into river or near bridge
            let hxAdj = hx, hyAdj = hy;
            for (const f of this.forests) {
                const dx = hxAdj - f.x, dy = hyAdj - f.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                const minDist = hr + f.radius + 40;
                if (d < minDist && d > 1) {
                    const newX = f.x + (dx / d) * minDist;
                    const newY = f.y + (dy / d) * minDist;
                    if (!this._isNearRiver(newX, newY, hr + 20) && !this._isNearBridge(newX, newY, hr + 150)) {
                        hxAdj = newX;
                        hyAdj = newY;
                    }
                }
            }
            this._tryPlaceHill(hxAdj, hyAdj, hr, elev, i * 3.7 + this._seed * 0.19, 15);
        }
    },

    // Hillfort map: one massive central hill, no forests
    _generateHillfortTerrain() {
        this.forests = [];
        this.hills = [];

        // One big hill in the center of the map
        const cx = this.width / 2;
        const cy = this.height / 2;
        // Radius ~300px — dominates the center
        const radius = 280 + Math.abs(this._noise(this._seed * 0.19, 0.7)) * 60;
        const elevation = 0.45 + Math.abs(this._noise(this._seed * 0.23, 0.3)) * 0.10;

        this.hills.push(this._createFeature(cx, cy, radius, elevation, cx * 0.01 + cy * 0.01));
    },

    // Dense Forest map: many forests, no hills — balanced across map
    _generateDenseForestTerrain() {
        this.hills = [];
        const clampR = (r, min, max) => Math.max(min, Math.min(max, r));

        // 5-7 forests spread across the map, balanced left/right and top/bottom
        const totalForestArea = 7 * Math.PI * 130 * 130;
        const numForests = 5 + Math.floor(Math.abs(this._noise(this._seed * 0.09, 0.3)) * 3);
        const forestRadii = this._splitAreaBudget(totalForestArea, numForests, this._seed * 0.13);

        this.forests = [];
        for (let i = 0; i < numForests; i++) {
            const fr = clampR(forestRadii[i], 70, 180);
            // Balance: alternate left/right and vary top/bottom
            const onLeft = (i % 2 === 0);
            const halfMin = onLeft ? 150 : this.width * 0.5;
            const halfMax = onLeft ? this.width * 0.5 : this.width - 150;
            const fx = halfMin + (this._noise(i * 5.3 + this._seed * 0.04, i * 2.1) + 1) * 0.5 * (halfMax - halfMin);
            const fy = 120 + (this._noise(this._seed * 0.04 + i * 2.1, i * 5.3) + 1) * 0.5 * (this.height - 240);
            // Push apart from existing forests
            let adjX = fx, adjY = fy;
            for (const f of this.forests) {
                const dx = adjX - f.x, dy = adjY - f.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                const minD = fr + f.radius + 30;
                if (d < minD && d > 1) {
                    adjX = f.x + (dx / d) * minD;
                    adjY = f.y + (dy / d) * minD;
                }
            }
            adjX = Math.max(fr + 50, Math.min(this.width - fr - 50, adjX));
            adjY = Math.max(fr + 50, Math.min(this.height - fr - 50, adjY));
            this.forests.push(this._createFeature(adjX, adjY, fr, undefined, i * 7.7 + this._seed * 0.13));
        }
    },

    // Rolling Hills map: many hills, no forests
    _generateRollingHillsTerrain() {
        this.forests = [];
        const clampR = (r, min, max) => Math.max(min, Math.min(max, r));

        // 5-7 hills spread across the map
        const totalHillArea = 7 * Math.PI * 140 * 140;
        const numHills = 5 + Math.floor(Math.abs(this._noise(this._seed * 0.15, 0.7)) * 3);
        const hillRadii = this._splitAreaBudget(totalHillArea, numHills, this._seed * 0.19);

        this.hills = [];
        for (let i = 0; i < numHills; i++) {
            const hr = clampR(hillRadii[i], 70, 200);
            // Balance: alternate left/right
            const onLeft = (i % 2 === 0);
            const halfMin = onLeft ? 200 : this.width * 0.5;
            const halfMax = onLeft ? this.width * 0.5 : this.width - 200;
            const hx = halfMin + (this._noise(i * 7.1 + this._seed * 0.06, i * 2.3) + 1) * 0.5 * (halfMax - halfMin);
            const hy = 150 + (this._noise(this._seed * 0.06 + i * 2.3, i * 7.1) + 1) * 0.5 * (this.height - 300);
            const elev = 0.30 + Math.abs(this._noise(i * 1.9, i * 3.1)) * 0.22;
            this._tryPlaceHill(hx, hy, hr, elev, i * 4.3 + this._seed * 0.21, 10);
        }
    },

    // Narrow Pass: two big hills forming walls with a gap in the center
    _generateNarrowPassTerrain() {
        this.forests = [];
        this.hills = [];
        const cx = this.width / 2;
        const cy = this.height / 2;
        const gapHalf = 80 + Math.abs(this._noise(this._seed * 0.17, 0.3)) * 40; // gap 160-240px

        // Top wall hill
        this.hills.push(this._createFeature(cx, cy - gapHalf - 180,
            250 + Math.abs(this._noise(this._seed * 0.21, 0.5)) * 60,
            0.50, cx * 0.01 + (cy - gapHalf - 180) * 0.02));
        // Bottom wall hill
        this.hills.push(this._createFeature(cx, cy + gapHalf + 180,
            250 + Math.abs(this._noise(this._seed * 0.29, 0.7)) * 60,
            0.50, cx * 0.02 + (cy + gapHalf + 180) * 0.01));
        // Small forests flanking the pass entrance
        const fr = 60 + Math.abs(this._noise(this._seed * 0.31, 0.2)) * 30;
        this.forests.push(this._createFeature(cx - 200, cy - gapHalf + 20, fr, undefined, 1.1));
        this.forests.push(this._createFeature(cx + 200, cy + gapHalf - 20, fr, undefined, 2.2));
    },

    // Twin Rivers: two parallel rivers with central island
    _generateTwinRiversTerrain() {
        this.forests = [];
        this.hills = [];
        // Forests on the island and flanks
        this.forests.push(this._createFeature(this.width / 2, this.height * 0.35, 90, undefined, 3.3));
        this.forests.push(this._createFeature(this.width / 2, this.height * 0.65, 80, undefined, 4.4));
        // Small hills on outer flanks
        this.hills.push(this._createFeature(this.width * 0.15, this.height * 0.4, 100, 0.30, 0.15 * 0.01 + 0.4 * 0.03));
        this.hills.push(this._createFeature(this.width * 0.85, this.height * 0.6, 100, 0.30, 0.85 * 0.03 + 0.6 * 0.01));
    },

    _generateTwinRivers() {
        // Two rivers, one at ~35% width, one at ~65% width
        const riverWidth = 45 + Math.abs(this._noise(this._seed * 0.23, 0)) * 15;
        this.river = null; // we'll use custom blocking
        this.bridges = [];

        // Generate two river polylines
        this._twinRiverData = [];
        for (let r = 0; r < 2; r++) {
            const baseX = this.width * (r === 0 ? 0.35 : 0.65);
            const points = [];
            let rx = baseX;
            let ry = 0;
            points.push({ x: rx, y: ry });
            while (ry < this.height) {
                ry += 15;
                const drift = this._noise(rx * 0.003 + this._seed * 0.1 + r * 50, ry * 0.005) * 5;
                rx = baseX + drift * 20;
                rx = Math.max(baseX - 60, Math.min(baseX + 60, rx));
                points.push({ x: rx, y: ry });
            }
            this._twinRiverData.push({ points, width: riverWidth });
        }

        // Use the first river as the primary for blocking (combined later)
        this.river = { points: this._twinRiverData[0].points, width: riverWidth };

        // Add 2 bridges per river (4 total)
        for (let r = 0; r < 2; r++) {
            const pts = this._twinRiverData[r].points;
            for (let b = 0; b < 2; b++) {
                const targetY = this.height * (b === 0 ? 0.3 : 0.7);
                let bestIdx = 0, bestDist = Infinity;
                for (let i = 0; i < pts.length; i++) {
                    const d = Math.abs(pts[i].y - targetY);
                    if (d < bestDist) { bestDist = d; bestIdx = i; }
                }
                const bridgePt = pts[bestIdx];
                const prevIdx = Math.max(0, bestIdx - 2);
                const nextIdx = Math.min(pts.length - 1, bestIdx + 2);
                const dx = pts[nextIdx].x - pts[prevIdx].x;
                const dy = pts[nextIdx].y - pts[prevIdx].y;
                const angle = Math.atan2(dy, dx) + Math.PI / 2;
                this.bridges.push({
                    x: bridgePt.x, y: bridgePt.y,
                    width: 100, length: riverWidth + 50, angle
                });
            }
        }
    },

    // Forest River: river with dense forest on both banks
    _generateForestRiverTerrain() {
        this.hills = [];
        this.forests = [];
        // Place forests along both banks of the river (river generated in init)
        if (!this.river) return;
        const midPts = this.river.points;
        const midIdx = Math.floor(midPts.length / 2);
        const riverX = midPts[midIdx].x;

        // 3 forests on each side of the river, close to banks
        for (let side = -1; side <= 1; side += 2) {
            for (let i = 0; i < 3; i++) {
                const fy = this.height * (0.15 + i * 0.3) + (Math.abs(this._noise(i * 3.1 + side, this._seed * 0.05)) - 0.5) * 100;
                const fx = riverX + side * (this.river.width / 2 + 80 + Math.abs(this._noise(this._seed * 0.07, i * 2.3)) * 60);
                const fr = 70 + Math.abs(this._noise(i * 1.7 + side * 5, this._seed * 0.09)) * 50;
                this.forests.push(this._createFeature(fx, fy, fr, undefined, fx * 0.01 + fy * 0.01 + fr));
            }
        }
    },

    // Scattered Rocks: many tiny hills everywhere
    // Ambush map: forests and hills on flanks, open center for player placement
    _generateAmbushTerrain() {
        this.forests = [];
        this.hills = [];
        const cx = this.width / 2, cy = this.height / 2;
        const w = this.width, h = this.height;

        // LEFT FLANK — big hills and forests to hide enemy behind
        this._tryPlaceHill(w * 0.13, cy - 100, 150, 0.28, 1.1, 5);
        this._tryPlaceHill(w * 0.11, cy + 180, 130, 0.24, 2.2, 5);
        this.forests.push(this._createFeature(w * 0.06, cy - 60, 140, undefined, 3.3));
        this.forests.push(this._createFeature(w * 0.09, cy + 280, 120, undefined, 4.4));

        // RIGHT FLANK — mirror: big hills and forests
        this._tryPlaceHill(w * 0.87, cy - 100, 150, 0.28, 5.5, 5);
        this._tryPlaceHill(w * 0.89, cy + 180, 130, 0.24, 6.6, 5);
        this.forests.push(this._createFeature(w * 0.94, cy - 60, 140, undefined, 7.7));
        this.forests.push(this._createFeature(w * 0.91, cy + 280, 120, undefined, 8.8));

        // Small tactical cover near center edges (not blocking the open kill zone)
        this.forests.push(this._createFeature(cx - 320, cy - 280, 75, undefined, 9.9));
        this.forests.push(this._createFeature(cx + 320, cy + 280, 75, undefined, 10.1));
    },

    _generateScatteredRocksTerrain() {
        this.forests = [];
        this.hills = [];
        const numRocks = 12 + Math.floor(Math.abs(this._noise(this._seed * 0.11, 0.5)) * 6);
        for (let i = 0; i < numRocks; i++) {
            // Distribute across map using grid-based zones for balance
            const col = i % 4;  // 4 columns
            const row = Math.floor(i / 4); // rows
            const zoneW = (this.width - 240) / 4;
            const zoneH = (this.height - 200) / Math.ceil(numRocks / 4);
            const rx = 120 + col * zoneW + (this._noise(i * 3.7 + this._seed * 0.05, i * 2.1) + 1) * 0.5 * zoneW;
            const ry = 100 + row * zoneH + (this._noise(this._seed * 0.05 + i * 2.1, i * 3.7) + 1) * 0.5 * zoneH;
            const rr = 40 + Math.abs(this._noise(i * 2.1, i * 1.3)) * 50; // 40-90px radius
            const elev = 0.20 + Math.abs(this._noise(i * 1.9, i * 3.1)) * 0.18;
            this._tryPlaceHill(rx, ry, rr, elev, i * 4.7 + this._seed * 0.23, 6);
        }
        // Add 2 small forests for variety
        this.forests.push(this._createFeature(this.width * 0.2, this.height * 0.3, 60, undefined, 5.5));
        this.forests.push(this._createFeature(this.width * 0.8, this.height * 0.7, 60, undefined, 6.6));
    },

    // Apply discrete hills to heightmap — multi-peak support
    _applyHillsToHeightmap() {
        for (const hill of this.hills) {
            const margin = hill.radius * 1.5;
            const gxMin = Math.max(0, Math.floor((hill.x - margin) / this.gridSize));
            const gxMax = Math.min(this._cols - 1, Math.ceil((hill.x + margin) / this.gridSize));
            const gyMin = Math.max(0, Math.floor((hill.y - margin) / this.gridSize));
            const gyMax = Math.min(this._rows - 1, Math.ceil((hill.y + margin) / this.gridSize));

            const peaks = hill.peaks || [{ x: hill.x, y: hill.y, strength: 1.0 }];
            // Each peak has an influence radius based on number of peaks
            const peakRadius = hill.radius * (peaks.length === 1 ? 1.3 : 0.7);

            for (let gy = gyMin; gy <= gyMax; gy++) {
                for (let gx = gxMin; gx <= gxMax; gx++) {
                    const px = gx * this.gridSize;
                    const py = gy * this.gridSize;

                    // Check if within polygon (or bounding circle fallback)
                    let insideFactor = 0;
                    if (hill.polygon) {
                        const sd = this._signedDistToPolygon(px, py, hill.polygon);
                        const falloff = hill.radius * 0.3;
                        if (sd > falloff) continue;
                        // Smooth boundary: 1 inside, fade to 0 at falloff distance outside
                        insideFactor = sd <= 0 ? 1 : Math.max(0, 1 - sd / falloff);
                    } else {
                        const dx = px - hill.x, dy = py - hill.y;
                        const rawDist = Math.sqrt(dx * dx + dy * dy);
                        const angle = Math.atan2(dy, dx);
                        const radiusNoise = this._noise(
                            hill.x * 0.025 + Math.cos(angle) * 2.5,
                            hill.y * 0.025 + Math.sin(angle) * 2.5
                        );
                        const effectiveRadius = hill.radius * (0.85 + 0.28 * radiusNoise) * 1.3;
                        if (rawDist >= effectiveRadius) continue;
                        insideFactor = 1 - rawDist / effectiveRadius;
                    }

                    // Sum contributions from each peak
                    let totalBump = 0;
                    for (const peak of peaks) {
                        const pdx = px - peak.x, pdy = py - peak.y;
                        const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
                        if (pDist >= peakRadius) continue;
                        const t = 1 - pDist / peakRadius;
                        totalBump += t * t * (3 - 2 * t) * hill.elevation * peak.strength;
                    }

                    // Apply boundary fade and cap total
                    const bump = totalBump * insideFactor;
                    if (bump > 0) {
                        this.heightData[gy * this._cols + gx] = Math.min(1,
                            this.heightData[gy * this._cols + gx] + bump);
                    }
                }
            }
        }
    },

    getHeight(px, py) {
        // Bilinear interpolation for smooth height values
        const fx = px / this.gridSize;
        const fy = py / this.gridSize;
        const gx = Math.floor(fx);
        const gy = Math.floor(fy);
        if (gx < 0 || gx >= this._cols - 1 || gy < 0 || gy >= this._rows - 1) return 0.5;
        const tx = fx - gx;
        const ty = fy - gy;
        const h00 = this.heightData[gy * this._cols + gx];
        const h10 = this.heightData[gy * this._cols + gx + 1];
        const h01 = this.heightData[(gy + 1) * this._cols + gx];
        const h11 = this.heightData[(gy + 1) * this._cols + gx + 1];
        return h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty;
    },

    // Raw grid lookup (no interpolation) — used for rendering where speed matters
    getHeightRaw(px, py) {
        const gx = Math.floor(px / this.gridSize);
        const gy = Math.floor(py / this.gridSize);
        if (gx < 0 || gx >= this._cols || gy < 0 || gy >= this._rows) return 0.5;
        return this.heightData[gy * this._cols + gx];
    },

    getSlope(px, py) {
        const h = this.getHeight(px, py);
        const hx = this.getHeight(px + this.gridSize, py);
        const hy = this.getHeight(px, py + this.gridSize);
        return Math.sqrt((hx - h) ** 2 + (hy - h) ** 2);
    },

    // Check if a point is inside a forest zone (boolean, for simple checks)
    isInForest(px, py) {
        for (const f of this.forests) {
            const dx = px - f.x, dy = py - f.y;
            if (dx * dx + dy * dy > f.radius * f.radius) continue;
            if (f.polygon) return this._pointInPolygon(px, py, f.polygon);
            return true;
        }
        return false;
    },

    // Get what fraction (0-1) of a unit's area overlaps with any forest
    getForestOverlap(px, py, unitRadius) {
        let maxOverlap = 0;
        for (const f of this.forests) {
            const dx = px - f.x, dy = py - f.y;
            if (dx * dx + dy * dy > (f.radius + unitRadius) * (f.radius + unitRadius)) continue;

            const signedDist = f.polygon ? this._signedDistToPolygon(px, py, f.polygon) :
                (Math.sqrt(dx * dx + dy * dy) - f.radius);
            if (signedDist >= unitRadius) continue;
            if (signedDist <= -unitRadius) { maxOverlap = 1; break; }
            const overlap = (unitRadius - signedDist) / (unitRadius * 2);
            maxOverlap = Math.max(maxOverlap, Math.min(1, overlap));
        }
        return maxOverlap;
    },

    getHillOverlap(px, py, unitRadius) {
        let bestBonus = 0;
        for (const hill of this.hills) {
            const dx = px - hill.x, dy = py - hill.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > hill.radius + unitRadius) continue;

            const signedDist = hill.polygon ? this._signedDistToPolygon(px, py, hill.polygon) :
                (dist - hill.radius);
            if (signedDist >= unitRadius) continue;
            const coverage = signedDist <= -unitRadius ? 1 : Math.min(1, (unitRadius - signedDist) / (unitRadius * 2));
            const elevFactor = dist < hill.radius ? (1 - dist / hill.radius) : 0;
            bestBonus = Math.max(bestBonus, coverage * elevFactor * 0.15);
        }
        return bestBonus;
    },

    getHillBonus(px, py) {
        for (const hill of this.hills) {
            const dx = px - hill.x, dy = py - hill.y;
            if (dx * dx + dy * dy > hill.radius * hill.radius) continue;
            const inside = hill.polygon ? this._pointInPolygon(px, py, hill.polygon) : true;
            if (!inside) continue;
            // Use nearest peak distance for bonus (closer to peak = higher bonus)
            const peaks = hill.peaks || [{ x: hill.x, y: hill.y, strength: 1.0 }];
            let bestBonus = 0;
            const peakRadius = hill.radius * (peaks.length === 1 ? 1.0 : 0.65);
            for (const peak of peaks) {
                const pdx = px - peak.x, pdy = py - peak.y;
                const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
                if (pDist < peakRadius) {
                    const t = (1 - pDist / peakRadius) * peak.strength;
                    bestBonus = Math.max(bestBonus, t * 0.15);
                }
            }
            if (bestBonus > 0) return bestBonus;
            // Fallback: edge distance based bonus
            const edgeDist = hill.polygon ? this._distToPolygonEdge(px, py, hill.polygon) :
                (hill.radius - Math.sqrt(dx * dx + dy * dy));
            return Math.min(1, edgeDist / (hill.radius * 0.5)) * 0.05;
        }
        return 0;
    },

    // Check if a unit is on a road (center within road width = ≥50% overlap)
    isOnRoad(px, py, margin) {
        margin = margin || 0;
        for (const road of this.roads) {
            const pts = road.points;
            const hw = road.width / 2 + margin;
            for (let i = 0; i < pts.length - 1; i++) {
                const ax = pts[i].x, ay = pts[i].y;
                const bx = pts[i + 1].x, by = pts[i + 1].y;
                const dx = bx - ax, dy = by - ay;
                const lenSq = dx * dx + dy * dy;
                if (lenSq === 0) continue;
                const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
                const cx = ax + t * dx, cy = ay + t * dy;
                const distSq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
                if (distSq < hw * hw) return true;
            }
        }
        return false;
    },

    _renderMap() {
        const ctx = this.canvas.getContext('2d');
        const w = this.width, h = this.height;

        // Base parchment color
        ctx.fillStyle = '#d4be98';
        ctx.fillRect(0, 0, w, h);

        // Draw heightmap shading
        const imgData = ctx.getImageData(0, 0, w, h);
        const pixels = imgData.data;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const height = this.getHeight(x, y);
                const idx = (y * w + x) * 4;

                const baseR = 212, baseG = 190, baseB = 152;
                const shade = 1.0 - (height - 0.5) * 0.35;
                const texNoise = this._noise(x * 0.05, y * 0.05) * 8;

                let r = baseR * shade + texNoise;
                let g = baseG * shade + texNoise - 5;
                let b = baseB * shade + texNoise - 10;

                // Forest zone tinting — skip on roads, smooth distance-based falloff
                let forestInf = 0;
                const gx = Math.floor(x / this.gridSize), gy = Math.floor(y / this.gridSize);
                const onRoad = this._roadMask && this._roadMask[gy * this._cols + gx];
                if (!onRoad) for (const ff of this.forests) {
                    const fdx = x - ff.x, fdy = y - ff.y;
                    const distSq = fdx * fdx + fdy * fdy;
                    const rSq = ff.radius * ff.radius;
                    if (distSq > rSq * 1.44) continue; // quick reject
                    let inf;
                    if (ff.polygon) {
                        const sd = this._signedDistToPolygon(x, y, ff.polygon);
                        // sd < 0 = inside, sd > 0 = outside. Falloff over ~20% of radius
                        const falloff = ff.radius * 0.2;
                        inf = sd < 0 ? 1 : Math.max(0, 1 - sd / falloff);
                    } else {
                        const ratio = Math.sqrt(distSq) / ff.radius;
                        inf = Math.max(0, Math.min(1, (1.2 - ratio) / 0.6));
                    }
                    {
                        if (inf > forestInf) forestInf = inf;
                    }
                }
                if (forestInf > 0) {
                    const tintNoise = this._noise(x * 0.04, y * 0.04) * 0.15;
                    const tint = forestInf * (0.85 + tintNoise);
                    r = r * (1 - tint * 0.2) - tint * 12;
                    g = g * (1 - tint * 0.05) + tint * 12;
                    b = b * (1 - tint * 0.25) - tint * 15;
                }


                pixels[idx] = Math.max(0, Math.min(255, r));
                pixels[idx + 1] = Math.max(0, Math.min(255, g));
                pixels[idx + 2] = Math.max(0, Math.min(255, b));
                pixels[idx + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);

        // Draw contour lines
        this._drawContours(ctx);

        // Draw roads (before other features so forests/rivers draw on top)
        if (this.roads.length > 0) {
            this._drawRoads(ctx);
        }

        // Draw terrain features
        if (this.mapType === 'river' || this.mapType === 'forest_river') {
            this._drawGameplayRiver(ctx);
        } else if (this.mapType === 'twin_rivers' && this._twinRiverData) {
            // Draw both rivers
            const savedRiver = this.river;
            for (const rd of this._twinRiverData) {
                this.river = rd;
                this._drawGameplayRiver(ctx);
            }
            this.river = savedRiver;
        } else {
            this._drawRivers(ctx); // cosmetic rivers only on grasslands
        }
        this._drawForestDetails(ctx);
        this._drawHillDetails(ctx);
        this._drawHillMarkers(ctx);

        // Parchment edge vignette
        this._drawVignette(ctx);

        // Aged paper border
        ctx.strokeStyle = '#8b7355';
        ctx.lineWidth = 3;
        ctx.strokeRect(2, 2, w - 4, h - 4);
        ctx.strokeStyle = '#6b5335';
        ctx.lineWidth = 1;
        ctx.strokeRect(6, 6, w - 12, h - 12);
    },

    _drawContours(ctx) {
        const cellSize = 8;
        const step = 0.05;
        let levelIdx = 0;

        for (let level = 0.30; level < 0.85; level += step) {
            // Every 3rd line is an index contour (bolder), like real topo maps
            const isIndex = (levelIdx % 3 === 0);
            const alpha = isIndex ? 0.30 : 0.16;
            ctx.lineWidth = isIndex ? 1.2 : 0.7;
            ctx.strokeStyle = `rgba(90, 70, 40, ${alpha})`;
            ctx.beginPath();

            for (let y = 0; y < this.height - cellSize; y += cellSize) {
                for (let x = 0; x < this.width - cellSize; x += cellSize) {
                    const tl = this.getHeight(x, y);
                    const tr = this.getHeight(x + cellSize, y);
                    const bl = this.getHeight(x, y + cellSize);
                    const br = this.getHeight(x + cellSize, y + cellSize);

                    const config = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) |
                                   (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);

                    if (config === 0 || config === 15) continue;

                    const lerp = (a, b) => (level - a) / (b - a);
                    const top = lerp(tl, tr) * cellSize;
                    const right = lerp(tr, br) * cellSize;
                    const bottom = lerp(bl, br) * cellSize;
                    const left = lerp(tl, bl) * cellSize;

                    const pts = [];
                    if (config === 1 || config === 14) { pts.push([x, y + left], [x + bottom, y + cellSize]); }
                    else if (config === 2 || config === 13) { pts.push([x + bottom, y + cellSize], [x + cellSize, y + right]); }
                    else if (config === 4 || config === 11) { pts.push([x + top, y], [x + cellSize, y + right]); }
                    else if (config === 8 || config === 7) { pts.push([x + top, y], [x, y + left]); }
                    else if (config === 3 || config === 12) { pts.push([x, y + left], [x + cellSize, y + right]); }
                    else if (config === 6 || config === 9) { pts.push([x + top, y], [x + bottom, y + cellSize]); }
                    else if (config === 5) { pts.push([x + top, y], [x, y + left], [x + bottom, y + cellSize], [x + cellSize, y + right]); }
                    else if (config === 10) { pts.push([x + top, y], [x + cellSize, y + right], [x, y + left], [x + bottom, y + cellSize]); }

                    if (pts.length >= 2) {
                        ctx.moveTo(pts[0][0], pts[0][1]);
                        ctx.lineTo(pts[1][0], pts[1][1]);
                    }
                    if (pts.length >= 4) {
                        ctx.moveTo(pts[2][0], pts[2][1]);
                        ctx.lineTo(pts[3][0], pts[3][1]);
                    }
                }
            }
            ctx.stroke();
            levelIdx++;
        }
    },

    _drawRivers(ctx) {
        const numRivers = 1 + Math.floor(this._noise(this._seed * 0.01, 0) + 1);
        for (let r = 0; r < numRivers; r++) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(80, 100, 120, 0.3)';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';

            let rx = this.width * (0.3 + r * 0.4);
            let ry = 0;
            ctx.moveTo(rx, ry);

            while (ry < this.height) {
                ry += 3;
                const slopeX = this.getHeight(rx - 5, ry) - this.getHeight(rx + 5, ry);
                rx += slopeX * 20 + this._noise(rx * 0.01, ry * 0.01) * 4;
                rx = Math.max(50, Math.min(this.width - 50, rx));
                ctx.lineTo(rx, ry);
            }
            ctx.stroke();
        }
    },

    _drawGameplayRiver(ctx) {
        if (!this.river) return;
        const pts = this.river.points;
        const w = this.river.width;

        // Draw river body — wide blue band
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Outer bank lines (dark brown)
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = 'rgba(80, 60, 30, 0.6)';
        ctx.lineWidth = w + 8;
        ctx.stroke();

        // Water fill
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = 'rgba(60, 90, 120, 0.5)';
        ctx.lineWidth = w;
        ctx.stroke();

        // Inner water highlight
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = 'rgba(80, 120, 160, 0.3)';
        ctx.lineWidth = w * 0.6;
        ctx.stroke();

        // Draw bridges
        for (const bridge of this.bridges) {
            ctx.save();
            ctx.translate(bridge.x, bridge.y);
            ctx.rotate(bridge.angle);

            // Stone bridge body
            const bw = bridge.width;
            const bl = bridge.length;
            ctx.fillStyle = 'rgba(140, 120, 90, 0.9)';
            ctx.fillRect(-bw / 2, -bl / 2, bw, bl);

            // Bridge border
            ctx.strokeStyle = 'rgba(90, 70, 40, 0.8)';
            ctx.lineWidth = 2;
            ctx.strokeRect(-bw / 2, -bl / 2, bw, bl);

            // Stone texture lines
            ctx.strokeStyle = 'rgba(100, 80, 50, 0.3)';
            ctx.lineWidth = 1;
            for (let s = -bl / 2 + 12; s < bl / 2; s += 12) {
                ctx.beginPath();
                ctx.moveTo(-bw / 2 + 2, s);
                ctx.lineTo(bw / 2 - 2, s);
                ctx.stroke();
            }
            // Center line
            ctx.beginPath();
            ctx.moveTo(0, -bl / 2 + 2);
            ctx.lineTo(0, bl / 2 - 2);
            ctx.strokeStyle = 'rgba(100, 80, 50, 0.2)';
            ctx.stroke();

            // Bridge railings (darker edges)
            ctx.fillStyle = 'rgba(90, 70, 40, 0.6)';
            ctx.fillRect(-bw / 2, -bl / 2, 4, bl);
            ctx.fillRect(bw / 2 - 4, -bl / 2, 4, bl);

            ctx.restore();
        }

        // River label
        ctx.font = 'italic 15px Georgia';
        ctx.fillStyle = 'rgba(40, 70, 100, 0.5)';
        ctx.textAlign = 'center';
        const midPt = pts[Math.floor(pts.length / 2)];
        ctx.fillText('River', midPt.x + w / 2 + 20, midPt.y);
        ctx.textAlign = 'left';

        ctx.restore();
    },

    _drawForestDetails(ctx) {
        for (const f of this.forests) {
            // --- Organic dashed boundary ---
            const boundaryPts = this._getForestBoundaryPoints(f, 24);
            ctx.strokeStyle = 'rgba(50, 70, 30, 0.18)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            const hasRoads = this.roads.length > 0;
            // Draw boundary in segments, skipping where road crosses
            let inPath = false;
            for (let i = 0; i < boundaryPts.length; i++) {
                const next = boundaryPts[(i + 1) % boundaryPts.length];
                const midX = (boundaryPts[i].x + next.x) / 2;
                const midY = (boundaryPts[i].y + next.y) / 2;
                const segOnRoad = hasRoads && this.isOnRoad(midX, midY, 20);
                if (segOnRoad) {
                    if (inPath) { ctx.stroke(); inPath = false; }
                    continue;
                }
                if (!inPath) {
                    ctx.beginPath();
                    const prevIdx = (i - 1 + boundaryPts.length) % boundaryPts.length;
                    const prevMidX = (boundaryPts[prevIdx].x + boundaryPts[i].x) / 2;
                    const prevMidY = (boundaryPts[prevIdx].y + boundaryPts[i].y) / 2;
                    ctx.moveTo(prevMidX, prevMidY);
                    inPath = true;
                }
                ctx.quadraticCurveTo(boundaryPts[i].x, boundaryPts[i].y, midX, midY);
            }
            if (inPath) ctx.stroke();
            ctx.setLineDash([]);

            // --- Generate tree data with type, size, alpha ---
            // Use jittered grid for even distribution instead of pure noise (which clumps)
            const spacing = 14; // base grid spacing between trees
            const trees = [];
            const gridLeft = f.x - f.radius * 1.1;
            const gridTop = f.y - f.radius * 1.1;
            const gridRight = f.x + f.radius * 1.1;
            const gridBottom = f.y + f.radius * 1.1;
            let i = 0;
            for (let gx = gridLeft; gx < gridRight; gx += spacing) {
                for (let gy = gridTop; gy < gridBottom; gy += spacing) {
                    i++;
                    // Jitter each grid point randomly using noise
                    const jitterX = this._noise(gx * 0.07 + f.x * 0.01, gy * 0.09) * spacing * 0.7;
                    const jitterY = this._noise(gy * 0.07 + f.y * 0.01, gx * 0.09) * spacing * 0.7;
                    const tx = gx + jitterX;
                    const ty = gy + jitterY;

                // Use polygon for containment if available
                if (f.polygon) {
                    const sd = this._signedDistToPolygon(tx, ty, f.polygon);
                    if (sd > 0) continue; // outside polygon
                    // Edge falloff — cull trees near edges
                    if (sd > -10 && Math.abs(this._noise(i * 4.1, i * 5.3)) > 0.5) continue;
                } else {
                    const dx = tx - f.x, dy = ty - f.y;
                    const distFromCenter = Math.sqrt(dx * dx + dy * dy);
                    const distRatio = distFromCenter / f.radius;
                    if (distRatio > 0.7) {
                        const cullThreshold = (1.0 - distRatio) * 3.3;
                        if (Math.abs(this._noise(i * 4.1, i * 5.3)) > cullThreshold) continue;
                    }
                    if (distRatio > 1.15) continue;
                }

                // Determine tree type and size (needed before road check for margin)
                const typeNoise = Math.abs(this._noise(i * 3.1, f.x * 0.02));
                let type, treeSize;
                const sizeNoise = Math.abs(this._noise(i * 1.7, i * 2.9));
                if (typeNoise < 0.45) {
                    type = 0; // deciduous
                    treeSize = 6 + sizeNoise * 14; // 6-20px range
                } else if (typeNoise < 0.80) {
                    type = 1; // conifer
                    treeSize = 5 + sizeNoise * 16; // 5-21px range
                } else {
                    type = 2; // bush
                    treeSize = 4 + sizeNoise * 8; // 4-12px range
                }

                // Skip trees on roads (roads split forests) — margin accounts for tree canopy size
                if (this.roads.length > 0 && this.isOnRoad(tx, ty, 12 + treeSize * 0.6)) continue;

                // Interior clearings — skip trees in low-frequency noise pockets
                if (this._noise(tx * 0.025, ty * 0.025) > 0.42) continue;

                // Alpha based on distance from center — denser in the middle
                const dx2 = tx - f.x, dy2 = ty - f.y;
                const distRatio = Math.sqrt(dx2 * dx2 + dy2 * dy2) / f.radius;
                const alpha = 0.18 + (1.0 - Math.min(1, distRatio)) * 0.17;

                trees.push({ x: tx, y: ty, size: treeSize, type, alpha });
                }
            }

            // Sort by y-coordinate for depth (southern trees drawn last)
            trees.sort((a, b) => a.y - b.y);

            // Draw all trees
            for (const t of trees) {
                this._drawTree(ctx, t.x, t.y, t.size, t.type, t.alpha);
            }

            // Label — position at bottom of organic boundary
            let maxY = -Infinity;
            for (const pt of boundaryPts) {
                if (pt.y > maxY) maxY = pt.y;
            }
            ctx.font = 'italic 13px Georgia';
            ctx.fillStyle = 'rgba(50, 70, 30, 0.35)';
            ctx.textAlign = 'center';
            ctx.fillText('Forest', f.x, maxY + 16);
            ctx.textAlign = 'left';
        }
    },

    _drawTree(ctx, x, y, size, type, alpha) {
        if (type === 0) {
            // Deciduous — short trunk + cloud canopy (3 overlapping circles)
            ctx.beginPath();
            ctx.moveTo(x, y + size * 0.3);
            ctx.lineTo(x, y - size * 0.1);
            ctx.strokeStyle = `rgba(80, 60, 30, ${(alpha * 0.9).toFixed(2)})`;
            ctx.lineWidth = Math.max(2, size * 0.15);
            ctx.stroke();

            const fill = `rgba(50, 75, 35, ${alpha.toFixed(2)})`;
            ctx.fillStyle = fill;
            // Left lobe
            ctx.beginPath();
            ctx.arc(x - size * 0.2, y - size * 0.25, size * 0.28, 0, Math.PI * 2);
            ctx.fill();
            // Right lobe
            ctx.beginPath();
            ctx.arc(x + size * 0.2, y - size * 0.25, size * 0.28, 0, Math.PI * 2);
            ctx.fill();
            // Center lobe (larger, on top)
            ctx.beginPath();
            ctx.arc(x, y - size * 0.38, size * 0.34, 0, Math.PI * 2);
            ctx.fill();
            // Faint outline on center for definition
            ctx.strokeStyle = `rgba(40, 60, 25, ${(alpha * 0.4).toFixed(2)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();

        } else if (type === 1) {
            // Conifer — thin trunk + 2 stacked triangles
            ctx.beginPath();
            ctx.moveTo(x, y + size * 0.4);
            ctx.lineTo(x, y - size * 0.1);
            ctx.strokeStyle = `rgba(80, 60, 30, ${(alpha * 0.8).toFixed(2)})`;
            ctx.lineWidth = Math.max(1.5, size * 0.12);
            ctx.stroke();

            const fill = `rgba(40, 70, 30, ${alpha.toFixed(2)})`;
            ctx.fillStyle = fill;
            // Bottom triangle (wider)
            ctx.beginPath();
            ctx.moveTo(x, y - size * 0.25);
            ctx.lineTo(x - size * 0.3, y + size * 0.15);
            ctx.lineTo(x + size * 0.3, y + size * 0.15);
            ctx.closePath();
            ctx.fill();
            // Top triangle (narrower, overlapping)
            ctx.beginPath();
            ctx.moveTo(x, y - size * 0.55);
            ctx.lineTo(x - size * 0.2, y - size * 0.1);
            ctx.lineTo(x + size * 0.2, y - size * 0.1);
            ctx.closePath();
            ctx.fill();

        } else {
            // Bush/shrub — no trunk, 2 low overlapping circles
            const fill = `rgba(60, 85, 40, ${alpha.toFixed(2)})`;
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.arc(x - size * 0.12, y, size * 0.3, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x + size * 0.12, y - size * 0.05, size * 0.25, 0, Math.PI * 2);
            ctx.fill();
        }
    },

    _getForestBoundaryPoints(forest, numPoints) {
        // Use polygon directly if available
        if (forest.polygon) return forest.polygon;
        const pts = [];
        for (let i = 0; i < numPoints; i++) {
            const theta = (i / numPoints) * Math.PI * 2;
            const noiseVal = this._noise(
                forest.x * 0.02 + Math.cos(theta) * 3,
                forest.y * 0.02 + Math.sin(theta) * 3
            );
            const r = forest.radius * (0.78 + 0.32 * noiseVal);
            pts.push({
                x: forest.x + Math.cos(theta) * r,
                y: forest.y + Math.sin(theta) * r
            });
        }
        return pts;
    },

    _getHillBoundaryPoints(hill, numPoints) {
        // Use polygon directly if available
        if (hill.polygon) return hill.polygon;
        const pts = [];
        for (let i = 0; i < numPoints; i++) {
            const theta = (i / numPoints) * Math.PI * 2;
            const noiseVal = this._noise(
                hill.x * 0.025 + Math.cos(theta) * 2.5,
                hill.y * 0.025 + Math.sin(theta) * 2.5
            );
            const r = hill.radius * (0.85 + 0.28 * noiseVal);
            pts.push({
                x: hill.x + Math.cos(theta) * r,
                y: hill.y + Math.sin(theta) * r
            });
        }
        return pts;
    },

    _drawHillDetails(ctx) {
        // Organic hill rendering
        for (const hill of this.hills) {
            const boundaryPts = this._getHillBoundaryPoints(hill, 20);

            // --- Organic dashed boundary ---
            ctx.strokeStyle = 'rgba(110, 85, 45, 0.3)';
            ctx.lineWidth = 1.4;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            const startX = (boundaryPts[0].x + boundaryPts[boundaryPts.length - 1].x) / 2;
            const startY = (boundaryPts[0].y + boundaryPts[boundaryPts.length - 1].y) / 2;
            ctx.moveTo(startX, startY);
            for (let i = 0; i < boundaryPts.length; i++) {
                const next = boundaryPts[(i + 1) % boundaryPts.length];
                const midX = (boundaryPts[i].x + next.x) / 2;
                const midY = (boundaryPts[i].y + next.y) / 2;
                ctx.quadraticCurveTo(boundaryPts[i].x, boundaryPts[i].y, midX, midY);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);

            // Inner contour rings are handled by the global marching squares contour system
            // which properly traces real heightmap isolines for multi-peak hills

            // --- Hachure marks along boundary pointing inward ---
            const peaks = hill.peaks || [{ x: hill.x, y: hill.y, strength: 1.0 }];
            const numHachures = Math.floor(boundaryPts.length * 2.5); // ~50 marks
            for (let i = 0; i < numHachures; i++) {
                const t = i / numHachures;
                const idx = t * boundaryPts.length;
                const idxA = Math.floor(idx) % boundaryPts.length;
                const idxB = (idxA + 1) % boundaryPts.length;
                const frac = idx - Math.floor(idx);

                // Interpolate position on boundary
                const bx = boundaryPts[idxA].x + (boundaryPts[idxB].x - boundaryPts[idxA].x) * frac;
                const by = boundaryPts[idxA].y + (boundaryPts[idxB].y - boundaryPts[idxA].y) * frac;

                // Direction toward nearest peak (or center if single peak)
                let nearPeak = peaks[0];
                let nearDist = Infinity;
                for (const pk of peaks) {
                    const pd = Math.sqrt((pk.x - bx) ** 2 + (pk.y - by) ** 2);
                    if (pd < nearDist) { nearDist = pd; nearPeak = pk; }
                }
                const dx = nearPeak.x - bx;
                const dy = nearPeak.y - by;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 1) continue;
                const nx = dx / dist;
                const ny = dy / dist;

                // Hachure length varies with noise
                const lengthNoise = Math.abs(this._noise(i * 2.7, hill.x * 0.03));
                const hLen = 8 + lengthNoise * 10; // 8-18px
                const alpha = 0.18 + lengthNoise * 0.15;

                ctx.strokeStyle = `rgba(110, 85, 45, ${alpha.toFixed(2)})`;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(bx, by);
                ctx.lineTo(bx + nx * hLen, by + ny * hLen);
                ctx.stroke();
            }

            // --- Peak triangle markers (use stored peaks from heightmap data) ---
            const peakPositions = hill.peaks || [{ x: hill.x, y: hill.y, strength: 1.0 }];
            for (const peak of peakPositions) {
                const peakSize = peakPositions.length === 1 ? 1 : 0.75 + peak.strength * 0.25;
                ctx.fillStyle = 'rgba(90, 70, 40, 0.5)';
                ctx.beginPath();
                ctx.moveTo(peak.x, peak.y - 10 * peakSize);
                ctx.lineTo(peak.x - 7 * peakSize, peak.y + 5 * peakSize);
                ctx.lineTo(peak.x + 7 * peakSize, peak.y + 5 * peakSize);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = 'rgba(90, 70, 40, 0.35)';
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }

            // --- Label at bottom of organic boundary ---
            let maxY = -Infinity;
            for (const pt of boundaryPts) {
                if (pt.y > maxY) maxY = pt.y;
            }
            ctx.font = 'italic 14px Georgia';
            ctx.fillStyle = 'rgba(90, 70, 40, 0.5)';
            ctx.textAlign = 'center';
            ctx.fillText('Hill', hill.x, maxY + 18);
            ctx.textAlign = 'left';
        }
    },

    _drawHillMarkers(ctx) {
        ctx.strokeStyle = 'rgba(100, 80, 50, 0.15)';
        ctx.lineWidth = 0.8;
        for (let y = 20; y < this.height - 20; y += 25) {
            for (let x = 20; x < this.width - 20; x += 25) {
                const slope = this.getSlope(x, y);
                if (slope > 0.03) {
                    const len = Math.min(slope * 80, 8);
                    const angle = Math.atan2(
                        this.getHeight(x, y + 4) - this.getHeight(x, y - 4),
                        this.getHeight(x + 4, y) - this.getHeight(x - 4, y)
                    );
                    ctx.beginPath();
                    ctx.moveTo(x - Math.cos(angle) * len, y - Math.sin(angle) * len);
                    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
                    ctx.stroke();
                }
            }
        }
    },

    _drawVignette(ctx) {
        const w = this.width, h = this.height;
        const grd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
        grd.addColorStop(0, 'rgba(0,0,0,0)');
        grd.addColorStop(1, 'rgba(40,25,10,0.15)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
    },

    // --- Ditch system ---
    clearDitches() {
        this.ditches = [];
    },

    // Max ditch length: 2.5× legion longest side (72px) = 180px
    get MAX_DITCH_LENGTH() { return SIZE_CONFIG[UnitSize.LEGION].width * 2.5; },

    // Start a new ditch trail for a digging unit
    startDitch(x, y, width) {
        const ditch = { points: [{ x, y }], width, totalLength: 0 };
        this.ditches.push(ditch);
        return ditch;
    },

    // Extend an existing ditch trail (add point if moved enough)
    // Returns false if max length reached (caller should stop digging)
    extendDitch(ditch, x, y) {
        const last = ditch.points[ditch.points.length - 1];
        const dx = x - last.x;
        const dy = y - last.y;
        const segLen = Math.sqrt(dx * dx + dy * dy);
        if (segLen >= 10) { // every 10px of movement
            const remaining = this.MAX_DITCH_LENGTH - ditch.totalLength;
            if (remaining <= 0) return false; // already at max
            if (segLen <= remaining) {
                ditch.points.push({ x, y });
                ditch.totalLength += segLen;
            } else {
                // Partial segment to hit exact max length
                const ratio = remaining / segLen;
                ditch.points.push({ x: last.x + dx * ratio, y: last.y + dy * ratio });
                ditch.totalLength = this.MAX_DITCH_LENGTH;
                return false; // max reached
            }
        }
        return true;
    },

    // Check if a point is inside any ditch (for movement blocking)
    isDitchBlocking(px, py, unitRadius) {
        for (const ditch of this.ditches) {
            const pts = ditch.points;
            if (pts.length < 2) continue;
            const hw = ditch.width / 2 + (unitRadius || 0);
            for (let i = 0; i < pts.length - 1; i++) {
                const ax = pts[i].x, ay = pts[i].y;
                const bx = pts[i + 1].x, by = pts[i + 1].y;
                // Point-to-segment distance
                const abx = bx - ax, aby = by - ay;
                const apx = px - ax, apy = py - ay;
                const abLen2 = abx * abx + aby * aby;
                if (abLen2 < 1) continue;
                let t = (apx * abx + apy * aby) / abLen2;
                t = Math.max(0, Math.min(1, t));
                const closestX = ax + t * abx;
                const closestY = ay + t * aby;
                const dx = px - closestX;
                const dy = py - closestY;
                if (dx * dx + dy * dy < hw * hw) return true;
            }
        }
        return false;
    },

    // --- River system ---

    _generateRiver() {
        // River flows top-to-bottom through the center third of the map
        // Stored as a polyline with a wide width
        const riverWidth = 50 + Math.abs(this._noise(this._seed * 0.23, 0)) * 20; // 50-70px
        const points = [];
        // Start near top, center third
        let rx = this.width * 0.35 + Math.abs(this._noise(this._seed * 0.31, 0)) * this.width * 0.3;
        let ry = 0;
        points.push({ x: rx, y: ry });

        // Walk down the map with gentle curves
        while (ry < this.height) {
            ry += 15;
            // Gentle noise-based wandering
            const drift = this._noise(rx * 0.003 + this._seed * 0.1, ry * 0.005) * 6;
            rx += drift;
            // Keep within center third (with some margin)
            rx = Math.max(this.width * 0.25, Math.min(this.width * 0.75, rx));
            points.push({ x: rx, y: ry });
        }

        this.river = { points, width: riverWidth };
    },

    _generateBridges() {
        if (!this.river) return;
        // Place 1-2 bridges at varied Y positions
        const numBridges = Math.abs(this._noise(this._seed * 0.41, 0)) > 0.3 ? 2 : 1;
        this.bridges = [];

        const pts = this.river.points;
        const h = this.height;

        for (let b = 0; b < numBridges; b++) {
            // Spread bridges vertically: if 1 bridge → center, if 2 → upper third and lower third
            let targetY;
            if (numBridges === 1) {
                targetY = h * 0.4 + Math.abs(this._noise(this._seed * 0.51, b)) * h * 0.2;
            } else {
                targetY = b === 0
                    ? h * 0.2 + Math.abs(this._noise(this._seed * 0.51, 0)) * h * 0.15
                    : h * 0.6 + Math.abs(this._noise(this._seed * 0.51, 1)) * h * 0.15;
            }

            // Find the river point closest to targetY
            let bestIdx = 0, bestDist = Infinity;
            for (let i = 0; i < pts.length; i++) {
                const d = Math.abs(pts[i].y - targetY);
                if (d < bestDist) { bestDist = d; bestIdx = i; }
            }

            const bridgePt = pts[bestIdx];
            // Compute river direction at this point for bridge angle (perpendicular)
            const prevIdx = Math.max(0, bestIdx - 2);
            const nextIdx = Math.min(pts.length - 1, bestIdx + 2);
            const dx = pts[nextIdx].x - pts[prevIdx].x;
            const dy = pts[nextIdx].y - pts[prevIdx].y;
            const riverAngle = Math.atan2(dy, dx);
            const bridgeAngle = riverAngle + Math.PI / 2; // perpendicular

            this.bridges.push({
                x: bridgePt.x,
                y: bridgePt.y,
                width: 120, // bridge is 120px wide (along the crossing direction)
                length: this.river.width + 60, // extends well beyond river banks
                angle: bridgeAngle
            });
        }
    },

    // Check if a point is blocked by the river (returns true if in river and NOT on a bridge)
    isRiverBlocking(px, py, unitRadius) {
        if (!this.river) return false;
        const pts = this.river.points;
        if (pts.length < 2) return false;
        const hw = this.river.width / 2 + (unitRadius || 0);

        // First check if on a bridge — bridges override river blocking
        // Bridge passable zone is expanded by unit radius so units can actually cross
        const ur = unitRadius || 0;
        for (const bridge of this.bridges) {
            const cos = Math.cos(bridge.angle);
            const sin = Math.sin(bridge.angle);
            const relX = px - bridge.x;
            const relY = py - bridge.y;
            // Project onto bridge axes
            const alongBridge = relX * cos + relY * sin;   // across the river
            const acrossBridge = -relX * sin + relY * cos;  // along the river
            // Expand passable zone by unit radius so edges don't clip
            const halfW = bridge.width / 2 + ur;
            const halfL = bridge.length / 2 + ur;
            if (Math.abs(alongBridge) < halfW && Math.abs(acrossBridge) < halfL) {
                return false; // on bridge, not blocked
            }
        }

        // Check point-to-polyline distance (same as ditch check)
        for (let i = 0; i < pts.length - 1; i++) {
            const ax = pts[i].x, ay = pts[i].y;
            const bx = pts[i + 1].x, by = pts[i + 1].y;
            const abx = bx - ax, aby = by - ay;
            const apx = px - ax, apy = py - ay;
            const abLen2 = abx * abx + aby * aby;
            if (abLen2 < 1) continue;
            let t = (apx * abx + apy * aby) / abLen2;
            t = Math.max(0, Math.min(1, t));
            const cx = ax + t * abx, cy = ay + t * aby;
            const dx = px - cx, dy = py - cy;
            if (dx * dx + dy * dy < hw * hw) return true;
        }

        // Twin rivers: also check the second river
        if (this._twinRiverData && this._twinRiverData.length > 1) {
            const pts2 = this._twinRiverData[1].points;
            const hw2 = this._twinRiverData[1].width / 2 + (unitRadius || 0);
            for (let i = 0; i < pts2.length - 1; i++) {
                const ax = pts2[i].x, ay = pts2[i].y;
                const bx = pts2[i + 1].x, by = pts2[i + 1].y;
                const abx = bx - ax, aby = by - ay;
                const apx = px - ax, apy = py - ay;
                const abLen2 = abx * abx + aby * aby;
                if (abLen2 < 1) continue;
                let t = (apx * abx + apy * aby) / abLen2;
                t = Math.max(0, Math.min(1, t));
                const cx = ax + t * abx, cy = ay + t * aby;
                const dx = px - cx, dy = py - cy;
                if (dx * dx + dy * dy < hw2 * hw2) return true;
            }
        }

        return false;
    },

    // Get slide direction along river bank (same pattern as ditch)
    getRiverSlideDirection(px, py, unitRadius) {
        if (!this.river) return { nx: 0, ny: 0 };
        let bestDist = Infinity;
        let bestNx = 0, bestNy = 0;
        const pts = this.river.points;
        const hw = this.river.width / 2 + (unitRadius || 0);
        for (let i = 0; i < pts.length - 1; i++) {
            const ax = pts[i].x, ay = pts[i].y;
            const bx = pts[i + 1].x, by = pts[i + 1].y;
            const abx = bx - ax, aby = by - ay;
            const apx = px - ax, apy = py - ay;
            const abLen2 = abx * abx + aby * aby;
            if (abLen2 < 1) continue;
            let t = (apx * abx + apy * aby) / abLen2;
            t = Math.max(0, Math.min(1, t));
            const cx = ax + t * abx, cy = ay + t * aby;
            const dx = px - cx, dy = py - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < hw && dist < bestDist) {
                bestDist = dist;
                if (dist > 0.1) {
                    bestNx = dx / dist;
                    bestNy = dy / dist;
                }
            }
        }
        // Twin rivers: also check second river
        if (this._twinRiverData && this._twinRiverData.length > 1) {
            const pts2 = this._twinRiverData[1].points;
            const hw2 = this._twinRiverData[1].width / 2 + (unitRadius || 0);
            for (let i = 0; i < pts2.length - 1; i++) {
                const ax = pts2[i].x, ay = pts2[i].y;
                const bx = pts2[i + 1].x, by = pts2[i + 1].y;
                const abx = bx - ax, aby = by - ay;
                const apx = px - ax, apy = py - ay;
                const abLen2 = abx * abx + aby * aby;
                if (abLen2 < 1) continue;
                let t = (apx * abx + apy * aby) / abLen2;
                t = Math.max(0, Math.min(1, t));
                const cx = ax + t * abx, cy = ay + t * aby;
                const dx = px - cx, dy = py - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < hw2 && dist < bestDist) {
                    bestDist = dist;
                    if (dist > 0.1) { bestNx = dx / dist; bestNy = dy / dist; }
                }
            }
        }
        return { nx: bestNx, ny: bestNy };
    },

    // Check if a point overlaps with the river (for terrain avoidance and rendering)
    _isNearRiver(px, py, margin) {
        if (!this.river) return false;
        const pts = this.river.points;
        const hw = this.river.width / 2 + margin;
        const hw2 = hw * hw;
        for (let i = 0; i < pts.length; i++) {
            const dx = px - pts[i].x, dy = py - pts[i].y;
            if (dx * dx + dy * dy < hw2) return true;
        }
        return false;
    },

    _isNearBridge(px, py, margin) {
        if (!this.bridges || this.bridges.length === 0) return false;
        const m2 = margin * margin;
        for (const b of this.bridges) {
            const dx = px - b.x, dy = py - b.y;
            if (dx * dx + dy * dy < m2) return true;
        }
        return false;
    },

    // Get the ditch normal at a blocked point (for sliding along the edge)
    getDitchSlideDirection(px, py, unitRadius) {
        let bestDist = Infinity;
        let bestNx = 0, bestNy = 0;
        for (const ditch of this.ditches) {
            const pts = ditch.points;
            const hw = ditch.width / 2 + (unitRadius || 0);
            for (let i = 0; i < pts.length - 1; i++) {
                const ax = pts[i].x, ay = pts[i].y;
                const bx = pts[i + 1].x, by = pts[i + 1].y;
                const abx = bx - ax, aby = by - ay;
                const apx = px - ax, apy = py - ay;
                const abLen2 = abx * abx + aby * aby;
                if (abLen2 < 1) continue;
                let t = (apx * abx + apy * aby) / abLen2;
                t = Math.max(0, Math.min(1, t));
                const cx = ax + t * abx, cy = ay + t * aby;
                const dx = px - cx, dy = py - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < hw && dist < bestDist) {
                    bestDist = dist;
                    // Normal points away from ditch center
                    if (dist > 0.1) {
                        bestNx = dx / dist;
                        bestNy = dy / dist;
                    }
                }
            }
        }
        return { nx: bestNx, ny: bestNy };
    },

    // Check if a ditch blocks the straight line from (x1,y1) to (x2,y2)
    // Returns the blocking ditch or null
    getDitchBetween(x1, y1, x2, y2, unitRadius) {
        const steps = 8;
        const dx = x2 - x1, dy = y2 - y1;
        for (const ditch of this.ditches) {
            const pts = ditch.points;
            if (pts.length < 2) continue;
            const hw = ditch.width / 2 + (unitRadius || 0);
            for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                const px = x1 + dx * t;
                const py = y1 + dy * t;
                for (let i = 0; i < pts.length - 1; i++) {
                    const ax = pts[i].x, ay = pts[i].y;
                    const bx = pts[i + 1].x, by = pts[i + 1].y;
                    const abx = bx - ax, aby = by - ay;
                    const apx = px - ax, apy = py - ay;
                    const abLen2 = abx * abx + aby * aby;
                    if (abLen2 < 1) continue;
                    let u = (apx * abx + apy * aby) / abLen2;
                    u = Math.max(0, Math.min(1, u));
                    const cx = ax + u * abx, cy = ay + u * aby;
                    const ex = px - cx, ey = py - cy;
                    if (ex * ex + ey * ey < hw * hw) return ditch;
                }
            }
        }
        return null;
    },

    // Find a bypass waypoint to go around the end of a blocking ditch
    // Returns {x, y} of a point past the ditch end closest to the destination
    getDitchBypassPoint(ditch, unitX, unitY, destX, destY, unitRadius) {
        const pts = ditch.points;
        if (pts.length < 2) return null;
        const margin = ditch.width / 2 + (unitRadius || 0) + 20;

        // Get both ends of the ditch
        const endA = pts[0];
        const endB = pts[pts.length - 1];

        // Pick the end that's closer to the destination
        const dA = Math.sqrt((endA.x - destX) ** 2 + (endA.y - destY) ** 2);
        const dB = Math.sqrt((endB.x - destX) ** 2 + (endB.y - destY) ** 2);
        const chosenEnd = dA < dB ? endA : endB;

        // Compute a perpendicular offset from the ditch at that end
        // Direction: from ditch end toward the unit's side
        const toDest = { x: destX - unitX, y: destY - unitY };
        const toEnd = { x: chosenEnd.x - unitX, y: chosenEnd.y - unitY };

        // Use the perpendicular to the ditch segment near the chosen end
        let segDx, segDy;
        if (chosenEnd === endA && pts.length >= 2) {
            segDx = pts[1].x - pts[0].x;
            segDy = pts[1].y - pts[0].y;
        } else {
            segDx = pts[pts.length - 1].x - pts[pts.length - 2].x;
            segDy = pts[pts.length - 1].y - pts[pts.length - 2].y;
        }
        const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
        if (segLen < 1) return null;

        // Perpendicular directions
        const perpX = -segDy / segLen;
        const perpY = segDx / segLen;

        // Pick the side that's closer to the unit
        const sideA = { x: chosenEnd.x + perpX * margin, y: chosenEnd.y + perpY * margin };
        const sideB = { x: chosenEnd.x - perpX * margin, y: chosenEnd.y - perpY * margin };
        const distA = Math.sqrt((sideA.x - unitX) ** 2 + (sideA.y - unitY) ** 2);
        const distB = Math.sqrt((sideB.x - unitX) ** 2 + (sideB.y - unitY) ** 2);

        const bypass = distA < distB ? sideA : sideB;

        // Clamp to map
        bypass.x = Math.max(20, Math.min(this.width - 20, bypass.x));
        bypass.y = Math.max(20, Math.min(this.height - 20, bypass.y));
        return bypass;
    },

    // --- Road Mask (for forest tinting exclusion) ---

    _buildRoadMask() {
        const cols = this._cols, rows = this._rows, gs = this.gridSize;
        this._roadMask = new Uint8Array(cols * rows);
        for (const road of this.roads) {
            const pts = road.points;
            const hw = road.width / 2 + 20; // margin beyond road edge for clean forest gap
            for (let i = 0; i < pts.length - 1; i++) {
                const ax = pts[i].x, ay = pts[i].y;
                const bx = pts[i + 1].x, by = pts[i + 1].y;
                // Bounding box of this segment in grid coords
                const gxMin = Math.max(0, Math.floor((Math.min(ax, bx) - hw) / gs));
                const gxMax = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + hw) / gs));
                const gyMin = Math.max(0, Math.floor((Math.min(ay, by) - hw) / gs));
                const gyMax = Math.min(rows - 1, Math.ceil((Math.max(ay, by) + hw) / gs));
                const dx = bx - ax, dy = by - ay;
                const lenSq = dx * dx + dy * dy;
                for (let gy = gyMin; gy <= gyMax; gy++) {
                    for (let gx = gxMin; gx <= gxMax; gx++) {
                        if (this._roadMask[gy * cols + gx]) continue;
                        const px = gx * gs, py = gy * gs;
                        const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
                        const cx = ax + t * dx, cy = ay + t * dy;
                        if ((px - cx) * (px - cx) + (py - cy) * (py - cy) < hw * hw) {
                            this._roadMask[gy * cols + gx] = 1;
                        }
                    }
                }
            }
        }
    },

    // --- Pre-compute hill positions for road avoidance ---

    _precomputeHillPositions() {
        // Compute hill center positions and radii before roads are generated
        // so roads can steer around them. Only for maps with random hill placement.
        this._pendingHills = [];
        const totalHillArea = 4 * Math.PI * 130 * 130;
        const hillPattern = Math.abs(this._noise(this._seed * 0.13, 0.5));
        const numHills = hillPattern < 0.3 ? 2 : hillPattern < 0.6 ? 3 : 4;
        const hillRadii = this._splitAreaBudget(totalHillArea, numHills, this._seed * 0.17);
        const clampR = (r, min, max) => Math.max(min, Math.min(max, r));

        for (let i = 0; i < numHills; i++) {
            const onLeft = (i % 2 === 0);
            const halfMin = onLeft ? 200 : this.width * 0.5;
            const halfMax = onLeft ? this.width * 0.5 : this.width - 200;
            const hr = clampR(hillRadii[i], 70, 200);
            let hx, hy, attempts = 0, valid = false;
            let rng = this._seed * 16807 + i * 54321;
            do {
                rng = (rng * 16807 + 1) % 2147483647;
                hx = halfMin + (rng / 2147483647) * (halfMax - halfMin);
                rng = (rng * 16807 + 1) % 2147483647;
                hy = 150 + (rng / 2147483647) * (this.height - 300);
                attempts++;
                valid = !this._isNearRiver(hx, hy, hr + 20) && !this._isNearBridge(hx, hy, hr + 150);
            } while (!valid && attempts < 50);
            if (valid) {
                this._pendingHills.push({ x: hx, y: hy, radius: hr, index: i });
            }
        }
    },

    // --- Roman Road ---

    _generateRomanRoad() {
        // Road runs left-to-right across the map with gentle Perlin noise curves
        const roadWidth = 32;
        const points = [];
        const centerY = this.height * 0.4 + Math.abs(this._noise(this._seed * 0.37, 0)) * this.height * 0.2;
        let rx = 0;
        let ry = centerY;
        points.push({ x: rx, y: ry });

        while (rx < this.width) {
            rx += 15;
            const drift = this._noise(rx * 0.004 + this._seed * 0.2, ry * 0.003) * 4;
            ry += drift;
            ry = Math.max(this.height * 0.2, Math.min(this.height * 0.8, ry));
            points.push({ x: rx, y: ry });
        }

        this.roads.push({ points, width: roadWidth });
    },

    // Grasslands: diagonal road from bottom-left to top-right
    _generateGrasslandsRoad() {
        const roadWidth = 28;
        const points = [];
        const startY = this.height * 0.85;
        const endY = this.height * 0.15;
        let rx = 0, ry = startY;
        points.push({ x: rx, y: ry });

        while (rx < this.width) {
            rx += 15;
            const progress = rx / this.width;
            const targetY = startY + (endY - startY) * progress;
            // Gently pull toward the ideal line but keep current deflection
            ry += (targetY - ry) * 0.08;
            const drift = this._noise(rx * 0.003 + this._seed * 0.15, ry * 0.004) * 3;
            ry += drift;
            // Steer around pre-computed hills (multiple passes for convergence)
            for (let pass = 0; pass < 3; pass++) {
                for (const ph of this._pendingHills) {
                    const dx = rx - ph.x, dy = ry - ph.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const avoidR = ph.radius + roadWidth + 20;
                    if (dist < avoidR && dist > 1) {
                        ry += (dy / dist) * (avoidR - dist) * 0.8;
                    }
                }
            }
            ry = Math.max(40, Math.min(this.height - 40, ry));
            points.push({ x: rx, y: ry });
        }
        this.roads.push({ points, width: roadWidth });
    },

    // River Crossing: horizontal road that crosses through the bridge
    _generateRiverCrossingRoad() {
        if (!this.river || this.bridges.length === 0) return;
        const roadWidth = 28;
        const bridge = this.bridges[0]; // Use first bridge
        const points = [];

        // Build road left-to-right, bending toward the bridge
        let rx = 0;
        let ry = bridge.y + (this._noise(this._seed * 0.44, 0) * 80 - 40);
        points.push({ x: rx, y: ry });

        while (rx < this.width) {
            rx += 15;
            const progress = rx / this.width;
            // Gently curve toward bridge in the middle, then away
            const bridgeInfluence = Math.max(0, 1 - Math.abs(progress - 0.5) * 4);
            ry += (bridge.y - ry) * bridgeInfluence * 0.15;
            const drift = this._noise(rx * 0.003 + this._seed * 0.25, ry * 0.004) * 3;
            ry += drift;
            // Steer around pre-computed hills — but suppress near bridge so road reaches it
            const distToBridge = Math.sqrt((rx - bridge.x) * (rx - bridge.x) + (ry - bridge.y) * (ry - bridge.y));
            const hillAvoidStrength = distToBridge < 200 ? 0 : distToBridge < 400 ? (distToBridge - 200) / 200 : 1;
            if (hillAvoidStrength > 0) {
                for (let pass = 0; pass < 3; pass++) {
                    for (const ph of this._pendingHills) {
                        const dx = rx - ph.x, dy = ry - ph.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const avoidR = ph.radius + roadWidth + 20;
                        if (dist < avoidR && dist > 1) {
                            ry += (dy / dist) * (avoidR - dist) * 0.8 * hillAvoidStrength;
                        }
                    }
                }
            }
            ry = Math.max(40, Math.min(this.height - 40, ry));
            points.push({ x: rx, y: ry });
        }
        this.roads.push({ points, width: roadWidth });
    },

    // Narrow Pass: road straight through the gap between the two hills
    _generateNarrowPassRoad() {
        const roadWidth = 28;
        const points = [];
        const centerY = this.height / 2;
        let rx = 0;
        let ry = centerY + (this._noise(this._seed * 0.55, 0) * 40 - 20);
        points.push({ x: rx, y: ry });

        while (rx < this.width) {
            rx += 15;
            // Stay close to center (the gap)
            const drift = this._noise(rx * 0.004 + this._seed * 0.3, ry * 0.003) * 2.5;
            ry += drift;
            // Pull toward center
            ry += (centerY - ry) * 0.03;
            ry = Math.max(this.height * 0.35, Math.min(this.height * 0.65, ry));
            points.push({ x: rx, y: ry });
        }
        this.roads.push({ points, width: roadWidth });
    },

    // Dense Forest: road winding between forest patches
    _generateDenseForestRoad() {
        const roadWidth = 24; // slightly narrower forest trail
        const points = [];
        const centerY = this.height * 0.45 + this._noise(this._seed * 0.66, 0) * this.height * 0.1;
        let rx = 0;
        let ry = centerY;
        points.push({ x: rx, y: ry });

        while (rx < this.width) {
            rx += 15;
            const drift = this._noise(rx * 0.005 + this._seed * 0.35, ry * 0.004) * 5;
            ry += drift;
            ry = Math.max(this.height * 0.2, Math.min(this.height * 0.8, ry));
            points.push({ x: rx, y: ry });
        }
        this.roads.push({ points, width: roadWidth });
    },

    // Twin Rivers: road connecting bridges of both rivers
    _generateTwinRiversRoad() {
        if (!this._twinRiverData || this._twinRiverData.length < 2) return;
        const roadWidth = 28;

        // Find the first bridge of each river
        const allBridges = this.bridges;
        if (allBridges.length < 2) return;

        // Sort bridges by x position
        const sorted = [...allBridges].sort((a, b) => a.x - b.x);
        const leftBridge = sorted[0];
        const rightBridge = sorted[sorted.length - 1];

        const points = [];
        let rx = 0;
        let ry = leftBridge.y + (this._noise(this._seed * 0.77, 0) * 60 - 30);
        points.push({ x: rx, y: ry });

        while (rx < this.width) {
            rx += 15;
            const progress = rx / this.width;
            // Curve toward left bridge, then toward right bridge
            let targetY;
            if (progress < 0.35) {
                targetY = ry + (leftBridge.y - ry) * 0.08;
            } else if (progress < 0.65) {
                const midProgress = (progress - 0.35) / 0.3;
                targetY = leftBridge.y + (rightBridge.y - leftBridge.y) * midProgress;
            } else {
                targetY = ry + (rightBridge.y - ry) * 0.08;
            }
            const drift = this._noise(rx * 0.003 + this._seed * 0.4, targetY * 0.004) * 3;
            ry = targetY + drift;
            ry = Math.max(40, Math.min(this.height - 40, ry));
            points.push({ x: rx, y: ry });
        }
        this.roads.push({ points, width: roadWidth });
    },

    _generateRomanRoadTerrain() {
        // Map with a road + flanking hills and forests for tactical variety
        this.forests = [];
        this.hills = [];

        if (this.roads.length === 0) return;
        const roadPts = this.roads[0].points;
        // Get road Y at various X positions for placement
        const roadYAt = (targetX) => {
            for (let i = 0; i < roadPts.length - 1; i++) {
                if (roadPts[i].x <= targetX && roadPts[i + 1].x >= targetX) {
                    const t = (targetX - roadPts[i].x) / (roadPts[i + 1].x - roadPts[i].x);
                    return roadPts[i].y + t * (roadPts[i + 1].y - roadPts[i].y);
                }
            }
            return this.height / 2;
        };

        // Place 3 hills: 2 above road, 1 below (or vice versa)
        const hillPositions = [
            { xFrac: 0.3, side: -1 },
            { xFrac: 0.55, side: 1 },
            { xFrac: 0.75, side: -1 },
        ];
        for (const hp of hillPositions) {
            const hx = this.width * hp.xFrac + (this._noise(this._seed * 0.6 + hp.xFrac, 0) * 80);
            const roadY = roadYAt(hx);
            const offset = (100 + Math.abs(this._noise(this._seed * 0.7 + hp.xFrac, 1)) * 80) * hp.side;
            const hy = roadY + offset;
            if (hy > 60 && hy < this.height - 60) {
                const radius = 60 + Math.abs(this._noise(this._seed * 0.8 + hp.xFrac, 2)) * 40;
                this.hills.push(this._createFeature(hx, hy, radius, 0.18, hx * 0.02 + hy * 0.02));
            }
        }

        // Place 3 forests flanking the road
        const forestPositions = [
            { xFrac: 0.2, side: 1 },
            { xFrac: 0.5, side: -1 },
            { xFrac: 0.8, side: 1 },
        ];
        for (const fp of forestPositions) {
            const fx = this.width * fp.xFrac + (this._noise(this._seed * 0.9 + fp.xFrac, 0) * 60);
            const roadY = roadYAt(fx);
            const offset = (120 + Math.abs(this._noise(this._seed * 1.0 + fp.xFrac, 1)) * 60) * fp.side;
            const fy = roadY + offset;
            if (fy > 80 && fy < this.height - 80) {
                const radius = 70 + Math.abs(this._noise(this._seed * 1.1 + fp.xFrac, 2)) * 40;
                this.forests.push(this._createFeature(fx, fy, radius, undefined, fx * 0.01 + fy * 0.01));
            }
        }
    },

    _drawRoads(ctx) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (const road of this.roads) {
            const pts = road.points;
            const w = road.width;

            // Edge lines (dark brown border)
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.strokeStyle = 'rgba(100, 80, 50, 0.5)';
            ctx.lineWidth = w + 6;
            ctx.stroke();

            // Stone fill (light tan)
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.strokeStyle = 'rgba(175, 155, 125, 0.7)';
            ctx.lineWidth = w;
            ctx.stroke();

            // Inner highlight (lighter center)
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.strokeStyle = 'rgba(200, 185, 160, 0.4)';
            ctx.lineWidth = w * 0.5;
            ctx.stroke();

            // Paving stone cross-marks every ~40px
            ctx.strokeStyle = 'rgba(120, 100, 70, 0.25)';
            ctx.lineWidth = 1;
            for (let i = 0; i < pts.length - 1; i += 3) {
                const px = pts[i].x, py = pts[i].y;
                const nx = pts[Math.min(i + 1, pts.length - 1)].x;
                const ny = pts[Math.min(i + 1, pts.length - 1)].y;
                const angle = Math.atan2(ny - py, nx - px);
                const perpX = -Math.sin(angle) * w * 0.45;
                const perpY = Math.cos(angle) * w * 0.45;
                ctx.beginPath();
                ctx.moveTo(px + perpX, py + perpY);
                ctx.lineTo(px - perpX, py - perpY);
                ctx.stroke();
            }

            // Road label
            const midPt = pts[Math.floor(pts.length / 2)];
            ctx.font = 'italic 13px Georgia';
            ctx.fillStyle = 'rgba(100, 80, 50, 0.45)';
            ctx.textAlign = 'center';
            ctx.fillText('Via Romana', midPt.x, midPt.y - w / 2 - 8);
            ctx.textAlign = 'left';
        }

        ctx.restore();
    }
};
