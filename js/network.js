// Multiplayer networking via Supabase Realtime broadcast channels
const Network = {
    // Supabase config
    SUPABASE_URL: 'https://rmlcqmvfjxktstqblpwc.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_2mNtnvIn_Tc43KT4q0SD2g_5jwRTNXt',

    // State
    supabase: null,
    channel: null,
    isHost: false,
    isMultiplayer: false,
    roomCode: null,
    peerId: null,
    peerConnected: false,
    _lastPeerPing: 0,
    _heartbeatInterval: null,
    _disconnectCheckInterval: null,
    _broadcastInterval: null,
    _commandCount: 0,
    _commandResetTime: 0,

    // Ready state
    _selfReady: false,
    _peerReady: false,
    _peerArmy: null,

    // Callbacks (set by main.js)
    onPeerJoin: null,       // guest joined lobby
    onPeerReady: null,      // peer sent ready + army
    onPeerUnready: null,    // peer cancelled ready
    onMapSelected: null,    // host selected map (guest receives)
    onCommand: null,        // host receives guest command
    onState: null,          // guest receives state snapshot
    onBattleStart: null,    // both enter battle
    onBattleResult: null,   // battle ended
    onPeerDisconnect: null, // peer disconnected

    // Guest interpolation
    _prevState: null,
    _currState: null,
    _stateTime: 0,
    _renderDelay: 80, // ms behind real-time

    // --- Initialization ---

    init() {
        if (this.supabase) return;
        this.supabase = supabase.createClient(this.SUPABASE_URL, this.SUPABASE_ANON_KEY);
        this.peerId = 'p_' + Math.random().toString(36).substring(2, 10);
    },

    // --- Room Management ---

    createRoom() {
        this.init();
        this.isHost = true;
        this.isMultiplayer = true;
        this.roomCode = this._generateRoomCode();
        this._selfReady = false;
        this._peerReady = false;
        this._peerArmy = null;
        this._subscribe();
        return this.roomCode;
    },

    joinRoom(code) {
        this.init();
        this.isHost = false;
        this.isMultiplayer = true;
        this.roomCode = code.toUpperCase();
        this._selfReady = false;
        this._peerReady = false;
        this._peerArmy = null;
        this._subscribe(() => {
            // Once subscribed, announce join
            this.channel.send({
                type: 'broadcast',
                event: 'lobby',
                payload: { action: 'join', peerId: this.peerId }
            });
        });
    },

    leaveRoom() {
        // Notify peer before leaving
        if (this.channel) {
            this.channel.send({
                type: 'broadcast',
                event: 'lobby',
                payload: { action: 'disconnect', peerId: this.peerId }
            });
        }
        this._cleanup();
    },

    _cleanup() {
        if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
        if (this._disconnectCheckInterval) clearInterval(this._disconnectCheckInterval);
        if (this._broadcastInterval) clearInterval(this._broadcastInterval);
        this._heartbeatInterval = null;
        this._disconnectCheckInterval = null;
        this._broadcastInterval = null;
        if (this.channel) {
            this.supabase.removeChannel(this.channel);
            this.channel = null;
        }
        this.isMultiplayer = false;
        this.isHost = false;
        this.roomCode = null;
        this.peerConnected = false;
        this._selfReady = false;
        this._peerReady = false;
        this._peerArmy = null;
        this._prevState = null;
        this._currState = null;
        this._commandCount = 0;
    },

    _subscribe(onReady) {
        this.channel = this.supabase.channel(`room:${this.roomCode}`, {
            config: { broadcast: { self: false } }
        });

        this.channel.on('broadcast', { event: 'lobby' }, (msg) => this._onLobby(msg.payload));
        this.channel.on('broadcast', { event: 'setup' }, (msg) => this._onSetup(msg.payload));
        this.channel.on('broadcast', { event: 'command' }, (msg) => this._onCommandReceived(msg.payload));
        this.channel.on('broadcast', { event: 'state' }, (msg) => this._onStateReceived(msg.payload));
        this.channel.on('broadcast', { event: 'ping' }, (msg) => this._onPing(msg.payload));

        this.channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                this._startHeartbeat();
                if (onReady) onReady();
            }
        });
    },

    // --- Heartbeat & Disconnect ---

    _startHeartbeat() {
        this._lastPeerPing = Date.now();
        this._heartbeatInterval = setInterval(() => {
            if (this.channel) {
                this.channel.send({
                    type: 'broadcast',
                    event: 'ping',
                    payload: { peerId: this.peerId, t: Date.now() }
                });
            }
        }, 3000);

        this._disconnectCheckInterval = setInterval(() => {
            if (this.peerConnected && Date.now() - this._lastPeerPing > 10000) {
                this.peerConnected = false;
                if (this.onPeerDisconnect) this.onPeerDisconnect();
            }
        }, 2000);
    },

    _onPing(payload) {
        if (payload.peerId !== this.peerId) {
            this._lastPeerPing = Date.now();
        }
    },

    // --- Lobby Messages ---

    _onLobby(payload) {
        switch (payload.action) {
            case 'join':
                if (this.isHost && !this.peerConnected) {
                    this.peerConnected = true;
                    this._lastPeerPing = Date.now();
                    // Send welcome back
                    this.channel.send({
                        type: 'broadcast',
                        event: 'lobby',
                        payload: { action: 'welcome', peerId: this.peerId }
                    });
                    if (this.onPeerJoin) this.onPeerJoin();
                }
                break;

            case 'welcome':
                if (!this.isHost) {
                    this.peerConnected = true;
                    this._lastPeerPing = Date.now();
                    if (this.onPeerJoin) this.onPeerJoin();
                }
                break;

            case 'disconnect':
                if (payload.peerId !== this.peerId) {
                    this.peerConnected = false;
                    if (this.onPeerDisconnect) this.onPeerDisconnect();
                }
                break;
        }
    },

    // --- Setup Messages (map selection, army ready, battle start) ---

    sendMapSelection(map, seed, budget) {
        if (!this.channel) return;
        this.channel.send({
            type: 'broadcast',
            event: 'setup',
            payload: { action: 'map', map, seed, budget }
        });
    },

    sendReady(armyData) {
        if (!this.channel) return;
        this._selfReady = true;
        this.channel.send({
            type: 'broadcast',
            event: 'setup',
            payload: { action: 'ready', army: armyData, peerId: this.peerId }
        });
    },

    sendUnready() {
        if (!this.channel) return;
        this._selfReady = false;
        this.channel.send({
            type: 'broadcast',
            event: 'setup',
            payload: { action: 'unready', peerId: this.peerId }
        });
    },

    sendBattleStart() {
        if (!this.channel) return;
        this.channel.send({
            type: 'broadcast',
            event: 'setup',
            payload: { action: 'start' }
        });
    },

    sendBattleResult(winner) {
        if (!this.channel) return;
        this.channel.send({
            type: 'broadcast',
            event: 'setup',
            payload: { action: 'result', winner }
        });
    },

    _onSetup(payload) {
        switch (payload.action) {
            case 'map':
                if (!this.isHost && this.onMapSelected) {
                    this.onMapSelected(payload.map, payload.seed, payload.budget);
                }
                break;

            case 'ready':
                if (payload.peerId !== this.peerId) {
                    this._peerReady = true;
                    this._peerArmy = payload.army;
                    if (this.onPeerReady) this.onPeerReady(payload.army);
                }
                break;

            case 'unready':
                if (payload.peerId !== this.peerId) {
                    this._peerReady = false;
                    this._peerArmy = null;
                    if (this.onPeerUnready) this.onPeerUnready();
                }
                break;

            case 'start':
                if (this.onBattleStart) this.onBattleStart();
                break;

            case 'result':
                if (this.onBattleResult) this.onBattleResult(payload.winner);
                break;
        }
    },

    // --- Game State Broadcasting (host → guest) ---

    startBroadcasting(getStateFn) {
        if (!this.isHost) return;
        // Broadcast at ~12 Hz
        this._broadcastInterval = setInterval(() => {
            if (!this.channel || !this.peerConnected) return;
            const state = getStateFn();
            this.channel.send({
                type: 'broadcast',
                event: 'state',
                payload: state
            });
        }, 83); // ~12 Hz
    },

    stopBroadcasting() {
        if (this._broadcastInterval) {
            clearInterval(this._broadcastInterval);
            this._broadcastInterval = null;
        }
    },

    compressUnits(units) {
        return units.map(u => ({
            nid: u.netId,
            x: Math.round(u.x),
            y: Math.round(u.y),
            a: Math.round(u.angle * 100) / 100,
            hp: Math.round(u.hp),
            mhp: u.maxHp,
            mo: Math.round(u.morale),
            rt: u.routing ? 1 : 0,
            ic: u.inCombat ? 1 : 0,
            dg: u.digging ? 1 : 0,
            al: u.alive ? 1 : 0,
            tx: u.targetX !== null ? Math.round(u.targetX) : null,
            ty: u.targetY !== null ? Math.round(u.targetY) : null,
        }));
    },

    compressArrows(arrows) {
        if (!arrows || arrows.length === 0) return [];
        return arrows.map(a => ({
            x: Math.round(a.x),
            y: Math.round(a.y),
            tx: Math.round(a.targetX),
            ty: Math.round(a.targetY),
            t: Math.round(a.time * 100) / 100,
            d: Math.round(a.duration * 100) / 100,
        }));
    },

    // --- Game State Receiving (guest) ---

    _onStateReceived(payload) {
        if (this.isHost) return;
        // Push into interpolation buffer
        this._prevState = this._currState;
        this._currState = {
            time: Date.now(),
            hostUnits: payload.hu,
            guestUnits: payload.gu,
            arrows: payload.ar,
            battleTime: payload.bt,
            events: payload.ev,
        };
        // Direct callback for immediate processing
        if (this.onState) this.onState(this._currState);
    },

    // Interpolate between two state snapshots for smooth rendering
    getInterpolatedState() {
        if (!this._currState) return null;
        if (!this._prevState) return this._currState;

        const now = Date.now() - this._renderDelay;
        const dt = this._currState.time - this._prevState.time;
        if (dt <= 0) return this._currState;

        const t = Math.max(0, Math.min(1, (now - this._prevState.time) / dt));

        const lerp = (a, b) => a + (b - a) * t;

        const interpolateUnits = (prev, curr) => {
            if (!prev || !curr) return curr || prev || [];
            const prevMap = {};
            for (const u of prev) prevMap[u.nid] = u;

            return curr.map(cu => {
                const pu = prevMap[cu.nid];
                if (!pu) return cu; // new unit, snap
                return {
                    nid: cu.nid,
                    x: lerp(pu.x, cu.x),
                    y: lerp(pu.y, cu.y),
                    a: lerp(pu.a, cu.a),
                    hp: lerp(pu.hp, cu.hp),
                    mhp: cu.mhp,
                    mo: lerp(pu.mo, cu.mo),
                    // Booleans: snap to latest
                    rt: cu.rt, ic: cu.ic, dg: cu.dg, al: cu.al,
                    tx: cu.tx, ty: cu.ty,
                };
            });
        };

        return {
            time: now,
            hostUnits: interpolateUnits(this._prevState.hostUnits, this._currState.hostUnits),
            guestUnits: interpolateUnits(this._prevState.guestUnits, this._currState.guestUnits),
            arrows: this._currState.arrows,
            battleTime: lerp(this._prevState.battleTime, this._currState.battleTime),
            events: this._currState.events,
        };
    },

    // --- Commands (guest → host) ---

    sendCommand(cmd) {
        if (!this.channel || this.isHost) return;
        this.channel.send({
            type: 'broadcast',
            event: 'command',
            payload: cmd
        });
    },

    _onCommandReceived(payload) {
        if (!this.isHost) return;
        // Rate limit: max 30 commands/sec
        const now = Date.now();
        if (now - this._commandResetTime > 1000) {
            this._commandCount = 0;
            this._commandResetTime = now;
        }
        this._commandCount++;
        if (this._commandCount > 30) return;

        // Validate command
        if (!this._validateCommand(payload)) return;

        if (this.onCommand) this.onCommand(payload);
    },

    _validateCommand(cmd) {
        // Type sanity
        const validTypes = ['move', 'hold', 'retreat', 'rally', 'dig', 'waypoint'];
        if (!validTypes.includes(cmd.type)) return false;

        // Bounds check for move/waypoint
        if (cmd.type === 'move' || cmd.type === 'waypoint') {
            if (typeof cmd.x !== 'number' || typeof cmd.y !== 'number') return false;
            cmd.x = Math.max(0, Math.min(1920, cmd.x));
            cmd.y = Math.max(0, Math.min(1080, cmd.y));
        }

        // Unit ownership: all unitIds must start with 'g' (guest units)
        if (cmd.unitIds) {
            for (const id of cmd.unitIds) {
                if (typeof id !== 'string' || !id.startsWith('g')) return false;
            }
        }

        return true;
    },

    // --- Utilities ---

    _generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    },

    // Find a unit by netId in an array
    findByNetId(units, netId) {
        return units.find(u => u.netId === netId);
    },
};
