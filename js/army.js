// Unit symbol helper — generates HTML badge matching in-game flag-style unit models
function unitSymbolHTML(type, size, small) {
    const tc = TYPE_CONFIG[type];
    const sc = SIZE_CONFIG[size];
    const s = small ? 0.75 : 1;

    // Colors matching the game renderer
    const fillColor  = 'rgba(20, 140, 20, 0.95)';   // vivid green (player)
    const lightFill  = 'rgba(120, 220, 120, 0.95)';  // lighter green — cavalry top-left triangle
    const borderColor = 'rgba(0, 0, 0, 0.75)';
    const symColor   = 'rgba(255, 255, 255, 0.92)';  // white symbol
    const strokeW    = tc.bold ? 3 : 1.5;
    const bw         = 1.5; // border stroke width

    // Shape dimensions — landscape orientation, front line is the longer side
    // Matches the proportions of the new in-game models (width=depth, height=front line)
    let svgW, svgH;
    if (sc.shape === 'square') {           // Century: square
        svgW = svgH = Math.round(22 * s);
    } else if (size === UnitSize.COHORT) { // Cohort: rect ~half legion area
        svgW = Math.round(34 * s);
        svgH = Math.round(18 * s);
    } else {                               // Legion: larger landscape rect
        svgW = Math.round(46 * s);
        svgH = Math.round(24 * s);
    }

    // SVG inner area bounds
    const x0 = bw / 2, y0 = bw / 2;
    const x1 = svgW - bw / 2, y1 = svgH - bw / 2;
    const cx = svgW / 2, cy = svgH / 2;

    let svgContent = '';

    // 1. Main fill rectangle (stroke drawn last so it sits on top)
    svgContent += `<rect x="${x0}" y="${y0}" width="${svgW - bw}" height="${svgH - bw}" fill="${fillColor}"/>`;

    // 2. Cavalry: lighter top-left triangle (above the '/' diagonal), matching renderer
    if (tc.symbol === '/') {
        svgContent += `<polygon points="${x0},${y0} ${x1},${y0} ${x0},${y1}" fill="${lightFill}"/>`;
    }

    // 3. Symbol — inset from edges
    const symW = cx - x0 - 3;
    const symH = cy - y0 - 2;
    if (tc.symbol === 'x') {
        svgContent += `<line x1="${cx-symW}" y1="${cy-symH}" x2="${cx+symW}" y2="${cy+symH}" stroke="${symColor}" stroke-width="${strokeW}" stroke-linecap="round"/>
                       <line x1="${cx+symW}" y1="${cy-symH}" x2="${cx-symW}" y2="${cy+symH}" stroke="${symColor}" stroke-width="${strokeW}" stroke-linecap="round"/>`;
    } else if (tc.symbol === '/') {
        // Diagonal from bottom-left to top-right, matching the renderer's '/' direction
        svgContent += `<line x1="${x0}" y1="${y1}" x2="${x1}" y2="${y0}" stroke="${symColor}" stroke-width="${strokeW}" stroke-linecap="round"/>`;
    } else if (tc.symbol === '•') {
        const dotR = Math.min(symW, symH) * 0.5;
        svgContent += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${symColor}"/>`;
    }

    // 4. Border on top so it's always visible above fill and triangle
    svgContent += `<rect x="${x0}" y="${y0}" width="${svgW - bw}" height="${svgH - bw}" fill="none" stroke="${borderColor}" stroke-width="${bw}"/>`;

    // Tier rank label: I / II / III
    const sizeRank = size === UnitSize.LEGION ? 'III' : size === UnitSize.COHORT ? 'II' : 'I';
    const tierColor = '#8b6914';
    const tierSize = small ? 10 : 12;

    return `<span class="unit-sym" style="display:inline-flex;align-items:center;gap:3px;vertical-align:middle;">
        <svg width="${svgW}" height="${svgH}" style="vertical-align:middle;">${svgContent}</svg>
        <span style="font-size:${tierSize}px;color:${tierColor};font-weight:bold;line-height:1;">${sizeRank}</span>
    </span>`;
}

