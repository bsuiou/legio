// Fog of war / visibility system
const Visibility = {
    CELL_SIZE: 40,
    gridW: 48,   // Math.ceil(1920 / 40)
    gridH: 27,   // Math.ceil(1080 / 40)
    playerGrid: null,
    enemyGrid: null,
    fogCanvas: null,
    fogCtx: null,
    // Half-angle of the visible arc (270° visible = 135° half-arc)
    VISION_HALF: Math.PI * 0.75, // 135 degrees in radians

    init() {
        this.gridW = Math.ceil(GameMap.width / this.CELL_SIZE);
        this.gridH = Math.ceil(GameMap.height / this.CELL_SIZE);
        this.playerGrid = new Uint8Array(this.gridW * this.gridH);
        this.enemyGrid = new Uint8Array(this.gridW * this.gridH);

        // Small offscreen canvas for fog — rendered at half cell resolution for soft edges
        this.fogCanvas = document.createElement('canvas');
        this.fogCanvas.width = this.gridW;
        this.fogCanvas.height = this.gridH;
        this.fogCtx = this.fogCanvas.getContext('2d');
    },

    // Compute visibility for a set of units, filling the given grid
    computeVisibility(units, grid) {
        if (!grid) return;
        const len = this.gridW * this.gridH;
        for (let i = 0; i < len; i++) grid[i] = 0;

        const cs = this.CELL_SIZE;
        const halfCS = cs * 0.5;

        // Cache obstacle list once per visibility pass
        this._cachedObstacles = [...GameMap.forests, ...GameMap.hills];

        for (const u of units) {
            if (!u.alive) continue;
            const range = u.getVisionRange();
            const rangeSq = range * range;
            const facing = u.angle;

            // Bounding box in grid coords
            const minCX = Math.max(0, Math.floor((u.x - range) / cs));
            const maxCX = Math.min(this.gridW - 1, Math.floor((u.x + range) / cs));
            const minCY = Math.max(0, Math.floor((u.y - range) / cs));
            const maxCY = Math.min(this.gridH - 1, Math.floor((u.y + range) / cs));

            for (let cy = minCY; cy <= maxCY; cy++) {
                for (let cx = minCX; cx <= maxCX; cx++) {
                    const idx = cy * this.gridW + cx;
                    if (grid[idx]) continue; // already visible

                    const cellX = cx * cs + halfCS;
                    const cellY = cy * cs + halfCS;
                    const dx = cellX - u.x;
                    const dy = cellY - u.y;
                    const distSq = dx * dx + dy * dy;

                    // Distance check
                    if (distSq > rangeSq) continue;

                    // Vision cone check — 270° forward, 90° blind spot behind
                    const angleToCell = Math.atan2(dy, dx);
                    let diff = angleToCell - facing;
                    if (diff > Math.PI) diff -= Math.PI * 2;
                    else if (diff < -Math.PI) diff += Math.PI * 2;
                    if (Math.abs(diff) > this.VISION_HALF) continue;

                    // Terrain LOS check
                    if (!this._hasLineOfSight(u.x, u.y, cellX, cellY)) continue;

                    grid[idx] = 1;
                }
            }
        }
    },

    // LOS check — circular obstacles (forests + hills)
    // Skip obstacles that the viewer is inside — units can see outward from forests/hills
    _hasLineOfSight(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1) return true;

        for (const obs of this._cachedObstacles) {
            const r = obs.radius * 0.7;
            const rSq = r * r;

            // If viewer is inside this obstacle, skip it — they can see outward
            const d1Sq = (x1 - obs.x) * (x1 - obs.x) + (y1 - obs.y) * (y1 - obs.y);
            if (d1Sq < obs.radius * obs.radius) continue;

            // If both endpoints inside, skip (shouldn't happen since viewer isn't inside)
            const d2Sq = (x2 - obs.x) * (x2 - obs.x) + (y2 - obs.y) * (y2 - obs.y);
            if (d1Sq < obs.radius * obs.radius && d2Sq < obs.radius * obs.radius) continue;

            const fx = x1 - obs.x;
            const fy = y1 - obs.y;
            let t = -(fx * dx + fy * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            const closestX = x1 + t * dx;
            const closestY = y1 + t * dy;
            const cdx = closestX - obs.x;
            const cdy = closestY - obs.y;
            if (cdx * cdx + cdy * cdy < rSq) return false;
        }
        return true;
    },

    // Render the fog overlay onto the small canvas
    renderFogOverlay() {
        const ctx = this.fogCtx;
        const w = this.gridW;
        const h = this.gridH;

        // Guest sees fog from their own units' perspective (enemyGrid)
        const myGrid = (Network.isMultiplayer && !Network.isHost)
            ? this.enemyGrid : this.playerGrid;

        // Clear previous frame first
        ctx.clearRect(0, 0, w, h);

        // Fill with subtle darkening
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.fillRect(0, 0, w, h);

        // Clear visible cells (make them transparent)
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0, 0, 0, 1)';
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (myGrid[y * w + x]) {
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }
        ctx.globalCompositeOperation = 'source-over';
    },

    // Check if a world coordinate is visible to a team
    isVisible(x, y, team) {
        const grid = team === 'player' ? this.playerGrid : this.enemyGrid;
        const cx = Math.floor(x / this.CELL_SIZE);
        const cy = Math.floor(y / this.CELL_SIZE);
        if (cx < 0 || cx >= this.gridW || cy < 0 || cy >= this.gridH) return false;
        return grid[cy * this.gridW + cx] === 1;
    }
};
