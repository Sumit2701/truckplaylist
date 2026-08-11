// truckplaylist — bootstrap. Starts driving + playing automatically.
import { CONFIG } from '../config.js';
import { Scene } from './scene/scene.js';
import {
  initPlayer, startMusic, setVolume, nextTrack, prevTrack, togglePause, getStatus,
} from './audio/player.js';

// --- apply URL overrides so a link can tune the drive ------------------------
function applyOverrides() {
  const q = new URLSearchParams(location.search);
  if (q.has('speed')) CONFIG.scene.speed = Number(q.get('speed'));
  if (q.has('daylength')) CONFIG.scene.dayLength = Number(q.get('daylength'));
  if (q.has('time')) {
    const v = q.get('time');
    CONFIG.scene.startPhase = v === 'now' ? (new Date().getHours() / 24) : (Number(v) / 24);
  }
  if (q.has('provider')) CONFIG.provider = q.get('provider');
  if (q.has('badge')) CONFIG.scene.provider = q.get('badge');
}

applyOverrides();

const canvas = document.getElementById('scene');
const curtain = document.getElementById('curtain');
const err = document.getElementById('error');
const live = {
  root: document.getElementById('live-count'),
  dot: document.getElementById('live-dot'),
  num: document.getElementById('live-num'),
};

// --- player bar (music-app style controls, bottom center) ---------------------
const bar = {
  root: document.getElementById('bar'),
  track: document.getElementById('bar-track'),
  artist: document.getElementById('bar-artist'),
  prev: document.getElementById('ctrl-prev'),
  play: document.getElementById('ctrl-play'),
  next: document.getElementById('ctrl-next'),
  volume: document.getElementById('ctrl-volume'),
  volIcon: document.getElementById('vol-icon'),
  time: document.getElementById('bar-time'),
  dur: document.getElementById('bar-dur'),
  seek: document.getElementById('seek'),
  hint: document.getElementById('tap-hint'),
};

const scene = new Scene(canvas);

