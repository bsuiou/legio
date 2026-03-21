// Unit sizes and types
const UnitSize = {
    CENTURY: 'century',
    COHORT: 'cohort',
    LEGION: 'legion'
};

const UnitType = {
    LIGHT_INFANTRY: 'light_infantry',
    HEAVY_INFANTRY: 'heavy_infantry',
    LIGHT_CAVALRY: 'light_cavalry',
    HEAVY_CAVALRY: 'heavy_cavalry',
    ARCHERS: 'archers'
};

const SIZE_CONFIG = {
    [UnitSize.CENTURY]: { strength: 80, shape: 'circle', radius: 10, turnRate: Math.PI * 1.0, label: 'Century', combatEff: 1.0 },
    [UnitSize.COHORT]: { strength: 480, shape: 'square', size: 28, turnRate: Math.PI * 0.5, label: 'Cohort', combatEff: 1.0 },
    [UnitSize.LEGION]: { strength: 5280, shape: 'rect', width: 64, height: 42, turnRate: Math.PI * 0.25, label: 'Legion', combatEff: 0.25 }
};

const TYPE_CONFIG = {
    [UnitType.LIGHT_INFANTRY]: { symbol: 'x', bold: false, damageMod: 1.0, speedMod: 1.0, heavy: false, category: 'infantry', label: 'Light Infantry', range: 0 },
    [UnitType.HEAVY_INFANTRY]: { symbol: 'x', bold: true, damageMod: 1.2, speedMod: 0.85, heavy: true, category: 'infantry', label: 'Heavy Infantry', range: 0 },
    [UnitType.LIGHT_CAVALRY]: { symbol: '/', bold: false, damageMod: 1.0, speedMod: 2.0, heavy: false, category: 'cavalry', label: 'Light Cavalry', range: 0 },
    [UnitType.HEAVY_CAVALRY]: { symbol: '/', bold: true, damageMod: 1.2, speedMod: 1.75, heavy: true, category: 'cavalry', label: 'Heavy Cavalry', range: 0 },
    [UnitType.ARCHERS]: { symbol: '•', bold: false, damageMod: 1.0, speedMod: 1.0, heavy: false, category: 'archers', label: 'Archers', range: 200 }
};

const BASE_SPEED = 12.5; // pixels per second (halved again for more tactical pacing)

const VISION_RANGE = {
    [UnitType.ARCHERS]: 400,
    [UnitType.LIGHT_INFANTRY]: 200,
    [UnitType.HEAVY_INFANTRY]: 160,
    [UnitType.LIGHT_CAVALRY]: 400,
    [UnitType.HEAVY_CAVALRY]: 400
};

let _unitIdCounter = 0;

class Unit {
    constructor(unitType, unitSize, team) {
        this.id = _unitIdCounter++;
        this.type = unitType;
        this.size = unitSize;
        this.team = team; // 'player' or 'enemy'

        const sc = SIZE_CONFIG[unitSize];
        const tc = TYPE_CONFIG[unitType];

        this.maxHp = sc.strength;
        this.hp = this.maxHp;
        this.strength = sc.strength;
        this.damageMod = tc.damageMod;
        this.speedMod = tc.speedMod;
        this.turnRate = sc.turnRate;
        this.range = tc.range;
        this.category = tc.category;

        this.x = 0;
        this.y = 0;
        this.angle = team === 'player' ? 0 : Math.PI; // face right / left
        this.targetX = null;
        this.targetY = null;

        // Multi-unit combat: arrays of engaged enemies
        this.combatTargets = []; // enemies this unit is fighting
        this.alive = true;
        this.selected = false;

        // Retreat penalty: after disengaging from combat
        this.retreatPenalty = 0; // seconds remaining

        // Idle timer: how long the unit has been standing still with no orders
        this.idleTime = 0;

        // Stuck detection: track progress toward target
        this._stuckTimer = 0;
        this._lastProgressDist = Infinity;

        // For archers
        this.attackCooldown = 0;
        this.arrowTarget = null;

        // Facing threats: all flank/rear attacks this frame
        // Each entry: { status: 'flank'|'rear', attackAngle: number }
        this.facingThreats = [];

        // Hold ground mode: prevents auto-engage when idle
        this.holdGround = false;

        // Waypoint queue for shift+right-click
        this.targetQueue = []; // array of {x, y}

        // Dig ditch mode (legion only)
        this.digging = false;
        this.currentDitch = null; // reference to active ditch in GameMap.ditches

        // Veterancy (campaign mode)
        this.veteran = false;
        this._veteranId = null; // links to Campaign.veteranRoster entry

        // Morale system
        this.morale = 100;
        this.routing = false;
        this.lastStand = false; // surrounded at 0 morale, fights to death

        // Rally cooldown
        this.rallyCooldown = 0;

        // Attack-move
        this.attackMove = false;
        this.attackMoveTarget = null;
    }

