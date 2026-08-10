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

let lastStatus = { playing: false, title: '', duration: 0 };

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

// When audio managed to autoplay, hide the tap hint after a short grace period.
setTimeout(() => {
  if (bar.hint && (lastStatus.playing || (player && player.kind))) bar.hint.style.opacity = '0';
}, 2500);
setTimeout(() => { if (bar.hint) bar.hint.remove(); }, 7000);

// On browsers that blocked audio autoplay, a tap anywhere starts the drive.
// Once playing, taps outside the player bar leave the music alone (title/art).
window.addEventListener('click', (ev) => {
  const inBar = ev.target.closest && ev.target.closest('#bar');
  if (!inBar && !lastStatus.playing) startMusic();
});

// Keep wake lock alive if the tab stays visible.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquireWakeLock();
});
