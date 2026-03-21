// Input handling
const Input = {
    mouseX: 0,
    mouseY: 0,
    gameX: 0,
    gameY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragThreshold: 5,
    draggingPlacedUnit: null,
    _dragOrigX: 0,
    _dragOrigY: 0,
    _attackMoveMode: false,
    _rightDragActive: false, // true only when right-button down without shift
    _rightDragging: false,
    _rightDragStartX: 0,
    _rightDragStartY: 0,
    _lineDragPreview: null,
    _rightDragConsumed: false,

    init() {
        const canvas = Renderer.canvas;

        canvas.addEventListener('mousemove', (e) => {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
            const g = Renderer.screenToGame(e.clientX, e.clientY);
            this.gameX = g.x;
            this.gameY = g.y;
        });

        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // left click
                const g = Renderer.screenToGame(e.clientX, e.clientY);
                this.dragStartX = g.x;
                this.dragStartY = g.y;
                this.isDragging = false;
                this.draggingPlacedUnit = null;

                // During placement, check if clicking on a placed unit to drag-reposition
                if (Game.state === 'PLACEMENT') {
                    for (const r of Army.rosterForPlacement) {
                        if (!r.placed) continue;
                        const dx = r.unit.x - g.x;
                        const dy = r.unit.y - g.y;
                        if (Math.sqrt(dx * dx + dy * dy) < r.unit.getCollisionRadius() + 8) {
                            this.draggingPlacedUnit = r.unit;
                            this._dragOrigX = r.unit.x;
                            this._dragOrigY = r.unit.y;
                            break;
                        }
                    }
                }
            } else if (e.button === 2 && !e.shiftKey) {
                const g = Renderer.screenToGame(e.clientX, e.clientY);
                this._rightDragActive = true;
                this._rightDragStartX = g.x;
                this._rightDragStartY = g.y;
                this._rightDragging = false;
                this._lineDragPreview = null;
            } else if (e.button === 2 && e.shiftKey) {
                this._rightDragActive = false;
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (e.buttons & 1) {
                const g = Renderer.screenToGame(e.clientX, e.clientY);
                const dx = g.x - this.dragStartX;
                const dy = g.y - this.dragStartY;
                if (Math.sqrt(dx * dx + dy * dy) > this.dragThreshold) {
                    this.isDragging = true;
                }

                // Drag-reposition placed unit during placement
                if (this.draggingPlacedUnit && this.isDragging) {
                    const cr = this.draggingPlacedUnit.getCollisionRadius();
                    if (GameMap.mapType === 'ambush') {
                        // Clamp to circular zone
                        const cx = GameMap.width / 2, cy = GameMap.height / 2;
                        const dx = g.x - cx, dy = g.y - cy;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist > 250 - cr) {
                            const scale = (250 - cr) / dist;
                            this.draggingPlacedUnit.x = cx + dx * scale;
                            this.draggingPlacedUnit.y = cy + dy * scale;
                        } else {
                            this.draggingPlacedUnit.x = g.x;
                            this.draggingPlacedUnit.y = g.y;
                        }
                    } else if (Network.isMultiplayer && !Network.isHost) {
                        const zoneW = GameMap.width / 6;
                        const zoneStart = GameMap.width - zoneW;
                        this.draggingPlacedUnit.x = Math.max(zoneStart + cr, Math.min(GameMap.width - cr, g.x));
                        this.draggingPlacedUnit.y = Math.max(cr, Math.min(GameMap.height - cr, g.y));
                    } else {
                        const zoneW = GameMap.width / 6;
                        this.draggingPlacedUnit.x = Math.max(cr, Math.min(zoneW - cr, g.x));
                        this.draggingPlacedUnit.y = Math.max(cr, Math.min(GameMap.height - cr, g.y));
                    }
                }
            }
            // Right-button drag detection for line formation (only when not shift-clicking for waypoints)
            if ((e.buttons & 2) && this._rightDragActive) {
                const g = Renderer.screenToGame(e.clientX, e.clientY);
                const dx = g.x - this._rightDragStartX;
                const dy = g.y - this._rightDragStartY;
                if (Math.sqrt(dx * dx + dy * dy) > this.dragThreshold) {
                    this._rightDragging = true;
                }
                if (this._rightDragging) {
                    const selected = Army.playerUnits.filter(u =>
                        Game.state === 'BATTLE' ? u.alive && u.selected : u.selected);
                    if (selected.length > 1) {
                        this._lineDragPreview = this._computeLinePositions(
                            this._rightDragStartX, this._rightDragStartY,
                            g.x, g.y, selected);
                    } else {
                        this._lineDragPreview = null;
                    }
                }
            }
        });

        canvas.addEventListener('mouseup', (e) => {
            const g = Renderer.screenToGame(e.clientX, e.clientY);

            if (e.button === 0) { // left click
                if (Game.state === 'PLACEMENT') {
                    if (this.draggingPlacedUnit && this.isDragging) {
                        // Finalize drag-reposition — check collision at final position
                        const u = this.draggingPlacedUnit;
                        const cr = u.getCollisionRadius();
                        let collides = false;
                        for (const r of Army.rosterForPlacement) {
                            if (!r.placed || r.unit === u) continue;
                            const ddx = r.unit.x - u.x;
                            const ddy = r.unit.y - u.y;
                            if (Math.sqrt(ddx * ddx + ddy * ddy) < cr + r.unit.getCollisionRadius() + 4) {
                                collides = true;
                                break;
                            }
                        }
                        if (collides) {
                            // Snap back to original position
                            u.x = this._dragOrigX;
                            u.y = this._dragOrigY;
                        }
                        this.draggingPlacedUnit = null;
                    } else {
                        const allPlaced = Army.rosterForPlacement.every(r => r.placed);
                        if (this.isDragging && allPlaced) {
                            // Multi-select box during placement
                            this._handleSelectionBox(this.dragStartX, this.dragStartY, g.x, g.y);
                        } else {
                            this._handlePlacementClick(g.x, g.y, e.shiftKey);
                        }
                    }
                } else if (Game.state === 'BATTLE') {
                    if (this.isDragging) {
                        this._handleSelectionBox(this.dragStartX, this.dragStartY, g.x, g.y);
                    } else {
                        this._handleUnitSelect(g.x, g.y, e.shiftKey);
                    }
                }
                this.isDragging = false;
            } else if (e.button === 2) {
                if (this._rightDragging && this._lineDragPreview && this._lineDragPreview.length > 1) {
                    const selected = Army.playerUnits.filter(u =>
                        Game.state === 'BATTLE' ? u.alive && u.selected : u.selected);
                    if (selected.length > 1) {
                        this._applyLineDragPositions(selected, this._lineDragPreview);
                    }
                    this._rightDragConsumed = true;
                }
                this._rightDragging = false;
                this._rightDragActive = false;
                this._lineDragPreview = null;
            }
        });

        // Keyboard hotkeys for unit selection (1-9), retreat (R), select all (Ctrl+A)
        document.addEventListener('keydown', (e) => {
            if (Game.spectatorMode) return;
            const key = e.key.toLowerCase();

            // Number keys: select units (works in BATTLE and PLACEMENT when all placed)
            if (key >= '1' && key <= '9') {
                const inBattle = Game.state === 'BATTLE';
                const inPlacement = Game.state === 'PLACEMENT' && Army.rosterForPlacement.every(r => r.placed);
                if (!inBattle && !inPlacement) return;

                const idx = parseInt(key) - 1;
                if (idx < Army.playerUnits.length) {
                    const unit = Army.playerUnits[idx];
                    if (inBattle && !unit.alive) return;
                    if (e.shiftKey) {
                        unit.selected = !unit.selected;
                    } else {
                        for (const u of Army.playerUnits) u.selected = false;
                        unit.selected = true;
                    }
                }
                return;
            }

            // R key: retreat selected units
            if (key === 'r' && Game.state === 'BATTLE') {
                this._handleRetreat();
                return;
            }

            // H key: toggle hold ground for selected units
            if (key === 'h' && Game.state === 'BATTLE') {
                const selected = Army.playerUnits.filter(u => u.alive && u.selected);
                if (selected.length > 0) {
                    const anyHolding = selected.some(u => u.holdGround);
                    for (const u of selected) {
                        u.holdGround = !anyHolding;
                        if (u.holdGround) {
                            u.targetX = null;
                            u.targetY = null;
                        }
                    }
                }
                return;
            }

            // D key: toggle dig mode for selected legions
            if (key === 'd' && Game.state === 'BATTLE') {
                this._handleDigToggle();
                return;
            }

            // Ctrl+A or Cmd+A: select all alive units
            if (key === 'a' && (e.ctrlKey || e.metaKey)) {
                if (Game.state === 'BATTLE' || (Game.state === 'PLACEMENT' && Army.rosterForPlacement.every(r => r.placed))) {
                    e.preventDefault();
                    for (const u of Army.playerUnits) {
                        if (u.alive) u.selected = true;
                    }
                }
                return;
            }

            // A key (no ctrl): toggle attack-move mode
            if (key === 'a' && !e.ctrlKey && !e.metaKey && Game.state === 'BATTLE') {
                this._attackMoveMode = true;
                return;
            }

            // G key: rally nearby routing friendlies
            if (key === 'g' && Game.state === 'BATTLE') {
                this._handleRally();
                return;
            }

            // F key: cycle formation
            if (key === 'f' && Game.state === 'BATTLE') {
                const formations = ['grid', 'line', 'column', 'wedge'];
                const labels = { grid: '▣ Grid', line: '═ Line', column: '║ Column', wedge: '◁ Wedge' };
                const idx = formations.indexOf(Game.currentFormation || 'grid');
                Game.currentFormation = formations[(idx + 1) % formations.length];
                const btn = document.getElementById('btnFormation');
                if (btn) btn.textContent = labels[Game.currentFormation];
                return;
            }
        });

        // A key release: clear attack-move mode
        document.addEventListener('keyup', (e) => {
            if (e.key.toLowerCase() === 'a') {
                this._attackMoveMode = false;
            }
        });

        // Right click for move commands (works in BATTLE and PLACEMENT for pre-orders)
        // Shift+right-click queues waypoints
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this._rightDragConsumed) {
                this._rightDragConsumed = false;
                return;
            }
            if (Game.state === 'BATTLE') {
                const g = Renderer.screenToGame(e.clientX, e.clientY);
                if (e.shiftKey) {
                    this._handleQueueWaypoint(g.x, g.y);
                } else {
                    this._handleMoveCommand(g.x, g.y);
                }
            } else if (Game.state === 'PLACEMENT') {
                const allPlaced = Army.rosterForPlacement.every(r => r.placed);
                if (allPlaced) {
                    const g = Renderer.screenToGame(e.clientX, e.clientY);
                    this._handlePlacementOrder(g.x, g.y);
                }
            }
        });
    },

    _handlePlacementClick(gx, gy, shiftKey) {
        if (Game.spectatorMode) return;
        // If all units are placed, allow selecting placed units (for pre-battle orders)
        const allPlaced = Army.rosterForPlacement.every(r => r.placed);
        if (allPlaced) {
            // Check if clicking on a placed unit
            let clicked = null;
            for (const r of Army.rosterForPlacement) {
                const u = r.unit;
                const dx = u.x - gx;
                const dy = u.y - gy;
                if (Math.sqrt(dx * dx + dy * dy) < u.getCollisionRadius() + 5) {
                    clicked = u;
                    break;
                }
            }
            if (clicked) {
                if (shiftKey) {
                    clicked.selected = !clicked.selected;
                } else {
                    for (const u of Army.playerUnits) u.selected = false;
                    clicked.selected = true;
                }
            } else if (!shiftKey) {
                for (const u of Army.playerUnits) u.selected = false;
            }
            return;
        }
        // Normal placement
        Army.placeCurrentUnit(gx, gy);
    },

    _handleUnitSelect(gx, gy, shiftKey) {
        if (Game.spectatorMode) return;
        // Check if clicking on a player unit
        let clicked = null;
        for (const unit of Army.playerUnits) {
            if (!unit.alive) continue;
            const dx = unit.x - gx;
            const dy = unit.y - gy;
            if (Math.sqrt(dx * dx + dy * dy) < unit.getCollisionRadius() + 5) {
                clicked = unit;
                break;
            }
        }

        // Deselect all unless shift held
        if (!clicked) {
            if (!shiftKey) {
                for (const u of Army.playerUnits) u.selected = false;
            }
            return;
        }

        // Shift: toggle individual selection. No shift: exclusive selection.
        if (shiftKey) {
            clicked.selected = !clicked.selected;
        } else {
            for (const u of Army.playerUnits) u.selected = false;
            clicked.selected = true;
        }
    },

    _handleSelectionBox(x1, y1, x2, y2) {
        const left = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const top = Math.min(y1, y2);
        const bottom = Math.max(y1, y2);

        for (const unit of Army.playerUnits) {
            if (!unit.alive) continue;
            unit.selected = (unit.x >= left && unit.x <= right && unit.y >= top && unit.y <= bottom);
        }
    },

    _handleMoveCommand(gx, gy) {
        if (Game.spectatorMode) return;
        const selected = Army.playerUnits.filter(u => u.alive && u.selected);
        if (selected.length === 0) return;

        // Guest: send command to host instead of executing locally
        if (Network.isMultiplayer && !Network.isHost) {
            Network.sendCommand({
                type: 'move',
                unitIds: selected.map(u => u.netId),
                x: gx, y: gy,
                formation: Game.currentFormation
            });
            return;
        }

        // Check if right-clicking on an enemy unit
        let targetEnemy = null;
        for (const eu of AI.units) {
            if (!eu.alive) continue;
            const dx = eu.x - gx;
            const dy = eu.y - gy;
            if (Math.sqrt(dx * dx + dy * dy) < eu.getCollisionRadius() + 10) {
                targetEnemy = eu;
                break;
            }
        }

        // Disengage any units currently in combat, clear hold ground
        for (const u of selected) {
            if (u.inCombat) {
                Combat.disengage(u);
            }
            u.holdGround = false; // Moving cancels hold ground
            u.targetQueue = []; // Clear waypoint queue on new command
            u.idleTime = 0; // Reset idle timer on manual command
        }

        // Assign targets
        for (const u of selected) {
            let destX = gx, destY = gy;

            // Archers: if targeting an enemy, stop at shooting range instead of walking into melee
            if (targetEnemy && u.category === 'archers' && u.range > 0) {
                const dx = targetEnemy.x - u.x;
                const dy = targetEnemy.y - u.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const stopDist = u.range * 0.85; // stop a bit inside max range for safety margin

                if (dist > stopDist) {
                    // Move toward enemy but stop at range
                    const ratio = (dist - stopDist) / dist;
                    destX = u.x + dx * ratio;
                    destY = u.y + dy * ratio;
                } else {
                    // Already in range — don't move, just face the enemy
                    destX = u.x;
                    destY = u.y;
                }
            }

            u.targetX = destX;
            u.targetY = destY;

            // Attack-move flag
            if (this._attackMoveMode && !targetEnemy) {
                u.attackMove = true;
                u.attackMoveTarget = { x: destX, y: destY };
            } else {
                u.attackMove = false;
                u.attackMoveTarget = null;
            }
        }

        // Formation spread for multi-select ground moves (no enemy target)
        if (!targetEnemy && selected.length > 1) {
            this._applyFormation(selected, gx, gy);
        }
    },

    _applyFormation(selected, gx, gy) {
        const formation = Game.currentFormation || 'grid';
        const spacing = 50;
        const n = selected.length;

        // Compute direction from centroid to destination
        let cx = 0, cy = 0;
        for (const u of selected) { cx += u.x; cy += u.y; }
        cx /= n; cy /= n;
        const ddx = gx - cx, ddy = gy - cy;
        const dirLen = Math.sqrt(ddx * ddx + ddy * ddy);
        const dirX = dirLen > 5 ? ddx / dirLen : 1;
        const dirY = dirLen > 5 ? ddy / dirLen : 0;
        const perpX = -dirY, perpY = dirX;

        // Compute target positions for each slot
        const positions = [];
        switch (formation) {
            case 'line': {
                for (let i = 0; i < n; i++) {
                    const offset = (i - (n - 1) / 2) * spacing;
                    positions.push({ x: gx + perpX * offset, y: gy + perpY * offset });
                }
                break;
            }
            case 'column': {
                for (let i = 0; i < n; i++) {
                    const offset = -i * spacing;
                    positions.push({ x: gx + dirX * offset, y: gy + dirY * offset });
                }
                break;
            }
            case 'wedge': {
                positions.push({ x: gx, y: gy });
                for (let i = 1; i < n; i++) {
                    const row = Math.ceil(i / 2);
                    const side = (i % 2 === 1) ? 1 : -1;
                    const backOffset = -row * spacing * 0.7;
                    const sideOffset = row * spacing * 0.6 * side;
                    positions.push({
                        x: gx + dirX * backOffset + perpX * sideOffset,
                        y: gy + dirY * backOffset + perpY * sideOffset
                    });
                }
                break;
            }
            default: { // grid
                const cols = Math.ceil(Math.sqrt(n));
                for (let i = 0; i < n; i++) {
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    positions.push({
                        x: gx + (col - cols / 2) * spacing,
                        y: gy + (row - Math.floor(n / cols) / 2) * spacing
                    });
                }
            }
        }

        // Assign units to nearest positions to avoid crossing paths
        const assignment = this._matchUnitsToPositions(selected, positions);
        for (let p = 0; p < assignment.length; p++) {
            selected[assignment[p]].targetX = positions[p].x;
            selected[assignment[p]].targetY = positions[p].y;
        }

        // Update attack-move targets if active
        if (this._attackMoveMode) {
            for (const u of selected) {
                u.attackMoveTarget = { x: u.targetX, y: u.targetY };
            }
        }
    },

    _handlePlacementOrder(gx, gy) {
        // Pre-battle orders: set waypoints for placed units during placement
        const selected = Army.playerUnits.filter(u => u.selected);
        if (selected.length === 0) return;

        if (selected.length === 1) {
            selected[0].targetX = gx;
            selected[0].targetY = gy;
        } else {
            this._applyFormation(selected, gx, gy);
        }
    },

    _handleQueueWaypoint(gx, gy) {
        if (Game.spectatorMode) return;
        const selected = Army.playerUnits.filter(u => u.alive && u.selected);
        if (selected.length === 0) return;

        // Guest: send command to host
        if (Network.isMultiplayer && !Network.isHost) {
            Network.sendCommand({
                type: 'waypoint',
                unitIds: selected.map(u => u.netId),
                x: gx, y: gy
            });
            return;
        }

        if (selected.length === 1) {
            const u = selected[0];
            if (u.targetX === null) {
                // No current target — set as primary target
                u.targetX = gx;
                u.targetY = gy;
            } else {
                // Has target — queue this as next waypoint
                u.targetQueue.push({ x: gx, y: gy });
            }
        } else {
            // Multi-unit: queue with formation spread
            const cols = Math.ceil(Math.sqrt(selected.length));
            const spacing = 50;
            selected.forEach((u, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const wx = gx + (col - cols / 2) * spacing;
                const wy = gy + (row - Math.floor(selected.length / cols) / 2) * spacing;
                if (u.targetX === null) {
                    u.targetX = wx;
                    u.targetY = wy;
                } else {
                    u.targetQueue.push({ x: wx, y: wy });
                }
            });
        }
    },

    _handleDigToggle() {
        if (Game.spectatorMode) return;
        const selected = Army.playerUnits.filter(u => u.alive && u.selected && u.size === UnitSize.LEGION);
        if (selected.length === 0) return;
        if (Network.isMultiplayer && !Network.isHost) {
            Network.sendCommand({ type: 'dig', unitIds: selected.map(u => u.netId) });
            return;
        }
        for (const u of selected) {
            if (u.digging) {
                // Stop digging — nudge past ditch edge
                u._stopDiggingAndNudge();
            } else {
                // Start digging — create a new ditch trail
                // Ditch width: fixed 32px
                const ditchWidth = 32;
                u.digging = true;
                u.currentDitch = GameMap.startDitch(u.x, u.y, ditchWidth);
            }
        }
    },

    _handleRetreat() {
        if (Game.spectatorMode) return;
        const selected = Army.playerUnits.filter(u => u.alive && u.selected);
        if (selected.length === 0) return;
        if (Network.isMultiplayer && !Network.isHost) {
            Network.sendCommand({ type: 'retreat', unitIds: selected.map(u => u.netId) });
            return;
        }
        // Retreat selected units: disengage and move toward player side (left)
        for (const u of selected) {
            if (u.inCombat) {
                Combat.disengage(u);
            }
            // Cancel dig mode on retreat — nudge past ditch
            if (u.digging) {
                u._stopDiggingAndNudge();
            }
            // Retreat toward the left side, keeping roughly same Y
            u.targetX = Math.max(50, u.x - 200);
            u.targetY = u.y;
            u.idleTime = 0;
        }
    },

    _handleRally() {
        if (Game.spectatorMode) return;
        const selected = Army.playerUnits.filter(u => u.alive && u.selected && u.canRally());
        if (selected.length === 0) return;
        if (Network.isMultiplayer && !Network.isHost) {
            Network.sendCommand({ type: 'rally', unitIds: selected.map(u => u.netId) });
            return;
        }
        for (const rallier of selected) {
            let rallied = 0;
            for (const u of Army.playerUnits) {
                if (!u.alive || !u.routing) continue;
                const dx = u.x - rallier.x, dy = u.y - rallier.y;
                if (Math.sqrt(dx * dx + dy * dy) > 150) continue;
                u.unrout();
                u.morale = Math.min(100, u.morale + 30);
                rallied++;
            }
            if (rallied > 0) {
                rallier.rallyCooldown = 30;
                Renderer.rallyEffects.push({ x: rallier.x, y: rallier.y, time: 1.0 });
                const tc = TYPE_CONFIG[rallier.type], sc = SIZE_CONFIG[rallier.size];
                const label = (tc ? tc.label : 'Unit') + ' ' + (sc ? sc.label : '');
                Renderer.addBattleLogEntry(`${label} rallied nearby units!`, '#6090d0');
            }
        }
    },

    getSelectionBox() {
        if (!this.isDragging) return null;
        return {
            x1: this.dragStartX,
            y1: this.dragStartY,
            x2: this.gameX,
            y2: this.gameY
        };
    },

    getLineDragPreview() {
        if (!this._rightDragging || !this._lineDragPreview) return null;
        return this._lineDragPreview;
    },

    _computeLinePositions(startX, startY, endX, endY, units) {
        const n = units.length;
        if (n === 0) return [];
        if (n === 1) return [{ x: startX, y: startY }];
        const positions = [];
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            positions.push({
                x: startX + (endX - startX) * t,
                y: startY + (endY - startY) * t
            });
        }
        return positions;
    },

    _matchUnitsToPositions(units, positions) {
        // Greedy nearest assignment: minimizes path crossing
        const n = Math.min(units.length, positions.length);
        const assignment = new Array(n);
        const used = new Uint8Array(n);
        for (let p = 0; p < n; p++) {
            let bestUnit = -1, bestDist = Infinity;
            for (let u = 0; u < n; u++) {
                if (used[u]) continue;
                const dx = units[u].x - positions[p].x;
                const dy = units[u].y - positions[p].y;
                const d = dx * dx + dy * dy;
                if (d < bestDist) { bestDist = d; bestUnit = u; }
            }
            assignment[p] = bestUnit;
            used[bestUnit] = 1;
        }
        return assignment; // assignment[posIndex] = unitIndex
    },

    _applyLineDragPositions(selected, positions) {
        const assignment = this._matchUnitsToPositions(selected, positions);
        if (Game.state === 'BATTLE') {
            for (let p = 0; p < assignment.length; p++) {
                const u = selected[assignment[p]];
                if (u.inCombat) Combat.disengage(u);
                u.holdGround = false;
                u.targetQueue = [];
                u.idleTime = 0;
                u.targetX = positions[p].x;
                u.targetY = positions[p].y;
                u.attackMove = false;
                u.attackMoveTarget = null;
            }
        } else if (Game.state === 'PLACEMENT') {
            const allPlaced = Army.rosterForPlacement.every(r => r.placed);
            if (allPlaced) {
                for (let p = 0; p < assignment.length; p++) {
                    selected[assignment[p]].targetX = positions[p].x;
                    selected[assignment[p]].targetY = positions[p].y;
                }
            }
        }
    }
};
