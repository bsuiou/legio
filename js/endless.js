// Endless Campaign mode — roguelike procedural battles with scaling difficulty
const EndlessCampaign = {
    active: false,
    battleNumber: 0,          // completed battles
    coins: 100,
    veteranRoster: [],
    _nextVetId: 0,
    _veteranUpgrades: {},
    _battleBuffs: { allDamage: 0, cavalrySpeed: 0, fireArrows: 0, scoutReport: false },
    _mercenaries: [],
    _nodes: [],
    _currentNodeData: null,
    _battleResultProcessed: false,
    _lastEarnings: null,
    _highScore: 0,
    _totalEarnings: 0,

    // Saved Campaign originals for proxy restore
    _origDamageBuff: null,
    _origArmorBuff: null,
    _origCavSpeedBuff: null,
    _origVetUpgrades: null,
    _origBattleBuffs: null,

    // Map pools by difficulty tier
    _easyMaps: ['grasslands', 'rolling_hills', 'roman_road'],
    _mediumMaps: ['river', 'scattered_rocks', 'forest_river'],
    _hardMaps: ['dense_forest', 'narrow_pass', 'ambush', 'hillfort', 'twin_rivers'],

    // Use same shop items as Campaign
    get _shopItems() { return Campaign._shopItems; },

    _mapLabel(mapType) {
        return Campaign._mapLabel(mapType);
    },

    // --- Buff methods (same as Campaign) ---
    getDamageBuff(unit) {
        let mult = 1.0;
        mult += this._battleBuffs.allDamage;
        if (unit.type === UnitType.ARCHERS && this._battleBuffs.fireArrows > 0) {
            mult += 0.20;
        }
        if (unit._veteranId && this._veteranUpgrades[unit._veteranId]) {
            mult += this._veteranUpgrades[unit._veteranId].damageUpgrades * 0.15;
        }
        return mult;
    },

    getArmorBuff(unit) {
        let mult = 1.0;
        if (unit._veteranId && this._veteranUpgrades[unit._veteranId]) {
            mult -= this._veteranUpgrades[unit._veteranId].armorUpgrades * 0.15;
        }
        return Math.max(0.25, mult);
    },

    getCavalrySpeedBuff() {
        return this._battleBuffs.cavalrySpeed > 0 ? 1.15 : 1.0;
    },

    _resetBattleBuffs() {
        this._battleBuffs = { allDamage: 0, cavalrySpeed: 0, fireArrows: 0, scoutReport: false };
        this._mercenaries = [];
    },

    _applyVetUpgrades(unit) {
        if (!unit._veteranId || !this._veteranUpgrades[unit._veteranId]) return;
        const ups = this._veteranUpgrades[unit._veteranId];
        unit._vetDamageUps = ups.damageUpgrades;
        unit._vetArmorUps = ups.armorUpgrades;
    },

    // --- Proxy onto Campaign so existing combat/unit code works ---
    _proxyCampaign() {
        this._origDamageBuff = Campaign.getDamageBuff;
        this._origArmorBuff = Campaign.getArmorBuff;
        this._origCavSpeedBuff = Campaign.getCavalrySpeedBuff;
        this._origVetUpgrades = Campaign._veteranUpgrades;
        this._origBattleBuffs = Campaign._battleBuffs;

        Campaign.active = true;
        Campaign.getDamageBuff = this.getDamageBuff.bind(this);
        Campaign.getArmorBuff = this.getArmorBuff.bind(this);
        Campaign.getCavalrySpeedBuff = this.getCavalrySpeedBuff.bind(this);
        Campaign._veteranUpgrades = this._veteranUpgrades;
        Campaign._battleBuffs = this._battleBuffs;
    },

    _restoreCampaign() {
        Campaign.active = false;
        Campaign.getDamageBuff = this._origDamageBuff;
        Campaign.getArmorBuff = this._origArmorBuff;
        Campaign.getCavalrySpeedBuff = this._origCavSpeedBuff;
        Campaign._veteranUpgrades = this._origVetUpgrades;
        Campaign._battleBuffs = this._origBattleBuffs;
    },

    // --- Node Generation ---
    _generateNode(index) {
        let pool;
        if (index < 3) {
            pool = this._easyMaps;
        } else if (index < 7) {
            pool = [...this._easyMaps, ...this._mediumMaps];
        } else {
            pool = [...this._easyMaps, ...this._mediumMaps, ...this._hardMaps];
        }
        // Weighted: harder maps more likely at higher indices
        let map;
        if (index >= 7) {
            // 50% chance of hard map, 30% medium, 20% easy
            const r = Math.random();
            if (r < 0.5) map = this._hardMaps[Math.floor(Math.random() * this._hardMaps.length)];
            else if (r < 0.8) map = this._mediumMaps[Math.floor(Math.random() * this._mediumMaps.length)];
            else map = this._easyMaps[Math.floor(Math.random() * this._easyMaps.length)];
        } else {
            map = pool[Math.floor(Math.random() * pool.length)];
        }

        const pBudget = Math.min(12000, Math.round(3000 * Math.pow(1.07, index)));
        const aBudget = Math.min(15000, Math.round(2800 * Math.pow(1.12, index)));

        return { id: index, map, pBudget, aBudget, label: index + 1 };
    },

    _ensureNodes() {
        // Always have current + 3 ahead
        const needed = this.battleNumber + 4;
        while (this._nodes.length < needed) {
            this._nodes.push(this._generateNode(this._nodes.length));
        }
    },

    // --- Lifecycle ---
    start() {
        this.active = true;
        this.battleNumber = 0;
        this.coins = 100;
        this.veteranRoster = [];
        this._nextVetId = 0;
        this._veteranUpgrades = {};
        this._battleResultProcessed = false;
        this._lastEarnings = null;
        this._totalEarnings = 0;
        this._nodes = [];
        this._currentNodeData = null;
        this._resetBattleBuffs();
        this._proxyCampaign();

        // Load high score
        try { this._highScore = parseInt(localStorage.getItem('endlessHighScore')) || 0; } catch(e) { this._highScore = 0; }

        this._ensureNodes();
        Game.setState('ENDLESS_MAP');
    },

    exit() {
        this.active = false;
        this._restoreCampaign();
    },

    // --- Map Screen ---
    renderMapScreen() {
        const container = document.getElementById('endlessMap');
        this._ensureNodes();

        const visibleStart = Math.max(0, this.battleNumber - 4); // show some completed
        const visibleEnd = this.battleNumber + 3; // 3 ahead

        let nodesHTML = '';
        for (let i = visibleEnd; i >= visibleStart; i--) {
            if (i >= this._nodes.length) continue;
            const node = this._nodes[i];
            const isCompleted = i < this.battleNumber;
            const isActive = i === this.battleNumber;
            const isFuture = i > this.battleNumber;

            let cls = 'endless-node';
            let click = '';
            let icon = '';

            if (isCompleted) {
                cls += ' completed';
                icon = '\u2714\uFE0F';
            } else if (isActive) {
                cls += ' active';
                click = `onclick="EndlessCampaign.startBattle(${node.id})"`;
                icon = Campaign._mapIcon(node.map, false, null);
            } else {
                cls += ' locked';
                icon = Campaign._mapIcon(node.map, false, null);
            }

            nodesHTML += `
                <div class="${cls}" ${click}>
                    <div class="endless-node-icon">${icon}</div>
                    <div class="endless-node-info">
                        <div class="endless-node-label">Battle ${node.label}</div>
                        <div class="endless-node-map">${this._mapLabel(node.map)}</div>
                        ${isActive ? `<div class="endless-node-strength">Strength: ${node.pBudget} vs ${node.aBudget}</div>` : ''}
                    </div>
                    ${isCompleted ? '<div class="endless-node-check">\u2714</div>' : ''}
                </div>
                ${i > visibleStart ? '<div class="endless-node-line"></div>' : ''}
            `;
        }

        container.innerHTML = `
            <div class="menu-content campaign-content">
                <h2>\u2694\uFE0F Endless Campaign</h2>
                <div class="coins-display">\u{1FA99} ${this.coins} Denarii</div>
                <div style="font-size:13px; color:#8b7355; margin-bottom:4px;">
                    Battle ${this.battleNumber + 1}
                    ${this.veteranRoster.length > 0 ? ' \u2014 ' + this.veteranRoster.length + ' veteran' + (this.veteranRoster.length > 1 ? 's' : '') : ''}
                    ${this._highScore > 0 ? ` \u2014 Best: ${this._highScore}` : ''}
                </div>
                <div class="endless-map-scroll">
                    ${nodesHTML}
                </div>
                <div style="margin-top:12px; display:flex; gap:8px; justify-content:center;">
                    <button class="menu-btn small" onclick="EndlessCampaign.exit(); Game.setState('MENU')">Back to Menu</button>
                </div>
            </div>
        `;
    },

    startBattle(nodeId) {
        const node = this._nodes.find(n => n.id === nodeId);
        if (!node) return;
        this._currentNodeData = node;
        Game.selectedMap = node.map;
        Army.budget = node.pBudget;
        Army.remaining = node.pBudget;
        Game.setState('ENDLESS_SHOP');
    },

    // --- Shop ---
    renderShopScreen() {
        const container = document.getElementById('endlessMap');
        const node = this._currentNodeData;

        // Scout report
        let scoutHTML = '';
        if (this._battleBuffs.scoutReport && node) {
            scoutHTML = this._renderScoutReport(node);
        }

        // Veteran upgrades
        let vetUpgradeHTML = '';
        if (this.veteranRoster.length > 0) {
            vetUpgradeHTML = `<div class="shop-section">
                <h3 class="shop-section-title">\u2605 Veteran Upgrades <span class="shop-cost-note">20 \u{1FA99} each</span></h3>
                <div class="shop-vet-list">
                    ${this.veteranRoster.map(v => {
                        const tc = TYPE_CONFIG[v.type]; const sc = SIZE_CONFIG[v.size];
                        const ups = this._veteranUpgrades[v.id] || { damageUpgrades: 0, armorUpgrades: 0 };
                        const dmgLabel = ups.damageUpgrades > 0 ? ` (\u2694+${ups.damageUpgrades * 15}%)` : '';
                        const armLabel = ups.armorUpgrades > 0 ? ` (\u{1F6E1}+${ups.armorUpgrades * 15}%)` : '';
                        return `<div class="shop-vet-row">
                            <span class="shop-vet-name">
                                ${unitSymbolHTML(v.type, v.size, true)}
                                \u2605 ${tc.label} ${sc.label}${dmgLabel}${armLabel}
                            </span>
                            <span class="shop-vet-buttons">
                                <button class="shop-vet-btn" onclick="EndlessCampaign._buyVetUpgrade('${v.id}','damage')" ${this.coins < 20 ? 'disabled' : ''} title="Sharpen Blades (+15% damage)">\u2694 +Dmg</button>
                                <button class="shop-vet-btn" onclick="EndlessCampaign._buyVetUpgrade('${v.id}','armor')" ${this.coins < 20 ? 'disabled' : ''} title="Reinforce Armor (+15% armor)">\u{1F6E1} +Arm</button>
                            </span>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        // Buffs
        const buffItems = this._shopItems.filter(i => i.category === 'buff');
        const buffHTML = `<div class="shop-section">
            <h3 class="shop-section-title">\u{1F4DC} Battle Preparations</h3>
            <div class="shop-items-grid">
                ${buffItems.map(item => {
                    let bought = false;
                    let stacks = 0;
                    if (item.once) {
                        if (item.id === 'scout_report') bought = this._battleBuffs.scoutReport;
                        if (item.id === 'fire_arrows') bought = this._battleBuffs.fireArrows > 0;
                        if (item.id === 'cavalry_speed') bought = this._battleBuffs.cavalrySpeed > 0;
                    }
                    if (item.repeatable) {
                        if (item.id === 'all_damage') stacks = Math.round(this._battleBuffs.allDamage / 0.05);
                    }
                    const canBuy = this.coins >= item.cost && !bought;
                    const costLabel = bought ? '\u2714 Bought' : (stacks > 0 ? `\u2714 \u00d7${stacks} (${item.cost} \u{1FA99} more)` : item.cost + ' \u{1FA99}');
                    return `<div class="shop-item ${bought ? 'bought' : ''} ${stacks > 0 ? 'bought-stacked' : ''} ${!canBuy && !bought ? 'too-expensive' : ''}" onclick="${canBuy ? `EndlessCampaign._buyBuff('${item.id}')` : ''}">
                        <span class="shop-item-icon">${item.icon}</span>
                        <span class="shop-item-label">${item.label}</span>
                        <span class="shop-item-desc">${item.desc}${stacks > 0 ? ' (+' + (stacks * 5) + '% total)' : ''}</span>
                        <span class="shop-item-cost">${costLabel}</span>
                    </div>`;
                }).join('')}
            </div>
            ${scoutHTML}
        </div>`;

        // Mercenaries
        const mercItems = this._shopItems.filter(i => i.category === 'mercenary');
        const mercHTML = `<div class="shop-section">
            <h3 class="shop-section-title">\u{1F5E1}\uFE0F Hire Mercenaries <span class="shop-cost-note">fight free, no promotion</span></h3>
            <div class="shop-items-grid">
                ${mercItems.map(item => {
                    const canBuy = this.coins >= item.cost;
                    return `<div class="shop-item ${!canBuy ? 'too-expensive' : ''}" onclick="${canBuy ? `EndlessCampaign._buyMerc('${item.id}')` : ''}">
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
            <div class="shop-content">
                <div class="shop-header">
                    <h2>\u{1FA99} Denarii Shop</h2>
                    <div class="coins-display shop-coins">\u{1FA99} <span id="shopCoins">${this.coins}</span> Denarii</div>
                    <div class="shop-battle-info">Preparing for Battle ${this.battleNumber + 1} \u2014 ${this._mapLabel(node.map)}</div>
                </div>
                ${vetUpgradeHTML}
                ${buffHTML}
                ${mercHTML}
                <div class="shop-buttons">
                    <button class="menu-btn" onclick="EndlessCampaign._exitShop()">Continue to Battle</button>
                    <button class="menu-btn small" onclick="EndlessCampaign._exitShopToMap()">Back to Map</button>
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
        // Re-proxy upgrades onto Campaign
        Campaign._veteranUpgrades = this._veteranUpgrades;
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
        Campaign._battleBuffs = this._battleBuffs;
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
        Game.setState('ENDLESS_MAP');
    },

    _renderScoutReport(node) {
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
        AI.units = oldUnits;
        AI.budget = oldBudget;
        const lines = Object.entries(report).map(([k, v]) => `${v}x ${k}`).join(', ');
        return `<div style="font-size:11px; color:#6b5a3a; margin-top:2px; font-style:italic;">\u{1F441}\uFE0F Scout: ${lines}</div>`;
    },

    // Army setup reuses Campaign.renderCampaignSetupUI() via data proxy in main.js

    // --- Battle Result ---
    onBattleResult(victory) {
        if (this._battleResultProcessed) return;
        this._battleResultProcessed = true;

        if (victory) {
            const basePay = Math.round(100 * (1 + 0.20 * this.battleNumber));
            const aliveStrength = Army.playerUnits
                .filter(u => u.alive)
                .reduce((s, u) => s + SIZE_CONFIG[u.size].strength, 0);
            const survivalBonus = Math.ceil(aliveStrength * 0.05);
            this._lastEarnings = { base: basePay, survival: survivalBonus, total: basePay + survivalBonus };
            this.coins += basePay + survivalBonus;
            this._totalEarnings += basePay + survivalBonus;
            this._collectSurvivors();
            this.battleNumber++;
            this._ensureNodes();

            // Update high score
            if (this.battleNumber > this._highScore) {
                this._highScore = this.battleNumber;
                try { localStorage.setItem('endlessHighScore', this._highScore); } catch(e) {}
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
        const enemyAlive = AI.units.filter(u => u.alive);
        const eRemaining = enemyAlive.reduce((s, u) => s + u.hp, 0);
        const minutes = Math.floor(Game.battleTime / 60);
        const seconds = Math.floor(Game.battleTime % 60);

        let survivorsHTML = '';
        if (victory) {
            const promoted = playerAlive.filter(u => !u._veteranId && !u._isMercenary);
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
        if (victory) {
            title = 'Victory!';
            titleClass = 'victory';
            buttonHTML = `<button class="menu-btn" onclick="Game.setState('ENDLESS_MAP')">View Campaign Map</button>`;
        } else {
            title = 'Defeat \u2014 Campaign Over';
            titleClass = 'defeat';
            const isNewRecord = this.battleNumber > 0 && this.battleNumber >= this._highScore;
            buttonHTML = `
                <div style="margin-top:12px; text-align:center;">
                    <div style="font-size:18px; color:#8b6914; font-variant:small-caps; margin-bottom:8px;">
                        ${isNewRecord ? '\u{1F3C6} New Record!' : 'Final Stats'}
                    </div>
                    <div style="color:#c0b898;">Battles Won: <strong>${this.battleNumber}</strong></div>
                    <div style="color:#c0b898;">Total Denarii Earned: <strong>${this._totalEarnings}</strong></div>
                    <div style="color:#c0b898;">Veterans Promoted: <strong>${this._nextVetId}</strong></div>
                    ${this._highScore > 0 ? `<div style="color:#8b7355; font-size:12px; margin-top:4px;">Best: ${this._highScore} battles</div>` : ''}
                </div>
                <button class="menu-btn" onclick="EndlessCampaign.exit(); Game.setState('MENU')" style="margin-top:12px;">Return to Menu</button>
            `;
        }

        container.innerHTML = `
            <div class="menu-content">
                <div class="result-title ${titleClass}">${title}</div>
                <div class="result-stats">
                    <div>Battle ${this.battleNumber} \u2014 Endless Campaign</div>
                    <div>Duration: ${minutes}:${seconds.toString().padStart(2, '0')}</div>
                    <div>Your Strength: ${Math.round(pRemaining)} / ${pInitial}</div>
                    <div>Enemy Strength: ${Math.round(eRemaining)} / ${eInitial}</div>
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
