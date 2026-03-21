// Combat resolution system
const Combat = {
    // Damage per second base (fraction of attacker strength)
    DPS_FACTOR: 0.02484, // ~2.48% of strength per second (10% global reduction)

    // Combat efficiency: large units can't bring all troops to bear.
    // As a unit takes losses and shrinks toward cohort-size, efficiency rises to 1.0.
    getCombatEff(unit) {
        const baseEff = SIZE_CONFIG[unit.size].combatEff;
        if (baseEff >= 1.0) return 1.0;
        // Lerp toward 1.0 as current hp drops toward cohort strength
        const cohortHp = SIZE_CONFIG[UnitSize.COHORT].strength;
        const ratio = Math.min(1.0, Math.max(0.0, (unit.hp - cohortHp) / (unit.maxHp - cohortHp)));
        // At full hp: ratio=1 → baseEff (0.25). At cohort hp or below: ratio=0 → 1.0
        return 1.0 - ratio * (1.0 - baseEff);
    },

    // Type advantage bonuses
    getTypeBonus(attacker, defender) {
        const ac = attacker.category;
        const dc = defender.category;

        if (ac === 'infantry' && dc === 'cavalry') return 1.25;
        if (ac === 'cavalry' && dc === 'archers') return 1.40;
        if (ac === 'archers' && dc === 'infantry') return 1.25;

        return 1.0;
    },

    // Height/hill advantage
    getHeightBonus(attacker, defender) {
        const aRadius = attacker.getCollisionRadius();
        const dRadius = defender.getCollisionRadius();
        const aHill = GameMap.getHillOverlap(attacker.x, attacker.y, aRadius);
        const dHill = GameMap.getHillOverlap(defender.x, defender.y, dRadius);
        let bonus = 1.0 + (aHill - dHill);
        const aH = GameMap.getHeight(attacker.x, attacker.y);
        const dH = GameMap.getHeight(defender.x, defender.y);
        bonus += (aH - dH) * 0.15;
        return Math.max(0.7, bonus);
    },

    // Forest bonus for archers shooting FROM forest - proportional to overlap
    getForestBonus(unit) {
        if (unit.category === 'archers') {
            const overlap = GameMap.getForestOverlap(unit.x, unit.y, unit.getCollisionRadius());
            if (overlap > 0) {
                return 1.0 + overlap * 0.10;
            }
        }
        return 1.0;
    },

    // Forest cover: target in forest takes less ranged damage - proportional to overlap
    getForestCover(target) {
        const overlap = GameMap.getForestOverlap(target.x, target.y, target.getCollisionRadius());
        if (overlap > 0) {
            return 1.0 - overlap * 0.40;
        }
        return 1.0;
    },

    // Flank/rear attack bonus: attacker deals more damage from the side or behind
    // Returns multiplier: 1.0 (frontal 0-60°), up to 1.15 (flank 60-90°), up to 1.35 (rear 90-180°)
    getFacingBonus(attacker, defender) {
        // Direction from defender to attacker
        const dx = attacker.x - defender.x;
        const dy = attacker.y - defender.y;
        const attackAngle = Math.atan2(dy, dx);

        // Defender's facing direction
        let angleDiff = attackAngle - defender.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        // angleDiff ~0 means attacker is in front, ~PI means attacker is behind

        const absAngle = Math.abs(angleDiff);
        const FLANK_START = Math.PI / 3;   // 60° — flank zone begins
        const REAR_START = Math.PI * 0.5;  // 90° — rear zone begins

        if (absAngle < FLANK_START) {
            return 1.0; // frontal attack, no bonus
        }
        if (absAngle < REAR_START) {
            // Flank: scale from 0% at 60° to 15% at 90°
            const flankFactor = (absAngle - FLANK_START) / (REAR_START - FLANK_START);
            return 1.0 + flankFactor * 0.15;
        }
        // Rear: scale from 15% at 90° to 35% at 180°
        const rearFactor = (absAngle - REAR_START) / (Math.PI - REAR_START);
        return 1.15 + rearFactor * 0.20;
    },

    // Get facing status for visual feedback: 'front', 'flank', or 'rear'
    // Also returns the angle the attack is coming from (relative to defender)
    getFacingStatus(attacker, defender) {
        const dx = attacker.x - defender.x;
        const dy = attacker.y - defender.y;
        const attackAngle = Math.atan2(dy, dx);

        let angleDiff = attackAngle - defender.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const absAngle = Math.abs(angleDiff);
        let status = 'front';
        if (absAngle >= Math.PI * 0.5) status = 'rear';
        else if (absAngle >= Math.PI / 3) status = 'flank';

        return { status, angleDiff, attackAngle };
    },

    // Check if two units should engage in melee combat
    checkEngagement(unitA, unitB) {
        if (!unitA.alive || !unitB.alive) return false;
        if (unitA.team === unitB.team) return false;
        // Routing units cannot be engaged — they are fleeing
        if (unitA.routing || unitB.routing) return false;
        // Already engaged with each other?
        if (unitA.combatTargets.includes(unitB)) return false;

        const dx = unitA.x - unitB.x;
        const dy = unitA.y - unitB.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const engageDist = unitA.getCollisionRadius() + unitB.getCollisionRadius() + 5;

        return dist <= engageDist;
    },

    // Start combat between two units (allows multi-unit engagement)
    engage(unitA, unitB) {
        if (!unitA.combatTargets.includes(unitB)) {
            unitA.combatTargets.push(unitB);
        }
        if (!unitB.combatTargets.includes(unitA)) {
            unitB.combatTargets.push(unitA);
        }
        // Stop movement on engagement (but never clear a routing unit's flee target)
        if (!unitA.routing) { unitA.targetX = null; unitA.targetY = null; }
        if (!unitB.routing) { unitB.targetX = null; unitB.targetY = null; }

        // Push units apart so they touch but don't overlap
        this.separateUnits(unitA, unitB);
    },

    // Disengage a unit from all its combat engagements
    disengage(unit) {
        unit.removeFromAllCombat();
        unit.retreatPenalty = 1.0; // 1s of +50% damage taken and 70% speed
    },

    // Push two combat-locked units apart so they are close but not deeply overlapping
    separateUnits(unitA, unitB) {
        const dx = unitB.x - unitA.x;
        const dy = unitB.y - unitA.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return;

        const touchDist = unitA.getCollisionRadius() + unitB.getCollisionRadius();
        const penetration = touchDist - dist;
        // Only push if significantly overlapping (>5px), gentle push to reduce combat sliding
        if (penetration > 5) {
            const nx = dx / dist;
            const ny = dy / dist;
            const push = (penetration - 5) * 0.08;
            const rA = unitA.getCollisionRadius();
            const rB = unitB.getCollisionRadius();
            // Check river/ditch before applying push — never push units into water
            const newAx = unitA.x - nx * push;
            const newAy = unitA.y - ny * push;
            const newBx = unitB.x + nx * push;
            const newBy = unitB.y + ny * push;
            if (!GameMap.isRiverBlocking(newAx, newAy, rA)) {
                unitA.x = Math.max(rA, Math.min(GameMap.width - rA, newAx));
                unitA.y = Math.max(rA, Math.min(GameMap.height - rA, newAy));
            }
            if (!GameMap.isRiverBlocking(newBx, newBy, rB)) {
                unitB.x = Math.max(rB, Math.min(GameMap.width - rB, newBx));
                unitB.y = Math.max(rB, Math.min(GameMap.height - rB, newBy));
            }
        }
    },

    // HP-based damage scaling: units deal less damage as they lose troops.
    // sqrt curve: at 25% HP → 50% damage, at 50% HP → 71% damage, at 100% HP → 100%
    getHpScaling(unit) {
        return Math.sqrt(unit.hp / unit.maxHp);
    },

    // Morale-based damage multiplier for attacker
    getMoraleMod(unit) {
        if (unit.morale >= 70) return 1.0 + (unit.morale - 70) / 300; // +0% to +10%
        if (unit.morale >= 30) return 0.95; // -5% when wavering
        return 0.80; // -20% when broken (should be routing)
    },

    // Process combat damage between two units for one tick
    processCombatPair(unitA, unitB, dt) {
        if (!unitA.alive || !unitB.alive) return;

        // A attacks B — but digging units deal no damage
        if (!unitA.digging) {
            const facingA = this.getFacingBonus(unitA, unitB);
            const effA = this.getCombatEff(unitA);
            const hpA = this.getHpScaling(unitA);
            const vetA = unitA.veteran ? 1.10 : 1.0;
            const campDmgA = (Campaign.active && unitA.team === 'player') ? Campaign.getDamageBuff(unitA) : 1.0;
            const moraleA = this.getMoraleMod(unitA);
            const dpsA = unitA.strength * this.DPS_FACTOR * unitA.damageMod * effA * hpA *
                this.getTypeBonus(unitA, unitB) * this.getHeightBonus(unitA, unitB) *
                this.getForestBonus(unitA) * facingA * vetA * moraleA * campDmgA;
            unitB.takeDamage(dpsA * dt);
        }

        // Track all facing threats on B from A
        const statusB = this.getFacingStatus(unitA, unitB);
        if (statusB.status !== 'front') {
            unitB.facingThreats.push({ status: statusB.status, attackAngle: statusB.attackAngle });
        }

        // B attacks A — but digging units deal no damage
        if (unitB.alive && !unitB.digging) {
            const facingB = this.getFacingBonus(unitB, unitA);
            const effB = this.getCombatEff(unitB);
            const hpB = this.getHpScaling(unitB);
            const vetB = unitB.veteran ? 1.10 : 1.0;
            const campDmgB = (Campaign.active && unitB.team === 'player') ? Campaign.getDamageBuff(unitB) : 1.0;
            const moraleB = this.getMoraleMod(unitB);
            const dpsB = unitB.strength * this.DPS_FACTOR * unitB.damageMod * effB * hpB *
                this.getTypeBonus(unitB, unitA) * this.getHeightBonus(unitB, unitA) *
                this.getForestBonus(unitB) * facingB * vetB * moraleB * campDmgB;
            unitA.takeDamage(dpsB * dt);

            // Track all facing threats on A from B
            const statusA = this.getFacingStatus(unitB, unitA);
            if (statusA.status !== 'front') {
                unitA.facingThreats.push({ status: statusA.status, attackAngle: statusA.attackAngle });
            }
        }
    },

    // Archer ranged attack
    processArcherAttack(archer, target, dt) {
        if (!archer.alive || !target.alive) return;
        if (archer.inCombat) return;
        if (archer.attackCooldown > 0) return;

        const dx = target.x - archer.x;
        const dy = target.y - archer.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > archer.range) return;

        const effArch = this.getCombatEff(archer);
        const hpArch = this.getHpScaling(archer);
        const vetArch = archer.veteran ? 1.10 : 1.0;
        const campDmgArch = (Campaign.active && archer.team === 'player') ? Campaign.getDamageBuff(archer) : 1.0;
        const damage = archer.strength * this.DPS_FACTOR * 0.65 * effArch * hpArch *
            archer.damageMod * this.getTypeBonus(archer, target) *
            this.getForestBonus(archer) * this.getForestCover(target) * vetArch * campDmgArch;
        target.takeDamage(damage);
        archer.attackCooldown = 1.2;
        archer.arrowTarget = target;

        return { from: { x: archer.x, y: archer.y }, to: { x: target.x, y: target.y } };
    },

    // Push apart overlapping units (not combat-locked pairs)
    // Only acts when units significantly overlap (>2px into each other)
    resolveAllCollisions(allUnits) {
        const pushX = new Float32Array(allUnits.length);
        const pushY = new Float32Array(allUnits.length);

        for (let i = 0; i < allUnits.length; i++) {
            const a = allUnits[i];
            if (!a.alive) continue;
            const rA = a.getCollisionRadius();
            for (let j = i + 1; j < allUnits.length; j++) {
                const b = allUnits[j];
                if (!b.alive) continue;
                if (a.combatTargets.includes(b)) continue;

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const distSq = dx * dx + dy * dy;
                const touchDist = rA + b.getCollisionRadius();
                // Quick reject: skip if clearly not overlapping
                if (distSq >= touchDist * touchDist) continue;

                const dist = Math.sqrt(distSq);
                if (dist < 0.5) continue;
                const penetration = touchDist - dist;
                // Dead zone: ignore overlaps smaller than 1px to prevent micro-jitter
                if (penetration < 1) continue;

                const nx = dx / dist;
                const ny = dy / dist;
                const aLocked = a.inCombat;
                const bLocked = b.inCombat;
                if (aLocked && bLocked) continue;

                // Same-team moving units get soft collisions to prevent blob clumping
                const sameTeam = a.team === b.team;
                const bothMoving = !aLocked && !bLocked && a.targetX !== null && b.targetX !== null;
                const pushFactor = (sameTeam && bothMoving) ? 0.12 : 0.35;
                const push = (penetration - 1) * pushFactor;

                if (aLocked) {
                    pushX[j] += nx * push;
                    pushY[j] += ny * push;
                } else if (bLocked) {
                    pushX[i] -= nx * push;
                    pushY[i] -= ny * push;
                } else {
                    pushX[i] -= nx * push * 0.5;
                    pushY[i] -= ny * push * 0.5;
                    pushX[j] += nx * push * 0.5;
                    pushY[j] += ny * push * 0.5;
                }
            }
        }

        // Apply accumulated pushes once
        const _blocked = (px, py, r) => GameMap.isDitchBlocking(px, py, r) || GameMap.isRiverBlocking(px, py, r);
        for (let i = 0; i < allUnits.length; i++) {
            if (pushX[i] === 0 && pushY[i] === 0) continue;
            const u = allUnits[i];
            if (!u.alive) continue;
            const r = u.getCollisionRadius();
            const newX = u.x + pushX[i];
            const newY = u.y + pushY[i];
            if (!_blocked(newX, newY, r)) {
                u.x = Math.max(r, Math.min(GameMap.width - r, newX));
                u.y = Math.max(r, Math.min(GameMap.height - r, newY));
            }
        }
    },

    // Auto-engage: idle units seek nearby visible enemies
    // Triggers immediately if under fire, otherwise after 2s idle
    autoEngageIdle(playerUnits, enemyUnits) {
        const engageRange = 150;

        for (const pu of playerUnits) {
            if (!pu.alive || pu.inCombat || pu.routing) continue;
            if (pu.targetX !== null) continue;
            // Skip archers — they should hold position and shoot
            if (pu.category === 'archers') continue;
            // Hold ground: skip auto-engage
            if (pu.holdGround) continue;
            // Under fire: engage immediately with extended range
            const underFire = pu._underFire;
            pu._underFire = false; // reset flag each tick
            // Only auto-engage after being idle for 2 seconds (or immediately if under fire)
            if (!underFire && pu.idleTime < 2.0) continue;

            let closest = null, closestDist = engageRange;
            for (const eu of enemyUnits) {
                if (!eu.alive) continue;
                // Only auto-engage enemies visible to this unit's team
                if (!Visibility.isVisible(eu.x, eu.y, pu.team)) continue;
                const dx = eu.x - pu.x;
                const dy = eu.y - pu.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < closestDist) {
                    closest = eu;
                    closestDist = d;
                }
            }

            if (closest) {
                pu.targetX = closest.x;
                pu.targetY = closest.y;
                pu.idleTime = 0; // Reset so it doesn't spam re-acquire every frame
            }
        }
    },

    // Update all combat in the game
    updateAll(playerUnits, enemyUnits, dt) {
        const arrows = [];

        // Reset facing threats for all units each frame
        for (const u of playerUnits) u.facingThreats = [];
        for (const u of enemyUnits) u.facingThreats = [];

        // Auto-engage idle player units
        this.autoEngageIdle(playerUnits, enemyUnits);

        // Check for new engagements (any pair of close enemy units)
        for (const pu of playerUnits) {
            if (!pu.alive) continue;
            for (const eu of enemyUnits) {
                if (!eu.alive) continue;
                if (this.checkEngagement(pu, eu)) {
                    this.engage(pu, eu);
                }
            }
        }

        // Process existing combats — iterate all unique engaged pairs
        const processedPairs = new Set();
        const allUnits = [...playerUnits, ...enemyUnits];
        for (const unit of allUnits) {
            if (!unit.alive) continue;
            // Clean dead targets from combatTargets
            for (let i = unit.combatTargets.length - 1; i >= 0; i--) {
                if (!unit.combatTargets[i].alive) {
                    unit.combatTargets.splice(i, 1);
                }
            }
            // Process each combat pair once
            for (const target of unit.combatTargets) {
                const pairKey = Math.min(unit.id, target.id) + '_' + Math.max(unit.id, target.id);
                if (processedPairs.has(pairKey)) continue;
                processedPairs.add(pairKey);
                this.separateUnits(unit, target);
                this.processCombatPair(unit, target, dt);
            }
        }

        // Morale: check for routs, cascades, and last stands
        this._processMorale(allUnits, playerUnits, enemyUnits, dt);

        // Pursuit damage: nearby enemies strike routing units as they flee
        this._processPursuitDamage(allUnits, dt);

        // Resolve collisions for all units (prevent overlap)
        this.resolveAllCollisions(allUnits);

        // Archer ranged attacks — only target visible enemies
        for (const archer of allUnits) {
            if (!archer.alive || archer.category !== 'archers' || archer.inCombat) continue;

            const enemies = archer.team === 'player' ? enemyUnits : playerUnits;
            let closest = null, closestDist = archer.range + 1;

            for (const enemy of enemies) {
                if (!enemy.alive) continue;
                // Archers can only shoot enemies visible to their team
                if (!Visibility.isVisible(enemy.x, enemy.y, archer.team)) continue;
                const dx = enemy.x - archer.x;
                const dy = enemy.y - archer.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < closestDist) {
                    closest = enemy;
                    closestDist = d;
                }
            }

            if (closest) {
                const arrow = this.processArcherAttack(archer, closest, dt);
                if (arrow) arrows.push(arrow);
            }
        }

        return arrows;
    },

    // Process morale: rout checks, cascades, last stands, and morale boosts
    _processMorale(allUnits, playerUnits, enemyUnits, dt) {
        const newRouts = [];
        const OUTNUMBER_RANGE = 100;
        const OUTNUMBER_RANGE_SQ = OUTNUMBER_RANGE * OUTNUMBER_RANGE;

        for (const u of allUnits) {
            if (!u.alive || u.routing) continue;

            // Outnumbered morale drain: compare nearby friendly vs enemy strength within 100px
            if (u.inCombat) {
                let friendlyStr = 0, enemyStr = 0;
                for (const other of allUnits) {
                    if (!other.alive || other.routing) continue;
                    const dx = other.x - u.x, dy = other.y - u.y;
                    if (dx * dx + dy * dy > OUTNUMBER_RANGE_SQ) continue;
                    if (other.team === u.team) friendlyStr += other.hp;
                    else enemyStr += other.hp;
                }
                // If enemy strength is 1.5x+ friendly, drain morale
                if (enemyStr > friendlyStr * 1.5 && friendlyStr > 0) {
                    const ratio = enemyStr / friendlyStr; // e.g. 2.0 means 2:1 outnumbered
                    const drain = Math.min(15, (ratio - 1.5) * 10); // 1.5:1=0, 2:1=5, 3:1=15/sec
                    u.morale = Math.max(0, u.morale - drain * dt);
                }
            }

            // Check for last stand: morale 0, truly surrounded (enemies from 3+ distinct directions)
            if (u.morale <= 0 && u.inCombat && u.combatTargets.length >= 3) {
                // Check if enemies are actually from distinct directions (120°+ spread)
                const angles = u.combatTargets.filter(t => t.alive).map(t => Math.atan2(t.y - u.y, t.x - u.x));
                let surrounded = false;
                if (angles.length >= 3) {
                    angles.sort((a, b) => a - b);
                    // Check if enemies span at least 180° around the unit
                    let maxGap = 0;
                    for (let i = 0; i < angles.length; i++) {
                        const next = (i + 1) % angles.length;
                        let gap = angles[next] - angles[i];
                        if (next === 0) gap += Math.PI * 2;
                        if (gap > maxGap) maxGap = gap;
                    }
                    // If largest gap is < 180°, unit is truly surrounded
                    surrounded = maxGap < Math.PI;
                }
                if (surrounded) {
                    u.lastStand = true;
                    continue; // fights to death, no routing
                }
            }

            // Reset lastStand if no longer surrounded
            if (u.lastStand && (!u.inCombat || u.combatTargets.filter(t => t.alive).length < 3)) {
                u.lastStand = false;
            }

            // Check for rout: morale below 30
            if (u.morale < 30 && !u.lastStand) {
                u.triggerRout();
                newRouts.push(u);
                // Kill feed + event tracking
                const tc = TYPE_CONFIG[u.type], sc = SIZE_CONFIG[u.size];
                const label = (tc ? tc.label : 'Unit') + ' ' + (sc ? sc.label : '');
                const prefix = u.team === 'player' ? 'Your' : 'Enemy';
                const color = u.team === 'player' ? '#d08060' : '#8ac070';
                Renderer.addBattleLogEntry(`${prefix} ${label} routed!`, color);
                if (u.team === 'player') { Game._battleEvents.playerRouted++; }
                else { Game._battleEvents.enemyRouted++; }
            }
        }

        // Cascade: each new rout affects nearby units
        for (const routed of newRouts) {
            for (const u of allUnits) {
                if (!u.alive || u.routing || u === routed) continue;
                const dx = u.x - routed.x;
                const dy = u.y - routed.y;
                const distSq = dx * dx + dy * dy;
                if (distSq > 200 * 200) continue;

                if (u.team === routed.team) {
                    // Friendly rout: lose 15 morale
                    u.morale = Math.max(0, u.morale - 15);
                } else {
                    // Enemy routed: gain 8 morale
                    u.morale = Math.min(100, u.morale + 8);
                }
            }
        }
    },

    // Pursuit damage: enemies near routing units deal damage without formal engagement
    _processPursuitDamage(allUnits, dt) {
        for (const runner of allUnits) {
            if (!runner.alive || !runner.routing) continue;

            // Find nearby enemies that can strike the fleeing unit
            for (const attacker of allUnits) {
                if (!attacker.alive || attacker.routing || attacker.team === runner.team) continue;
                if (attacker.category === 'archers') continue; // archers use ranged system

                const dx = attacker.x - runner.x;
                const dy = attacker.y - runner.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const strikeRange = attacker.getCollisionRadius() + runner.getCollisionRadius() + 20;

                if (dist > strikeRange) continue;

                // Deal pursuit damage — attacker hits the fleeing unit
                const hpFrac = attacker.hp / attacker.maxHp;
                const eff = Math.sqrt(hpFrac);
                const dps = attacker.strength * this.DPS_FACTOR * attacker.damageMod * eff;
                const damage = dps * dt;

                // Routing units take +50% damage (already in takeDamage, but apply here too)
                runner.takeDamage(damage);

                // Attacker gains a small morale boost from striking a fleeing enemy
                attacker.morale = Math.min(100, attacker.morale + 1 * dt);
            }
        }
    },

    // Called when a unit dies in combat — morale effects on nearby units
    onUnitKilled(deadUnit, allUnits) {
        for (const u of allUnits) {
            if (!u.alive || u === deadUnit) continue;
            const dx = u.x - deadUnit.x;
            const dy = u.y - deadUnit.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > 200 * 200) continue;

            if (u.team === deadUnit.team) {
                // Comrade fell: lose 10 morale
                u.morale = Math.max(0, u.morale - 10);
            } else {
                // Killed an enemy: gain 10 morale
                u.morale = Math.min(100, u.morale + 10);
            }
        }
    }
};
