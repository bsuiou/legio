// Main game controller
const Game = {
    state: 'MENU', // MENU, MAP_SELECT, ARMY_SETUP, PLACEMENT, BATTLE, RESULT
    selectedMap: 'grasslands',
    spectatorMode: false,
    lastTime: 0,
    battleTime: 0,
    gameSpeed: 1, // 0 = paused, 1 = normal, 1.5 = fast, 2 = fastest
    _speedSteps: [0, 1, 1.5, 2],
    _speedLabels: ['⏸', '▶', '▶▶', '▶▶▶'],
    currentFormation: 'grid', // grid, line, column, wedge
    _battleEvents: { playerRouted: 0, playerDestroyed: 0, enemyRouted: 0, enemyDestroyed: 0 },

    init() {
        Renderer.init();
        Input.init();
        this._bindMenuEvents();
        this.loop(0);
    },

    // Multiplayer map seed — shared between host and guest
    _mpSeed: null,

    setState(newState) {
        // Hide all overlays
        document.getElementById('mainMenu').classList.add('hidden');
        document.getElementById('mapSelect').classList.add('hidden');
        document.getElementById('armySetup').classList.add('hidden');
        document.getElementById('placementUI').classList.add('hidden');
        document.getElementById('battleUI').classList.add('hidden');
        document.getElementById('resultScreen').classList.add('hidden');
        document.getElementById('modifiersScreen').classList.add('hidden');
        document.getElementById('campaignMap').classList.add('hidden');
        document.getElementById('spectatorSetup').classList.add('hidden');
        document.getElementById('multiplayerLobby').classList.add('hidden');
        document.getElementById('endlessMap').classList.add('hidden');

        this.state = newState;

        switch (newState) {
            case 'MENU':
                this.spectatorMode = false;
                document.getElementById('mainMenu').classList.remove('hidden');
                break;

            case 'MODIFIERS':
                this._showModifiers();
                document.getElementById('modifiersScreen').classList.remove('hidden');
                break;

            case 'MAP_SELECT':
                document.getElementById('mapSelect').classList.remove('hidden');
                break;

            case 'SPECTATOR_SETUP':
                this._renderSpectatorSetup();
                document.getElementById('spectatorSetup').classList.remove('hidden');
                break;

            case 'CAMPAIGN_MAP':
                Campaign.renderMapScreen();
                document.getElementById('campaignMap').classList.remove('hidden');
                break;

            case 'CAMPAIGN_SHOP':
                Campaign._resetBattleBuffs();
                Campaign.renderShopScreen();
                document.getElementById('campaignMap').classList.remove('hidden');
                break;

            case 'ENDLESS_MAP':
                EndlessCampaign.renderMapScreen();
                document.getElementById('endlessMap').classList.remove('hidden');
                break;

            case 'ENDLESS_SHOP':
                EndlessCampaign._resetBattleBuffs();
                Campaign._battleBuffs = EndlessCampaign._battleBuffs;
                EndlessCampaign.renderShopScreen();
                document.getElementById('endlessMap').classList.remove('hidden');
                break;

            case 'MP_LOBBY':
                this._renderMPLobby();
                document.getElementById('multiplayerLobby').classList.remove('hidden');
                break;

            case 'MP_WAITING':
                this._renderMPWaiting();
                document.getElementById('multiplayerLobby').classList.remove('hidden');
                break;

            case 'ARMY_SETUP':
                GameMap.init(this.selectedMap, this._mpSeed);
                if (EndlessCampaign.active) {
                    // Proxy endless data onto Campaign so its setup UI works
                    Campaign.veteranRoster = EndlessCampaign.veteranRoster;
                    Campaign._currentNodeData = EndlessCampaign._currentNodeData;
                    Campaign._mercenaries = EndlessCampaign._mercenaries;
                    Campaign._veteranUpgrades = EndlessCampaign._veteranUpgrades;
                    Campaign._battleBuffs = EndlessCampaign._battleBuffs;
                    Campaign.coins = EndlessCampaign.coins;
                    Campaign._nextVetId = EndlessCampaign._nextVetId;
                    Campaign.getCompletedBattleCount = () => EndlessCampaign.battleNumber;
                    Campaign.renderCampaignSetupUI();
                } else if (Campaign.active) {
                    Campaign.renderCampaignSetupUI();
                } else {
                    Army.reset();
                    Army.renderSetupUI();
                }
                document.getElementById('armySetup').classList.remove('hidden');
                break;

            case 'PLACEMENT':
                Army.renderPlacementUI();
                document.getElementById('placementUI').classList.remove('hidden');
                // In multiplayer, don't generate AI army — opponent handles their side
                if (Network.isMultiplayer) {
                    // Assign netIds to player units
                    const prefix = Network.isHost ? 'h' : 'g';
                    Army.playerUnits.forEach((u, i) => { u.netId = prefix + i; });
                } else {
                    // Generate and place AI army
                    if (EndlessCampaign.active) {
                        const node = EndlessCampaign._currentNodeData;
                        AI.budget = node ? node.aBudget : 3000;
                        for (const u of Army.playerUnits) {
                            if (u._veteranId) EndlessCampaign._applyVetUpgrades(u);
                        }
                    } else if (Campaign.active) {
                        const node = Campaign._currentNodeData || Campaign.getCurrentNode();
                        AI.budget = node ? node.aBudget : 3000;
                        Campaign._deployMercenaries();
                        for (const u of Army.playerUnits) {
                            if (u._veteranId) Campaign._applyVetUpgrades(u);
                        }
                    } else {
                        AI.budget = Army.budget;
                    }
                    AI.generateArmy();
                    AI.placeUnits();
                }
                break;

            case 'BATTLE':
                document.getElementById('battleUI').classList.remove('hidden');
                if (Campaign.active) Campaign._battleResultProcessed = false;
                if (EndlessCampaign.active) EndlessCampaign._battleResultProcessed = false;
                this._assignSubNames();
                this.battleTime = 0;
                this.gameSpeed = 1;
                this._buildBattleUI();
                Renderer.arrows = [];
                Renderer.deathMarkers = [];
                Renderer.battleLog = [];
                Renderer.rallyEffects = [];
                GameMap.clearDitches();
                Renderer.battleTimer = 0;
                this._battleEvents = { playerRouted: 0, playerDestroyed: 0, enemyRouted: 0, enemyDestroyed: 0 };
                // Init fog of war
                Visibility.init();
                if (!Network.isMultiplayer) AI.initScouts();
                // Snapshot alive state for death detection
                this._prevAlive = {};
                for (const u of Army.playerUnits) this._prevAlive[u.id] = true;
                for (const u of AI.units) this._prevAlive[u.id] = true;
                // Start multiplayer broadcasting
                if (Network.isMultiplayer && Network.isHost) {
                    this._setupHostBroadcast();
                }
                break;

            case 'RESULT':
                this._showResult();
                break;
        }
    },

    _bindMenuEvents() {
        document.getElementById('btnStart').addEventListener('click', () => {
            this.spectatorMode = false;
            this.setState('MAP_SELECT');
        });

        document.getElementById('btnWatch').addEventListener('click', () => {
            this.spectatorMode = true;
            this.setState('MAP_SELECT');
        });

        document.getElementById('btnModifiers').addEventListener('click', () => {
            this.setState('MODIFIERS');
        });

        document.getElementById('btnCampaign').addEventListener('click', () => {
            Campaign.start();
        });

        document.getElementById('btnEndless').addEventListener('click', () => {
            EndlessCampaign.start();
        });

        document.getElementById('btnMultiplayer').addEventListener('click', () => {
            this.setState('MP_LOBBY');
        });

        document.getElementById('btnBack').addEventListener('click', () => {
            this.setState('MENU');
        });

        // Map card selection
        document.querySelectorAll('.map-card').forEach(card => {
            card.addEventListener('click', (e) => {
                document.querySelectorAll('.map-card').forEach(c => c.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                this.selectedMap = e.currentTarget.dataset.map;
                if (Network.isMultiplayer) {
                    // Host selects map — broadcast to guest
                    this._mpSeed = Math.floor(Math.random() * 100000);
                    Network.sendMapSelection(this.selectedMap, this._mpSeed, Army.budget);
                    this.setState('ARMY_SETUP');
                } else if (this.spectatorMode) {
                    this.setState('SPECTATOR_SETUP');
                } else {
                    this._mpSeed = null;
                    this.setState('ARMY_SETUP');
                }
            });
        });
    },

    _getBattleRating(victory, lossPercent) {
        if (victory) {
            if (lossPercent < 20) return { title: 'Decisive Victory', cssClass: 'rating-decisive' };
            if (lossPercent < 50) return { title: 'Victory', cssClass: 'rating-victory' };
            return { title: 'Pyrrhic Victory', cssClass: 'rating-pyrrhic' };
        } else {
            if (lossPercent < 50) return { title: 'Narrow Defeat', cssClass: 'rating-narrow' };
            if (lossPercent < 80) return { title: 'Defeat', cssClass: 'rating-defeat' };
            return { title: 'Crushing Defeat', cssClass: 'rating-crushing' };
        }
    },

    // Multiplayer: store the authoritative result from host
    _mpVictoryOverride: null,

    _showResult() {
        const playerAlive = Army.playerUnits.filter(u => u.alive);
        const enemyAlive = AI.units.filter(u => u.alive);
        // In multiplayer, use the authoritative result from host if available
        let victory;
        if (Network.isMultiplayer && this._mpVictoryOverride !== null) {
            victory = this._mpVictoryOverride;
            this._mpVictoryOverride = null;
        } else {
            victory = enemyAlive.length === 0;
        }

        // Multiplayer: stop broadcasting, notify peer
        if (Network.isMultiplayer) {
            Network.stopBroadcasting();
            if (Network.isHost) {
                Network.sendBattleResult(victory ? 'host' : 'guest');
            }
        }

        const container = document.getElementById('resultScreen');
        container.classList.remove('hidden');

        // Endless Campaign mode
        if (EndlessCampaign.active) {
            EndlessCampaign.onBattleResult(victory);
            EndlessCampaign.renderResultScreen(container, victory);
            return;
        }

        // Story Campaign mode
        if (Campaign.active) {
            Campaign.onBattleResult(victory);
            Campaign.renderResultScreen(container, victory);
            return;
        }

        const pInitial = Army.playerUnits.reduce((s, u) => s + u.maxHp, 0);
        const pRemaining = playerAlive.reduce((s, u) => s + u.hp, 0);
        const eInitial = AI.units.reduce((s, u) => s + u.maxHp, 0);
        const eRemaining = enemyAlive.reduce((s, u) => s + u.hp, 0);

        const minutes = Math.floor(this.battleTime / 60);
        const seconds = Math.floor(this.battleTime % 60);

        // Battle rating
        const lossPercent = pInitial > 0 ? (1 - pRemaining / pInitial) * 100 : 100;
        const rating = this._getBattleRating(victory, lossPercent);

        let resultTitle, resultClass;
        if (this.spectatorMode) {
            resultTitle = victory ? 'Green Wins!' : 'Red Wins!';
            resultClass = victory ? 'victory' : 'defeat';
        } else {
            resultTitle = victory ? 'Victory!' : 'Defeat';
            resultClass = victory ? 'victory' : 'defeat';
        }

        const ev = this._battleEvents || { playerRouted: 0, playerDestroyed: 0, enemyRouted: 0, enemyDestroyed: 0 };
        const youLabel = this.spectatorMode ? 'Green' : 'Your';
        const foeLabel = this.spectatorMode ? 'Red' : 'Enemy';

        container.innerHTML = `
            <div class="menu-content">
                <div class="result-title ${resultClass}">
                    ${resultTitle}
                </div>
                ${!this.spectatorMode ? `<div class="battle-rating ${rating.cssClass}">${rating.title}</div>` : ''}
                <div class="result-stats">
                    <div>Battle Duration: ${minutes}:${seconds.toString().padStart(2, '0')}</div>
                    <div>${youLabel} Strength: ${Math.round(pRemaining)} / ${pInitial}</div>
                    <div>${foeLabel} Strength: ${Math.round(eRemaining)} / ${eInitial}</div>
                    <div>${youLabel} Units Remaining: ${playerAlive.length} / ${Army.playerUnits.length}</div>
                    <div>${foeLabel} Units Remaining: ${enemyAlive.length} / ${AI.units.length}</div>
                </div>
                <div class="result-moments">
                    <div style="font-variant:small-caps;margin-bottom:6px;color:#8b6914;">Key Moments</div>
                    ${ev.enemyDestroyed > 0 ? `<div>${ev.enemyDestroyed} enemy unit${ev.enemyDestroyed > 1 ? 's' : ''} destroyed</div>` : ''}
                    ${ev.enemyRouted > 0 ? `<div>${ev.enemyRouted} enemy unit${ev.enemyRouted > 1 ? 's' : ''} routed</div>` : ''}
                    ${ev.playerDestroyed > 0 ? `<div>${ev.playerDestroyed} of your unit${ev.playerDestroyed > 1 ? 's' : ''} fell</div>` : ''}
                    ${ev.playerRouted > 0 ? `<div>${ev.playerRouted} of your unit${ev.playerRouted > 1 ? 's' : ''} broke and fled</div>` : ''}
                </div>
                <button class="menu-btn" onclick="if(Network.isMultiplayer) Network.leaveRoom(); Game.setState('MENU')">Return to Menu</button>
            </div>
        `;
    },


    _showModifiers() {
        const container = document.getElementById('modifiersScreen');
        container.innerHTML = `
            <div class="menu-content">
                <h2>Battle Modifiers</h2>

                <div class="mod-section">
                    <h3>Unit Type Advantages</h3>
                    <table class="mod-table">
                        <tr><td>Infantry vs Cavalry</td><td>+25% damage</td></tr>
                        <tr><td>Cavalry vs Archers</td><td>+40% damage</td></tr>
                        <tr><td>Archers vs Infantry</td><td>+25% damage</td></tr>
                    </table>
                </div>

                <div class="mod-section">
                    <h3>Positioning</h3>
                    <table class="mod-table">
                        <tr><td>Flank attack (60-90\u00B0 from front)</td><td>up to +15% damage</td></tr>
                        <tr><td>Rear attack (90-180\u00B0 from front)</td><td>up to +35% damage</td></tr>
                        <tr><td>High ground advantage</td><td>up to +40% damage</td></tr>
                        <tr><td>Low ground disadvantage</td><td>up to -30% damage</td></tr>
                    </table>
                </div>

                <div class="mod-section">
                    <h3>Morale</h3>
                    <table class="mod-table">
                        <tr><td>Steady (morale 70-100)</td><td>up to +10% damage</td></tr>
                        <tr><td>Wavering (morale 30-69)</td><td>-5% damage</td></tr>
                        <tr><td>Broken (morale below 30)</td><td>-20% damage, unit routs</td></tr>
                        <tr><td>Routing units take extra damage</td><td>+50% damage taken</td></tr>
                        <tr><td>Last stand (surrounded at 0 morale)</td><td>+50% damage taken</td></tr>
                        <tr><td>Morale loss from casualties</td><td>Proportional to HP lost</td></tr>
                        <tr><td>Flanked attack morale damage</td><td>+25% morale loss</td></tr>
                        <tr><td>Rear attack morale damage</td><td>+50% morale loss</td></tr>
                        <tr><td>Outnumbered (1.5:1+ nearby)</td><td>up to -15 morale/sec</td></tr>
                        <tr><td>Surrounded (3+ melee threats)</td><td>-5 morale/sec</td></tr>
                        <tr><td>Passive morale recovery</td><td>+3/sec when idle</td></tr>
                        <tr><td>Winning combat / causing routs</td><td>Restores morale</td></tr>
                    </table>
                </div>

                <div class="mod-section">
                    <h3>Terrain Effects</h3>
                    <table class="mod-table">
                        <tr><td>Archers firing from forest</td><td>up to +10% damage</td></tr>
                        <tr><td>Target in forest (ranged cover)</td><td>up to -40% damage taken</td></tr>
                        <tr><td>Forest slows infantry</td><td>up to -55% speed</td></tr>
                        <tr><td>Forest slows cavalry</td><td>up to -85% speed</td></tr>
                        <tr><td>Hill slopes slow all units</td><td>up to -60% speed</td></tr>
                        <tr><td>Roman road speed bonus</td><td>+25% speed</td></tr>
                        <tr><td>River blocks movement</td><td>Must cross at bridges</td></tr>
                        <tr><td>Ditch blocks enemy movement</td><td>Units cannot cross</td></tr>
                    </table>
                </div>

                <div class="mod-section">
                    <h3>Unit Strength</h3>
                    <table class="mod-table">
                        <tr><td>Heavy units (Hv Infantry, Hv Cavalry)</td><td>+20% base damage</td></tr>
                        <tr><td>Heavy infantry speed</td><td>-15% slower</td></tr>
                        <tr><td>Light cavalry speed</td><td>+100% faster</td></tr>
                        <tr><td>Heavy cavalry speed</td><td>+75% faster</td></tr>
                        <tr><td>Veteran bonus (campaign)</td><td>+10% damage, -10% damage taken</td></tr>
                        <tr><td>Damage scales with remaining HP</td><td>\u221A(HP%) curve</td></tr>
                        <tr><td>Legion combat efficiency (at full strength)</td><td>25% of potential</td></tr>
                        <tr><td>Legion efficiency at cohort HP</td><td>100% of potential</td></tr>
                    </table>
                </div>

                <div class="mod-section">
                    <h3>Special Actions</h3>
                    <table class="mod-table">
                        <tr><td>Hold ground (H key)</td><td>Unit won't auto-engage enemies</td></tr>
                        <tr><td>Shift+right-click</td><td>Queue waypoints</td></tr>
                        <tr><td>Retreating (after disengaging)</td><td>+50% damage taken, -30% speed</td></tr>
                        <tr><td>Digging ditches (Legion only)</td><td>\u00D72 damage taken, -50% speed, no damage dealt</td></tr>
                    </table>
                </div>

                <div class="mod-section">
                    <h3>Vision</h3>
                    <table class="mod-table">
                        <tr><td>Archers / Light Cavalry / Heavy Cavalry</td><td>400px range</td></tr>
                        <tr><td>Light Infantry</td><td>200px range</td></tr>
                        <tr><td>Heavy Infantry</td><td>160px range</td></tr>
                        <tr><td>Vision cone</td><td>270\u00B0 forward (90\u00B0 blind spot)</td></tr>
                        <tr><td>High ground (hilltop)</td><td>500px vision (minimum)</td></tr>
                        <tr><td>Forests and hills block line of sight</td><td></td></tr>
                    </table>
                </div>

                <button class="menu-btn small" onclick="Game.setState('MENU')">Back</button>
            </div>
        `;
    },

    // --- Multiplayer UI & Logic ---

    _renderMPLobby() {
        const container = document.getElementById('multiplayerLobby');
        container.innerHTML = `
            <div class="menu-content">
                <h2>1v1 Multiplayer</h2>
                <div class="mp-lobby">
                    <button class="menu-btn" id="btnCreateRoom">Create Room</button>
                    <div class="mp-divider">or</div>
                    <div class="mp-join">
                        <input type="text" id="joinCodeInput" class="mp-code-input" placeholder="Room Code" maxlength="4"
                            style="text-transform:uppercase; text-align:center; font-size:24px; font-family:Georgia; width:120px; padding:8px;">
                        <button class="menu-btn" id="btnJoinRoom">Join Room</button>
                    </div>
                    <button class="menu-btn small" onclick="Game.setState('MENU')">Back</button>
                </div>
            </div>
        `;
        document.getElementById('btnCreateRoom').addEventListener('click', () => {
            const code = Network.createRoom();
            this._setupNetworkCallbacks();
            container.querySelector('.mp-lobby').innerHTML = `
                <div class="mp-room-code">
                    <p style="color:#8b7355;">Share this code with your opponent:</p>
                    <div style="font-size:48px; font-family:Georgia; color:#8b6914; letter-spacing:8px; margin:16px 0;">${code}</div>
                    <p style="color:#8b7355; font-style:italic;">Waiting for opponent to join...</p>
                </div>
                <button class="menu-btn small" onclick="Network.leaveRoom(); Game.setState('MENU')">Cancel</button>
            `;
        });
        document.getElementById('btnJoinRoom').addEventListener('click', () => {
            const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
            if (code.length !== 4) return;
            Network.joinRoom(code);
            this._setupNetworkCallbacks();
            container.querySelector('.mp-lobby').innerHTML = `
                <p style="color:#8b7355; font-style:italic;">Joining room ${code}...</p>
                <button class="menu-btn small" onclick="Network.leaveRoom(); Game.setState('MENU')">Cancel</button>
            `;
        });
    },

    _renderMPWaiting() {
        const container = document.getElementById('multiplayerLobby');
        if (Network.isHost) {
            container.innerHTML = `
                <div class="menu-content">
                    <h2>Opponent Connected!</h2>
                    <p style="color:#8b7355;">Select a battlefield to begin.</p>
                    <div class="map-grid">
                        ${Array.from(document.querySelectorAll('#mapSelect .map-card')).map(c =>
                            `<div class="map-card mp-map-card" data-map="${c.dataset.map}">
                                <img class="map-preview" src="assets/maps/${c.dataset.map}.png" alt="${c.querySelector('span').textContent}">
                                <span>${c.querySelector('span').textContent}</span>
                            </div>`
                        ).join('')}
                    </div>
                    <div style="margin-top:12px;">
                        <label style="color:#8b7355; font-size:13px;">Budget:
                            <input type="range" id="mpBudgetSlider" min="2000" max="10000" step="500" value="3000"
                                style="vertical-align:middle; width:150px;">
                            <span id="mpBudgetValue" style="color:#8b6914; font-weight:bold;">3000</span>
                        </label>
                    </div>
                    <button class="menu-btn small" onclick="Network.leaveRoom(); Game.setState('MENU')">Cancel</button>
                </div>
            `;
            // Budget slider
            const slider = document.getElementById('mpBudgetSlider');
            const valSpan = document.getElementById('mpBudgetValue');
            slider.addEventListener('input', () => { valSpan.textContent = slider.value; });
            // Map card clicks
            container.querySelectorAll('.mp-map-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    const map = e.currentTarget.dataset.map;
                    this.selectedMap = map;
                    this._mpSeed = Math.floor(Math.random() * 100000);
                    Army.budget = parseInt(slider.value);
                    Army.remaining = Army.budget;
                    Network.sendMapSelection(map, this._mpSeed, Army.budget);
                    this.setState('ARMY_SETUP');
                });
            });
        } else {
            container.innerHTML = `
                <div class="menu-content">
                    <h2>Connected!</h2>
                    <p style="color:#8b7355; font-style:italic;">Waiting for host to select a map...</p>
                    <button class="menu-btn small" onclick="Network.leaveRoom(); Game.setState('MENU')">Cancel</button>
                </div>
            `;
        }
    },

    _setupNetworkCallbacks() {
        // Peer joins lobby
        Network.onPeerJoin = () => {
            this.setState('MP_WAITING');
        };

        // Guest receives map selection from host
        Network.onMapSelected = (map, seed, budget) => {
            this.selectedMap = map;
            this._mpSeed = seed;
            Army.budget = budget;
            Army.remaining = budget;
            this.setState('ARMY_SETUP');
        };

        // Peer sends ready with army data
        Network.onPeerReady = (peerArmy) => {
            // If we're also ready, create opponent army and start
            if (Network._selfReady) {
                this._mpCreateOpponentArmy(peerArmy);
                if (Network.isHost) {
                    Network.sendBattleStart();
                    this.setState('BATTLE');
                }
            }
        };

        // Battle start signal (guest receives)
        Network.onBattleStart = () => {
            if (!Network.isHost && Network._peerArmy) {
                this._mpCreateOpponentArmy(Network._peerArmy);
                this.setState('BATTLE');
            }
        };

        // Peer un-readies
        Network.onPeerUnready = () => {
            // Nothing to do — they'll re-ready when done
        };

        // Host receives guest commands during battle
        Network.onCommand = (cmd) => {
            if (!Network.isHost) return;
            this._mpApplyGuestCommand(cmd);
        };

        // Guest receives state during battle
        Network.onState = (state) => {
            if (Network.isHost) return;
            this._mpApplyState(state);
        };

        // Battle result (guest receives authoritative winner from host)
        Network.onBattleResult = (winner) => {
            if (!Network.isHost) {
                // 'guest' means the guest won, 'host' means the host won
                this._mpVictoryOverride = (winner === 'guest');
                this.setState('RESULT');
            }
        };

        // Peer disconnected
        Network.onPeerDisconnect = () => {
            if (this.state === 'BATTLE') {
                Game.gameSpeed = 0; // pause
                Network.stopBroadcasting();
            }
            alert('Opponent disconnected.');
            Network.leaveRoom();
            this.setState('MENU');
        };
    },

    // Create opponent army from received data
    _mpCreateOpponentArmy(armyData) {
        AI.units = [];
        const opponentPrefix = Network.isHost ? 'g' : 'h';
        armyData.forEach((uData, i) => {
            const u = new Unit(uData.type, uData.size, 'enemy');
            u.netId = opponentPrefix + i;
            u.x = uData.x;
            u.y = uData.y;
            u.placed = true;
            AI.units.push(u);
        });
    },

    // Host: apply guest command to AI.units
    _mpApplyGuestCommand(cmd) {
        if (cmd.type === 'rally') {
            // Rally all routing guest units
            for (const u of AI.units) {
                if (u.alive && u.routing && u.morale < 30) {
                    u.morale = 35;
                    u.routing = false;
                    u.retreatPenalty = 0;
                }
            }
            return;
        }

        if (!cmd.unitIds) return;
        const units = cmd.unitIds.map(id => Network.findByNetId(AI.units, id)).filter(u => u && u.alive);
        if (units.length === 0) return;

        switch (cmd.type) {
            case 'move': {
                // Apply formation spread if multiple units
                if (units.length === 1) {
                    units[0].targetX = cmd.x;
                    units[0].targetY = cmd.y;
                    units[0].targetQueue = [];
                    units[0].holdGround = false;
                    if (units[0].inCombat) units[0].removeFromAllCombat();
                } else {
                    const cols = Math.ceil(Math.sqrt(units.length));
                    const spacing = 50;
                    units.forEach((u, idx) => {
                        const col = idx % cols;
                        const row = Math.floor(idx / cols);
                        u.targetX = cmd.x + (col - cols / 2) * spacing;
                        u.targetY = cmd.y + (row - Math.floor(units.length / cols) / 2) * spacing;
                        u.targetQueue = [];
                        u.holdGround = false;
                        if (u.inCombat) u.removeFromAllCombat();
                    });
                }
                break;
            }
            case 'hold':
                units.forEach(u => { u.holdGround = !u.holdGround; });
                break;
            case 'retreat':
                units.forEach(u => {
                    if (u.inCombat) {
                        u.removeFromAllCombat();
                        u.retreatPenalty = 1.0;
                    }
                    u.targetX = GameMap.width + 50;
                    u.targetY = u.y;
                    u.targetQueue = [];
                });
                break;
            case 'dig':
                units.forEach(u => {
                    if (u.type === UnitType.HEAVY_INFANTRY && u.size === 'legion') {
                        u.digging = !u.digging;
                    }
                });
                break;
            case 'waypoint':
                units.forEach(u => {
                    if (u.targetX === null) {
                        u.targetX = cmd.x;
                        u.targetY = cmd.y;
                    } else {
                        u.targetQueue.push({ x: cmd.x, y: cmd.y });
                    }
                });
                break;
            case 'lineDrag': {
                if (!cmd.positions || !Array.isArray(cmd.positions)) break;
                // Use the same matching logic as the local line-drag
                const assignment = Input._matchUnitsToPositions(units, cmd.positions);
                for (let p = 0; p < assignment.length; p++) {
                    const u = units[assignment[p]];
                    if (u.inCombat) u.removeFromAllCombat();
                    u.holdGround = false;
                    u.targetQueue = [];
                    u.idleTime = 0;
                    u.targetX = cmd.positions[p].x;
                    u.targetY = cmd.positions[p].y;
                    u.attackMove = false;
                    u.attackMoveTarget = null;
                }
                break;
            }
        }
    },

    // Host: set up state broadcasting
    _setupHostBroadcast() {
        Network.startBroadcasting(() => {
            return {
                hu: Network.compressUnits(Army.playerUnits),
                gu: Network.compressUnits(AI.units),
                ar: Network.compressArrows(this._frameArrows || []),
                bt: this.battleTime,
                ev: this._battleEvents,
                sp: this.gameSpeed,
            };
        });
    },

    // Guest: store received state snapshot for interpolation
    _mpPrevSnapshot: null,
    _mpCurrSnapshot: null,

    _mpApplyState(state) {
        if (!state) return;
        // Push into interpolation buffer
        this._mpPrevSnapshot = this._mpCurrSnapshot;
        this._mpCurrSnapshot = { time: Date.now(), data: state };

        // Immediately apply boolean/discrete states (alive, routing, etc)
        const applyDiscrete = (units, dataArr) => {
            if (!dataArr) return;
            for (const uData of dataArr) {
                const u = Network.findByNetId(units, uData.nid);
                if (!u) continue;
                u.routing = !!uData.rt;
                u.digging = !!uData.dg;
                u.alive = !!uData.al;
                u.maxHp = uData.mhp;
                u.targetX = uData.tx; u.targetY = uData.ty;
                // Snap inCombat state from flag
                u._mpInCombat = !!uData.ic;
            }
        };
        applyDiscrete(AI.units, state.hostUnits);
        applyDiscrete(Army.playerUnits, state.guestUnits);

        // Sync arrows — decompress into format drawArrows expects
        if (state.arrows && state.arrows.length > 0) {
            this._frameArrows = state.arrows.map(a => ({
                from: { x: a.fx, y: a.fy },
                to: { x: a.tx, y: a.ty },
            }));
        } else {
            this._frameArrows = [];
        }

        // Sync battle time, and game speed
        this.battleTime = state.battleTime || 0;
        Renderer.battleTimer = this.battleTime;
        if (state.sp !== undefined && this.gameSpeed !== state.sp) {
            this.gameSpeed = state.sp;
            const btn = document.getElementById('btnSpeed');
            if (btn) {
                const idx = this._speedSteps.indexOf(this.gameSpeed);
                btn.textContent = idx >= 0 ? this._speedLabels[idx] : this._speedLabels[1];
            }
        }
        const timerEl = document.getElementById('battleTimer');
        if (timerEl) {
            const m = Math.floor(this.battleTime / 60);
            const s = Math.floor(this.battleTime % 60);
            timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        }
        this._updateHotbar();
    },

    // Guest: interpolate unit positions between snapshots every frame
    _mpInterpolateUnits() {
        if (!this._mpCurrSnapshot) return;
        const curr = this._mpCurrSnapshot.data;
        const prev = this._mpPrevSnapshot ? this._mpPrevSnapshot.data : null;

        if (!prev) {
            // No previous snapshot — snap to current
            this._mpSnapUnits(AI.units, curr.hostUnits);
            this._mpSnapUnits(Army.playerUnits, curr.guestUnits);
            return;
        }

        const dt = this._mpCurrSnapshot.time - this._mpPrevSnapshot.time;
        if (dt <= 0) {
            this._mpSnapUnits(AI.units, curr.hostUnits);
            this._mpSnapUnits(Army.playerUnits, curr.guestUnits);
            return;
        }

        const now = Date.now() - 50; // render 50ms behind
        const t = Math.max(0, Math.min(1.5, (now - this._mpPrevSnapshot.time) / dt));

        this._mpLerpUnits(AI.units, prev.hostUnits, curr.hostUnits, t);
        this._mpLerpUnits(Army.playerUnits, prev.guestUnits, curr.guestUnits, t);
    },

    _mpSnapUnits(units, dataArr) {
        if (!dataArr) return;
        for (const uData of dataArr) {
            const u = Network.findByNetId(units, uData.nid);
            if (!u) continue;
            u.x = uData.x; u.y = uData.y;
            u.angle = uData.a;
            u.hp = uData.hp; u.morale = uData.mo;
        }
    },

    _mpLerpUnits(units, prevArr, currArr, t) {
        if (!currArr) return;
        const prevMap = {};
        if (prevArr) for (const u of prevArr) prevMap[u.nid] = u;

        for (const cu of currArr) {
            const u = Network.findByNetId(units, cu.nid);
            if (!u) continue;
            const pu = prevMap[cu.nid];
            if (!pu) {
                // New unit or no prev — snap
                u.x = cu.x; u.y = cu.y; u.angle = cu.a;
                u.hp = cu.hp; u.morale = cu.mo;
            } else {
                // Interpolate continuous values
                u.x = pu.x + (cu.x - pu.x) * t;
                u.y = pu.y + (cu.y - pu.y) * t;
                u.angle = pu.a + (cu.a - pu.a) * t;
                u.hp = pu.hp + (cu.hp - pu.hp) * t;
                u.morale = pu.mo + (cu.mo - pu.mo) * t;
            }
        }
    },

    _shortLabel(unitType) {
        const labels = {
            light_infantry: 'Lt Inf',
            heavy_infantry: 'Hv Inf',
            light_cavalry: 'Lt Cav',
            heavy_cavalry: 'Hv Cav',
            archers: 'Archer'
        };
        return labels[unitType] || unitType;
    },

    _assignSubNames() {
        const counts = {};
        for (const u of Army.playerUnits) {
            counts[u.type] = (counts[u.type] || 0) + 1;
        }
        // Only number if there are multiples of a type
        const idx = {};
        Army.playerUnits.forEach((u, i) => {
            idx[u.type] = (idx[u.type] || 0) + 1;
            u.subName = counts[u.type] > 1 ? idx[u.type] : null;
            u.slotIndex = i;
        });
    },

    _buildBattleUI() {
        if (this.spectatorMode) {
            document.getElementById('battleUI').innerHTML = `
                <div class="battle-controls" style="justify-content:center;">
                    <span style="font-variant:small-caps; font-size:14px; color:#c0b898;">Spectator Mode</span>
                    <span id="battleTimer" style="margin-left:12px;">0:00</span>
                    <button class="menu-btn small" style="margin-left:16px; padding:4px 14px; font-size:12px;" onclick="Game.setState('MENU')">Exit</button>
                </div>
                <button id="btnSpeed" class="speed-btn" onclick="Game.cycleSpeed()" title="Game Speed">${this._speedLabels[this._speedSteps.indexOf(this.gameSpeed)]}</button>
            `;
            return;
        }

        let hotbarHTML = '';
        Army.playerUnits.forEach((u, i) => {
            if (i >= 9) return; // max 9 slots
            const label = this._shortLabel(u.type);
            const sub = u.subName ? ` ${u.subName}` : '';
            const sym = unitSymbolHTML(u.type, u.size, true, !!u._veteranId);
            // Badge indicators for upgrade pips — stars are shown inside the model
            let badges = '';
            let slotClass = 'hotbar-slot';
            if (u._veteranId) {
                slotClass += ' veteran';
                const dmg = u._vetDamageUps || 0;
                const arm = u._vetArmorUps || 0;
                if (dmg > 0) badges += `<span class="badge-dmg">\u2694${dmg > 1 ? '\u00d7' + dmg : ''}</span>`;
                if (arm > 0) badges += `<span class="badge-arm">\u{1F6E1}${arm > 1 ? '\u00d7' + arm : ''}</span>`;
            } else if (u._isMercenary) {
                slotClass += ' mercenary';
                badges += '<span class="badge-merc">M</span>';
            }
            // Campaign buffs
            if (Campaign.active) {
                if (Campaign._battleBuffs.fireArrows > 0 && u.type === UnitType.ARCHERS) badges += '<span class="badge-fire">\u{1F525}</span>';
                if (Campaign._battleBuffs.cavalrySpeed > 0 && u.category === 'cavalry') badges += '<span class="badge-horse">\u{1F40E}</span>';
            }
            hotbarHTML += `
                <div class="${slotClass}" data-slot="${i}">
                    <span class="slot-key">${i + 1}</span>
                    <div class="slot-sym">${sym}</div>
                    <span class="slot-label">${label}${sub}</span>
                    ${badges ? `<div class="slot-badges">${badges}</div>` : ''}
                    <div class="slot-hp"><div class="slot-hp-fill" style="width:100%"></div></div>
                </div>`;
        });

        document.getElementById('battleUI').innerHTML = `
            <div class="unit-info-panel" id="unitInfoPanel">Select a unit for info</div>
            <div class="unit-hotbar">${hotbarHTML}</div>
            <div class="battle-controls">
                <button id="btnFormation" class="formation-btn" title="Formation (F) — cycle formation type">▣ Grid</button>
                <button id="btnHold" class="hold-btn" title="Hold Ground (H) — stop auto-engage">⚓ Hold</button>
                <button id="btnDig" class="dig-btn hidden" title="Dig Ditch (D) — Legion only">⛏ Dig Ditch</button>
                <button id="btnRally" class="rally-btn" title="Rally routing units (G)">🏳 Rally</button>
                <button id="btnRetreat" class="retreat-btn" title="Retreat selected units (R)">⟵ Retreat</button>
                <button id="btnSurrender" class="surrender-btn" title="Surrender and exit battle">✕ Exit</button>
                <span id="battleTimer">0:00</span>
            </div>
            <button id="btnSpeed" class="speed-btn" onclick="Game.cycleSpeed()" title="Game Speed">${this._speedLabels[this._speedSteps.indexOf(this.gameSpeed)]}</button>
        `;

        // Stop canvas from stealing clicks on any battle button
        document.querySelectorAll('.battle-controls button, .speed-btn').forEach(btn => {
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
        });

        // Retreat button
        document.getElementById('btnRetreat').addEventListener('click', () => {
            Input._handleRetreat();
        });

        // Hold Ground button
        document.getElementById('btnHold').addEventListener('click', () => {
            const selected = Army.playerUnits.filter(u => u.alive && u.selected);
            if (selected.length === 0) return;
            if (Network.isMultiplayer && !Network.isHost) {
                Network.sendCommand({ type: 'hold', unitIds: selected.map(u => u.netId) });
                return;
            }
            const anyHolding = selected.some(u => u.holdGround);
            for (const u of selected) {
                u.holdGround = !anyHolding;
                if (u.holdGround) { u.targetX = null; u.targetY = null; }
            }
        });

        // Formation button
        document.getElementById('btnFormation').addEventListener('click', () => {
            const formations = ['grid', 'line', 'column', 'wedge'];
            const labels = { grid: '▣ Grid', line: '═ Line', column: '║ Column', wedge: '◁ Wedge' };
            const idx = formations.indexOf(Game.currentFormation || 'grid');
            Game.currentFormation = formations[(idx + 1) % formations.length];
            document.getElementById('btnFormation').textContent = labels[Game.currentFormation];
        });

        // Rally button
        document.getElementById('btnRally').addEventListener('click', () => {
            Input._handleRally();
        });

        // Dig Ditch button
        document.getElementById('btnDig').addEventListener('click', () => {
            Input._handleDigToggle();
        });

        // Surrender / exit battle button
        document.getElementById('btnSurrender').addEventListener('click', () => {
            if (confirm('Exit this battle?')) {
                if (Campaign.active) {
                    Game.setState('RESULT');
                } else {
                    Game.setState('MENU');
                }
            }
        });

        // Bind click handlers (shift to add to selection)
        document.querySelectorAll('.hotbar-slot').forEach(slot => {
            slot.addEventListener('click', (e) => {
                const idx = parseInt(slot.dataset.slot);
                const unit = Army.playerUnits[idx];
                if (!unit || !unit.alive) return;
                if (e.shiftKey) {
                    unit.selected = !unit.selected;
                } else {
                    for (const u of Army.playerUnits) u.selected = false;
                    unit.selected = true;
                }
            });
        });
    },

    cycleSpeed() {
        // Guest can't change speed — host controls it
        if (Network.isMultiplayer && !Network.isHost) return;
        const idx = this._speedSteps.indexOf(this.gameSpeed);
        const next = (idx + 1) % this._speedSteps.length;
        this.gameSpeed = this._speedSteps[next];
        const btn = document.getElementById('btnSpeed');
        if (btn) btn.textContent = this._speedLabels[next];
    },

    _updateHotbar() {
        const slots = document.querySelectorAll('.hotbar-slot');
        slots.forEach(slot => {
            const idx = parseInt(slot.dataset.slot);
            const u = Army.playerUnits[idx];
            if (!u) return;

            slot.classList.toggle('selected', u.selected);
            slot.classList.toggle('dead', !u.alive);
            slot.classList.toggle('in-combat', u.inCombat && u.alive);
            slot.classList.toggle('digging', u.digging && u.alive);
            slot.classList.toggle('holding', u.holdGround && u.alive);

            const hpFill = slot.querySelector('.slot-hp-fill');
            if (hpFill) {
                const ratio = u.hp / u.maxHp;
                hpFill.style.width = (ratio * 100) + '%';
                hpFill.className = 'slot-hp-fill';
                if (ratio <= 0.25) hpFill.classList.add('critical');
                else if (ratio <= 0.5) hpFill.classList.add('low');
            }
        });

        // Show/hide dig button based on whether a legion is selected
        const digBtn = document.getElementById('btnDig');
        if (digBtn) {
            const hasLegion = Army.playerUnits.some(u => u.alive && u.selected && u.size === UnitSize.LEGION);
            const anyDigging = Army.playerUnits.some(u => u.alive && u.selected && u.digging);
            digBtn.classList.toggle('hidden', !hasLegion);
            digBtn.textContent = anyDigging ? '⛏ Stop Digging' : '⛏ Dig Ditch';
        }
    },

    // --- Spectator Mode Methods ---

    _spectatorBudget: 7000,

    _renderSpectatorSetup() {
        const container = document.getElementById('spectatorSetup');
        this._spectatorBudget = 7000;
        const mapLabels = { grasslands: 'The Grasslands', river: 'River Crossing', hillfort: 'King of the Hill', dense_forest: 'Dense Forest', rolling_hills: 'Rolling Hills', narrow_pass: 'Narrow Pass', twin_rivers: 'Twin Rivers', forest_river: 'Forest River', scattered_rocks: 'Scattered Rocks' };
        const mapLabel = mapLabels[this.selectedMap] || this.selectedMap;

        container.innerHTML = `
            <div class="menu-content" style="max-width:500px;">
                <h2>Watch Battle</h2>
                <p style="color:#8b7355; font-style:italic; margin-bottom:18px;">Map: ${mapLabel}</p>
                <div style="margin-bottom:20px;">
                    <label style="font-variant:small-caps; font-size:15px;">Army Strength: <strong id="specBudgetDisplay">7000</strong></label>
                    <input type="range" id="specBudgetSlider" min="2000" max="20000" step="1000" value="7000"
                        style="width:260px; margin-left:10px; vertical-align:middle; accent-color:#8b6914; cursor:pointer;">
                    <p style="font-size:12px; color:#998866; margin-top:6px;">Both sides get equal strength</p>
                </div>
                <button id="specStartBtn" class="menu-btn">Start Battle</button>
                <button id="specBackBtn" class="menu-btn small">Back</button>
            </div>
        `;

        document.getElementById('specBudgetSlider').addEventListener('input', (e) => {
            this._spectatorBudget = parseInt(e.target.value);
            document.getElementById('specBudgetDisplay').textContent = this._spectatorBudget;
        });

        document.getElementById('specStartBtn').addEventListener('click', () => {
            this._startSpectatorBattle();
        });

        document.getElementById('specBackBtn').addEventListener('click', () => {
            this.setState('MAP_SELECT');
        });
    },

    _startSpectatorBattle() {
        // Initialize map
        GameMap.init(this.selectedMap);

        // Generate and place player army (left side)
        this._generateSpectatorPlayerArmy();
        this._placeSpectatorPlayerArmy();

        // Generate and place AI army (right side)
        AI.budget = this._spectatorBudget;
        AI.generateArmy();
        AI.placeUnits();

        // Go straight to battle
        this.setState('BATTLE');
    },

    _generateSpectatorPlayerArmy() {
        Army.reset();
        Army.budget = this._spectatorBudget;
        Army.remaining = 0;

        let remaining = this._spectatorBudget;
        const compositions = [
            { type: UnitType.HEAVY_INFANTRY, size: UnitSize.COHORT, weight: 3 },
            { type: UnitType.LIGHT_INFANTRY, size: UnitSize.COHORT, weight: 2 },
            { type: UnitType.LIGHT_CAVALRY, size: UnitSize.COHORT, weight: 2 },
            { type: UnitType.HEAVY_CAVALRY, size: UnitSize.CENTURY, weight: 2 },
            { type: UnitType.ARCHERS, size: UnitSize.COHORT, weight: 2 },
            { type: UnitType.LIGHT_INFANTRY, size: UnitSize.CENTURY, weight: 3 },
            { type: UnitType.ARCHERS, size: UnitSize.CENTURY, weight: 2 },
        ];

        const totalWeight = compositions.reduce((sum, c) => sum + c.weight, 0);
        let attempts = 0;
        while (remaining > 0 && attempts < 100) {
            let roll = Math.random() * totalWeight;
            let pick = compositions[0];
            for (const c of compositions) {
                roll -= c.weight;
                if (roll <= 0) { pick = c; break; }
            }
            const cost = SIZE_CONFIG[pick.size].strength;
            if (cost <= remaining) {
                const unit = new Unit(pick.type, pick.size, 'player');
                Army.playerUnits.push(unit);
                remaining -= cost;
            }
            attempts++;
        }
        // Fill remainder with centuries
        while (remaining >= 80) {
            const types = [UnitType.LIGHT_INFANTRY, UnitType.ARCHERS, UnitType.LIGHT_CAVALRY];
            const unit = new Unit(types[Math.floor(Math.random() * types.length)], UnitSize.CENTURY, 'player');
            Army.playerUnits.push(unit);
            remaining -= 80;
        }
    },

    _placeSpectatorPlayerArmy() {
        if (GameMap.mapType === 'ambush') {
            this._placeSpectatorPlayerAmbush();
            return;
        }

        const leftStart = GameMap.width * 0.03;
        const leftEnd = GameMap.width / 6;
        const topMargin = 80;
        const bottomMargin = GameMap.height - 80;
        const formationDepth = (leftEnd - leftStart);

        const archers = Army.playerUnits.filter(u => u.category === 'archers');
        const infantry = Army.playerUnits.filter(u => u.category === 'infantry');
        const cavalry = Army.playerUnits.filter(u => u.category === 'cavalry');

        const infFrontX = leftEnd - formationDepth * 0.25;
        const infSpread = (bottomMargin - topMargin - 100) / Math.max(infantry.length, 1);
        infantry.forEach((u, i) => {
            u.x = infFrontX + (Math.random() - 0.5) * 30;
            u.y = topMargin + 50 + infSpread * (i + 0.5);
            u.angle = 0;
        });

        const archBackX = leftStart + formationDepth * 0.35;
        const archSpread = (bottomMargin - topMargin - 100) / Math.max(archers.length, 1);
        archers.forEach((u, i) => {
            u.x = archBackX + (Math.random() - 0.5) * 20;
            u.y = topMargin + 50 + archSpread * (i + 0.5);
            u.angle = 0;
        });

        const halfCav = Math.ceil(cavalry.length / 2);
        const cavFrontX = leftEnd - formationDepth * 0.2;
        cavalry.slice(0, halfCav).forEach((u, i) => {
            u.x = cavFrontX + (Math.random() - 0.5) * 20;
            u.y = topMargin + 20 + i * 50;
            u.angle = 0;
        });
        cavalry.slice(halfCav).forEach((u, i) => {
            u.x = cavFrontX + (Math.random() - 0.5) * 20;
            u.y = bottomMargin - 20 - i * 50;
            u.angle = 0;
        });

        for (let pass = 0; pass < 10; pass++) {
            let moved = false;
            for (let i = 0; i < Army.playerUnits.length; i++) {
                for (let j = i + 1; j < Army.playerUnits.length; j++) {
                    const a = Army.playerUnits[i], b = Army.playerUnits[j];
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
        for (const u of Army.playerUnits) {
            const r = u.getCollisionRadius();
            u.x = Math.max(leftStart + r, Math.min(leftEnd - r, u.x));
            u.y = Math.max(r + 10, Math.min(GameMap.height - r - 10, u.y));
        }
    },

    // Ambush: place player units in center circle
    _placeSpectatorPlayerAmbush() {
        const cx = GameMap.width / 2, cy = GameMap.height / 2;
        const radius = 200;
        const units = Army.playerUnits;

        // Place in a tight formation in the center
        const cols = Math.ceil(Math.sqrt(units.length));
        const spacing = radius * 2 / (cols + 1);
        units.forEach((u, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            u.x = cx - radius + spacing * (col + 1) + (Math.random() - 0.5) * 15;
            u.y = cy - radius + spacing * (row + 1) + (Math.random() - 0.5) * 15;
            u.angle = Math.random() * Math.PI * 2; // face random directions (ambush!)
        });

        // Resolve overlaps — clamp to center circle
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
        for (const u of units) {
            const r = u.getCollisionRadius();
            const dx = u.x - cx, dy = u.y - cy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > radius - r) {
                const scale = (radius - r) / d;
                u.x = cx + dx * scale;
                u.y = cy + dy * scale;
            }
        }
    },

    // Spectator AI: mirrors AI.updateBattle but controls player units against AI units
    _updatePlayerAI(dt) {
        const visibleEnemies = AI.units.filter(e => e.alive && Visibility.isVisible(e.x, e.y, 'player'));
        const hasVisibleTargets = visibleEnemies.length > 0;

        let enemyCenterX, enemyCenterY;
        if (hasVisibleTargets) {
            enemyCenterX = visibleEnemies.reduce((s, e) => s + e.x, 0) / visibleEnemies.length;
            enemyCenterY = visibleEnemies.reduce((s, e) => s + e.y, 0) / visibleEnemies.length;
        }

        // Formation center of player units
        let fcX = 0, fcY = 0, fcN = 0;
        for (const u of Army.playerUnits) {
            if (!u.alive) continue;
            fcX += u.x; fcY += u.y; fcN++;
        }
        const formCenter = fcN > 0 ? { x: fcX / fcN, y: fcY / fcN } : { x: GameMap.width * 0.25, y: GameMap.height / 2 };

        for (const unit of Army.playerUnits) {
            if (!unit.alive || unit.inCombat || unit.routing) continue;

            // Find best target
            let bestTarget = null, bestScore = -Infinity;
            for (const enemy of visibleEnemies) {
                const dx = enemy.x - unit.x;
                const dy = enemy.y - unit.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                let score = 1000 - dist;
                if (enemy.routing) score += 300; // prefer routing enemies
                const bonus = Combat.getTypeBonus(unit, enemy);
                score += (bonus - 1) * 500;
                if (unit.category === 'cavalry' && enemy.category === 'archers') score += 400;
                if (unit.category === 'archers' && dist < unit.range * 0.5) score -= 400;
                if (score > bestScore) { bestScore = score; bestTarget = enemy; }
            }

            // Route helper (handles rivers via bridges and ditches via bypass)
            const routeTo = (destX, destY) => {
                if (AI._riverBetween(unit.x, unit.y, destX, destY)) {
                    const bridge = AI._findNearestBridge(unit.x, unit.y, destY);
                    if (bridge) {
                        const distToBridge = Math.sqrt((bridge.x - unit.x) ** 2 + (bridge.y - unit.y) ** 2);
                        if (distToBridge < 50) {
                            unit.targetX = destX;
                            unit.targetY = destY;
                        } else {
                            unit.targetX = bridge.x;
                            unit.targetY = bridge.y;
                        }
                        return;
                    }
                }
                // Ditch avoidance
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
                // Cavalry forest avoidance
                if (unit.category === 'cavalry') {
                    const steps = 5;
                    const ddx = destX - unit.x, ddy = destY - unit.y;
                    for (let s = 1; s <= steps; s++) {
                        const sx = unit.x + ddx * s / steps;
                        const sy = unit.y + ddy * s / steps;
                        if (GameMap.isInForest(sx, sy)) {
                            for (const f of GameMap.forests) {
                                const fdx = sx - f.x, fdy = sy - f.y;
                                if (fdx * fdx + fdy * fdy < (f.radius + 30) * (f.radius + 30)) {
                                    const perpX = -ddy, perpY = ddx;
                                    const len = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
                                    const nx = perpX / len, ny = perpY / len;
                                    const sA = { x: f.x + nx * (f.radius + 40), y: f.y + ny * (f.radius + 40) };
                                    const sB = { x: f.x - nx * (f.radius + 40), y: f.y - ny * (f.radius + 40) };
                                    const dA = (sA.x - unit.x) ** 2 + (sA.y - unit.y) ** 2;
                                    const dB = (sB.x - unit.x) ** 2 + (sB.y - unit.y) ** 2;
                                    const bp = dA < dB ? sA : sB;
                                    bp.x = Math.max(30, Math.min(GameMap.width - 30, bp.x));
                                    bp.y = Math.max(30, Math.min(GameMap.height - 30, bp.y));
                                    unit.targetX = bp.x;
                                    unit.targetY = bp.y;
                                    return;
                                }
                            }
                            break;
                        }
                    }
                }

                unit.targetX = destX;
                unit.targetY = destY;
            };

            if (unit.category === 'archers') {
                if (bestTarget) {
                    const dx = bestTarget.x - unit.x;
                    const dy = bestTarget.y - unit.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist > unit.range * 0.9) {
                        const moveX = unit.x + (dx / dist) * (dist - unit.range * 0.7);
                        const moveY = unit.y + (dy / dist) * (dist - unit.range * 0.7);
                        routeTo(moveX, moveY);
                    } else if (dist < unit.range * 0.3) {
                        // Retreat behind friendly infantry
                        let nearestInf = null, nearInfDist = Infinity;
                        for (const u of Army.playerUnits) {
                            if (!u.alive || u === unit || u.category !== 'infantry') continue;
                            const d = Math.sqrt((u.x - unit.x) ** 2 + (u.y - unit.y) ** 2);
                            if (d < nearInfDist) { nearestInf = u; nearInfDist = d; }
                        }
                        if (nearestInf) {
                            const retreatX = nearestInf.x + (nearestInf.x - bestTarget.x) * 0.3 - 50;
                            routeTo(retreatX, Math.max(50, Math.min(GameMap.height - 50, nearestInf.y)));
                        } else {
                            routeTo(unit.x - (dx / dist) * 100, unit.y - (dy / dist) * 100);
                        }
                    } else {
                        unit.targetX = null;
                        unit.targetY = null;
                    }
                    unit._turnToward(Math.atan2(dy, dx), dt);
                } else if (!hasVisibleTargets) {
                    if (unit.targetX === null) {
                        routeTo(formCenter.x - 80, formCenter.y + (Math.random() - 0.5) * 60);
                    }
                }

            } else if (unit.category === 'cavalry') {
                if (bestTarget) {
                    const dx = bestTarget.x - unit.x;
                    const dy = bestTarget.y - unit.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist > 200) {
                        const aboveCenter = unit.y < (enemyCenterY || GameMap.height / 2);
                        const flankY = aboveCenter ?
                            Math.max(40, bestTarget.y - 200) :
                            Math.min(GameMap.height - 40, bestTarget.y + 200);
                        routeTo(bestTarget.x, flankY);
                    } else {
                        routeTo(bestTarget.x, bestTarget.y);
                    }
                } else if (!hasVisibleTargets) {
                    if (unit.targetX === null) {
                        const aboveCenter = unit.y < GameMap.height / 2;
                        const flankY = aboveCenter ? Math.max(60, formCenter.y - 250) : Math.min(GameMap.height - 60, formCenter.y + 250);
                        routeTo(formCenter.x + 50, flankY);
                    }
                }

            } else {
                // Infantry
                if (bestTarget) {
                    const dx = bestTarget.x - unit.x;
                    const dy = bestTarget.y - unit.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist > 400) {
                        const hill = AI._findBestTerrain(unit.x, unit.y, 250, 'infantry');
                        const notOnHill = !GameMap.getHillBonus(unit.x, unit.y);
                        if (hill && notOnHill) {
                            const hillToEnemy = Math.sqrt((hill.x - bestTarget.x) ** 2 + (hill.y - bestTarget.y) ** 2);
                            if (hillToEnemy < dist) {
                                routeTo(hill.x, hill.y);
                            } else {
                                routeTo(bestTarget.x, bestTarget.y);
                            }
                        } else {
                            routeTo(bestTarget.x, bestTarget.y);
                        }
                    } else {
                        routeTo(bestTarget.x, bestTarget.y);
                    }
                } else if (!hasVisibleTargets) {
                    if (unit.targetX === null) {
                        const creepX = GameMap.width * (0.4 + Math.random() * 0.15);
                        const creepY = unit.y + (Math.random() - 0.5) * 80;
                        routeTo(creepX, Math.max(60, Math.min(GameMap.height - 60, creepY)));
                    }
                }
            }
        }
    },

    _physicsAccum: 0,
    _PHYSICS_DT: 1 / 60, // fixed 60Hz physics step

    loop(timestamp) {
        const frameDt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
        this.lastTime = timestamp;

        Renderer.clear();

        switch (this.state) {
            case 'PLACEMENT':
                this._renderPlacement();
                break;

            case 'BATTLE':
                if (Network.isMultiplayer && !Network.isHost) {
                    // Guest: interpolate between state snapshots for smooth movement
                    this._mpInterpolateUnits();
                    this._renderBattle(frameDt);
                } else {
                    // Host or single-player: run physics
                    this._physicsAccum += frameDt * this.gameSpeed;
                    this._frameArrows = [];
                    while (this._physicsAccum >= this._PHYSICS_DT && this.state === 'BATTLE') {
                        this._updateBattle(this._PHYSICS_DT);
                        this._physicsAccum -= this._PHYSICS_DT;
                    }
                    this._renderBattle(frameDt);
                }
                break;
        }

        requestAnimationFrame((t) => this.loop(t));
    },

    _isInPlacementZone(gx, gy) {
        if (GameMap.mapType === 'ambush') {
            const cx = GameMap.width / 2, cy = GameMap.height / 2;
            const dx = gx - cx, dy = gy - cy;
            return dx * dx + dy * dy <= 250 * 250;
        }
        const zoneW = GameMap.width / 6;
        const isGuestSide = Network.isMultiplayer && !Network.isHost;
        const zoneX = isGuestSide ? GameMap.width - zoneW : 0;
        return gx >= zoneX && gx <= zoneX + zoneW && gy >= 0 && gy <= GameMap.height;
    },

    _renderPlacement() {
        Renderer.placementTimer = performance.now() / 1000;
        Renderer.drawMap();
        Renderer.drawPlacementZone();

        // Show tooltip when hovering the placement zone
        const gm = Renderer.screenToGame(Input.mouseX, Input.mouseY);
        if (this._isInPlacementZone(gm.x, gm.y)) {
            Renderer.drawPlacementZoneTooltip(gm.x, gm.y);
        }

        // Draw pre-battle order waypoints for placed units
        const allPlaced = Army.rosterForPlacement.every(r => r.placed);
        if (allPlaced) {
            Renderer.battleTimer = performance.now() / 1000; // for pulsing
            Renderer.drawMoveTargets(Army.playerUnits);
        }

        // Draw placed player units
        for (const r of Army.rosterForPlacement) {
            if (r.placed) Renderer.drawUnit(r.unit);
        }

        // Draw selection box during placement (when all placed)
        if (allPlaced) {
            const box = Input.getSelectionBox();
            if (box) {
                Renderer.drawSelectionBox(box.x1, box.y1, box.x2, box.y2);
            }
        }

        // Draw line drag preview
        if (Input._lineDragPreview) {
            const sel = Army.playerUnits.filter(u => u.selected);
            Renderer.drawLineDragPreview(Input._lineDragPreview, sel);
        }

        // AI units hidden during placement — revealed at battle start
    },

    _updateBattle(dt) {
        this.battleTime += dt;

        // Update all units
        for (const u of Army.playerUnits) u.update(dt);
        for (const u of AI.units) u.update(dt);

        // Compute visibility for both teams
        Visibility.computeVisibility(Army.playerUnits, Visibility.playerGrid);
        Visibility.computeVisibility(AI.units, Visibility.enemyGrid);
        if (!this.spectatorMode) {
            Visibility.renderFogOverlay();
        }

        // Spectator: run player AI before enemy AI
        if (this.spectatorMode) {
            this._updatePlayerAI(dt);
        }

        // AI decision making (uses enemyGrid for target filtering)
        AI.updateBattle(Army.playerUnits, dt);

        // Combat resolution
        const tickArrows = Combat.updateAll(Army.playerUnits, AI.units, dt);
        if (tickArrows.length > 0) {
            if (!this._frameArrows) this._frameArrows = [];
            for (const a of tickArrows) this._frameArrows.push(a);
        }

        // Detect newly dead units and add death markers
        const allUnits = [...Army.playerUnits, ...AI.units];
        for (const u of allUnits) {
            if (!u.alive && this._prevAlive[u.id]) {
                Renderer.addDeathMarker(u.x, u.y, u.team);
                this._prevAlive[u.id] = false;
                // Morale effects: nearby allies lose morale, enemies gain
                Combat.onUnitKilled(u, allUnits);
                // Kill feed
                const tc = TYPE_CONFIG[u.type], sc = SIZE_CONFIG[u.size];
                const label = (tc ? tc.label : 'Unit') + ' ' + (sc ? sc.label : '');
                const prefix = u.team === 'player' ? 'Your' : 'Enemy';
                const color = u.team === 'player' ? '#d08060' : '#8ac070';
                Renderer.addBattleLogEntry(`${prefix} ${label} destroyed!`, color);
                // Track battle events
                if (u.team === 'player') { this._battleEvents.playerDestroyed++; }
                else { this._battleEvents.enemyDestroyed++; }
            }
        }

        // Update renderer battle timer for pulsing effects
        Renderer.battleTimer = this.battleTime;

        // Check win/loss
        const playerAlive = Army.playerUnits.some(u => u.alive);
        const enemyAlive = AI.units.some(u => u.alive);

        if (!playerAlive || !enemyAlive) {
            this.setState('RESULT');
        }
    },

    _renderBattle(dt) {
        // DOM updates — once per render frame, not per physics tick
        if (!this.spectatorMode) {
            const selected = Army.playerUnits.find(u => u.selected && u.alive);
            const infoPanel = document.getElementById('unitInfoPanel');
            if (infoPanel) {
                if (selected) {
                    infoPanel.textContent = selected.getDisplayInfo() + (selected.inCombat ? ' [IN COMBAT]' : '');
                } else {
                    infoPanel.textContent = 'Select a unit for info';
                }
            }
            this._updateHotbar();
        }
        const timerEl = document.getElementById('battleTimer');
        if (timerEl) {
            const m = Math.floor(this.battleTime / 60);
            const s = Math.floor(this.battleTime % 60);
            timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        }

        Renderer.drawMap();

        // Draw ditches (above map, below units)
        Renderer.drawDitches();

        // Draw death markers (below units)
        Renderer.drawDeathMarkers(dt);

        // Draw fog of war overlay (above map/ditches, below units) — skip in spectator
        if (!this.spectatorMode) {
            Renderer.drawFogOfWar();
        }

        // Draw move targets for selected units
        if (!this.spectatorMode) {
            Renderer.drawMoveTargets(Army.playerUnits);
        }

        // Draw player units (always visible)
        for (const u of Army.playerUnits) Renderer.drawUnit(u);

        // Draw enemy units — in spectator show all, otherwise only visible
        for (const u of AI.units) {
            if (u.alive && (this.spectatorMode || Visibility.isVisible(u.x, u.y, 'player'))) {
                Renderer.drawUnit(u);
            }
        }

        // Draw arrows
        Renderer.drawArrows(this._frameArrows || [], dt);

        // Draw selection box
        const box = Input.getSelectionBox();
        if (box) {
            Renderer.drawSelectionBox(box.x1, box.y1, box.x2, box.y2);
        }

        // Draw line drag preview
        if (Input._lineDragPreview) {
            const sel = Army.playerUnits.filter(u => u.alive && u.selected);
            Renderer.drawLineDragPreview(Input._lineDragPreview, sel);
        }

        // Draw battle info overlay
        Renderer.drawBattleInfo(Army.playerUnits, AI.units);

        // Draw kill feed
        Renderer.drawBattleLog(dt);

        // Draw rally effects
        Renderer.drawRallyEffects(dt);

        // Draw tooltip for unit under cursor (skip invisible enemies)
        let hovered = null;
        for (const u of Army.playerUnits) {
            if (!u.alive) continue;
            const dx = u.x - Input.gameX;
            const dy = u.y - Input.gameY;
            if (Math.sqrt(dx * dx + dy * dy) < u.getCollisionRadius() + 5) {
                hovered = u;
                break;
            }
        }
        if (!hovered) {
            for (const u of AI.units) {
                if (!u.alive) continue;
                if (!Visibility.isVisible(u.x, u.y, 'player')) continue;
                const dx = u.x - Input.gameX;
                const dy = u.y - Input.gameY;
                if (Math.sqrt(dx * dx + dy * dy) < u.getCollisionRadius() + 5) {
                    hovered = u;
                    break;
                }
            }
        }
        if (hovered) {
            Renderer.drawTooltip(hovered, Input.gameX, Input.gameY);
        }
    }
};

// Start the game
window.addEventListener('load', () => Game.init());
