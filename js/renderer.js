// Canvas rendering
const Renderer = {
    canvas: null,
    ctx: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    arrows: [], // active arrow projectiles for visual
    arrowTimer: 0,
    deathMarkers: [], // { x, y, team, time } — fade out over 10s
    battleTimer: 0, // for pulsing effects
    placementTimer: 0, // for placement zone pulsing
    battleLog: [], // { text, color, time } — scrolling kill feed
    rallyEffects: [], // { x, y, time } — expanding ring effects

    init() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
    },

    resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const targetW = 1920;
        const targetH = 1080;
        // Fill the width fully, let height adapt (bottom bar overlays)
        this.scale = w / targetW;
        const scaledH = targetH * this.scale;
        // If scaled height exceeds window, scale to fit height instead
        if (scaledH > h) {
            this.scale = h / targetH;
        }
        this.canvas.width = targetW * this.scale;
        this.canvas.height = targetH * this.scale;
        this.canvas.style.width = this.canvas.width + 'px';
        this.canvas.style.height = this.canvas.height + 'px';
        this.offsetX = (w - this.canvas.width) / 2;
        this.offsetY = 0; // Top-align the map
        this.canvas.style.marginLeft = this.offsetX + 'px';
        this.canvas.style.marginTop = '0px';
    },

    // Convert screen coords to game coords
    screenToGame(sx, sy) {
        return {
            x: (sx - this.offsetX) / this.scale,
            y: (sy - this.offsetY) / this.scale
        };
    },

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    },

    drawMap() {
        this.ctx.save();
        this.ctx.scale(this.scale, this.scale);
        this.ctx.drawImage(GameMap.canvas, 0, 0);
        this.ctx.restore();
    },

    drawPlacementZone() {
        this.ctx.save();
        this.ctx.scale(this.scale, this.scale);

        const pulse = 0.5 + 0.5 * Math.sin(this.placementTimer * 2);
        const fillAlpha = 0.06 + pulse * 0.18;
        const borderAlpha = 0.4 + pulse * 0.55;
        const lineW = 1.5 + pulse * 1.5;

        const isGuestSide = Network.isMultiplayer && !Network.isHost;

        if (GameMap.mapType === 'ambush') {
            // Circular placement zone in center
            const cx = GameMap.width / 2, cy = GameMap.height / 2;
            this.ctx.fillStyle = `rgba(40, 180, 40, ${fillAlpha})`;
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, 250, 0, Math.PI * 2);
            this.ctx.fill();
            // Pulsing green dashed circle border
            this.ctx.strokeStyle = `rgba(60, 220, 60, ${borderAlpha})`;
            this.ctx.lineWidth = lineW;
            this.ctx.setLineDash([10, 10]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        } else {
            const zoneW = GameMap.width / 6;
            const zoneX = isGuestSide ? GameMap.width - zoneW : 0;
            const lineX = isGuestSide ? GameMap.width - zoneW : zoneW;
            // Guest stays red, player is green
            const fillColor = isGuestSide ? `rgba(180, 40, 40, ${fillAlpha})` : `rgba(40, 180, 40, ${fillAlpha})`;
            const borderColor = isGuestSide ? `rgba(220, 60, 60, ${borderAlpha})` : `rgba(60, 220, 60, ${borderAlpha})`;
            this.ctx.fillStyle = fillColor;
            this.ctx.fillRect(zoneX, 0, zoneW, GameMap.height);
            this.ctx.strokeStyle = borderColor;
            this.ctx.lineWidth = lineW;
            this.ctx.setLineDash([10, 10]);
            this.ctx.beginPath();
            this.ctx.moveTo(lineX, 0);
            this.ctx.lineTo(lineX, GameMap.height);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        this.ctx.restore();
    },

    drawPlacementZoneTooltip(mouseX, mouseY) {
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.scale, this.scale);

        const isGuestSide = Network.isMultiplayer && !Network.isHost;
        const lines = ['Place your units here', 'Click to place • Drag to rotate'];

        ctx.font = '12px Georgia';
        let maxW = 0;
        for (const line of lines) {
            const w = ctx.measureText(line).width;
            if (w > maxW) maxW = w;
        }
        const padX = 8, padY = 5, lineH = 16;
        const boxW = maxW + padX * 2;
        const boxH = lines.length * lineH + padY * 2;

        let tx = mouseX + 15;
        let ty = mouseY - boxH - 5;
        if (tx + boxW > 1920) tx = mouseX - boxW - 10;
        if (ty < 5) ty = mouseY + 20;

        ctx.fillStyle = 'rgba(20, 15, 10, 0.9)';
        ctx.fillRect(tx, ty, boxW, boxH);
        ctx.strokeStyle = '#8b6914';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx, ty, boxW, boxH);

        const titleColor = isGuestSide ? '#e08060' : '#a0d090';
        for (let i = 0; i < lines.length; i++) {
            ctx.fillStyle = i === 0 ? titleColor : '#c0b898';
            ctx.fillText(lines[i], tx + padX, ty + padY + (i + 1) * lineH - 3);
        }

        ctx.restore();
    },

    drawUnit(unit) {
        if (!unit.alive) return;

        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.scale, this.scale);
        ctx.translate(unit.x, unit.y);
        ctx.rotate(unit.angle);

        const sc = SIZE_CONFIG[unit.size];
        const tc = TYPE_CONFIG[unit.type];
        const isPlayer = unit.team === 'player';

        // Shrink unit visually as it takes damage
        const hpRatio = unit.hp / unit.maxHp;
        const sizeScale = 0.4 + 0.6 * hpRatio;
        ctx.scale(sizeScale, sizeScale);

        // Flag-style colors: vivid opaque fill, white symbol, dark border
        const isMerc = isPlayer && unit._isMercenary;
        const fillColor = isMerc ? 'rgba(110, 100, 30, 0.95)'
            : isPlayer ? 'rgba(20, 140, 20, 0.95)'
            : 'rgba(170, 25, 20, 0.95)';
        const borderColor = 'rgba(0, 0, 0, 0.75)';
        const symbolColor = 'rgba(255, 255, 255, 0.92)';

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = unit.selected ? 3 : 2;

        // Draw shape — CENTURY=square, COHORT=rect, LEGION=rect
        if (sc.shape === 'square') {
            const hs = sc.size / 2;
            ctx.fillRect(-hs, -hs, sc.size, sc.size);
            ctx.strokeRect(-hs, -hs, sc.size, sc.size);
            if (unit.selected) {
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 2;
                ctx.strokeRect(-hs - 3, -hs - 3, sc.size + 6, sc.size + 6);
            }
        } else { // rect (COHORT and LEGION)
            const hw = sc.width / 2, hh = sc.height / 2;
            ctx.fillRect(-hw, -hh, sc.width, sc.height);
            ctx.strokeRect(-hw, -hh, sc.width, sc.height);
            if (unit.selected) {
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 2;
                ctx.strokeRect(-hw - 3, -hh - 3, sc.width + 6, sc.height + 6);
            }
        }

        // Draw symbol inside (rotates with unit)
        // Inset and line width scale to the smaller dimension of the shape
        const halfMin = sc.shape === 'square' ? sc.size / 2 : Math.min(sc.width, sc.height) / 2;
        const inset = Math.max(2, halfMin * 0.22);
        const symW = sc.shape === 'square' ? sc.size / 2 - inset : sc.width / 2 - inset;
        const symH = sc.shape === 'square' ? sc.size / 2 - inset : sc.height / 2 - inset;
        const symbolLW = tc.bold ? Math.max(2.5, halfMin * 0.32) : Math.max(1.2, halfMin * 0.13);

        ctx.fillStyle = symbolColor;
        ctx.strokeStyle = symbolColor;
        ctx.lineWidth = symbolLW;
        ctx.lineCap = 'round';

        if (tc.symbol === 'x') {
            ctx.beginPath();
            ctx.moveTo(-symW, -symH);
            ctx.lineTo(symW, symH);
            ctx.moveTo(symW, -symH);
            ctx.lineTo(-symW, symH);
            ctx.stroke();
        } else if (tc.symbol === '/') {
            ctx.beginPath();
            ctx.moveTo(-symW, symH);
            ctx.lineTo(symW, -symH);
            ctx.stroke();
        } else if (tc.symbol === '•') {
            ctx.beginPath();
            ctx.arc(0, 0, Math.min(symW, symH) * 0.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // Direction indicator — chevron at the front edge
        const frontDist = sc.shape === 'square' ? sc.size / 2 : sc.width / 2;
        const chevSize = frontDist * 0.4;
        const chevX = frontDist + 2;
        ctx.fillStyle = isPlayer ? 'rgba(180, 255, 180, 0.8)' : 'rgba(255, 180, 150, 0.8)';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chevX + chevSize, 0);
        ctx.lineTo(chevX - chevSize * 0.3, -chevSize * 0.6);
        ctx.lineTo(chevX, 0);
        ctx.lineTo(chevX - chevSize * 0.3, chevSize * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();

        // Health bar (drawn without rotation)
        if (unit.hp < unit.maxHp) {
            ctx.save();
            ctx.scale(this.scale, this.scale);
            const barW = sc.shape === 'rect' ? Math.round(Math.max(sc.width, sc.height) * 0.9) : Math.round(sc.size * 0.9);
            const barH = 5;
            const barX = unit.x - barW / 2;
            const rawOffset = sc.shape === 'square' ? sc.size / 2 : sc.height / 2;
            const barY = unit.y - rawOffset * sizeScale - 10;

            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(barX, barY, barW, barH);

            ctx.fillStyle = hpRatio > 0.5 ? '#4a8a2a' : hpRatio > 0.25 ? '#c8a020' : '#a03020';
            ctx.fillRect(barX, barY, barW * hpRatio, barH);

            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(barX, barY, barW, barH);
            ctx.restore();
        }

        // Morale bar (vertical, left side of unit, blue)
        if (unit.morale < 100) {
            ctx.save();
            ctx.scale(this.scale, this.scale);
            const rawOff = sc.shape === 'square' ? sc.size / 2 : Math.max(sc.width, sc.height) / 2;
            const mBarH = rawOff * 2 * sizeScale; // full height matches unit visual size
            const mBarW = 3;
            const mBarX = unit.x - rawOff * sizeScale - 6;
            const mBarY = unit.y - mBarH / 2;
            const mFill = unit.morale / 100;

            // Background (faded blue)
            ctx.fillStyle = 'rgba(60, 100, 180, 0.2)';
            ctx.fillRect(mBarX, mBarY, mBarW, mBarH);
            // Fill from bottom (blue)
            ctx.fillStyle = unit.routing ? 'rgba(180, 60, 60, 0.8)' : 'rgba(60, 100, 180, 0.8)';
            ctx.fillRect(mBarX, mBarY + mBarH * (1 - mFill), mBarW, mBarH * mFill);
            ctx.restore();
        }

        // Veteran / mercenary / upgrade indicators (above unit, no rotation)
        if (isPlayer && (unit._veteranId || unit._isMercenary)) {
            ctx.save();
            ctx.scale(this.scale, this.scale);
            const rawOff = sc.shape === 'square' ? sc.size / 2 : sc.height / 2;
            const indicY = unit.y - rawOff * sizeScale - (unit.hp < unit.maxHp ? 18 : 10);
            const indicX = unit.x;

            ctx.font = 'bold 9px Georgia';
            ctx.textAlign = 'center';

            if (unit._veteranId) {
                // Gold star for veteran
                ctx.fillStyle = '#e0c060';
                ctx.fillText('\u2605', indicX, indicY);

                // Upgrade pips to the right of the star
                const dmg = unit._vetDamageUps || 0;
                const arm = unit._vetArmorUps || 0;
                let pipX = indicX + 7;
                for (let p = 0; p < dmg; p++) {
                    ctx.fillStyle = '#d04030';
                    ctx.beginPath();
                    ctx.arc(pipX, indicY - 3, 2.5, 0, Math.PI * 2);
                    ctx.fill();
                    pipX += 6;
                }
                for (let p = 0; p < arm; p++) {
                    ctx.fillStyle = '#4080d0';
                    ctx.beginPath();
                    ctx.arc(pipX, indicY - 3, 2.5, 0, Math.PI * 2);
                    ctx.fill();
                    pipX += 6;
                }
            } else if (unit._isMercenary) {
                // Olive M for mercenary
                ctx.fillStyle = '#d4a040';
                ctx.fillText('M', indicX, indicY);
            }
            ctx.restore();
        }

        // Facing threat indicators — one arc per flank/rear attacker
        if (unit.inCombat && unit.facingThreats.length > 0) {
            ctx.save();
            ctx.scale(this.scale, this.scale);
            ctx.translate(unit.x, unit.y);

            const threatRadius = sc.shape === 'square' ? sc.size / 2 + 6 : Math.max(sc.width, sc.height) / 2 + 6;

            for (const threat of unit.facingThreats) {
                const attackFrom = threat.attackAngle;
                const isRear = threat.status === 'rear';
                const arcSpan = isRear ? Math.PI * 0.6 : Math.PI * 0.4;

                const color = isRear ? 'rgba(220, 40, 20, 0.6)' : 'rgba(230, 160, 30, 0.6)';
                const fillColor = isRear ? 'rgba(220, 40, 20, 0.15)' : 'rgba(230, 160, 30, 0.12)';

                // Warning arc stroke
                ctx.beginPath();
                ctx.arc(0, 0, threatRadius, attackFrom - arcSpan / 2, attackFrom + arcSpan / 2);
                ctx.strokeStyle = color;
                ctx.lineWidth = 2.5;
                ctx.stroke();

                // Filled arc wedge
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.arc(0, 0, threatRadius, attackFrom - arcSpan / 2, attackFrom + arcSpan / 2);
                ctx.closePath();
                ctx.fillStyle = fillColor;
                ctx.fill();

                // Warning arrow pointing inward
                const arrowDist = threatRadius + 5;
                const ax = Math.cos(attackFrom) * arrowDist;
                const ay = Math.sin(attackFrom) * arrowDist;
                const tipX = Math.cos(attackFrom) * (threatRadius - 2);
                const tipY = Math.sin(attackFrom) * (threatRadius - 2);
                const perpX = -Math.sin(attackFrom) * 4;
                const perpY = Math.cos(attackFrom) * 4;

                ctx.beginPath();
                ctx.moveTo(tipX, tipY);
                ctx.lineTo(ax + perpX, ay + perpY);
                ctx.lineTo(ax - perpX, ay - perpY);
                ctx.closePath();
                ctx.fillStyle = color;
                ctx.fill();
            }

            ctx.restore();
        }
    },

    drawArrows(arrows, dt) {
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.scale, this.scale);

        // Add new arrows
        for (const a of arrows) {
            this.arrows.push({ ...a, t: 0, duration: 0.4 });
        }

        // Draw and update existing arrows
        this.arrows = this.arrows.filter(a => {
            a.t += dt;
            if (a.t >= a.duration) return false;

            const progress = a.t / a.duration;
            const x = a.from.x + (a.to.x - a.from.x) * progress;
            const y = a.from.y + (a.to.y - a.from.y) * progress;
            const angle = Math.atan2(a.to.y - a.from.y, a.to.x - a.from.x);

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.strokeStyle = '#5a4020';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-8, 0);
            ctx.lineTo(4, 0);
            ctx.moveTo(2, -2);
            ctx.lineTo(5, 0);
            ctx.lineTo(2, 2);
            ctx.stroke();
            ctx.restore();

            return true;
        });

        ctx.restore();
    },

    drawSelectionBox(x1, y1, x2, y2) {
        this.ctx.save();
        this.ctx.scale(this.scale, this.scale);
        this.ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([4, 4]);
        this.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        this.ctx.fillStyle = 'rgba(255, 215, 0, 0.05)';
        this.ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        this.ctx.setLineDash([]);
        this.ctx.restore();
    },

    drawLineDragPreview(positions, units) {
        if (!positions || positions.length === 0) return;
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.scale, this.scale);

        // Draw the line itself (dashed gold)
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(positions[0].x, positions[0].y);
        ctx.lineTo(positions[positions.length - 1].x, positions[positions.length - 1].y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw ghost outlines at each position
        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            const unit = units[i];
            if (!unit) continue;

            const sc = SIZE_CONFIG[unit.size];
            ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
            ctx.fillStyle = 'rgba(255, 215, 0, 0.08)';
            ctx.lineWidth = 1.5;

            if (sc.shape === 'circle') {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, sc.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            } else if (sc.shape === 'square') {
                const hs = sc.size / 2;
                ctx.fillRect(pos.x - hs, pos.y - hs, sc.size, sc.size);
                ctx.strokeRect(pos.x - hs, pos.y - hs, sc.size, sc.size);
            } else {
                const hw = sc.width / 2, hh = sc.height / 2;
                ctx.fillRect(pos.x - hw, pos.y - hh, sc.width, sc.height);
                ctx.strokeRect(pos.x - hw, pos.y - hh, sc.width, sc.height);
            }
        }

        ctx.restore();
    },

    drawBattleInfo(playerUnits, enemyUnits) {
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.scale, this.scale);

        const pAlive = playerUnits.filter(u => u.alive).length;
        const eAlive = enemyUnits.filter(u => u.alive).length;
        const pStr = playerUnits.filter(u => u.alive).reduce((s, u) => s + u.hp, 0);
        const eStr = enemyUnits.filter(u => u.alive).reduce((s, u) => s + u.hp, 0);
        const pMaxStr = playerUnits.reduce((s, u) => s + u.maxHp, 0);
        const eMaxStr = enemyUnits.reduce((s, u) => s + u.maxHp, 0);

        const boxW = 300, boxH = 80;
        const boxX = 10, boxY = 10;
        const barW = 160, barH = 10, barX = 90, barGap = 6;

        // Background
        ctx.fillStyle = 'rgba(30, 20, 10, 0.8)';
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeStyle = '#8b6914';
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        // Player label + bar
        ctx.font = '13px Georgia';
        ctx.fillStyle = '#8ac070';
        ctx.fillText(`You: ${pAlive}`, boxX + 8, boxY + 22);

        // Player strength bar background
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(barX, boxY + 12, barW, barH);
        // Player strength bar fill
        const pRatio = pMaxStr > 0 ? pStr / pMaxStr : 0;
        ctx.fillStyle = '#4a8a2a';
        ctx.fillRect(barX, boxY + 12, barW * pRatio, barH);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.strokeRect(barX, boxY + 12, barW, barH);

        // Enemy label + bar
        ctx.fillStyle = '#d08060';
        ctx.fillText(`Foe: ${eAlive}`, boxX + 8, boxY + 22 + barH + barGap + 12);

        // Enemy strength bar background
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(barX, boxY + 12 + barH + barGap + 2, barW, barH);
        // Enemy strength bar fill
        const eRatio = eMaxStr > 0 ? eStr / eMaxStr : 0;
        ctx.fillStyle = '#a03020';
        ctx.fillRect(barX, boxY + 12 + barH + barGap + 2, barW * eRatio, barH);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.strokeRect(barX, boxY + 12 + barH + barGap + 2, barW, barH);

        // Strength numbers
        ctx.font = '11px Georgia';
        ctx.fillStyle = '#c0c0a0';
        ctx.fillText(`${Math.round(pStr)}`, barX + barW + 6, boxY + 22);
        ctx.fillText(`${Math.round(eStr)}`, barX + barW + 6, boxY + 22 + barH + barGap + 12);

        ctx.restore();
    },

    addBattleLogEntry(text, color) {
        this.battleLog.unshift({ text, color: color || '#c0c0a0', time: 5.0 });
        if (this.battleLog.length > 8) this.battleLog.pop();
    },

    drawBattleLog(dt) {
        if (this.battleLog.length === 0) return;
        const ctx = this.ctx;
        ctx.save();

        // Draw in screen space (not scaled by game zoom)
        const rightEdge = this.canvas.width - 15;
        let y = 100;

        ctx.font = '13px Georgia';
        ctx.textAlign = 'right';
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;

        for (let i = this.battleLog.length - 1; i >= 0; i--) {
            const entry = this.battleLog[i];
            entry.time -= dt;
            if (entry.time <= 0) {
                this.battleLog.splice(i, 1);
                continue;
            }
            const alpha = Math.min(1, entry.time / 1.5);
            if (entry.color.startsWith('#')) {
                const r = parseInt(entry.color.slice(1, 3), 16);
                const g = parseInt(entry.color.slice(3, 5), 16);
                const b = parseInt(entry.color.slice(5, 7), 16);
                ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
            } else {
                ctx.fillStyle = entry.color;
            }
            ctx.fillText(entry.text, rightEdge, y);
            y += 18;
        }
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        ctx.textAlign = 'left';
        ctx.restore();
    },

    drawRallyEffects(dt) {
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.scale, this.scale);
        for (let i = this.rallyEffects.length - 1; i >= 0; i--) {
            const e = this.rallyEffects[i];
            e.time -= dt;
            if (e.time <= 0) { this.rallyEffects.splice(i, 1); continue; }
            const progress = 1 - e.time / 1.0;
            const radius = 30 + progress * 120;
            const alpha = (1 - progress) * 0.6;
            ctx.beginPath();
            ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(100, 180, 255, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.restore();
    },

    drawMoveTargets(units) {
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.scale, this.scale);

        const pulse = 0.5 + 0.5 * Math.sin(this.battleTimer * 4); // 0..1 pulsing

        for (const u of units) {
            if (!u.alive || !u.selected || u.targetX === null) continue;
            // Red dashed line from unit to target
            ctx.strokeStyle = 'rgba(220, 50, 30, 0.45)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(u.x, u.y);
            ctx.lineTo(u.targetX, u.targetY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Pulsing red target ring — larger and bolder
            const radius = 6 + pulse * 5; // 6..11 px pulsing
            const alpha = 0.5 + pulse * 0.4; // 0.5..0.9
            ctx.beginPath();
            ctx.arc(u.targetX, u.targetY, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(220, 50, 30, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Inner filled dot
            ctx.beginPath();
            ctx.arc(u.targetX, u.targetY, 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(220, 50, 30, ${alpha})`;
            ctx.fill();

            // Outer faint ring for extra visibility
            ctx.beginPath();
            ctx.arc(u.targetX, u.targetY, radius + 4, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(220, 50, 30, ${alpha * 0.3})`;
            ctx.lineWidth = 1;
            ctx.stroke();

            // Draw queued waypoints
            if (u.targetQueue && u.targetQueue.length > 0) {
                let prevX = u.targetX, prevY = u.targetY;
                ctx.setLineDash([4, 4]);
                for (let wi = 0; wi < u.targetQueue.length; wi++) {
                    const wp = u.targetQueue[wi];
                    // Dashed line from previous point
                    ctx.strokeStyle = 'rgba(220, 160, 30, 0.4)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(prevX, prevY);
                    ctx.lineTo(wp.x, wp.y);
                    ctx.stroke();
                    // Small dot at waypoint
                    ctx.beginPath();
                    ctx.arc(wp.x, wp.y, 3, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(220, 160, 30, 0.6)';
                    ctx.fill();
                    // Number label
                    ctx.fillStyle = 'rgba(220, 160, 30, 0.7)';
                    ctx.font = '9px Georgia';
                    ctx.textAlign = 'center';
                    ctx.fillText(wi + 1, wp.x, wp.y - 7);
                    prevX = wp.x;
                    prevY = wp.y;
                }
                ctx.setLineDash([]);
            }
        }

        ctx.restore();
    },

    drawDitches() {
        if (GameMap.ditches.length === 0) return;
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.scale, this.scale);

        for (const ditch of GameMap.ditches) {
            const pts = ditch.points;
            if (pts.length < 2) continue;

            // Draw the ditch as a thick brown trench
            ctx.lineWidth = ditch.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Dark fill
            ctx.strokeStyle = 'rgba(60, 40, 15, 0.55)';
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.stroke();

            // Lighter inner line for depth effect
            ctx.lineWidth = ditch.width * 0.6;
            ctx.strokeStyle = 'rgba(45, 30, 10, 0.7)';
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.stroke();

            // Cross-hatch marks along the ditch
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(30, 20, 5, 0.4)';
            for (let i = 0; i < pts.length - 1; i++) {
                const ax = pts[i].x, ay = pts[i].y;
                const bx = pts[i + 1].x, by = pts[i + 1].y;
                const dx = bx - ax, dy = by - ay;
                const segLen = Math.sqrt(dx * dx + dy * dy);
                if (segLen < 5) continue;
                // Perpendicular direction
                const nx = -dy / segLen, ny = dx / segLen;
                const hw = ditch.width * 0.35;
                // Draw cross marks every 12px
                const numMarks = Math.floor(segLen / 12);
                for (let m = 0; m <= numMarks; m++) {
                    const t = numMarks > 0 ? m / numMarks : 0;
                    const mx = ax + dx * t;
                    const my = ay + dy * t;
                    ctx.beginPath();
                    ctx.moveTo(mx - nx * hw, my - ny * hw);
                    ctx.lineTo(mx + nx * hw, my + ny * hw);
                    ctx.stroke();
                }
            }

            // Edge highlights
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(100, 70, 30, 0.35)';
            // Left edge
            for (let side = -1; side <= 1; side += 2) {
                ctx.beginPath();
                for (let i = 0; i < pts.length; i++) {
                    let nx = 0, ny = 0;
                    if (i < pts.length - 1) {
                        const dx = pts[i + 1].x - pts[i].x;
                        const dy = pts[i + 1].y - pts[i].y;
                        const len = Math.sqrt(dx * dx + dy * dy);
                        if (len > 0) { nx = -dy / len; ny = dx / len; }
                    } else if (i > 0) {
                        const dx = pts[i].x - pts[i - 1].x;
                        const dy = pts[i].y - pts[i - 1].y;
                        const len = Math.sqrt(dx * dx + dy * dy);
                        if (len > 0) { nx = -dy / len; ny = dx / len; }
                    }
                    const ex = pts[i].x + nx * ditch.width * 0.5 * side;
                    const ey = pts[i].y + ny * ditch.width * 0.5 * side;
                    if (i === 0) ctx.moveTo(ex, ey);
                    else ctx.lineTo(ex, ey);
                }
                ctx.stroke();
            }
        }

        ctx.restore();
    },

    addDeathMarker(x, y, team) {
        this.deathMarkers.push({ x, y, team, time: 10.0 });
    },

    drawDeathMarkers(dt) {
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.scale, this.scale);

        this.deathMarkers = this.deathMarkers.filter(m => {
            m.time -= dt;
            if (m.time <= 0) return false;

            const alpha = Math.min(1, m.time / 3); // fade over last 3 seconds
            const color = m.team === 'player' ? `rgba(100, 180, 80, ${alpha * 0.5})` : `rgba(200, 80, 50, ${alpha * 0.5})`;
            const size = 6;

            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(m.x - size, m.y - size);
            ctx.lineTo(m.x + size, m.y + size);
            ctx.moveTo(m.x + size, m.y - size);
            ctx.lineTo(m.x - size, m.y + size);
            ctx.stroke();

            return true;
        });

        ctx.restore();
    },

    drawFogOfWar() {
        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.scale, this.scale);
        // Draw the small fog canvas scaled up to full map size with smoothing for soft edges
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(Visibility.fogCanvas, 0, 0, GameMap.width, GameMap.height);
        ctx.imageSmoothingEnabled = false;
        ctx.restore();
    },

    drawTooltip(unit, mouseX, mouseY) {
        if (!unit || !unit.alive) return;

        const ctx = this.ctx;
        ctx.save();
        ctx.scale(this.scale, this.scale);

        const sc = SIZE_CONFIG[unit.size];
        const tc = TYPE_CONFIG[unit.type];
        const sub = unit.subName ? ` ${unit.subName}` : '';
        const name = `${tc.label}${sub} ${sc.label}`;
        const hpText = `HP: ${Math.round(unit.hp)} / ${unit.maxHp}`;

        const lines = [name, hpText];

        // Veteran / mercenary status
        let statusLineIdx = -1;
        if (unit._veteranId) {
            let vetLine = 'Veteran';
            const dmgUps = unit._vetDamageUps || 0;
            const armUps = unit._vetArmorUps || 0;
            if (dmgUps > 0 || armUps > 0) {
                const parts = [];
                if (dmgUps > 0) parts.push(`+${dmgUps * 15}% dmg`);
                if (armUps > 0) parts.push(`+${armUps * 15}% armor`);
                vetLine += ` (${parts.join(', ')})`;
            }
            statusLineIdx = lines.length;
            lines.push(vetLine);
        } else if (unit._isMercenary) {
            statusLineIdx = lines.length;
            lines.push('Mercenary');
        }

        // Campaign battle buffs
        if (Campaign.active && unit.team === 'player') {
            if (Campaign._battleBuffs.fireArrows > 0 && unit.type === UnitType.ARCHERS) lines.push('\u{1F525} Fire Arrows +20%');
            if (Campaign._battleBuffs.cavalrySpeed > 0 && unit.category === 'cavalry') lines.push('\u{1F40E} War Horses +15% speed');
            if (Campaign._battleBuffs.allDamage > 0) lines.push(`\u{1F941} War Drums +${Math.round(Campaign._battleBuffs.allDamage * 100)}% dmg`);
        }

        // Terrain info
        const forestOvl = GameMap.getForestOverlap(unit.x, unit.y, unit.getCollisionRadius());
        if (forestOvl > 0.05) lines.push(`Forest: ${Math.round(forestOvl * 100)}%`);
        const hillOvl = GameMap.getHillOverlap(unit.x, unit.y, unit.getCollisionRadius());
        if (hillOvl > 0.01) lines.push(`Hill bonus`);

        // Combat status
        if (unit.inCombat) {
            lines.push(`Fighting ${unit.combatTargets.length} unit${unit.combatTargets.length > 1 ? 's' : ''}`);
        }
        const rearCount = unit.facingThreats.filter(t => t.status === 'rear').length;
        const flankCount = unit.facingThreats.filter(t => t.status === 'flank').length;
        if (rearCount > 0) lines.push(`REAR ATTACK! (×${rearCount})`);
        if (flankCount > 0) lines.push(`Flanked! (×${flankCount})`);
        if (unit.retreatPenalty > 0) lines.push('Retreating!');

        // Measure text
        ctx.font = '12px Georgia';
        let maxW = 0;
        for (const line of lines) {
            const w = ctx.measureText(line).width;
            if (w > maxW) maxW = w;
        }
        const padX = 8, padY = 5;
        const lineH = 16;
        const boxW = maxW + padX * 2;
        const boxH = lines.length * lineH + padY * 2;

        // Position: offset from mouse, keep on screen
        let tx = mouseX + 15;
        let ty = mouseY - boxH - 5;
        if (tx + boxW > 1920) tx = mouseX - boxW - 10;
        if (ty < 5) ty = mouseY + 20;

        // Draw background
        ctx.fillStyle = 'rgba(20, 15, 10, 0.9)';
        ctx.fillRect(tx, ty, boxW, boxH);
        ctx.strokeStyle = '#8b6914';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx, ty, boxW, boxH);

        // Draw text
        const isPlayer = unit.team === 'player';
        ctx.fillStyle = isPlayer ? '#a0d090' : '#e0a080';
        for (let i = 0; i < lines.length; i++) {
            if (i === statusLineIdx) {
                ctx.fillStyle = unit._isMercenary ? '#d4a040' : '#e0c060';
            } else if (i > 0) {
                ctx.fillStyle = '#c0b898';
            }
            ctx.fillText(lines[i], tx + padX, ty + padY + (i + 1) * lineH - 3);
        }

        ctx.restore();
    }
};
