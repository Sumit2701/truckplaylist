// ---------------------------------------------------------------------------
// Music source. No controls — the drive just plays.
//
// YouTube is the zero-setup default (works with no account/API key).
// Spotify requires: config.js -> provider:'spotify' + a clientId + a one-time
// PKCE login (see README). It uses the Web Playback SDK to play continuously.
// ---------------------------------------------------------------------------
import { CONFIG } from '../../config.js';

let player = null;      // current impl ({play, setVolume, meta, onMeta})
let onMeta = null;      // callback the scene uses to show now-playing
let onError = null;
let started = false;

export function initPlayer({ ready, meta, error }) {
  onMeta = meta;
  onError = error;
  const provider = CONFIG.provider;
  if (provider === 'spotify') {
    player = createSpotify({ ready, meta, error });
  } else {
    player = createYoutube({ ready, meta, error });
  }
  return player;
}

export async function startMusic() {
  if (!player) return;
  if (started) { player.resume && player.resume(); return; }
  started = true;
  await player.start();
}

export function setVolume(v) {
  player && player.setVolume && player.setVolume(v);
}

export function getPlayer() { return player; }

// --- YouTube (default) ------------------------------------------------------

function createYoutube({ ready, meta, error }) {
  const state = {
    apiReady: false,
    iframe: null,
    nextResume: null,
    volume: (CONFIG.youtube?.volume ?? 55) / 100,
  };

  function loadApi() {
    return new Promise((resolve) => {
      if (window.YT && window.YT.Player) return resolve();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(); };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        s.async = true;
        document.head.appendChild(s);
      }
    });
  }

  function setVolume(v) { state.volume = v; state.iframe?.setVolume(v * 100); }

  function buildIframe() {
    const id = document.createElement('div');
    id.style.display = 'none';
    document.body.appendChild(id);
    const p = new YT.Player(id, {
      width: 1, height: 1,
      videoId: 'M9CkNhdqyCI', // placeholder song; replaced by playlist
      playerVars: {
        listType: 'playlist',
        list: CONFIG.youtube.playlistId,
        autoplay: 1,
        loop: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        playsinline: 1,
        modestbranding: 1,
        rel: 0,
      },
      events: {
        onReady: () => {
          p.setVolume(state.volume * 100);
          p.setLoop(true);
          if (state.nextResume) { state.nextResume(); state.nextResume = null; }
          ready();
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) {
            const t = p.getVideoData && p.getVideoData();
            meta({ title: t?.title || 'Drive mix', artist: t?.author || 'YouTube', album: 'endless drive' });
          }
        },
        onError: () => error('YouTube playback failed. Check playlistId or try again.'),
      },
    });
    state.iframe = p;
  }

  return {
    start: async () => {
      await loadApi();
      if (!state.iframe) buildIframe();
      else {
        state.nextResume = () => state.iframe.playVideo();
        state.iframe.playVideo();
        ready();
      }
    },
    resume: () => state.iframe?.playVideo(),
    setVolume,
    get meta() { return null; },
    get kind() { return 'youtube'; },
  };
}

// --- Spotify (Web Playback SDK + PKCE) ---------------------------------------

function createSpotify({ ready, meta, error }) {
  const cfg = CONFIG.spotify;
  const state = {
    deviceId: null,
    token: null,
    sdk: null,
    volume: cfg.volume ?? 0.55,
    pendingPlay: false,
  };

  function showAuth() {
    error('Spotify needs a one-time login. Add a clientId in config.js, then open /?auth=1 this once.');
  }

  async function start() {
    if (!cfg.clientId) { showAuth(); return; }
    try {
      state.token = await getToken();
      await loadSdk();
      await waitForDevice();
      await play();
    } catch (e) {
      error('Spotify: ' + (e?.message || e));
    }
  }

  async function getToken() {
    const params = new URLSearchParams(location.search);
    if (params.get('code')) {
      const code = params.get('code');
      history.replaceState({}, '', location.pathname);
      return exchangeCode(code);
    }
    if (localStorage.getItem('tp_token')) {
      const cached = JSON.parse(localStorage.getItem('tp_token'));
      if (cached && cached.expires > Date.now()) return cached.token;
    }
    if (params.get('auth') === '1') {
      const verifier = pkce();
      localStorage.setItem('tp_verifier', verifier);
      redirectToAuth(verifier);
      return new Promise(() => {}); // never resolves; page navigates
    }
    // No token yet: go through auth automatically.
    const verifier = localStorage.getItem('tp_verifier') || pkce();
    localStorage.setItem('tp_verifier', verifier);
    redirectToAuth(verifier);
    return new Promise(() => {});
  }

  function pkce() {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function redirectToAuth(verifier) {
    const challenge = sha256(verifier).then((ch) => {
      const q = new URLSearchParams({
        client_id: cfg.clientId,
        response_type: 'code',
        redirect_uri: cfg.redirectUri,
        code_challenge_method: 'S256',
        code_challenge: ch,
        scope: 'streaming user-read-email user-read-private playlist-read-private',
      });
      location.href = 'https://accounts.spotify.com/authorize?' + q.toString();
    });
    return challenge;
  }

  async function exchangeCode(code) {
    const verifier = localStorage.getItem('tp_verifier');
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: verifier,
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();
    if (!data.access_token) throw new Error('login failed');
    localStorage.setItem('tp_token', JSON.stringify({ token: data.access_token, expires: Date.now() + data.expires_in * 1000 }));
    return data.access_token;
  }

  function loadSdk() {
    return new Promise((resolve, reject) => {
      if (window.Spotify) return resolve();
      const s = document.createElement('script');
      s.src = 'https://sdk.scdn.co/spotify-player.js';
      s.async = true;
      s.onerror = () => reject(new Error('could not load SDK'));
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
      document.head.appendChild(s);
    });
  }

  function waitForDevice() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('device not ready')), 20000);
      state.sdk = new Spotify.Player({
        name: 'truckplaylist · endless drive',
        getOAuthToken: (cb) => cb(state.token),
        volume: state.volume,
      });
      state.sdk.addListener('ready', ({ device_id }) => {
        state.deviceId = device_id;
        clearTimeout(timeout);
        ready();
        resolve();
      });
      state.sdk.addListener('not_ready', () => {});
      state.sdk.addListener('player_state_changed', (s) => {
        if (s && s.track_window && s.track_window.current_track) {
          const t = s.track_window.current_track;
          meta({ title: t.name, artist: t.artists?.map(a => a.name).join(', ') || 'Spotify', album: t.album?.name || 'endless drive' });
        }
      });
      state.sdk.addListener('initialization_error', (e) => reject(new Error(e.message)));
      state.sdk.addListener('authentication_error', () => reject(new Error('auth rejected')));
      state.sdk.connect().catch(reject);
    });
  }

  async function play() {
    const uri = cfg.playlistUri || 'spotify:playlist:37i9dQZF1DX3Ogo9pFvBkY';
    const q = new URLSearchParams({ device_id: state.deviceId, context_uri: uri });
    const res = await fetch('https://api.spotify.com/v1/me/player/play?' + q, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + state.token },
    });
    if (res.status === 204) return;
    if (res.status === 404) throw new Error('no active device — open Spotify once');
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || 'play failed');
  }

  return {
    start,
    resume: () => state.sdk?.resume(),
    setVolume: (v) => { state.volume = v; state.sdk?.setVolume(v); },
    get kind() { return 'spotify'; },
  };
}