// --- live presence -----------------------------------------------------------
// Pings the Node server every few seconds with a persistent session id and
// shows a small "N online" badge. On a static host (no /api/presence) this
// quietly hides itself.
(function startPresence() {
  if (!live.root) return;
  const SESSION_KEY = 'truckplaylist/session';
  let sid = null;
  try { sid = localStorage.getItem(SESSION_KEY); } catch { /* private mode */ }
  if (!sid) {
    sid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) +
          Date.now().toString(36);
    try { localStorage.setItem(SESSION_KEY, sid); } catch { /* ignore */ }
  }

  let alive = false;
  let timer = null;

  async function ping() {
    try {
      const res = await fetch(`/api/presence?id=${encodeURIComponent(sid)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      if (!alive) {
        alive = true;
        live.root.classList.remove('hidden');
      }
      live.num.textContent = String(data.online);
    } catch {
      // No presence endpoint — stop trying and hide the badge.
      if (alive) live.root.classList.add('hidden');
      clearInterval(timer);
    }
  }

  timer = setInterval(ping, 5000);
  ping();

  // Heartbeat as soon as the tab regains focus so the count stays accurate.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ping();
  });

  window.addEventListener('beforeunload', () => {
    // Best-effort: tell the server this session is gone. Fire-and-forget.
    try { navigator.sendBeacon('/api/presence?leave=1&id=' + encodeURIComponent(sid)); } catch { /* ignore */ }
  });
})();

function showError(msg) {
  err.textContent = msg;
  err.classList.remove('hidden');
}

// --- music -------------------------------------------------------------------
let playerStart = Promise.resolve();
let timer = null;

const player = initPlayer({
  ready: () => { if (timer == null) startTicker(); },
  meta: (m) => {
    updateBar(m);                     // artist + title
    setMediaSession(m);
  },
  error: (m) => showError(m),
});

function fmt(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

function updateBar(m) {
  if (!m) return;
  if (bar.track) bar.track.textContent = m.title;
  if (bar.artist) bar.artist.textContent = `${m.artist} · ${m.album}`;
}

function setPlayIcon(playing) {
  if (!bar.play) return;
  bar.play.classList.toggle('playing', !!playing);
  bar.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

let lastStatus = { playing: false, muted: false, title: '', duration: 0 };

function tick() {
  (async () => {
    const s = await getStatus();
    if (!s) return;
    const prev = lastStatus;
    lastStatus = s;
    // Track changed (new title) -> refresh media session
    if (s.title && s.title !== prev.title) {
      setMediaSession(s);
      updateBar(s);
    }
    if (s.playing !== prev.playing) setPlayIcon(s.playing);
    if (s.muted !== prev.muted || s.playing !== prev.playing) updateHint(s);
    if (bar.time) bar.time.textContent = fmt(s.currentTime);
    if (bar.dur) bar.dur.textContent = s.duration > 0 ? fmt(s.duration) : '0:00';
    if (bar.seek) {
      const pct = s.duration > 0 ? Math.min(100, (s.currentTime / s.duration) * 100) : 0;
      bar.seek.style.setProperty('--pct', `${pct}%`);
    }
  })();
}

function startTicker() { timer = setInterval(tick, 500); }

function setMediaSession(m) {
  if (!('mediaSession' in navigator)) return;
  if (m.title) {
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: m.title, artist: m.artist, album: m.album }); } catch { /* ignored */ }
  }
  try {
    navigator.mediaSession.setActionHandler('play', () => { togglePause(); });
    navigator.mediaSession.setActionHandler('pause', () => { togglePause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
    navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
  } catch { /* ignored */ }
}

// --- transport listeners ------------------------------------------------------
if (bar.prev) bar.prev.addEventListener('click', (e) => { e.stopPropagation(); prevTrack(); });
if (bar.next) bar.next.addEventListener('click', (e) => { e.stopPropagation(); nextTrack(); });
if (bar.play) bar.play.addEventListener('click', (e) => { e.stopPropagation(); togglePause(); });

if (bar.volume) {
  bar.volume.addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    e.target.style.setProperty('--vol', `${e.target.value}%`);
    bar.volIcon.textContent = v === 0 ? '🔇' : (v < 0.5 ? '🔉' : '🔊');
    setVolume(v);
  });
}

// --- auto-start + fallback -----------------------------------------------------
let wakeLock = null;
async function acquireWakeLock() {
  try { wakeLock = await navigator.wakeLock.request('screen'); }
  catch { /* not supported / denied — fine */ }
}

function fadeIn() {
  document.body.classList.add('running');
}

async function begin() {
  fadeIn();
  playerStart = startMusic();
  await playerStart.catch(() => {});
  setVolume(CONFIG.youtube?.volume != null ? CONFIG.youtube.volume / 100 : 0.55);
  await acquireWakeLock();
}

// Try to start immediately (no start page). Browsers that block audio autoplay
// simply stay paused until the user taps anywhere — that tap also resumes music.
begin();

// The drive always starts on its own; the only thing a browser can withhold is
// sound. So the hint appears purely when we're playing muted, and any gesture
// (move, scroll, key, tap) lifts it — see armAutoUnmute() in the player.
function updateHint(s) {
  if (!bar.hint) return;
  if (s.muted) {
    const kicker = bar.hint.querySelector('.tp-kicker');
    if (kicker) kicker.textContent = 'move or tap for sound';
    bar.hint.style.opacity = '1';
  } else if (s.playing) {
    bar.hint.style.opacity = '0';
    setTimeout(() => {
      if (!bar.hint || lastStatus.muted) return;
      bar.hint.remove();
      bar.hint = null;
    }, 1400);
  }
}

// Hide the hint until we actually know sound was blocked, so a normal start
// never flashes it.
if (bar.hint) bar.hint.style.opacity = '0';

// Safety net: if the player never came up at all, a tap still kicks it off.
window.addEventListener('click', (ev) => {
  const inBar = ev.target.closest && ev.target.closest('#bar');
  if (!inBar && !lastStatus.playing) startMusic();
});

// Keep wake lock alive if the tab stays visible.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquireWakeLock();
});
