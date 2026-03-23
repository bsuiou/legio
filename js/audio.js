// Audio Manager — handles music tracks and sound effects
// Designed for future expansion: per-context music, layered SFX, crossfades
const AudioManager = {
    // --- State ---
    _initialized: false,
    _muted: false,
    _musicVolume: 0.4,
    _sfxVolume: 0.6,
    _currentTrack: null,   // key of currently playing music track
    _currentAudio: null,   // HTMLAudioElement for current music
    _fadeInterval: null,

    // --- Track Registry ---
    // Add new tracks here. Each key maps to { src, loop, volume (relative 0-1) }
    // Future: campaign, boss, shop, event, multiplayer, etc.
    tracks: {
        'main-theme':   { src: 'assets/audio/main-theme.mp3', loop: true, volume: 1.0 },
        // 'campaign':  { src: 'assets/audio/campaign.mp3',   loop: true, volume: 1.0 },
        // 'battle':    { src: 'assets/audio/battle.mp3',     loop: true, volume: 1.0 },
        // 'shop':      { src: 'assets/audio/shop.mp3',       loop: true, volume: 0.8 },
        // 'boss':      { src: 'assets/audio/boss.mp3',       loop: true, volume: 1.0 },
        // 'victory':   { src: 'assets/audio/victory.mp3',    loop: false, volume: 1.0 },
        // 'defeat':    { src: 'assets/audio/defeat.mp3',     loop: false, volume: 1.0 },
    },

    // --- SFX Registry ---
    // Future: arrow impact, charge, rally horn, rout scream, etc.
    sfx: {
        // 'arrow-hit':  { src: 'assets/audio/sfx/arrow-hit.mp3', volume: 0.5 },
        // 'charge':     { src: 'assets/audio/sfx/charge.mp3',    volume: 0.7 },
        // 'rally':      { src: 'assets/audio/sfx/rally.mp3',     volume: 0.6 },
    },

    // --- Context-to-Track Mapping ---
    // Maps game states to which track should play. null = keep current.
    // Override with specific tracks as they're added.
    contextMap: {
        'MENU':           'main-theme',
        'MAP_SELECT':     'main-theme',
        'MODIFIERS':      'main-theme',
        'ARMY_SETUP':     'main-theme',
        'CAMPAIGN_MAP':   'main-theme',  // future: 'campaign'
        'CAMPAIGN_SHOP':  'main-theme',  // future: 'shop'
        'ENDLESS_MAP':    'main-theme',  // future: 'campaign'
        'ENDLESS_SHOP':   'main-theme',  // future: 'shop'
        'PLACEMENT':      'main-theme',  // future: 'battle'
        'BATTLE':         'main-theme',  // future: 'battle'
        'RESULT':         'main-theme',  // future: 'victory' or 'defeat'
        'MP_WAITING':     'main-theme',
        'MP_JOINING':     'main-theme',
        'SPECTATOR_SETUP':'main-theme',
    },

    // --- Public API ---

    // Call once on first user interaction (click) to unlock audio
    init() {
        if (this._initialized) return;
        this._initialized = true;
        // Load saved preferences
        try {
            const saved = localStorage.getItem('legio_audio');
            if (saved) {
                const prefs = JSON.parse(saved);
                if (prefs.muted !== undefined) this._muted = prefs.muted;
                if (prefs.musicVolume !== undefined) this._musicVolume = prefs.musicVolume;
            }
        } catch (e) { /* ignore */ }
    },

    // Called by Game.setState — switches music based on context
    onStateChange(newState) {
        if (!this._initialized) this.init();
        const trackKey = this.contextMap[newState];
        if (trackKey && trackKey !== this._currentTrack) {
            this.playMusic(trackKey);
        }
    },

    // Play a music track by key (crossfades if something is already playing)
    playMusic(key, fadeMs) {
        const track = this.tracks[key];
        if (!track) return;
        fadeMs = fadeMs || 800;

        // Same track already playing
        if (key === this._currentTrack && this._currentAudio && !this._currentAudio.paused) return;

        // Fade out current track, then start new one
        if (this._currentAudio && !this._currentAudio.paused) {
            this._fadeOut(this._currentAudio, fadeMs, () => {
                this._startTrack(key, track);
            });
        } else {
            this._startTrack(key, track);
        }
    },

    // Stop current music (with optional fade)
    stopMusic(fadeMs) {
        if (!this._currentAudio) return;
        fadeMs = fadeMs || 500;
        this._fadeOut(this._currentAudio, fadeMs, () => {
            this._currentTrack = null;
            this._currentAudio = null;
        });
    },

    // Play a one-shot SFX (future use)
    playSFX(key) {
        const sfx = this.sfx[key];
        if (!sfx || this._muted) return;
        const audio = new Audio(sfx.src);
        audio.volume = sfx.volume * this._sfxVolume;
        audio.play().catch(() => {});
    },

    // Toggle mute
    toggleMute() {
        this._muted = !this._muted;
        if (this._currentAudio) {
            this._currentAudio.muted = this._muted;
        }
        this._savePrefs();
        return this._muted;
    },

    // Set music volume (0-1)
    setMusicVolume(vol) {
        this._musicVolume = Math.max(0, Math.min(1, vol));
        if (this._currentAudio) {
            const track = this.tracks[this._currentTrack];
            this._currentAudio.volume = this._musicVolume * (track ? track.volume : 1);
        }
        this._savePrefs();
    },

    get muted() { return this._muted; },
    get musicVolume() { return this._musicVolume; },

    // --- Internal ---

    _startTrack(key, track) {
        const audio = new Audio(track.src);
        audio.loop = !!track.loop;
        audio.volume = this._muted ? 0 : this._musicVolume * track.volume;
        audio.muted = this._muted;
        audio.play().catch(() => {});
        this._currentTrack = key;
        this._currentAudio = audio;
    },

    _fadeOut(audio, durationMs, onComplete) {
        if (this._fadeInterval) clearInterval(this._fadeInterval);
        const startVol = audio.volume;
        const steps = 20;
        const stepMs = durationMs / steps;
        const decrement = startVol / steps;
        let step = 0;
        this._fadeInterval = setInterval(() => {
            step++;
            audio.volume = Math.max(0, startVol - decrement * step);
            if (step >= steps) {
                clearInterval(this._fadeInterval);
                this._fadeInterval = null;
                audio.pause();
                audio.currentTime = 0;
                if (onComplete) onComplete();
            }
        }, stepMs);
    },

    _savePrefs() {
        try {
            localStorage.setItem('legio_audio', JSON.stringify({
                muted: this._muted,
                musicVolume: this._musicVolume,
            }));
        } catch (e) { /* ignore */ }
    },
};