// Army manager - handles player army setup and unit roster
const Army = {
    playerUnits: [],
    budget: 7000,
    remaining: 7000,
    rosterForPlacement: [],
    placementIndex: -1,

    reset() {
        this.playerUnits = [];
        this.remaining = this.budget;
        this.rosterForPlacement = [];
        this.placementIndex = -1;
        // Don't reset _unitIdCounter — prevents ghost references from old games
    },

    addUnit(unitType, unitSize) {
        const cost = SIZE_CONFIG[unitSize].strength;
        if (cost > this.remaining) return false;

        const unit = new Unit(unitType, unitSize, 'player');
        this.playerUnits.push(unit);
        this.remaining -= cost;
        return true;
    },

    removeUnit(index) {
        if (index < 0 || index >= this.playerUnits.length) return;
        const unit = this.playerUnits[index];
        this.remaining += unit.getCost();
        this.playerUnits.splice(index, 1);
    },

    getUnitOptions() {
        const options = [];
        for (const type of Object.values(UnitType)) {
            for (const size of Object.values(UnitSize)) {
                const tc = TYPE_CONFIG[type];
                const sc = SIZE_CONFIG[size];
                // Only show Legion if budget is large enough
                if (size === UnitSize.LEGION && this.budget < sc.strength) continue;
                options.push({
                    type, size,
                    label: `${tc.label} ${sc.label}`,
                    cost: sc.strength
                });
            }
        }
        return options;
    },

    renderSetupUI() {
        const container = document.getElementById('armySetup');
        const options = this.getUnitOptions();

        container.innerHTML = `
            <div class="menu-content">
                <div class="setup-header">
                    <h2>Assemble Your Legion</h2>
                    <div class="budget-selector" style="margin-bottom:12px;">
                        <label style="font-variant:small-caps; font-size:15px;">Army Strength: <strong id="budgetDisplay">${this.budget}</strong></label>
                        <input type="range" id="budgetSlider" min="2000" max="20000" step="1000" value="${this.budget}"
                            style="width:260px; margin-left:10px; vertical-align:middle; accent-color:#8b6914; cursor:pointer;">
                    </div>
                    <div class="points-display">Strength Remaining: <strong id="pointsLeft">${this.remaining}</strong> / <span id="budgetTotal">${this.budget}</span></div>
                </div>
                <div class="army-setup-grid">
                    <div class="unit-picker">
                        <h3 style="margin-bottom:10px; font-variant:small-caps;">Available Units</h3>
                        ${options.map(o => `
                            <div class="unit-option" data-type="${o.type}" data-size="${o.size}">
                                <span>${unitSymbolHTML(o.type, o.size, false)} ${o.label}</span>
                                <span class="cost">${o.cost}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div class="unit-roster">
                        <h3 style="margin-bottom:10px; font-variant:small-caps;">Your Legion</h3>
                        <div class="roster-list" id="rosterList"></div>
                    </div>
                </div>
                <button id="btnReady" class="menu-btn" ${this.playerUnits.length === 0 ? 'disabled style="opacity:0.5"' : ''}>Ready for Battle</button>
                <button id="btnBackSetup" class="menu-btn small">Back</button>
            </div>
        `;

        this._updateRosterDisplay();
        this._bindSetupEvents();
    },

    _updateRosterDisplay() {
        const list = document.getElementById('rosterList');
        if (!list) return;

        list.innerHTML = this.playerUnits.map((u, i) => `
            <div class="roster-item">
                <span>${unitSymbolHTML(u.type, u.size, true)} ${u.getDisplayInfo()}</span>
                <button class="remove-btn" data-index="${i}">Remove</button>
            </div>
        `).join('') || '<p style="color:#888; font-style:italic; padding:10px;">No units added yet</p>';

        const pointsEl = document.getElementById('pointsLeft');
        if (pointsEl) pointsEl.textContent = this.remaining;

        const readyBtn = document.getElementById('btnReady');
        if (readyBtn) {
            readyBtn.disabled = this.playerUnits.length === 0;
            readyBtn.style.opacity = this.playerUnits.length === 0 ? '0.5' : '1';
        }
    },

    _bindSetupEvents() {
        const container = document.getElementById('armySetup');

        container.querySelectorAll('.unit-option').forEach(el => {
            el.addEventListener('click', () => {
                const type = el.dataset.type;
                const size = el.dataset.size;
                if (this.addUnit(type, size)) {
                    this._updateRosterDisplay();
                }
            });
        });

        container.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-btn')) {
                const idx = parseInt(e.target.dataset.index);
                this.removeUnit(idx);
                this._updateRosterDisplay();
            }
        });

        document.getElementById('btnReady').addEventListener('click', () => {
            if (this.playerUnits.length > 0) {
                Game.setState('PLACEMENT');
            }
        });

        // Hide budget slider in multiplayer (host already chose budget)
        if (Network.isMultiplayer) {
            const slider = document.getElementById('budgetSlider');
            if (slider) slider.parentElement.style.display = 'none';
        }

        document.getElementById('budgetSlider').addEventListener('input', (e) => {
            const newBudget = parseInt(e.target.value);
            // Remove units that exceed new budget
            this.budget = newBudget;
            // Clear army when budget changes to avoid confusion
            this.playerUnits = [];
            this.remaining = this.budget;
            document.getElementById('budgetDisplay').textContent = this.budget;
            document.getElementById('budgetTotal').textContent = this.budget;
            // Re-render options (Legion visibility may change)
            this.renderSetupUI();
        });

        document.getElementById('btnBackSetup').addEventListener('click', () => {
            this.reset();
            Game.setState('MAP_SELECT');
        });
    },

    // Build grouped placement data: group units by type+size
    _buildPlacementGroups() {
        const groups = [];
        const groupMap = {};
        for (let i = 0; i < this.rosterForPlacement.length; i++) {
            const r = this.rosterForPlacement[i];
            const mercPrefix = r.unit._isMercenary ? 'merc_' : '';
            const key = `${mercPrefix}${r.unit.type}_${r.unit.size}`;
            if (!groupMap[key]) {
                groupMap[key] = { key, type: r.unit.type, size: r.unit.size, isMerc: !!r.unit._isMercenary, indices: [], placed: 0 };
                groups.push(groupMap[key]);
            }
            groupMap[key].indices.push(i);
            if (r.placed) groupMap[key].placed++;
        }
        return groups;
    },

    _updatePlacementUI() {
        const groups = this._buildPlacementGroups();
        const container = document.getElementById('placementRoster');
        if (!container) return;

        container.innerHTML = groups.map((g, gi) => {
            const tc = TYPE_CONFIG[g.type];
            const sc = SIZE_CONFIG[g.size];
            const total = g.indices.length;
            const remaining = total - g.placed;
            const allDone = remaining === 0;
            const mercLabel = g.isMerc ? 'Merc. ' : '';
            const label = `${mercLabel}${tc.label} ${sc.label}`;
            const sym = unitSymbolHTML(g.type, g.size, true);
            return `<div class="placement-unit ${allDone ? 'placed' : ''} ${this._activeGroupKey === g.key ? 'selected' : ''}" data-group="${g.key}">
                ${sym} ${label} <span style="opacity:0.7">(${remaining} left)</span>
            </div>`;
        }).join('');

        // Re-bind clicks
        container.querySelectorAll('.placement-unit').forEach(el => {
            el.addEventListener('click', () => {
                const key = el.dataset.group;
                const group = groups.find(g => g.key === key);
                if (!group || group.placed >= group.indices.length) return;

                container.querySelectorAll('.placement-unit').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
                this._activeGroupKey = key;
                // Set placementIndex to next unplaced unit in this group
                const nextIdx = group.indices.find(i => !this.rosterForPlacement[i].placed);
                this.placementIndex = nextIdx !== undefined ? nextIdx : -1;
            });
        });
    },

    renderPlacementUI() {
        const container = document.getElementById('placementUI');
        this.rosterForPlacement = this.playerUnits.map((u, i) => ({ unit: u, placed: false, index: i }));
        this._activeGroupKey = null;

        container.innerHTML = `
            <div class="placement-roster" id="placementRoster"></div>
            <div style="display:flex; gap:10px; align-items:center;">
                <span id="placementHint" style="font-style:italic; margin-right:10px;">Select a unit type, then click the map to place it</span>
                <button id="btnBackPlacement" class="menu-btn small" style="font-size:11px; padding:4px 10px;">Back</button>
                <button id="btnStartBattle" class="menu-btn small" disabled style="opacity:0.5">Start Battle</button>
            </div>
        `;

        this._updatePlacementUI();
        this._bindPlacementEvents();
    },

    _bindPlacementEvents() {
        document.getElementById('btnStartBattle').addEventListener('click', () => {
            const allPlaced = this.rosterForPlacement.every(r => r.placed);
            if (!allPlaced) return;

            if (Network.isMultiplayer) {
                // Send ready with army positions
                const armyData = this.playerUnits.map(u => ({
                    type: u.type, size: u.size,
                    x: Math.round(u.x), y: Math.round(u.y)
                }));
                Network.sendReady(armyData);
                // Show waiting message
                const btn = document.getElementById('btnStartBattle');
                btn.textContent = 'Waiting for opponent...';
                btn.disabled = true;
                btn.style.opacity = '0.5';

                // If peer is already ready, start immediately
                if (Network._peerReady && Network._peerArmy) {
                    Game._mpCreateOpponentArmy(Network._peerArmy);
                    if (Network.isHost) {
                        Network.sendBattleStart();
                        Game.setState('BATTLE');
                    }
                }
            } else {
                Game.setState('BATTLE');
            }
        });
        document.getElementById('btnBackPlacement').addEventListener('click', () => {
            if (Network.isMultiplayer) Network.sendUnready();
            Game.setState('ARMY_SETUP');
        });
    },

    placeCurrentUnit(x, y) {
        if (this.placementIndex < 0) return false;
        const roster = this.rosterForPlacement[this.placementIndex];
        if (!roster || roster.placed) return false;

        // Placement zone check — ambush map uses circular center zone
        if (GameMap.mapType === 'ambush') {
            const cx = GameMap.width / 2, cy = GameMap.height / 2;
            const dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
            if (dist > 250) return false; // circular zone radius 250px
        } else if (Network.isMultiplayer && !Network.isHost) {
            // Guest: right 1/6 of map
            if (x < GameMap.width * 5 / 6) return false;
        } else {
            // Default: left 1/6 of map
            if (x > GameMap.width / 6) return false;
        }

        // Prevent overlapping with already-placed units
        const placingRadius = roster.unit.getCollisionRadius();
        for (const r2 of this.rosterForPlacement) {
            if (!r2.placed || r2 === roster) continue;
            const dx = r2.unit.x - x;
            const dy = r2.unit.y - y;
            if (Math.sqrt(dx * dx + dy * dy) < placingRadius + r2.unit.getCollisionRadius() + 4) return false;
        }

        roster.unit.x = x;
        roster.unit.y = y;
        roster.placed = true;
        // Guest units face left (toward the host side)
        if (Network.isMultiplayer && !Network.isHost) {
            roster.unit.angle = Math.PI;
        }

        // Auto-advance to next unplaced unit in same group
        if (this._activeGroupKey) {
            const groups = this._buildPlacementGroups();
            const group = groups.find(g => g.key === this._activeGroupKey);
            if (group) {
                const nextIdx = group.indices.find(i => !this.rosterForPlacement[i].placed);
                this.placementIndex = nextIdx !== undefined ? nextIdx : -1;
                if (this.placementIndex < 0) this._activeGroupKey = null;
            }
        } else {
            this.placementIndex = -1;
        }

        // Update placement UI
        this._updatePlacementUI();

        // Check if all placed
        const allPlaced = this.rosterForPlacement.every(r => r.placed);
        const btn = document.getElementById('btnStartBattle');
        if (btn && allPlaced) {
            btn.disabled = false;
            btn.style.opacity = '1';
            document.getElementById('placementHint').textContent = 'All placed! Click units to select, right-click to set orders.';
        }

        return true;
    }
};