    // Backward-compatible getters
    get inCombat() { return this.combatTargets.length > 0; }
    get combatTarget() { return this.combatTargets[0] || null; }

    canRally() {
        return this.alive && !this.routing && this.morale > 70 && this.rallyCooldown <= 0;
    }

    unrout() {
        if (!this.routing) return;
        this.routing = false;
        this.retreatPenalty = 0;
        this.morale = Math.max(this.morale, 30);
        this.targetX = null;
        this.targetY = null;
        this.targetQueue = [];
    }

    getSpeed() {
        let speed = BASE_SPEED * this.speedMod;
        // Digging: 50% speed
        if (this.digging) {
            speed *= 0.50;
        }
        // Retreat penalty: 70% speed while retreating
        if (this.retreatPenalty > 0) {
            speed *= 0.70;
        }
        // Slope penalty — steeper hills slow units more
        const slope = GameMap.getSlope(this.x, this.y);
        speed *= Math.max(0.4, 1.0 - slope * 18);
        // Road check — even partially touching a road gives full bonus and negates forest
        const cr = this.getCollisionRadius();
        const onRoad = GameMap.roads.length > 0 && GameMap.isOnRoad(this.x, this.y, cr * 0.8);
        if (onRoad) {
            speed *= 1.25; // Roman road bonus
        } else {
            // Forest penalty - only applies off-road
            const forestOverlap = GameMap.getForestOverlap(this.x, this.y, this.getCollisionRadius());
            if (forestOverlap > 0) {
                if (this.category === 'cavalry') {
                    speed *= 1.0 - forestOverlap * 0.85; // up to 85% slower at full overlap
                } else {
                    speed *= 1.0 - forestOverlap * 0.55; // up to 55% slower at full overlap
                }
            }
        }
        // Campaign cavalry speed buff
        if (Campaign.active && this.team === 'player' && this.category === 'cavalry') {
            speed *= Campaign.getCavalrySpeedBuff();
        }
        return speed;
    }

    getCollisionRadius() {
        const sc = SIZE_CONFIG[this.size];
        if (sc.shape === 'circle') return sc.radius;
        if (sc.shape === 'square') return sc.size * 0.7;
        return Math.max(sc.width, sc.height) * 0.5;
    }

    getVisionRange() {
        let range = VISION_RANGE[this.type] || 200;
        // Hill bonus: units on hills get minimum 500px vision
        const hillBonus = GameMap.getHillBonus(this.x, this.y);
        if (hillBonus > 0) {
            range = Math.max(range, 500);
        }
        return range;
    }

    getDisplayInfo() {
        const sc = SIZE_CONFIG[this.size];
        const tc = TYPE_CONFIG[this.type];
        const sub = this.subName ? ` ${this.subName}` : '';
        const vet = this.veteran ? '\u2605 ' : '';
        const merc = this._isMercenary ? 'Merc. ' : '';
        return `${vet}${merc}${tc.label}${sub} ${sc.label} (${Math.round(this.hp)}/${this.maxHp})`;
    }

