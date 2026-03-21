// AI opponent
const AI = {
    units: [],
    budget: 7000,
    scouts: [],        // designated scout units
    scoutWaypoints: [], // patrol waypoints for scouts
    scoutPhase: 0,     // current waypoint index

    generateArmy() {
        this.units = [];
        let remaining = this.budget;

        // Strategy: weighted mix of unit types
        const compositions = [
            { type: UnitType.HEAVY_INFANTRY, size: UnitSize.COHORT, weight: 3 },
            { type: UnitType.LIGHT_INFANTRY, size: UnitSize.COHORT, weight: 2 },
            { type: UnitType.LIGHT_CAVALRY, size: UnitSize.COHORT, weight: 2 },
            { type: UnitType.HEAVY_CAVALRY, size: UnitSize.CENTURY, weight: 2 },
            { type: UnitType.ARCHERS, size: UnitSize.COHORT, weight: 2 },
            { type: UnitType.LIGHT_INFANTRY, size: UnitSize.CENTURY, weight: 3 },
            { type: UnitType.ARCHERS, size: UnitSize.CENTURY, weight: 2 },
        ];

        // Build weighted pool
        const totalWeight = compositions.reduce((sum, c) => sum + c.weight, 0);

        let attempts = 0;
        while (remaining > 0 && attempts < 100) {
            // Weighted random pick
            let roll = Math.random() * totalWeight;
            let pick = compositions[0];
            for (const c of compositions) {
                roll -= c.weight;
                if (roll <= 0) { pick = c; break; }
            }

            const cost = SIZE_CONFIG[pick.size].strength;
            if (cost <= remaining) {
                const unit = new Unit(pick.type, pick.size, 'enemy');
                this.units.push(unit);
                remaining -= cost;
            }
            attempts++;
        }

        // Fill remainder with centuries
        while (remaining >= 80) {
            const types = [UnitType.LIGHT_INFANTRY, UnitType.ARCHERS, UnitType.LIGHT_CAVALRY];
            const unit = new Unit(types[Math.floor(Math.random() * types.length)], UnitSize.CENTURY, 'enemy');
            this.units.push(unit);
            remaining -= 80;
        }
    },

    placeUnits() {
        // Ambush map: split units between left and right flanks
        if (GameMap.mapType === 'ambush') {
            this._placeUnitsAmbush();
            return;
        }
        const rightStart = GameMap.width * (5 / 6);
        const rightEnd = GameMap.width * 0.97;
        const topMargin = 80;
        const bottomMargin = GameMap.height - 80;
        const midY = GameMap.height / 2;
        const formationDepth = (rightEnd - rightStart);

        const archers = this.units.filter(u => u.category === 'archers');
        const infantry = this.units.filter(u => u.category === 'infantry');
        const cavalry = this.units.filter(u => u.category === 'cavalry');

        // Standard formation: infantry front line, archers behind, cavalry on flanks
        // Infantry: front line spread vertically in the center
        const infFrontX = rightStart + formationDepth * 0.25;
        const infSpread = (bottomMargin - topMargin - 100) / Math.max(infantry.length, 1);
        infantry.forEach((u, i) => {
            u.x = infFrontX + (Math.random() - 0.5) * 30;
            u.y = topMargin + 50 + infSpread * (i + 0.5);
            u.angle = Math.PI; // face left toward enemy
        });

        // Archers: behind infantry in a line
        const archBackX = rightStart + formationDepth * 0.65;
        const archSpread = (bottomMargin - topMargin - 100) / Math.max(archers.length, 1);
        archers.forEach((u, i) => {
            u.x = archBackX + (Math.random() - 0.5) * 20;
            u.y = topMargin + 50 + archSpread * (i + 0.5);
            u.angle = Math.PI;
        });

        // Cavalry: split between top and bottom flanks
        const halfCav = Math.ceil(cavalry.length / 2);
        const cavFrontX = rightStart + formationDepth * 0.2;
        cavalry.slice(0, halfCav).forEach((u, i) => {
            u.x = cavFrontX + (Math.random() - 0.5) * 20;
            u.y = topMargin + 20 + i * 50;
            u.angle = Math.PI;
        });
        cavalry.slice(halfCav).forEach((u, i) => {
            u.x = cavFrontX + (Math.random() - 0.5) * 20;
            u.y = bottomMargin - 20 - i * 50;
            u.angle = Math.PI;
        });

        // Resolve any overlaps
        this._resolveOverlaps(this.units);
    },

    // Push apart any overlapping placed units
    _resolveOverlaps(units) {
        for (let pass = 0; pass < 10; pass++) {
            let moved = false;
            for (let i = 0; i < units.length; i++) {
                for (let j = i + 1; j < units.length; j++) {
                    const a = units[i], b = units[j];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minD = a.getCollisionRadius() + b.getCollisionRadius() + 6;
                    if (dist < minD && dist > 0.1) {
                        const push = (minD - dist) / 2 + 1;
                        const nx = dx / dist, ny = dy / dist;
                        a.x -= nx * push; a.y -= ny * push;
                        b.x += nx * push; b.y += ny * push;
                        moved = true;
                    }
                }
            }
            if (!moved) break;
        }
        // Clamp all to map
        const rS = GameMap.width * (5 / 6), rE = GameMap.width * 0.97;
        for (const u of units) {
            const r = u.getCollisionRadius();
            u.x = Math.max(rS + r, Math.min(rE - r, u.x));
            u.y = Math.max(r + 10, Math.min(GameMap.height - r - 10, u.y));
        }
    },

    // Ambush placement: split AI units between left and right edges
    _placeUnitsAmbush() {
        const leftX = GameMap.width * 0.05;
        const leftEnd = GameMap.width * 0.18;
        const rightX = GameMap.width * 0.82;
        const rightEnd = GameMap.width * 0.95;
        const topM = 80, botM = GameMap.height - 80;
        const midY = GameMap.height / 2;

        // Split units roughly 50/50 between left and right flanks
        const leftUnits = [], rightUnits = [];
        this.units.forEach((u, i) => {
            if (i % 2 === 0) leftUnits.push(u);
            else rightUnits.push(u);
        });

        // Place left flank
        const leftSpread = (botM - topM) / Math.max(leftUnits.length, 1);
        leftUnits.forEach((u, i) => {
            u.x = leftX + Math.random() * (leftEnd - leftX);
            u.y = topM + leftSpread * (i + 0.5) + (Math.random() - 0.5) * 20;
            u.angle = 0; // face right toward center
        });

        // Place right flank
        const rightSpread = (botM - topM) / Math.max(rightUnits.length, 1);
        rightUnits.forEach((u, i) => {
            u.x = rightX + Math.random() * (rightEnd - rightX);
            u.y = topM + rightSpread * (i + 0.5) + (Math.random() - 0.5) * 20;
            u.angle = Math.PI; // face left toward center
        });

        // Resolve overlaps — custom clamp for ambush (no right-side-only constraint)
        for (let pass = 0; pass < 10; pass++) {
            let moved = false;
            for (let i = 0; i < this.units.length; i++) {
                for (let j = i + 1; j < this.units.length; j++) {
                    const a = this.units[i], b = this.units[j];
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minD = a.getCollisionRadius() + b.getCollisionRadius() + 6;
                    if (dist < minD && dist > 0.1) {
                        const push = (minD - dist) / 2 + 1;
                        const nx = dx / dist, ny = dy / dist;
                        a.x -= nx * push; a.y -= ny * push;
                        b.x += nx * push; b.y += ny * push;
                        moved = true;
                    }
                }
            }
            if (!moved) break;
        }
        for (const u of this.units) {
            const r = u.getCollisionRadius();
            u.x = Math.max(r + 10, Math.min(GameMap.width - r - 10, u.x));
            u.y = Math.max(r + 10, Math.min(GameMap.height - r - 10, u.y));
        }
    },

    // Place units near terrain features (forests or hills)
    _placeNearTerrain(units, terrainZones, xMin, xMax, yMin, yMax, facing) {
        for (let i = 0; i < units.length; i++) {
            const u = units[i];
            // Pick a terrain zone (round-robin)
            const zone = terrainZones[i % terrainZones.length];
            // Place within or near the zone
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * zone.radius * 0.7;
            u.x = zone.x + Math.cos(angle) * dist;
            u.y = zone.y + Math.sin(angle) * dist;
            // Clamp to placement area
            u.x = Math.max(xMin, Math.min(xMax, u.x));
            u.y = Math.max(yMin, Math.min(yMax, u.y));
            u.angle = facing;

            // Avoid overlap with already-placed units
            for (let j = 0; j < i; j++) {
                const other = units[j];
                const dx = u.x - other.x;
                const dy = u.y - other.y;
                const minDist = u.getCollisionRadius() + other.getCollisionRadius() + 10;
                if (Math.sqrt(dx * dx + dy * dy) < minDist) {
                    u.y += minDist;
                    if (u.y > yMax) u.y = yMin + Math.random() * (yMax - yMin);
                }
            }
        }
    },

    _placeGroup(units, xMin, xMax, yMin, yMax, facing) {
        for (let i = 0; i < units.length; i++) {
            const u = units[i];
            u.x = xMin + Math.random() * (xMax - xMin);
            u.y = yMin + Math.random() * (yMax - yMin);
            u.angle = facing;

            for (let j = 0; j < i; j++) {
                const other = units[j];
                const dx = u.x - other.x;
                const dy = u.y - other.y;
                const minDist = u.getCollisionRadius() + other.getCollisionRadius() + 10;
                if (Math.sqrt(dx * dx + dy * dy) < minDist) {
                    u.y += minDist;
                    if (u.y > yMax) u.y = yMin + Math.random() * (yMax - yMin);
                }
            }
        }
    },

    // Find nearest terrain zone of a type from a position
    _findNearestForest(x, y, maxDist) {
        let best = null, bestDist = maxDist;
        for (const f of GameMap.forests) {
            const d = Math.sqrt((f.x - x) ** 2 + (f.y - y) ** 2);
            if (d < bestDist) { best = f; bestDist = d; }
        }
        return best;
    },

    _findNearestHill(x, y, maxDist) {
        let best = null, bestDist = maxDist;
        const hills = GameMap.hills;
        for (const h of hills) {
            const d = Math.sqrt((h.x - x) ** 2 + (h.y - y) ** 2);
            if (d < bestDist) { best = h; bestDist = d; }
        }
        return best;
    },

    // Find best bridge to cross — nearest but biased toward the target's Y position
    _findNearestBridge(x, y, targetY) {
        let best = null, bestScore = Infinity;
        for (const b of GameMap.bridges) {
            const dist = Math.sqrt((b.x - x) ** 2 + (b.y - y) ** 2);
            // Prefer bridges closer to the target's vertical position
            const yBias = targetY !== undefined ? Math.abs(b.y - targetY) * 0.3 : 0;
            const score = dist + yBias;
            if (score < bestScore) { best = b; bestScore = score; }
        }
        return best;
    },

    // Check if a river separates two points (ignoring bridges — we want to know
    // if the river line is between them, so AI can route toward a bridge)
    _riverBetween(x1, y1, x2, y2) {
        // Check all rivers (main river + twin rivers)
        const rivers = [];
        if (GameMap.river) rivers.push(GameMap.river);
        if (GameMap._twinRiverData) {
            for (const r of GameMap._twinRiverData) rivers.push(r);
        }
        if (rivers.length === 0) return false;

        for (const river of rivers) {
            const pts = river.points;
            const midY = (y1 + y2) / 2;
            // Find river x at midY
            let closest = pts[0];
            for (const p of pts) {
                if (Math.abs(p.y - midY) < Math.abs(closest.y - midY)) closest = p;
            }
            const riverX = closest.x;
            const margin = river.width / 2 + 20;
            if ((x1 < riverX - margin && x2 > riverX + margin) ||
                (x2 < riverX - margin && x1 > riverX + margin)) {
                return true;
            }
        }
        return false;
    },

    // Designate 1-2 fast units as scouts at battle start
    initScouts() {
        this.scouts = [];
        this.scoutPhase = 0;

        // Build patrol waypoints sweeping across the map toward the player side
        const mapW = GameMap.width;
        const mapH = GameMap.height;
        this.scoutWaypoints = [
            { x: mapW * 0.55, y: mapH * 0.35 },
            { x: mapW * 0.45, y: mapH * 0.65 },
            { x: mapW * 0.35, y: mapH * 0.40 },
            { x: mapW * 0.25, y: mapH * 0.55 },
            { x: mapW * 0.15, y: mapH * 0.30 },
            { x: mapW * 0.20, y: mapH * 0.70 },
        ];

        // Pick 1-2 fastest century units as scouts (prefer light cavalry, then light infantry)
        const candidates = this.units.filter(u => u.alive && u.size === UnitSize.CENTURY);
        candidates.sort((a, b) => b.speedMod - a.speedMod); // fastest first

        const numScouts = Math.min(2, candidates.length);
        for (let i = 0; i < numScouts; i++) {
            candidates[i]._isScout = true;
            candidates[i]._scoutWaypointIdx = i % this.scoutWaypoints.length;
            this.scouts.push(candidates[i]);
        }
    },

    // Compute the formation center-of-mass for alive AI units
    _getFormationCenter() {
        let sx = 0, sy = 0, n = 0;
        for (const u of this.units) {
            if (!u.alive) continue;
            sx += u.x; sy += u.y; n++;
        }
        return n > 0 ? { x: sx / n, y: sy / n } : { x: GameMap.width * 0.75, y: GameMap.height / 2 };
    },

    // Find the best terrain feature near a position within range
    _findBestTerrain(x, y, maxDist, category) {
        let best = null, bestScore = -Infinity;

        // Hills are valuable for infantry (height advantage)
        if (category === 'infantry') {
            for (const h of GameMap.hills) {
                const d = Math.sqrt((h.x - x) ** 2 + (h.y - y) ** 2);
                if (d < maxDist) {
                    const score = h.elevation * 100 - d;
                    if (score > bestScore) { best = h; bestScore = score; }
                }
            }
        }

        // Forests are valuable for archers (cover + bonus)
        if (category === 'archers') {
            for (const f of GameMap.forests) {
                const d = Math.sqrt((f.x - x) ** 2 + (f.y - y) ** 2);
                if (d < maxDist) {
                    const score = 200 - d;
                    if (score > bestScore) { best = f; bestScore = score; }
                }
            }
        }

        return best;
    },

    // Route a unit toward a destination, avoiding rivers (via bridges) and ditches
    _routeTo(unit, destX, destY) {
        // River check — route through bridge (check main river and twin rivers)
        if (this._riverBetween(unit.x, unit.y, destX, destY)) {
            const bridge = this._findNearestBridge(unit.x, unit.y, destY);
            if (bridge) {
                const distToBridge = Math.sqrt((bridge.x - unit.x) ** 2 + (bridge.y - unit.y) ** 2);
                if (distToBridge < 50) {
                    // Close to bridge — walk through it toward destination
                    unit.targetX = destX;
                    unit.targetY = destY;
                } else {
                    unit.targetX = bridge.x;
                    unit.targetY = bridge.y;
                }
                return;
            }
        }
        // Ditch check — route around ditch end
        const cr = unit.getCollisionRadius();
        const blockingDitch = GameMap.getDitchBetween(unit.x, unit.y, destX, destY, cr);
        if (blockingDitch) {
            const bypass = GameMap.getDitchBypassPoint(blockingDitch, unit.x, unit.y, destX, destY, cr);
            if (bypass) {
                unit.targetX = bypass.x;
                unit.targetY = bypass.y;
                return;
            }
        }
        // Cavalry forest avoidance: if path goes through a forest, steer around it
        if (unit.category === 'cavalry') {
            const steps = 5;
            const dx = destX - unit.x, dy = destY - unit.y;
            for (let s = 1; s <= steps; s++) {
                const sx = unit.x + dx * s / steps;
                const sy = unit.y + dy * s / steps;
                if (GameMap.isInForest(sx, sy)) {
                    // Find which forest we're hitting and go around it
                    for (const f of GameMap.forests) {
                        const fdx = sx - f.x, fdy = sy - f.y;
                        if (fdx * fdx + fdy * fdy < (f.radius + 30) * (f.radius + 30)) {
                            // Go around: pick the side that's closer to our current position
                            const perpX = -dy, perpY = dx;
                            const len = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
                            const nx = perpX / len, ny = perpY / len;
                            // Check which side of forest is closer
                            const sideA = { x: f.x + nx * (f.radius + 40), y: f.y + ny * (f.radius + 40) };
                            const sideB = { x: f.x - nx * (f.radius + 40), y: f.y - ny * (f.radius + 40) };
                            const dA = (sideA.x - unit.x) ** 2 + (sideA.y - unit.y) ** 2;
                            const dB = (sideB.x - unit.x) ** 2 + (sideB.y - unit.y) ** 2;
                            const bypass = dA < dB ? sideA : sideB;
                            bypass.x = Math.max(30, Math.min(GameMap.width - 30, bypass.x));
                            bypass.y = Math.max(30, Math.min(GameMap.height - 30, bypass.y));
                            unit.targetX = bypass.x;
                            unit.targetY = bypass.y;
                            return;
                        }
                    }
                    break;
                }
            }
        }

        unit.targetX = destX;
        unit.targetY = destY;
    },

    // Battle AI - formation-based + terrain awareness + fog of war
    updateBattle(playerUnits, dt) {
        if (Network.isMultiplayer) return; // human controls enemy side
        // Check if any player units are visible to the AI
        const visibleEnemies = playerUnits.filter(e => e.alive && Visibility.isVisible(e.x, e.y, 'enemy'));
        const hasVisibleTargets = visibleEnemies.length > 0;

        // If scouts spotted enemies, convert them back to normal AI units
        if (hasVisibleTargets) {
            for (const scout of this.scouts) {
                scout._isScout = false;
            }
            this.scouts = [];
        }

        // Categorize alive AI units (exclude routing units — they're fleeing)
        const aliveInfantry = this.units.filter(u => u.alive && !u.inCombat && !u.routing && u.category === 'infantry');
        const aliveArchers = this.units.filter(u => u.alive && !u.inCombat && !u.routing && u.category === 'archers');
        const aliveCavalry = this.units.filter(u => u.alive && !u.inCombat && !u.routing && u.category === 'cavalry');

        // Compute where the enemy center-of-mass is (if visible)
        let enemyCenterX, enemyCenterY;
        if (hasVisibleTargets) {
            enemyCenterX = visibleEnemies.reduce((s, e) => s + e.x, 0) / visibleEnemies.length;
            enemyCenterY = visibleEnemies.reduce((s, e) => s + e.y, 0) / visibleEnemies.length;
        }

        for (const unit of this.units) {
            if (!unit.alive || unit.inCombat) continue;

            // Scout behavior — patrol waypoints to find the enemy
            if (unit._isScout && !hasVisibleTargets) {
                const wp = this.scoutWaypoints[unit._scoutWaypointIdx];
                if (wp) {
                    const dx = wp.x - unit.x;
                    const dy = wp.y - unit.y;
                    if (Math.sqrt(dx * dx + dy * dy) < 40) {
                        unit._scoutWaypointIdx = (unit._scoutWaypointIdx + 1) % this.scoutWaypoints.length;
                    }
                    this._routeTo(unit, wp.x, wp.y);
                }
                continue;
            }

            // --- FIND BEST TARGET ---
            let bestTarget = null;
            let bestScore = -Infinity;

            for (const enemy of visibleEnemies) {
                const dx = enemy.x - unit.x;
                const dy = enemy.y - unit.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                let score = 1000 - dist;

                const bonus = Combat.getTypeBonus(unit, enemy);
                score += (bonus - 1) * 500;

                // Cavalry prioritize archers and flanking
                if (unit.category === 'cavalry' && enemy.category === 'archers') score += 400;
                // Archers avoid close targets
                if (unit.category === 'archers' && dist < unit.range * 0.5) score -= 400;
                // Prefer routing enemies — easy kills
                if (enemy.routing) score += 300;

                if (score > bestScore) { bestScore = score; bestTarget = enemy; }
            }

            // --- ROLE-BASED BEHAVIOR ---

            if (unit.category === 'archers') {
                // ARCHERS: stay behind infantry line, seek forest cover, shoot from range
                if (bestTarget) {
                    const dx = bestTarget.x - unit.x;
                    const dy = bestTarget.y - unit.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist > unit.range * 0.9) {
                        // Too far — move closer, prefer forest
                        const forest = this._findBestTerrain(unit.x, unit.y, 300, 'archers');
                        if (forest && !GameMap.isInForest(unit.x, unit.y)) {
                            // Only go to forest if it doesn't take us further from target
                            const forestToTarget = Math.sqrt((forest.x - bestTarget.x) ** 2 + (forest.y - bestTarget.y) ** 2);
                            if (forestToTarget < dist) {
                                this._routeTo(unit, forest.x, forest.y);
                            } else {
                                const moveX = unit.x + (dx / dist) * (dist - unit.range * 0.7);
                                const moveY = unit.y + (dy / dist) * (dist - unit.range * 0.7);
                                this._routeTo(unit, moveX, moveY);
                            }
                        } else {
                            const moveX = unit.x + (dx / dist) * (dist - unit.range * 0.7);
                            const moveY = unit.y + (dy / dist) * (dist - unit.range * 0.7);
                            this._routeTo(unit, moveX, moveY);
                        }
                    } else if (dist < unit.range * 0.3) {
                        // Too close — retreat behind friendly infantry if possible
                        const nearestInf = this._findNearestFriendlyInfantry(unit);
                        if (nearestInf) {
                            // Retreat to behind the infantry (away from enemy)
                            const retreatX = nearestInf.x + (nearestInf.x - bestTarget.x) * 0.3 + 50;
                            const retreatY = nearestInf.y;
                            this._routeTo(unit, retreatX, Math.max(50, Math.min(GameMap.height - 50, retreatY)));
                        } else {
                            const forest = this._findBestTerrain(unit.x, unit.y, 400, 'archers');
                            if (forest) {
                                this._routeTo(unit, forest.x, forest.y);
                            } else {
                                this._routeTo(unit, unit.x - (dx / dist) * 100, unit.y - (dy / dist) * 100);
                            }
                        }
                    } else {
                        // In good range — hold position
                        unit.targetX = null;
                        unit.targetY = null;
                    }
                    // Face target
                    unit._turnToward(Math.atan2(dy, dx), dt);
                } else if (!hasVisibleTargets) {
                    // No targets — stay behind infantry formation center
                    if (unit.targetX === null) {
                        const fc = this._getFormationCenter();
                        this._routeTo(unit, fc.x + 80, fc.y + (Math.random() - 0.5) * 60);
                    }
                }

            } else if (unit.category === 'cavalry') {
                // CAVALRY: flank enemies, target archers, swing wide
                if (bestTarget) {
                    const dx = bestTarget.x - unit.x;
                    const dy = bestTarget.y - unit.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    // Attempt to flank: approach from above or below the enemy center
                    if (dist > 200) {
                        // Swing wide — go to the enemy's flank (top or bottom)
                        const aboveCenter = unit.y < (enemyCenterY || GameMap.height / 2);
                        const flankY = aboveCenter ?
                            Math.max(40, bestTarget.y - 200) :
                            Math.min(GameMap.height - 40, bestTarget.y + 200);
                        this._routeTo(unit, bestTarget.x, flankY);
                    } else {
                        // Close enough — charge in
                        this._routeTo(unit, bestTarget.x, bestTarget.y);
                    }
                } else if (!hasVisibleTargets) {
                    // No targets — hold flanking positions while creeping forward
                    if (unit.targetX === null) {
                        const fc = this._getFormationCenter();
                        const aboveCenter = unit.y < GameMap.height / 2;
                        const flankY = aboveCenter ? Math.max(60, fc.y - 250) : Math.min(GameMap.height - 60, fc.y + 250);
                        const creepX = fc.x - 50;
                        this._routeTo(unit, creepX, flankY);
                    }
                }

            } else {
                // INFANTRY: front line, secure hills, screen archers
                if (bestTarget) {
                    const dx = bestTarget.x - unit.x;
                    const dy = bestTarget.y - unit.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist > 400) {
                        // Far away — try to secure high ground on the way
                        const hill = this._findBestTerrain(unit.x, unit.y, 250, 'infantry');
                        const notOnHill = !GameMap.getHillBonus(unit.x, unit.y);
                        if (hill && notOnHill) {
                            // Only if hill is between us and enemy (not behind us)
                            const hillToEnemy = Math.sqrt((hill.x - bestTarget.x) ** 2 + (hill.y - bestTarget.y) ** 2);
                            if (hillToEnemy < dist) {
                                this._routeTo(unit, hill.x, hill.y);
                            } else {
                                this._routeTo(unit, bestTarget.x, bestTarget.y);
                            }
                        } else {
                            this._routeTo(unit, bestTarget.x, bestTarget.y);
                        }
                    } else {
                        // Close — engage directly
                        this._routeTo(unit, bestTarget.x, bestTarget.y);
                    }
                } else if (!hasVisibleTargets) {
                    // No targets — advance as front line toward map center
                    if (unit.targetX === null) {
                        const creepX = GameMap.width * (0.4 + Math.random() * 0.15);
                        const creepY = unit.y + (Math.random() - 0.5) * 80;
                        this._routeTo(unit, creepX, Math.max(60, Math.min(GameMap.height - 60, creepY)));
                    }
                }
            }
        }
    },

    // Find nearest alive friendly infantry to a given unit
    _findNearestFriendlyInfantry(unit) {
        let best = null, bestDist = Infinity;
        for (const u of this.units) {
            if (!u.alive || u === unit || u.category !== 'infantry') continue;
            const d = Math.sqrt((u.x - unit.x) ** 2 + (u.y - unit.y) ** 2);
            if (d < bestDist) { best = u; bestDist = d; }
        }
        return best;
    }
};
