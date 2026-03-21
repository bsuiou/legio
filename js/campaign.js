// Campaign mode — branching paths with progressive budget and veterancy
const Campaign = {
    active: false,
    currentNode: 0,      // index into the player's battle sequence
    chosenPath: null,     // null, 'A', or 'B'
    coins: 100,
    veteranRoster: [],    // { id, type, size, cost, deployed }
    _nextVetId: 0,
    _pendingFork: false,  // true after winning the fork battle, before choosing

    // --- Denarii Shop ---
    // Buffs that persist for one battle only
    _battleBuffs: {
        allDamage: 0,       // +5% per purchase, stacks
        cavalrySpeed: 0,    // +15% per purchase (one-time)
        fireArrows: 0,      // +20% archer damage (one-time)
        scoutReport: false,  // reveal enemy army composition
    },
    // Mercenaries hired from shop (added to army for free, non-promotable)
    _mercenaries: [],
    // Veteran upgrade tracking: { vetId: { damageUpgrades: N, armorUpgrades: N } }
    _veteranUpgrades: {},

    _resetBattleBuffs() {
        this._battleBuffs = { allDamage: 0, cavalrySpeed: 0, fireArrows: 0, scoutReport: false };
        this._mercenaries = [];
    },

    // Get the total damage multiplier from buffs for a unit
    getDamageBuff(unit) {
        let mult = 1.0;
        mult += this._battleBuffs.allDamage; // e.g. 0.05 per purchase
        if (unit.type === UnitType.ARCHERS && this._battleBuffs.fireArrows > 0) {
            mult += 0.20;
        }
        // Veteran damage upgrades (permanent, stackable)
        if (unit._veteranId && this._veteranUpgrades[unit._veteranId]) {
            mult += this._veteranUpgrades[unit._veteranId].damageUpgrades * 0.15;
        }
        return mult;
    },

    // Get the armor multiplier from buffs for a unit (lower = less damage taken)
    getArmorBuff(unit) {
        let mult = 1.0;
        // Veteran armor upgrades (permanent, stackable)
        if (unit._veteranId && this._veteranUpgrades[unit._veteranId]) {
            mult -= this._veteranUpgrades[unit._veteranId].armorUpgrades * 0.15;
        }
        return Math.max(0.25, mult); // cap at 75% reduction
    },

    // Get cavalry speed bonus
    getCavalrySpeedBuff() {
        return this._battleBuffs.cavalrySpeed > 0 ? 1.15 : 1.0;
    },

    // Shop item definitions
    _shopItems: [
        {
            id: 'upgrade_vet_damage', category: 'veteran', label: 'Sharpen Blades',
            desc: '+15% damage for a veteran (stackable)', cost: 20,
            icon: '\u2694\uFE0F', requiresVeteran: true, upgradeType: 'damage'
        },
        {
            id: 'upgrade_vet_armor', category: 'veteran', label: 'Reinforce Armor',
            desc: '+15% armor for a veteran (stackable)', cost: 20,
            icon: '\u{1F6E1}\uFE0F', requiresVeteran: true, upgradeType: 'armor'
        },
        {
            id: 'all_damage', category: 'buff', label: 'War Drums',
            desc: 'All units +5% damage (this battle)', cost: 150,
            icon: '\u{1F941}', repeatable: true
        },
        {
            id: 'scout_report', category: 'buff', label: 'Scout Report',
            desc: 'Reveal enemy army before battle', cost: 20,
            icon: '\u{1F441}\uFE0F', once: true
        },
        {
            id: 'fire_arrows', category: 'buff', label: 'Fire Arrows',
            desc: 'Archers +20% damage (this battle)', cost: 80,
            icon: '\u{1F3F9}', once: true
        },
        {
            id: 'cavalry_speed', category: 'buff', label: 'War Horses',
            desc: 'Cavalry +15% speed (this battle)', cost: 65,
            icon: '\u{1F40E}', once: true
        },
        {
            id: 'merc_light_inf', category: 'mercenary', label: 'Mercenary Skirmishers',
            desc: 'Free Light Infantry Century (no veteran promotion)', cost: 60,
            icon: '\u2694\uFE0F', mercType: 'light_infantry', mercSize: 'century'
        },
        {
            id: 'merc_archers', category: 'mercenary', label: 'Mercenary Bowmen',
            desc: 'Free Archer Century (no veteran promotion)', cost: 80,
            icon: '\u{1F3F9}', mercType: 'archers', mercSize: 'century'
        },
        {
            id: 'merc_cavalry', category: 'mercenary', label: 'Mercenary Riders',
            desc: 'Free Light Cavalry Century (no veteran promotion)', cost: 100,
            icon: '\u{1F40E}', mercType: 'light_cavalry', mercSize: 'century'
        },
    ],

    // Campaign sequence — 7 battles + 1 village event
    // Nodes 0-1: shared battles, Node 2: village event, Node 3: fork battle
    // Nodes 4-6 (path A) or 7-9 (path B): branch battles
    // Node 10: final battle (shared)
    nodes: [
        { id: 0, label: '1', map: 'grasslands',       pBudget: 3000, aBudget: 2500 },
        { id: 1, label: '2', map: 'rolling_hills',     pBudget: 3500, aBudget: 3000 },
        // Village event — non-combat encounter
        { id: 2, label: 'V', type: 'village' },
        { id: 3, label: '3', map: 'dense_forest',      pBudget: 3500, aBudget: 3500, fork: true },
        // Path A — aggressive (open terrain, cavalry-friendly)
        { id: 4, path: 'A', label: '4', map: 'hillfort',          pBudget: 4000, aBudget: 4000 },
        { id: 5, path: 'A', label: '5', map: 'scattered_rocks',   pBudget: 4500, aBudget: 5000 },
        { id: 6, path: 'A', label: '6', map: 'rolling_hills',     pBudget: 5000, aBudget: 5500 },
        // Path B — defensive (cover, chokepoints)
        { id: 7, path: 'B', label: '4', map: 'narrow_pass',       pBudget: 4000, aBudget: 4000 },
        { id: 8, path: 'B', label: '5', map: 'forest_river',      pBudget: 4500, aBudget: 5000 },
        { id: 9, path: 'B', label: '6', map: 'dense_forest',      pBudget: 5000, aBudget: 5500 },
        // Final
        { id: 10, label: '7', map: 'hillfort',          pBudget: 5000, aBudget: 6000, final: true },
    ],

    // Get the ordered list of battles for the current campaign path
    getBattleSequence() {
        const shared = this.nodes.filter(n => !n.path && !n.final);
        const branch = this.chosenPath ? this.nodes.filter(n => n.path === this.chosenPath) : [];
        const final = this.nodes.filter(n => n.final);
        return [...shared, ...branch, ...final];
    },

    // Get the current node (the one we're about to fight or just fought)
    getCurrentNode() {
        const seq = this.getBattleSequence();
        return seq[this.currentNode] || seq[seq.length - 1];
    },

    // Always 7 battles regardless of path chosen (village events don't count)
    getTotalBattles() {
        return 7;
    },

    // Count how many battles (not village events) have been completed
    getCompletedBattleCount() {
        const seq = this.getBattleSequence();
        let count = 0;
        for (let i = 0; i < this.currentNode && i < seq.length; i++) {
            if (seq[i].type !== 'village') count++;
        }
        return count;
    },

    start() {
        this.active = true;
        this.currentNode = 0;
        this.chosenPath = null;
        this._pendingFork = false;
        this.coins = 100;
        this.veteranRoster = [];
        this._nextVetId = 0;
        this._veteranUpgrades = {};
        this._resetBattleBuffs();
        Game.setState('CAMPAIGN_MAP');
    },

    // --- Shop Phase ---
    renderShopScreen() {
        const container = document.getElementById('campaignMap');
        const node = this.getCurrentNode();
        const battleNum = this.getCompletedBattleCount() + 1;

        // Build veteran upgrade section
        let vetUpgradeHTML = '';
        if (this.veteranRoster.length > 0) {
            vetUpgradeHTML = `<div class="shop-section">
                <h3 class="shop-section-title">\u2605 Veteran Upgrades <span class="shop-cost-note">20 Denarii each</span></h3>
                <div class="shop-vet-list">
                    ${this.veteranRoster.map(v => {
                        const tc = TYPE_CONFIG[v.type];
                        const sc = SIZE_CONFIG[v.size];
                        const ups = this._veteranUpgrades[v.id] || { damageUpgrades: 0, armorUpgrades: 0 };
                        const dmgPct = (10 + ups.damageUpgrades * 15);
                        const armPct = (10 + ups.armorUpgrades * 15);
                        return `<div class="shop-vet-row">
                            <span class="shop-vet-name">${unitSymbolHTML(v.type, v.size, true)} \u2605 ${tc.label} ${sc.label}</span>
                            <span class="shop-vet-stats">
                                <span class="vet-stat dmg" title="Damage bonus">+${dmgPct}% dmg</span>
                                <span class="vet-stat arm" title="Armor bonus">-${armPct}% taken</span>
                            </span>
                            <span class="shop-vet-buttons">
                                <button class="shop-vet-btn" onclick="Campaign._buyVetUpgrade('${v.id}','damage')" ${this.coins < 20 ? 'disabled' : ''} title="Sharpen Blades (+15% damage)">\u2694 +Dmg</button>
                                <button class="shop-vet-btn" onclick="Campaign._buyVetUpgrade('${v.id}','armor')" ${this.coins < 20 ? 'disabled' : ''} title="Reinforce Armor (+15% armor)">\u{1F6E1} +Arm</button>
                            </span>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        // Build buff section
        const buffItems = this._shopItems.filter(i => i.category === 'buff');
        const buffHTML = `<div class="shop-section">
            <h3 class="shop-section-title">\u{1F4DC} Battle Preparations</h3>
            <div class="shop-items-grid">
                ${buffItems.map(item => {
                    let bought = false;
                    if (item.once) {
                        if (item.id === 'scout_report') bought = this._battleBuffs.scoutReport;
                        if (item.id === 'fire_arrows') bought = this._battleBuffs.fireArrows > 0;
                        if (item.id === 'cavalry_speed') bought = this._battleBuffs.cavalrySpeed > 0;
                    }
                    const canBuy = this.coins >= item.cost && !bought;
                    return `<div class="shop-item ${bought ? 'bought' : ''} ${!canBuy && !bought ? 'too-expensive' : ''}" onclick="${canBuy ? `Campaign._buyBuff('${item.id}')` : ''}">
                        <span class="shop-item-icon">${item.icon}</span>
                        <span class="shop-item-label">${item.label}</span>
                        <span class="shop-item-desc">${item.desc}</span>
                        <span class="shop-item-cost">${bought ? '\u2714 Bought' : item.cost + ' \u{1FA99}'}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>`;

        // Build mercenary section
        const mercItems = this._shopItems.filter(i => i.category === 'mercenary');
        const mercHTML = `<div class="shop-section">
            <h3 class="shop-section-title">\u{1F5E1}\uFE0F Hire Mercenaries <span class="shop-cost-note">fight free, no promotion</span></h3>
            <div class="shop-items-grid">
                ${mercItems.map(item => {
                    const canBuy = this.coins >= item.cost;
                    return `<div class="shop-item ${!canBuy ? 'too-expensive' : ''}" onclick="${canBuy ? `Campaign._buyMerc('${item.id}')` : ''}">
                        <span class="shop-item-icon">${item.icon}</span>
                        <span class="shop-item-label">${item.label}</span>
                        <span class="shop-item-desc">${item.desc}</span>
                        <span class="shop-item-cost">${item.cost} \u{1FA99}</span>
                    </div>`;
                }).join('')}
            </div>
            ${this._mercenaries.length > 0 ? `<div class="shop-merc-hired">Hired: ${this._mercenaries.map(m => {
                const tc = TYPE_CONFIG[m.type]; const sc = SIZE_CONFIG[m.size];
                return `${tc.label} ${sc.label}`;
            }).join(', ')}</div>` : ''}
        </div>`;

        container.innerHTML = `
            <div class="menu-content campaign-content shop-content">
                <div class="shop-header">
                    <h2>\u{1FA99} Denarii Shop</h2>
                    <div class="coins-display shop-coins">\u{1FA99} <span id="shopCoins">${this.coins}</span> Denarii</div>
                    <div class="shop-battle-info">Preparing for Battle ${battleNum} \u2014 ${this._mapLabel(node.map)}</div>
                </div>
                ${vetUpgradeHTML}
                ${buffHTML}
                ${mercHTML}
                <div class="shop-buttons">
                    <button class="menu-btn" onclick="Campaign._exitShop()">Continue to Battle</button>
                    <button class="menu-btn small" onclick="Campaign._exitShopToMap()">Back to Map</button>
                </div>
            </div>
        `;
    },

    _buyVetUpgrade(vetId, upgradeType) {
        if (this.coins < 20) return;
        this.coins -= 20;
        if (!this._veteranUpgrades[vetId]) {
            this._veteranUpgrades[vetId] = { damageUpgrades: 0, armorUpgrades: 0 };
        }
        if (upgradeType === 'damage') {
            this._veteranUpgrades[vetId].damageUpgrades++;
        } else {
            this._veteranUpgrades[vetId].armorUpgrades++;
        }
        this.renderShopScreen();
    },

    _buyBuff(itemId) {
        const item = this._shopItems.find(i => i.id === itemId);
        if (!item || this.coins < item.cost) return;
        this.coins -= item.cost;

        switch (itemId) {
            case 'all_damage': this._battleBuffs.allDamage += 0.05; break;
            case 'scout_report': this._battleBuffs.scoutReport = true; break;
            case 'fire_arrows': this._battleBuffs.fireArrows = 1; break;
            case 'cavalry_speed': this._battleBuffs.cavalrySpeed = 1; break;
        }
        this.renderShopScreen();
    },

    _buyMerc(itemId) {
        const item = this._shopItems.find(i => i.id === itemId);
        if (!item || this.coins < item.cost) return;
        this.coins -= item.cost;
        this._mercenaries.push({ type: item.mercType, size: item.mercSize });
        this.renderShopScreen();
    },

    _exitShop() {
        Game.setState('ARMY_SETUP');
    },

    _exitShopToMap() {
        Game.setState('CAMPAIGN_MAP');
    },

    // Map node icons — each map type gets a thematic icon
    _mapIcon(mapType, isFinal, nodeType) {
        if (nodeType === 'village') return '<img src="assets/village.png" class="village-img">';
        if (isFinal) return '\u{1F3F0}'; // castle for final battle
        const icons = {
            grasslands: '\u2694\uFE0F',       // crossed swords
            rolling_hills: '\u26F0\uFE0F',    // mountain
            dense_forest: '\u{1F332}',        // evergreen tree
            hillfort: '\u{1F3F0}',            // castle
            scattered_rocks: '\u{1FAA8}',     // rock
            narrow_pass: '\u26E9\uFE0F',      // shinto shrine (pass)
            forest_river: '\u{1F332}',        // tree
            twin_rivers: '\u{1F30A}',         // wave
            roman_road: '\u{1F6E4}\uFE0F',   // railway track
            river: '\u{1F30A}',               // wave
            ambush: '\u{1F441}\uFE0F',       // eye (ambush/watching)
        };
        return icons[mapType] || '\u2694\uFE0F';
    },

    renderMapScreen() {
        const container = document.getElementById('campaignMap');
        const seq = this.getBattleSequence();

        // --- Vertical layout (bottom to top, like Slay the Spire) ---
        // Virtual coordinate space: 400 wide x 500 tall
        const W = 400, H = 500;
        const centerX = W / 2;
        const branchSpread = 90;
        const positions = [];
        const sharedNodes = this.nodes.filter(n => !n.path && !n.final);
        const pathANodes = this.nodes.filter(n => n.path === 'A');
        const pathBNodes = this.nodes.filter(n => n.path === 'B');
        const finalNode = this.nodes.find(n => n.final);

        // Shared nodes (bottom, going up): rows from bottom
        const startY = 460, rowSpacing = 60;
        for (let i = 0; i < sharedNodes.length; i++) {
            // slight horizontal stagger for visual interest
            const xOff = (i % 2 === 0 ? -15 : 15);
            positions.push({ node: sharedNodes[i], x: centerX + xOff, y: startY - i * rowSpacing });
        }

        // Branch rows (after fork) — A goes left, B goes right
        const branchStartY = startY - sharedNodes.length * rowSpacing;
        for (let i = 0; i < pathANodes.length; i++) {
            const xOff = (i % 2 === 0 ? 10 : -10);
            positions.push({ node: pathANodes[i], x: centerX - branchSpread + xOff, y: branchStartY - i * rowSpacing });
        }
        for (let i = 0; i < pathBNodes.length; i++) {
            const xOff = (i % 2 === 0 ? -10 : 10);
            positions.push({ node: pathBNodes[i], x: centerX + branchSpread + xOff, y: branchStartY - i * rowSpacing });
        }

        // Final battle: top center
        const finalY = branchStartY - pathANodes.length * rowSpacing;
        positions.push({ node: finalNode, x: centerX, y: finalY });

        // Determine state of each node
        const completedIds = new Set();
        for (let i = 0; i < this.currentNode && i < seq.length; i++) {
            completedIds.add(seq[i].id);
        }
        const activeId = this.currentNode < seq.length ? seq[this.currentNode].id : -1;

        // Build stops HTML — icon-based nodes
        const stopsHTML = positions.map(p => {
            const n = p.node;
            const isVillage = n.type === 'village';
            let cls = 'battle-stop';
            if (isVillage) cls += ' village-stop';
            let click = '';
            const isOtherPath = n.path && this.chosenPath && n.path !== this.chosenPath;

            let icon;
            if (completedIds.has(n.id)) {
                cls += ' completed';
                icon = '\u2714\uFE0F'; // heavy check mark
            } else if (n.id === activeId && !this._pendingFork) {
                cls += ' active';
                if (isVillage) {
                    click = `onclick="Campaign.startVillageEvent()"`;
                } else {
                    click = `onclick="Campaign.startBattle(${n.id})"`;
                }
                icon = this._mapIcon(n.map, n.final, n.type);
            } else if (isOtherPath) {
                cls += ' locked other-path';
                icon = this._mapIcon(n.map, n.final, n.type);
            } else {
                cls += ' locked';
                icon = this._mapIcon(n.map, n.final, n.type);
            }

            const leftPct = (p.x / W * 100).toFixed(2);
            const topPct = (p.y / H * 100).toFixed(2);
            const mapName = isVillage ? 'Village' : this._mapLabel(n.map);
            const labelSide = p.x < centerX ? '' : 'label-left';

            return `<div class="${cls}" style="left:${leftPct}%;top:${topPct}%;" ${click}>
                <span class="stop-icon">${icon}</span>
                <span class="stop-map ${labelSide}">${mapName}</span>
            </div>`;
        }).join('');

        // Build SVG dashed paths between nodes
        const sharedPos = positions.filter(p => !p.node.path && !p.node.final);
        const pathAPos = positions.filter(p => p.node.path === 'A');
        const pathBPos = positions.filter(p => p.node.path === 'B');
        const finalPos = positions.find(p => p.node.final);
        const forkPt = sharedPos[sharedPos.length - 1];

        let svgPaths = '';
        const dashStyle = 'stroke-dasharray="6,4"';

        // Shared path (bottom to fork)
        if (sharedPos.length > 1) {
            for (let i = 0; i < sharedPos.length - 1; i++) {
                const a = sharedPos[i], b = sharedPos[i + 1];
                svgPaths += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="rgba(100,80,50,0.35)" stroke-width="2" ${dashStyle}/>`;
            }
        }
        // Fork → Path A nodes → Final
        if (forkPt && pathAPos.length > 0 && finalPos) {
            const opA = (!this.chosenPath || this.chosenPath === 'A') ? 0.35 : 0.08;
            // fork to first A
            svgPaths += `<line x1="${forkPt.x}" y1="${forkPt.y}" x2="${pathAPos[0].x}" y2="${pathAPos[0].y}" stroke="rgba(100,80,50,${opA})" stroke-width="2" ${dashStyle}/>`;
            for (let i = 0; i < pathAPos.length - 1; i++) {
                svgPaths += `<line x1="${pathAPos[i].x}" y1="${pathAPos[i].y}" x2="${pathAPos[i+1].x}" y2="${pathAPos[i+1].y}" stroke="rgba(100,80,50,${opA})" stroke-width="2" ${dashStyle}/>`;
            }
            // last A to final
            const lastA = pathAPos[pathAPos.length - 1];
            svgPaths += `<line x1="${lastA.x}" y1="${lastA.y}" x2="${finalPos.x}" y2="${finalPos.y}" stroke="rgba(100,80,50,${opA})" stroke-width="2" ${dashStyle}/>`;
        }
        // Fork → Path B nodes → Final
        if (forkPt && pathBPos.length > 0 && finalPos) {
            const opB = (!this.chosenPath || this.chosenPath === 'B') ? 0.35 : 0.08;
            svgPaths += `<line x1="${forkPt.x}" y1="${forkPt.y}" x2="${pathBPos[0].x}" y2="${pathBPos[0].y}" stroke="rgba(100,80,50,${opB})" stroke-width="2" ${dashStyle}/>`;
            for (let i = 0; i < pathBPos.length - 1; i++) {
                svgPaths += `<line x1="${pathBPos[i].x}" y1="${pathBPos[i].y}" x2="${pathBPos[i+1].x}" y2="${pathBPos[i+1].y}" stroke="rgba(100,80,50,${opB})" stroke-width="2" ${dashStyle}/>`;
            }
            const lastB = pathBPos[pathBPos.length - 1];
            svgPaths += `<line x1="${lastB.x}" y1="${lastB.y}" x2="${finalPos.x}" y2="${finalPos.y}" stroke="rgba(100,80,50,${opB})" stroke-width="2" ${dashStyle}/>`;
        }

        // Path labels near the branches
        let pathLabels = '';
        const labelOpA = this.chosenPath === 'A' ? 1 : (this.chosenPath ? 0.15 : 0.55);
        const labelOpB = this.chosenPath === 'B' ? 1 : (this.chosenPath ? 0.15 : 0.55);
        const labelY = ((branchStartY - 10) / H * 100).toFixed(1);
        const labelLeftA = ((centerX - branchSpread) / W * 100).toFixed(1);
        const labelLeftB = ((centerX + branchSpread) / W * 100).toFixed(1);
        if (!this.chosenPath || this.chosenPath === 'A') {
            pathLabels += `<div class="path-label" style="left:${labelLeftA}%;top:${labelY}%;opacity:${labelOpA};transform:translateX(-50%) translateY(-22px);font-size:10px;">Path A</div>`;
        }
        if (!this.chosenPath || this.chosenPath === 'B') {
            pathLabels += `<div class="path-label" style="left:${labelLeftB}%;top:${labelY}%;opacity:${labelOpB};transform:translateX(-50%) translateY(-22px);font-size:10px;">Path B</div>`;
        }

        // Fork choice buttons
        let forkUI = '';
        if (this._pendingFork) {
            forkUI = `
                <div style="margin-top:8px; text-align:center;">
                    <p style="color:#8b6914; font-variant:small-caps; font-size:14px; margin-bottom:8px;">Choose your path:</p>
                    <button class="menu-btn" onclick="Campaign.choosePath('A')" style="margin:4px;">Path A \u2014 Aggressive</button>
                    <button class="menu-btn" onclick="Campaign.choosePath('B')" style="margin:4px;">Path B \u2014 Defensive</button>
                </div>
            `;
        }

        const node = this.getCurrentNode();
        const isVillageNext = node && node.type === 'village';
        const battleNum = this.getCompletedBattleCount() + (isVillageNext ? 0 : 1);
        const nextLabel = isVillageNext ? 'Village' : (node && !this._pendingFork ? this._mapLabel(node.map) : '');

        container.innerHTML = `
            <div class="menu-content campaign-content">
                <h2>Campaign</h2>
                <div class="coins-display">\u{1FA99} ${this.coins} Denarii</div>
                <div class="campaign-road">
                    <svg class="road-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
                        ${svgPaths}
                    </svg>
                    ${stopsHTML}
                    ${pathLabels}
                </div>
                <div style="margin-top:4px; font-size:13px; color:#8b7355; font-style:italic;">
                    ${isVillageNext ? 'Next: Village' : `Battle ${battleNum} of 7`}
                    ${!isVillageNext && nextLabel ? ` \u2014 ${nextLabel}` : ''}
                    ${this.veteranRoster.length > 0 ? ' \u2014 ' + this.veteranRoster.length + ' veteran' + (this.veteranRoster.length > 1 ? 's' : '') : ''}
                </div>
                ${forkUI}
                <div style="margin-top:8px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
                    <button class="menu-btn small" onclick="Campaign.active=false; Game.setState('MENU')">Back to Menu</button>
                </div>
            </div>
        `;
    },

    _mapLabel(mapType) {
        const labels = { grasslands: 'Grasslands', river: 'River Crossing', hillfort: 'King of the Hill', dense_forest: 'Dense Forest', rolling_hills: 'Rolling Hills', narrow_pass: 'Narrow Pass', twin_rivers: 'Twin Rivers', forest_river: 'Forest River', scattered_rocks: 'Scattered Rocks', roman_road: 'Roman Road', ambush: 'Ambush' };
        return labels[mapType] || mapType;
    },

    choosePath(path) {
        this.chosenPath = path;
        this._pendingFork = false;
        // currentNode stays at 3 (first branch battle)
        this.renderMapScreen();
        document.getElementById('campaignMap').classList.remove('hidden');
    },

    startBattle(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;
        // Store which node we're fighting
        this._currentNodeData = node;
        Game.selectedMap = node.map;
        Army.budget = node.pBudget;
        Army.remaining = node.pBudget;
        Game.setState('CAMPAIGN_SHOP');
    },

    _renderScoutReport(node) {
        // Pre-generate AI army to show composition
        const oldBudget = AI.budget;
        const oldUnits = AI.units;
        AI.budget = node.aBudget;
        AI.generateArmy();
        const report = {};
        for (const u of AI.units) {
            const tc = TYPE_CONFIG[u.type]; const sc = SIZE_CONFIG[u.size];
            const key = `${tc.label} ${sc.label}`;
            report[key] = (report[key] || 0) + 1;
        }
        // Restore (will be re-generated at placement)
        AI.units = oldUnits;
        AI.budget = oldBudget;
        const lines = Object.entries(report).map(([k, v]) => `${v}x ${k}`).join(', ');
        return `<div style="font-size:11px; color:#6b5a3a; margin-top:2px; font-style:italic;">\u{1F441}\uFE0F Scout: ${lines}</div>`;
    },

    // Apply veteran upgrades to a deployed unit
    _applyVetUpgrades(unit) {
        if (!unit._veteranId || !this._veteranUpgrades[unit._veteranId]) return;
        const ups = this._veteranUpgrades[unit._veteranId];
        unit._vetDamageUps = ups.damageUpgrades;
        unit._vetArmorUps = ups.armorUpgrades;
    },

    // Mercenaries are now added during army setup, so this is a no-op
    _deployMercenaries() {
        // Already added in renderCampaignSetupUI
    },

    // --- Village Event ---

    startVillageEvent() {
        const container = document.getElementById('campaignMap');
        container.innerHTML = `
            <div class="menu-content campaign-content">
                <h2>A Village Appears</h2>
                <div class="village-event">
                    <div class="village-icon-large"><img src="assets/village.png" style="width:100px;height:100px;object-fit:contain;"></div>
                    <p class="village-story">
                        Your legion approaches a peaceful village nestled between the hills.
                        Smoke rises from chimneys and villagers watch nervously from behind their fences.
                        Your centurion turns to you for orders.
                    </p>
                    <p class="village-prompt">What will you do?</p>
                    <div class="village-choices">
                        <button class="menu-btn village-btn pillage" onclick="Campaign.completeVillageEvent('pillage')">
                            <span class="choice-icon">\u{1F525}</span>
                            <span class="choice-title">Pillage the Village</span>
                            <span class="choice-desc">Seize their supplies for your war effort. +200 Denarii</span>
                        </button>
                        <button class="menu-btn village-btn befriend" onclick="Campaign.completeVillageEvent('befriend')">
                            <span class="choice-icon">\u{1F91D}</span>
                            <span class="choice-title">Seek Alliance</span>
                            <span class="choice-desc">Win their trust. A group of fighters may join your cause.</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    completeVillageEvent(choice) {
        let resultText = '';
        let resultIcon = '';

        if (choice === 'pillage') {
            this.coins += 200;
            resultText = 'Your soldiers ransack the village stores. You seize grain, weapons, and coin.';
            resultIcon = '\u{1F4B0}';
        } else {
            // Random cohort type
            const options = [
                { type: 'light_infantry', size: 'cohort', label: 'Light Infantry Cohort' },
                { type: 'heavy_infantry', size: 'cohort', label: 'Heavy Infantry Cohort' },
                { type: 'archers', size: 'cohort', label: 'Archer Cohort' },
                { type: 'light_cavalry', size: 'century', label: 'Light Cavalry Century' },
            ];
            const pick = options[Math.floor(Math.random() * options.length)];
            const vetId = 'village_' + this._nextVetId++;
            const cost = SIZE_CONFIG[pick.size].strength;
            this.veteranRoster.push({
                id: vetId, type: pick.type, size: pick.size,
                cost: cost, deployed: false
            });
            resultText = `The village elders are moved by your mercy. A group of <strong>${pick.label}</strong> volunteers to fight alongside your legion!`;
            resultIcon = '\u2694\uFE0F';
        }

        this.currentNode++;

        const container = document.getElementById('campaignMap');
        container.innerHTML = `
            <div class="menu-content campaign-content">
                <h2>${choice === 'pillage' ? 'Village Pillaged' : 'Alliance Formed'}</h2>
                <div class="village-event">
                    <div class="village-icon-large">${resultIcon}</div>
                    <p class="village-story">${resultText}</p>
                    ${choice === 'pillage'
                        ? `<p class="village-reward"><strong>+200 Denarii</strong> (Total: ${this.coins})</p>`
                        : `<p class="village-reward"><strong>New recruit added to your veteran roster!</strong></p>`
                    }
                    <button class="menu-btn" onclick="Campaign.renderMapScreen(); document.getElementById('campaignMap').classList.remove('hidden');" style="margin-top:16px;">Continue Campaign</button>
                </div>
            </div>
        `;
    },

    // Render campaign-specific army setup
    renderCampaignSetupUI() {
        const container = document.getElementById('armySetup');
        const node = this._currentNodeData || this.getCurrentNode();
        const budget = node.pBudget;

        Army.playerUnits = [];
        Army.remaining = budget;
        for (const v of this.veteranRoster) v.deployed = false;

        // Pre-add mercenaries (free units, not removable)
        for (const m of this._mercenaries) {
            const unit = new Unit(m.type, m.size, 'player');
            unit._isMercenary = true;
            Army.playerUnits.push(unit);
        }

        const options = Army.getUnitOptions();
        let vetsHTML = '';
        if (this.veteranRoster.length > 0) {
            vetsHTML = `
                <div class="campaign-veterans">
                    <h3 style="margin-bottom:8px; font-variant:small-caps; color:#8b6914;">\u2605 Veterans</h3>
                    ${this.veteranRoster.map(v => {
                        const tc = TYPE_CONFIG[v.type];
                        const sc = SIZE_CONFIG[v.size];
                        return `<div class="vet-option" data-vet-id="${v.id}">
                            <span>${unitSymbolHTML(v.type, v.size, true)} \u2605 ${tc.label} ${sc.label}</span>
                            <span class="cost">${v.cost}</span>
                        </div>`;
                    }).join('')}
                </div>
            `;
        }

        const battleNum = this.currentNode + 1;
        container.innerHTML = `
            <div class="menu-content">
                <div class="setup-header">
                    <h2>Battle ${battleNum} \u2014 ${this._mapLabel(node.map)}</h2>
                    <div class="coins-display" style="margin-bottom:4px;">\u{1FA99} ${this.coins} Denarii</div>
                    <div class="points-display">Strength: <strong id="pointsLeft">${Army.remaining}</strong> / <span id="budgetTotal">${budget}</span></div>
                    <div style="font-size:12px; color:#a05050; margin-top:4px;">Enemy Strength: ~${node.aBudget}${this._battleBuffs.scoutReport ? ' \u{1F441}\uFE0F' : ''}</div>
                    ${this._battleBuffs.scoutReport ? this._renderScoutReport(node) : ''}
                </div>
                <div class="army-setup-grid">
                    <div class="unit-picker">
                        ${vetsHTML}
                        <h3 style="margin-bottom:10px; font-variant:small-caps;">Recruit Units</h3>
                        ${options.map(o => `
                            <div class="unit-option" data-type="${o.type}" data-size="${o.size}">
                                <span>${unitSymbolHTML(o.type, o.size, false)} ${o.label}</span>
                                <span class="cost">${o.cost}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div class="unit-roster">
                        <h3 style="margin-bottom:10px; font-variant:small-caps;">Your Army</h3>
                        <div class="roster-list" id="rosterList"></div>
                    </div>
                </div>
                <button id="btnReady" class="menu-btn" disabled style="opacity:0.5">Ready for Battle</button>
                <button id="btnBackSetup" class="menu-btn small">Back</button>
            </div>
        `;

        this._updateCampaignRoster();
        this._bindCampaignSetupEvents(budget);
    },

    _updateCampaignRoster() {
        const list = document.getElementById('rosterList');
        if (!list) return;
        list.innerHTML = Army.playerUnits.map((u, i) => {
            const vet = u.veteran ? '\u2605 ' : '';
            const isMerc = u._isMercenary;
            const tag = isMerc ? '<span class="merc-tag">Mercenary</span>' : '';
            return `<div class="roster-item ${isMerc ? 'merc-item' : ''}">
                <span>${unitSymbolHTML(u.type, u.size, true)} ${vet}${u.getDisplayInfo()} ${tag}</span>
                ${isMerc ? '<span class="merc-free">FREE</span>' : `<button class="remove-btn" data-index="${i}">Remove</button>`}
            </div>`;
        }).join('') || '<p style="color:#888; font-style:italic; padding:10px;">No units added yet</p>';

        const pointsEl = document.getElementById('pointsLeft');
        if (pointsEl) pointsEl.textContent = Army.remaining;

        const readyBtn = document.getElementById('btnReady');
        if (readyBtn) {
            readyBtn.disabled = Army.playerUnits.length === 0;
            readyBtn.style.opacity = Army.playerUnits.length === 0 ? '0.5' : '1';
        }

        document.querySelectorAll('.vet-option').forEach(el => {
            const id = el.dataset.vetId;
            const v = this.veteranRoster.find(r => r.id === id);
            el.classList.toggle('deployed', !!(v && v.deployed));
        });
    },

    _bindCampaignSetupEvents(budget) {
        const container = document.getElementById('armySetup');

        container.querySelectorAll('.unit-option').forEach(el => {
            el.addEventListener('click', () => {
                if (Army.addUnit(el.dataset.type, el.dataset.size)) {
                    this._updateCampaignRoster();
                }
            });
        });

        container.querySelectorAll('.vet-option').forEach(el => {
            el.addEventListener('click', () => {
                const v = this.veteranRoster.find(r => r.id === el.dataset.vetId);
                if (!v || v.deployed || v.cost > Army.remaining) return;
                const unit = new Unit(v.type, v.size, 'player');
                unit.veteran = true;
                unit._veteranId = v.id;
                Army.playerUnits.push(unit);
                Army.remaining -= v.cost;
                v.deployed = true;
                this._updateCampaignRoster();
            });
        });

        container.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-btn')) {
                const idx = parseInt(e.target.dataset.index);
                const unit = Army.playerUnits[idx];
                if (unit) {
                    if (unit._veteranId) {
                        const v = this.veteranRoster.find(r => r.id === unit._veteranId);
                        if (v) v.deployed = false;
                    }
                    Army.remaining += unit.getCost();
                    Army.playerUnits.splice(idx, 1);
                    this._updateCampaignRoster();
                }
            }
        });

        document.getElementById('btnReady').addEventListener('click', () => {
            if (Army.playerUnits.length > 0) Game.setState('PLACEMENT');
        });

        document.getElementById('btnBackSetup').addEventListener('click', () => {
            Army.playerUnits = [];
            Army.remaining = budget;
            Game.setState('CAMPAIGN_MAP');
        });
    },

    onBattleResult(victory) {
        if (victory) {
            // Earnings: base 100 + 20% per battle number + 0.05 per surviving strength
            const battleNum = this.getCompletedBattleCount();
            const basePay = Math.round(100 * (1 + 0.20 * battleNum));
            const aliveStrength = Army.playerUnits
                .filter(u => u.alive)
                .reduce((s, u) => s + SIZE_CONFIG[u.size].strength, 0);
            const survivalBonus = Math.ceil(aliveStrength * 0.05);
            this._lastEarnings = { base: basePay, survival: survivalBonus, total: basePay + survivalBonus };
            this.coins += basePay + survivalBonus;
            this._collectSurvivors();
            const node = this._currentNodeData || this.getCurrentNode();
            if (node.fork) {
                // Won the fork battle — need to choose path before continuing
                this._pendingFork = true;
                this.currentNode++; // advance past the fork
            } else {
                this.currentNode++;
            }
        }
    },

    _collectSurvivors() {
        for (const u of Army.playerUnits) {
            if (!u.alive) {
                if (u._veteranId) {
                    this.veteranRoster = this.veteranRoster.filter(v => v.id !== u._veteranId);
                }
                continue;
            }
            if (!u._veteranId && !u._isMercenary) {
                const vetId = 'vet_' + this._nextVetId++;
                this.veteranRoster.push({
                    id: vetId, type: u.type, size: u.size,
                    cost: SIZE_CONFIG[u.size].strength, deployed: false
                });
            }
        }
    },

    renderResultScreen(container, victory) {
        const playerAlive = Army.playerUnits.filter(u => u.alive);
        const pInitial = Army.playerUnits.reduce((s, u) => s + u.maxHp, 0);
        const pRemaining = playerAlive.reduce((s, u) => s + u.hp, 0);
        const eInitial = AI.units.reduce((s, u) => s + u.maxHp, 0);
        const minutes = Math.floor(Game.battleTime / 60);
        const seconds = Math.floor(Game.battleTime % 60);

        const node = this._currentNodeData;
        const totalBattles = this.getTotalBattles();
        const isComplete = victory && this.currentNode >= totalBattles;
        const isForkResult = victory && this._pendingFork;

        let survivorsHTML = '';
        if (victory) {
            const promoted = playerAlive.filter(u => !u._veteranId);
            const vets = playerAlive.filter(u => u._veteranId);
            const fallen = Army.playerUnits.filter(u => !u.alive);

            if (vets.length > 0) {
                survivorsHTML += '<div style="margin-top:12px;"><strong style="color:#8b6914;">\u2605 Veterans survived:</strong></div>';
                for (const u of vets) {
                    const tc = TYPE_CONFIG[u.type]; const sc = SIZE_CONFIG[u.size];
                    survivorsHTML += `<div style="color:#c0b898;">\u2605 ${tc.label} ${sc.label}</div>`;
                }
            }
            if (promoted.length > 0) {
                survivorsHTML += '<div style="margin-top:8px;"><strong style="color:#4a7a2a;">Promoted to Veteran:</strong></div>';
                for (const u of promoted) {
                    const tc = TYPE_CONFIG[u.type]; const sc = SIZE_CONFIG[u.size];
                    survivorsHTML += `<div style="color:#6a9a4a;">\u2605 ${tc.label} ${sc.label} <span style="opacity:0.7">NEW</span></div>`;
                }
            }
            if (fallen.length > 0) {
                survivorsHTML += '<div style="margin-top:8px;"><strong style="color:#8b2020;">Fallen:</strong></div>';
                for (const u of fallen) {
                    const tc = TYPE_CONFIG[u.type]; const sc = SIZE_CONFIG[u.size];
                    const vet = u._veteranId ? '\u2605 ' : '';
                    survivorsHTML += `<div style="color:#a05050;">\u2020 ${vet}${tc.label} ${sc.label}</div>`;
                }
            }
        }

        let title, titleClass, buttonHTML;
        if (isComplete) {
            title = 'Campaign Complete!';
            titleClass = 'victory';
            buttonHTML = `<button class="menu-btn" onclick="Campaign.active=false; Game.setState('MENU')">Return to Menu</button>`;
        } else if (isForkResult) {
            title = 'Victory!';
            titleClass = 'victory';
            buttonHTML = `
                <div style="margin-top:12px;">
                    <p style="color:#8b6914; font-variant:small-caps; margin-bottom:8px;">Choose your path:</p>
                    <button class="menu-btn" onclick="Campaign.choosePath('A'); document.getElementById('resultScreen').classList.add('hidden');" style="margin:4px;">Path A \u2014 Aggressive</button>
                    <button class="menu-btn" onclick="Campaign.choosePath('B'); document.getElementById('resultScreen').classList.add('hidden');" style="margin:4px;">Path B \u2014 Defensive</button>
                </div>
            `;
        } else if (victory) {
            title = 'Victory!';
            titleClass = 'victory';
            buttonHTML = `<button class="menu-btn" onclick="Game.setState('CAMPAIGN_MAP')">Continue Campaign</button>`;
        } else {
            title = 'Defeat \u2014 Campaign Over';
            titleClass = 'defeat';
            buttonHTML = `<button class="menu-btn" onclick="Campaign.active=false; Game.setState('MENU')">Return to Menu</button>`;
        }

        container.innerHTML = `
            <div class="menu-content">
                <div class="result-title ${titleClass}">${title}</div>
                <div class="result-stats">
                    <div>Battle ${this.getCompletedBattleCount()} of ${totalBattles}</div>
                    <div>Duration: ${minutes}:${seconds.toString().padStart(2, '0')}</div>
                    <div>Your Strength: ${Math.round(pRemaining)} / ${pInitial}</div>
                    <div>Enemy Strength: 0 / ${eInitial}</div>
                    ${victory && this._lastEarnings ? `<div style="color:#8b6914; margin-top:8px;">
                        <strong>+${this._lastEarnings.total} Denarii</strong> (${this._lastEarnings.base} base + ${this._lastEarnings.survival} survival bonus)
                        <div style="opacity:0.7; font-size:12px;">Total: ${this.coins} Denarii</div>
                    </div>` : ''}
                </div>
                ${survivorsHTML}
                ${buttonHTML}
            </div>
        `;
    }
};