    getCost() {
        return SIZE_CONFIG[this.size].strength;
    }

    // Gradual turning helper - used in both combat and movement
    _turnToward(targetAngle, dt) {
        let angleDiff = targetAngle - this.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const maxTurn = this.turnRate * dt;
        if (Math.abs(angleDiff) > maxTurn) {
            this.angle += Math.sign(angleDiff) * maxTurn;
        } else {
            this.angle = targetAngle;
        }
        // Normalize
        while (this.angle > Math.PI) this.angle -= Math.PI * 2;
        while (this.angle < -Math.PI) this.angle += Math.PI * 2;
        return angleDiff;
    }

    update(dt) {
        if (!this.alive) return;

        // Decrement retreat penalty (but not for routing units — they keep it)
        if (this.retreatPenalty > 0 && !this.routing) {
            this.retreatPenalty = Math.max(0, this.retreatPenalty - dt);
        }
        // Rally cooldown
        if (this.rallyCooldown > 0) this.rallyCooldown = Math.max(0, this.rallyCooldown - dt);

        // Routing: flee to map edge, skip normal combat/movement
        if (this.routing) {
            this.idleTime = 0;
            // Check if reached map edge — removed from battle
            if (this.x < 30 || this.x > GameMap.width - 30 || this.y < 30 || this.y > GameMap.height - 30) {
                this.alive = false;
                this.removeFromAllCombat();
                return;
            }
            // If in combat while routing, just take damage (handled by combat.js), don't move
            if (this.inCombat) return;
            // Ensure flee target is always set (re-set if cleared by arrival logic)
            if (this.targetX == null) {
                const edgePoints = [
                    { x: -10, y: this.y },
                    { x: GameMap.width + 10, y: this.y },
                    { x: this.x, y: -10 },
                    { x: this.x, y: GameMap.height + 10 },
                ];
                let nearest = edgePoints[0], nearDist = Infinity;
                for (const p of edgePoints) {
                    const d = Math.sqrt((p.x - this.x) ** 2 + (p.y - this.y) ** 2);
                    if (d < nearDist) { nearDist = d; nearest = p; }
                }
                this.targetX = nearest.x;
                this.targetY = nearest.y;
            }
            // Continue fleeing — fall through to normal movement with target set
        }

        // Morale: surrounded drain (3+ facing threats)
        if (this.inCombat && this.facingThreats.length >= 3) {
            this.morale = Math.max(0, this.morale - 5 * dt);
        }

        // Morale: passive recovery when NOT in combat and NOT routing
        if (!this.inCombat && !this.routing) {
            this.morale = Math.min(100, this.morale + 3 * dt);
        }

        if (this.inCombat && !this.routing) {
            // Gradually turn toward closest combat target (no instant snap!)
            const target = this.combatTarget;
            if (target && target.alive) {
                const dx = target.x - this.x;
                const dy = target.y - this.y;
                const desiredAngle = Math.atan2(dy, dx);
                this._turnToward(desiredAngle, dt);
            }
            // Digging legions continue extending their ditch even in combat
            if (this.digging && this.currentDitch) {
                const canContinue = GameMap.extendDitch(this.currentDitch, this.x, this.y);
                if (!canContinue) {
                    this._stopDiggingAndNudge();
                }
            }
            this.idleTime = 0;
            return;
        }

        // Archer auto-targeting
        if (this.category === 'archers' && this.range > 0) {
            this.attackCooldown = Math.max(0, this.attackCooldown - dt);
        }

        // Attack-move: scan for enemies along the way
        if (this.attackMove && !this.inCombat && !this.routing && this.targetX !== null) {
            const scanRange = 120;
            const enemies = this.team === 'player' ? AI.units : Army.playerUnits;
            let nearest = null, nearDist = scanRange;
            for (const e of enemies) {
                if (!e.alive || e.routing) continue;
                const edx = e.x - this.x, edy = e.y - this.y;
                const d = Math.sqrt(edx * edx + edy * edy);
                if (d < nearDist) { nearest = e; nearDist = d; }
            }
            if (nearest) {
                this.targetX = nearest.x;
                this.targetY = nearest.y;
            }
        }
        // Restore attack-move destination after combat ends
        if (this.attackMove && !this.inCombat && this.targetX === null && this.attackMoveTarget) {
            this.targetX = this.attackMoveTarget.x;
            this.targetY = this.attackMoveTarget.y;
        }

        // Movement toward target
        if (this.targetX !== null && this.targetY !== null) {
            this.idleTime = 0;

            // Bridge routing: if path crosses a river, redirect through nearest bridge
            if (GameMap.river && GameMap.bridges.length > 0 && !this._bridgeRouted) {
                const cr2 = this.getCollisionRadius();
                // Check if target is across the river (unit blocked, target on other side)
                const unitBlocked = GameMap.isRiverBlocking(this.x + (this.targetX - this.x) * 0.3, this.y + (this.targetY - this.y) * 0.3, cr2);
                if (unitBlocked) {
                    // Find nearest bridge
                    let bestBridge = null, bestDist = Infinity;
                    for (const b of GameMap.bridges) {
                        const bd = Math.sqrt((b.x - this.x) ** 2 + (b.y - this.y) ** 2);
                        // Prefer bridges that are roughly between us and target
                        const bToTarget = Math.sqrt((b.x - this.targetX) ** 2 + (b.y - this.targetY) ** 2);
                        const totalVia = bd + bToTarget;
                        if (totalVia < bestDist) {
                            bestDist = totalVia;
                            bestBridge = b;
                        }
                    }
                    if (bestBridge) {
                        // Insert bridge as waypoint, keep original target
                        this.targetQueue.unshift({ x: this.targetX, y: this.targetY });
                        this.targetX = bestBridge.x;
                        this.targetY = bestBridge.y;
                        this._bridgeRouted = true;
                    }
                }
            }
            // Reset bridge routing flag when target changes (arrival clears it)

            const dx = this.targetX - this.x;
            const dy = this.targetY - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 15) {
                this._bridgeRouted = false;
                // Pop next waypoint from queue if any
                if (this.targetQueue.length > 0) {
                    const next = this.targetQueue.shift();
                    this.targetX = next.x;
                    this.targetY = next.y;
                } else {
                    this.targetX = null;
                    this.targetY = null;
                    // Clear attack-move at final destination
                    if (this.attackMove && this.attackMoveTarget) {
                        const amDx = this.x - this.attackMoveTarget.x;
                        const amDy = this.y - this.attackMoveTarget.y;
                        if (Math.sqrt(amDx * amDx + amDy * amDy) < 30) {
                            this.attackMove = false;
                            this.attackMoveTarget = null;
                        }
                    }
                }
                return;
            }

            const desiredAngle = Math.atan2(dy, dx);
            const angleDiff = this._turnToward(desiredAngle, dt);

            // Move forward — scale speed by facing accuracy instead of hard cutoff
            // Units still move (slowly) even when turning, preventing deadlocks
            const absDiff = Math.abs(angleDiff);
            if (absDiff < Math.PI * 0.85) {
                const facingFactor = absDiff < Math.PI * 0.3 ? 1.0 : Math.max(0.2, 1.0 - (absDiff - Math.PI * 0.3) / (Math.PI * 0.55));
                const targetSpeed = this.getSpeed();
                // Smooth speed transitions to avoid jitter from terrain changes
                if (this._smoothSpeed === undefined) this._smoothSpeed = targetSpeed;
                this._smoothSpeed += (targetSpeed - this._smoothSpeed) * Math.min(1, dt * 8);
                const speed = this._smoothSpeed * facingFactor;
                let moveX = Math.cos(this.angle) * speed * dt;
                let moveY = Math.sin(this.angle) * speed * dt;

                // Local avoidance: steer around nearby friendly units blocking the path
                if (!this.inCombat && this.targetX !== null) {
                    const friendlies = this.team === 'player' ? Army.playerUnits : AI.units;
                    const unitCr = this.getCollisionRadius();
                    const mySpeed = this.speedMod;
                    for (const other of friendlies) {
                        if (other === this || !other.alive) continue;
                        const odx = other.x - this.x;
                        const ody = other.y - this.y;
                        const oDist = Math.sqrt(odx * odx + ody * ody);
                        // Larger avoidance radius for faster units (cavalry sees further ahead)
                        const speedRatio = mySpeed / (other.speedMod || 1);
                        const lookAhead = speedRatio > 1.2 ? 20 : 8;
                        const avoidDist = unitCr + other.getCollisionRadius() + lookAhead;
                        if (oDist >= avoidDist || oDist < 1) continue;
                        // Only avoid if the other unit is roughly ahead of us
                        const dot = moveX * odx + moveY * ody;
                        if (dot <= 0) continue;
                        // Steer perpendicular — pick the side closer to target
                        const perpX = -ody / oDist;
                        const perpY = odx / oDist;
                        // Stronger avoidance when we're faster than the blocker (cavalry behind infantry)
                        const urgency = speedRatio > 1.2 ? 1.2 : 0.6;
                        const avoidStrength = (avoidDist - oDist) / avoidDist * speed * dt * urgency;
                        const toTargetX = this.targetX - this.x;
                        const toTargetY = this.targetY - this.y;
                        const side = (perpX * toTargetX + perpY * toTargetY) > 0 ? 1 : -1;
                        moveX += perpX * side * avoidStrength;
                        moveY += perpY * side * avoidStrength;
                    }
                }

                // Road preference: gently steer toward nearby roads when not already on one
                // Only if the road is roughly along our path (not a big detour)
                if (!this.inCombat && !this.routing && this.targetX !== null && GameMap.roads.length > 0) {
                    const unitCr = this.getCollisionRadius();
                    if (!GameMap.isOnRoad(this.x, this.y, unitCr * 0.8)) {
                        // Find closest road point
                        let bestRoadX = 0, bestRoadY = 0, bestRoadDist = 150; // max seek range
                        for (const road of GameMap.roads) {
                            // Sample every 5th point for performance
                            for (let ri = 0; ri < road.points.length; ri += 5) {
                                const rp = road.points[ri];
                                const rdx = rp.x - this.x, rdy = rp.y - this.y;
                                const rd = Math.sqrt(rdx * rdx + rdy * rdy);
                                if (rd < bestRoadDist) {
                                    // Only prefer if road point is roughly between us and target (not behind us)
                                    const toTargetDx = this.targetX - this.x;
                                    const toTargetDy = this.targetY - this.y;
                                    const toTargetDist = Math.sqrt(toTargetDx * toTargetDx + toTargetDy * toTargetDy);
                                    if (toTargetDist < 100) break; // close to target, don't detour
                                    // Road point should not be further from target than we are
                                    const rpToTarget = Math.sqrt((rp.x - this.targetX) ** 2 + (rp.y - this.targetY) ** 2);
                                    if (rpToTarget < toTargetDist * 1.1) { // allow 10% detour
                                        bestRoadDist = rd;
                                        bestRoadX = rp.x;
                                        bestRoadY = rp.y;
                                    }
                                }
                            }
                        }
                        if (bestRoadDist < 150) {
                            // Gentle pull toward road — stronger when closer
                            const pullStrength = (1.0 - bestRoadDist / 150) * 0.25;
                            const trdx = bestRoadX - this.x, trdy = bestRoadY - this.y;
                            const trd = Math.sqrt(trdx * trdx + trdy * trdy);
                            if (trd > 1) {
                                moveX += (trdx / trd) * speed * dt * pullStrength;
                                moveY += (trdy / trd) * speed * dt * pullStrength;
                            }
                        }
                    }
                }

                const newX = this.x + moveX;
                const newY = this.y + moveY;

                // Ditch blocking: non-digging units can't cross ditches
                // But if already inside a ditch, allow movement out
                const cr = this.getCollisionRadius();
                const alreadyInDitch = !this.digging && GameMap.isDitchBlocking(this.x, this.y, cr);
                if (!this.digging && !alreadyInDitch && GameMap.isDitchBlocking(newX, newY, cr)) {
                    // Slide along the ditch edge
                    const slide = GameMap.getDitchSlideDirection(newX, newY, cr);
                    const dot = moveX * slide.nx + moveY * slide.ny;
                    this.x += moveX - dot * slide.nx;
                    this.y += moveY - dot * slide.ny;
                } else if (GameMap.isRiverBlocking(newX, newY, cr)) {
                    // River blocking — slide along river bank
                    const prevX = this.x, prevY = this.y;
                    const slide = GameMap.getRiverSlideDirection(newX, newY, cr);
                    if (slide.nx !== 0 || slide.ny !== 0) {
                        const dot = moveX * slide.nx + moveY * slide.ny;
                        this.x += moveX - dot * slide.nx;
                        this.y += moveY - dot * slide.ny;
                    }
                    // Safety: if still in river after slide, revert to previous position
                    if (GameMap.isRiverBlocking(this.x, this.y, cr)) {
                        this.x = prevX;
                        this.y = prevY;
                    }
                } else {
                    this.x = newX;
                    this.y = newY;
                }

                // Clamp to map bounds
                this.x = Math.max(cr, Math.min(GameMap.width - cr, this.x));
                this.y = Math.max(cr, Math.min(GameMap.height - cr, this.y));

                // Final river safety — if somehow in water, push toward nearest bank
                if (GameMap.river && GameMap.isRiverBlocking(this.x, this.y, cr)) {
                    const bankSlide = GameMap.getRiverSlideDirection(this.x, this.y, cr);
                    if (bankSlide.nx !== 0 || bankSlide.ny !== 0) {
                        this.x += bankSlide.nx * 3;
                        this.y += bankSlide.ny * 3;
                    }
                }

                // Stuck detection: if not making progress toward target for 3+ seconds, nudge gradually
                if (this.targetX !== null) {
                    const curDist = Math.sqrt((this.targetX - this.x) ** 2 + (this.targetY - this.y) ** 2);
                    // Only count as stuck if we haven't moved at least 5px closer over the sample period
                    if (this._stuckCheckDist === undefined) this._stuckCheckDist = curDist;
                    this._stuckTimer += dt;
                    if (this._stuckTimer > 3.0) {
                        if (curDist >= this._stuckCheckDist - 5) {
                            // Truly stuck — adjust target slightly perpendicular instead of teleporting
                            const perpX = -Math.sin(this.angle);
                            const perpY = Math.cos(this.angle);
                            const tdx = this.targetX - this.x;
                            const tdy = this.targetY - this.y;
                            const dot = perpX * tdx + perpY * tdy;
                            const sign = dot > 0 ? 1 : -1;
                            this.targetX += perpX * sign * 8;
                            this.targetY += perpY * sign * 8;
                            // Clamp target to map
                            this.targetX = Math.max(20, Math.min(GameMap.width - 20, this.targetX));
                            this.targetY = Math.max(20, Math.min(GameMap.height - 20, this.targetY));
                        }
                        this._stuckTimer = 0;
                        this._stuckCheckDist = curDist;
                    }
                } else {
                    this._stuckTimer = 0;
                    this._stuckCheckDist = undefined;
                }

                // If digging, extend the ditch trail (auto-stop at max length)
                if (this.digging && this.currentDitch) {
                    const canContinue = GameMap.extendDitch(this.currentDitch, this.x, this.y);
                    if (!canContinue) {
                        this._stopDiggingAndNudge();
                    }
                }
            }
        } else {
            // No target, no combat — increment idle time
            this.idleTime += dt;
        }
    }

    // Stop digging and nudge unit past the ditch edge so it doesn't get stuck
    _stopDiggingAndNudge() {
        if (!this.digging) return;
        const ditch = this.currentDitch;
        this.digging = false;
        this.currentDitch = null;

        if (ditch && ditch.points.length >= 2) {
            // Nudge in the direction the unit was moving (along last ditch segment)
            const pts = ditch.points;
            const last = pts[pts.length - 1];
            const prev = pts[pts.length - 2];
            const dx = last.x - prev.x;
            const dy = last.y - prev.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0.1) {
                const nudgeDist = ditch.width / 2 + this.getCollisionRadius() + 4;
                this.x = last.x + (dx / len) * nudgeDist;
                this.y = last.y + (dy / len) * nudgeDist;
                // Clamp to map bounds
                const cr = this.getCollisionRadius();
                this.x = Math.max(cr, Math.min(GameMap.width - cr, this.x));
                this.y = Math.max(cr, Math.min(GameMap.height - cr, this.y));
            }
        }
    }

    // Remove this unit from all combat engagements
    removeFromAllCombat() {
        for (const enemy of this.combatTargets) {
            const idx = enemy.combatTargets.indexOf(this);
            if (idx !== -1) enemy.combatTargets.splice(idx, 1);
        }
        this.combatTargets = [];
    }

    takeDamage(amount) {
        // Veteran defense: -10% damage taken
        if (this.veteran) {
            amount *= 0.90;
        }
        // Campaign armor upgrades (stackable)
        if (Campaign.active && this.team === 'player') {
            amount *= Campaign.getArmorBuff(this);
        }
        // Digging penalty: ×2 damage taken
        if (this.digging) {
            amount *= 2.0;
        }
        // Retreat penalty: +50% damage taken while retreating
        if (this.retreatPenalty > 0) {
            amount *= 1.5;
        }
        // Last stand: +50% damage taken (surrounded at 0 morale)
        if (this.lastStand) {
            amount *= 1.5;
        }
        // Routing: +50% damage taken (vulnerable while fleeing)
        if (this.routing && this.retreatPenalty <= 0) {
            amount *= 1.5;
        }

        this.hp -= amount;
        this._underFire = true; // flag for auto-engage

        // Morale loss proportional to damage taken
        let moraleLoss = (amount / this.maxHp) * 80;
        // Flanked/rear attacks cause extra morale damage
        if (this.facingThreats.length > 0) {
            let threatMult = 1.0;
            for (const t of this.facingThreats) {
                if (t.status === 'rear') threatMult = Math.max(threatMult, 1.5);
                else if (t.status === 'flank') threatMult = Math.max(threatMult, 1.25);
            }
            moraleLoss *= threatMult;
        }
        this.morale = Math.max(0, this.morale - moraleLoss);

        if (this.hp <= 0) {
            this.hp = 0;
            this.alive = false;
            this.removeFromAllCombat();
        }
    }

    triggerRout() {
        if (this.routing) return;
        this.routing = true;
        this.removeFromAllCombat();
        this.retreatPenalty = 999; // permanent speed penalty while routing
        this.holdGround = false;
        this.targetQueue = [];
        // Flee to nearest map edge (set target beyond edge so arrival threshold doesn't stop unit)
        const edgePoints = [
            { x: -50, y: this.y },                     // left
            { x: GameMap.width + 50, y: this.y },      // right
            { x: this.x, y: -50 },                     // top
            { x: this.x, y: GameMap.height + 50 },     // bottom
        ];
        let nearest = edgePoints[0], nearDist = Infinity;
        for (const p of edgePoints) {
            const d = Math.sqrt((p.x - this.x) ** 2 + (p.y - this.y) ** 2);
            if (d < nearDist) { nearDist = d; nearest = p; }
        }
        this.targetX = nearest.x;
        this.targetY = nearest.y;
    }
}
