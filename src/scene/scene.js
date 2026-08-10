// ---------------------------------------------------------------------------
// Endless highway, driver's POV — a classic pseudo-3D road ribbon.
//
// The track is a fixed loop of segments whose curve and hill profiles are built
// from harmonics of the loop length, so it repeats seamlessly forever. Each
// frame the segments ahead of the camera are projected to screen and painted
// near -> far; a running `maxY` clip stops distant segments from drawing over
// nearer ones, which is what makes hills occlude the road behind them.
//
// The view is from inside an Indian truck cab: right-hand drive, so the wheel
// is on the right and the road is kept to the left. Everything is procedural —
// no image assets.
// ---------------------------------------------------------------------------
import { CONFIG } from '../../config.js';
import { clamp, hash1, mixRgb, rgb, rgba, TAU } from '../lib/util.js';

const FOV            = 100;
const CAMERA_HEIGHT  = 1450;                                  // cab is high up
const CAMERA_DEPTH   = 1 / Math.tan((FOV / 2) * Math.PI / 180);
const SEGMENT_LENGTH = 200;                                   // world units per segment
const DRAW_DISTANCE  = 620;                                   // segments drawn ahead
const SPRITE_DISTANCE = 380;                                  // roadside detail cutoff
const ROAD_WIDTH     = 2200;                                  // half-width, world units
const BAND_LENGTH    = 3;                                     // segments per light/dark band
const TRACK_SEGMENTS = 2400;                                  // loop length
const PLAYER_X       = -0.40;                                 // left lane, -1..1 across the road
const FOG_DENSITY    = 0.5;                                   // low: the road runs to the horizon

const DAY   = CONFIG.scene.dayLength ?? 1200;
const SPEED = CONFIG.scene.speed ?? 5200;

// Two shades of everything: alternating bands are what sell the speed.
const ROAD   = [[64, 66, 73], [58, 60, 67]];
const GRASS  = [[38, 70, 45], [33, 63, 40]];
const RUMBLE = [[206, 210, 220], [96, 100, 110]];
const PAINT  = [238, 240, 248];
const SNOW   = [242, 247, 255];

// Sky is a three-stop vertical ramp per time of day: zenith, mid, horizon.
const SKY = {
  night: { top: [4, 6, 16],    mid: [10, 14, 32],   low: [22, 28, 54] },
  dawn:  { top: [38, 52, 116], mid: [214, 108, 96], low: [255, 184, 122] },
  day:   { top: [38, 96, 190], mid: [102, 164, 226], low: [186, 214, 240] },
  dusk:  { top: [22, 20, 62],  mid: [110, 54, 108], low: [240, 126, 78] },
};

// Far -> near. `drift` is horizontal parallax, `vpar` how much a crest lifts
// them, `snow` the height above the horizon where the peaks turn white.
const RANGES = [
  { amp: 0.34, freq: 0.00085, drift: 0.28, vpar: 0.0022, snow: 0.44, haze: 0.62, rock: [96, 108, 134], off: 3 },
  { amp: 0.23, freq: 0.00170, drift: 0.58, vpar: 0.0046, snow: 0.68, haze: 0.42, rock: [64, 76, 100], off: 41 },
  { amp: 0.12, freq: 0.00330, drift: 1.10, vpar: 0.0082, snow: 9.99, haze: 0.22, rock: [34, 48, 60],  off: 77 },
];

// Fringe (jhalar) colours strung across the top of the windscreen.
const JHALAR = [
  [232, 88, 52], [246, 176, 38], [34, 142, 90],
  [216, 52, 92], [40, 132, 196], [244, 214, 60],
];

// Periodic track profile — every harmonic is an integer number of cycles per
// lap, so segment N and segment 0 line up exactly and the loop never seams.
function curveAt(i) {
  const u = (i / TRACK_SEGMENTS) * TAU;
  return Math.sin(u * 3) * 2.4
       + Math.sin(u * 7 + 1.3) * 1.1
       + Math.sin(u * 13 + 2.6) * 0.4;
}

function hillAt(i) {
  const u = (i / TRACK_SEGMENTS) * TAU;
  return Math.sin(u * 2) * 1200
       + Math.sin(u * 5 + 0.7) * 520
       + Math.sin(u * 11 + 2.1) * 170;
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.w = 0; this.h = 0;
    this.t = 0; this.tms = 0;
    this.phase = CONFIG.scene.startPhase ?? 0.3;
    this.hidden = false;

    this.seed = (Math.random() * 1e5) | 0;
    this.position = 0;                  // world distance driven
    this.playerZ = CAMERA_HEIGHT * CAMERA_DEPTH;
    this.playerY = 0;
    this.skyDrift = 0;                  // horizon parallax as the road turns
    this.lean = 0;                      // hanging decorations swing into bends
    this.wheel = 0;                     // steering angle

    this._buildTrack();

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this._loop = this._loop.bind(this);
    this.raf = requestAnimationFrame(this._loop);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // --- track ------------------------------------------------------------------
  _buildTrack() {
    this.segments = [];
    for (let i = 0; i < TRACK_SEGMENTS; i++) {
      this.segments.push({
        index: i,
        curve: curveAt(i),
        band: Math.floor(i / BAND_LENGTH) % 2,
        y1: hillAt(i),
        y2: hillAt(i + 1),
        p1: { camera: {}, screen: {} },
        p2: { camera: {}, screen: {} },
        sprites: [],
        clip: 0,
      });
    }
    this._placeSprites();
  }

  // Roadside furniture, hung off segments so it rides the curves for free.
  _placeSprites() {
    for (let i = 0; i < TRACK_SEGMENTS; i++) {
      const seg = this.segments[i];

      if (i % 16 === 0) seg.sprites.push({ kind: 'lamp', side: -1, offset: 1.22 });
      if (i % 240 === 120) seg.sprites.push({ kind: 'sign', side: 1, offset: 1.30 });

      // Little roadside shrine with orange prayer flags (jhandi), tucked into
      // the treeline. Rare, so it's a treat rather than clutter.
      if (i % 240 === 60) {
        seg.sprites.push({ kind: 'shrine', side: -1, offset: 1.42 });
      }

      // Patches of marigolds on the verges, dotting the shoulder like the
      // familiar roadside trench flowers.
      if (hash1(i, this.seed + 31) < 0.22) {
        seg.sprites.push({ kind: 'flowers', idx: i * 7, side: 1, offset: 1.08 + hash1(i, this.seed + 33) * 0.3 });
      }

      // Treeline: a dense near row just past the shoulder, then scattered
      // depth behind it. Four draws per segment keeps the verge continuous
      // instead of leaving the gaps that made it look sparse. Each tree gets
      // a species so the roadside is varied instead of one clone repeated.
      for (let k = 0; k < 4; k++) {
        const r = hash1(i * 4 + k, this.seed);
        if (r < (k === 0 ? 0.12 : 0.40)) continue;
        const near = k === 0;
        const sp = (hash1(i * 4 + k, this.seed + 19) * 3) | 0;
        seg.sprites.push({
          kind: 'tree',
          idx: i * 4 + k,
          species: sp,
          side: hash1(i * 4 + k, this.seed + 11) > 0.48 ? 1 : -1,
          offset: near ? 1.32 + hash1(i * 4 + k, this.seed + 7) * 0.75
                       : 2.1 + hash1(i * 4 + k, this.seed + 7) * 4.2,
          scale: (near ? 0.62 : 0.78) + hash1(i * 4 + k, this.seed + 3) * 0.6,
        });
      }
    }
  }

  segAt(i) { return this.segments[((i % TRACK_SEGMENTS) + TRACK_SEGMENTS) % TRACK_SEGMENTS]; }

  // --- day/night ---------------------------------------------------------------
  _light() {
    const p = this.phase;
    const ang = (p - 0.25) * TAU;
    const elev = Math.sin(ang);
    const ambient = Math.max(0, elev);

    // Blend the three-stop sky palettes across the day.
    let sky;
    if (p < 0.20)      sky = SKY.night;
    else if (p < 0.27) sky = mixSky(SKY.night, SKY.dawn, s01(p, 0.20, 0.27));
    else if (p < 0.36) sky = mixSky(SKY.dawn, SKY.day, s01(p, 0.27, 0.36));
    else if (p < 0.62) sky = SKY.day;
    else if (p < 0.72) sky = mixSky(SKY.day, SKY.dusk, s01(p, 0.62, 0.72));
    else if (p < 0.82) sky = mixSky(SKY.dusk, SKY.night, s01(p, 0.72, 0.82));
    else               sky = SKY.night;

    // Stars fade with how bright the sky actually is, so they never show
    // through a lit dusk.
    const topLum = sky.top[0] * 0.299 + sky.top[1] * 0.587 + sky.top[2] * 0.114;
    const stars = clamp((55 - topLum) / 40, 0, 1);

    // Elevation lifts the body above the horizon; below it, it has set.
    const sun = {
      x: this.cx + Math.cos(ang) * this.w * 0.44,
      y: this.horizon - elev * this.h * 0.44,
      vis: Math.max(0, elev * 6),
    };
    const mAng = (p - 0.75) * TAU;
    const mElev = Math.sin(mAng);
    const moon = {
      x: this.cx + Math.cos(mAng) * this.w * 0.44,
      y: this.horizon - mElev * this.h * 0.44,
      vis: Math.max(0, mElev * 4),
    };

    // One global light level: everything in the world dims after dark.
    const lum = 0.28 + ambient * 0.72;

    return {
      sky, stars, sun, moon, ambient, lum,
      fog: mixRgb([12, 15, 24], mixRgb(sky.low, [190, 205, 225], 0.3), 0.25 + ambient * 0.75),
    };
  }

  // --- main loop ---------------------------------------------------------------
  _loop(tms) {
    this.raf = requestAnimationFrame(this._loop);
    const dt = Math.min((tms - this.tms) / 1000, 0.05) || 0;
    this.tms = tms;
    if (this.hidden) return;

    this.t += dt;
    this.phase = (this.phase + dt / DAY) % 1;
    this.position = (this.position + SPEED * dt) % (TRACK_SEGMENTS * SEGMENT_LENGTH);

    // Everything that reacts to the bend is driven off distance travelled and
    // dt, so the sky, the cab and the road all turn at the same rate whatever
    // the frame rate.
    const curve = this.segAt(Math.floor((this.position + this.playerZ) / SEGMENT_LENGTH)).curve;
    const segsPerSec = SPEED * dt / SEGMENT_LENGTH;
    this.skyDrift += curve * segsPerSec * 3.2;
    this.lean += (clamp(-curve * 0.085, -0.45, 0.45) - this.lean) * Math.min(1, dt * 2.4);
    this.wheel += (clamp(curve * 0.20, -0.85, 0.85) - this.wheel) * Math.min(1, dt * 3);

    this.render();
  }

  setHidden(v) { this.hidden = v; }

  // --- render ------------------------------------------------------------------
  render() {
    const ctx = this.ctx;
    this.cx = this.w / 2;
    this.horizon = this.h / 2;           // the projection's vanishing point

    const baseIdx = Math.floor(this.position / SEGMENT_LENGTH);
    const basePercent = (this.position % SEGMENT_LENGTH) / SEGMENT_LENGTH;

    const playerIdx = Math.floor((this.position + this.playerZ) / SEGMENT_LENGTH);
    const playerSeg = this.segAt(playerIdx);
    const playerPercent = ((this.position + this.playerZ) % SEGMENT_LENGTH) / SEGMENT_LENGTH;
    this.playerY = playerSeg.y1 + (playerSeg.y2 - playerSeg.y1) * playerPercent;
    const cameraY = this.playerY + CAMERA_HEIGHT;
    const cameraX = PLAYER_X * ROAD_WIDTH;

    const L = this._light();
    this._drawSky(ctx, L);

    // Lay out and project the ribbon. `x` is the accumulated lateral drift of
    // the road ahead; `dx` is how fast that drift is growing (the curve).
    let x = 0;
    let dx = -(this.segAt(baseIdx).curve * basePercent);
    let maxY = this.h;

    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const seg = this.segAt(baseIdx + n);
      const z1 = (n - basePercent) * SEGMENT_LENGTH;

      this._project(seg.p1, x - cameraX, seg.y1 - cameraY, z1);
      this._project(seg.p2, x + dx - cameraX, seg.y2 - cameraY, z1 + SEGMENT_LENGTH);
      x += dx;
      dx += seg.curve;

      seg.clip = maxY;

      if (seg.p1.camera.z <= CAMERA_DEPTH) continue;    // behind the camera
      if (seg.p2.screen.y >= seg.p1.screen.y) continue; // degenerate / inverted
      if (seg.p2.screen.y >= maxY) continue;            // hidden behind nearer road

      this._drawSegment(ctx, seg, this._haze(n), L);
      maxY = seg.p2.screen.y;
    }

    // Sprites go back-to-front so nearer trees overlap farther ones.
    for (let n = SPRITE_DISTANCE - 1; n >= 0; n--) {
      const seg = this.segAt(baseIdx + n);
      if (!seg.sprites.length || seg.p1.camera.z <= CAMERA_DEPTH) continue;
      if (seg.p1.screen.y > seg.clip) continue;         // occluded by a hill
      const haze = this._haze(n);
      for (const sp of seg.sprites) this._drawSprite(ctx, seg, sp, haze, L);
    }

    this._drawHeadlights(ctx, L);
    if (CONFIG.scene.cabin !== false) this._drawCabin(ctx, L);
  }

  _haze(n) { return 1 - 1 / Math.exp((n / DRAW_DISTANCE) * FOG_DENSITY); }

  /** World-space (relative to camera) -> screen. */
  _project(p, camX, camY, camZ) {
    p.camera.x = camX;
    p.camera.y = camY;
    p.camera.z = camZ;
    const scale = CAMERA_DEPTH / camZ;
    p.screen.scale = scale;
    p.screen.x = this.w / 2 + scale * camX * this.w / 2;
    p.screen.y = this.h / 2 - scale * camY * this.h / 2;
    p.screen.w = scale * ROAD_WIDTH * this.w / 2;
  }

  // --- road --------------------------------------------------------------------
  _drawSegment(ctx, seg, haze, L) {
    const { x: x1, y: y1, w: w1 } = seg.p1.screen;
    const { x: x2, y: y2, w: w2 } = seg.p2.screen;
    const b = seg.band;
    const lit = (c) => mixRgb(mul(c, L.lum), L.fog, haze);
    // The road itself keeps slightly more contrast than the surroundings so
    // its outline stays readable all the way to the horizon.
    const litRoad = (c) => mixRgb(mul(c, L.lum), L.fog, haze * 0.72);

    // Grass runs the full width — the road and shoulders paint on top of it.
    ctx.fillStyle = rgb(lit(GRASS[b]));
    ctx.fillRect(0, y2, this.w, y1 - y2 + 1);

    // Rumble strips on the shoulders.
    const r1 = w1 * 0.16, r2 = w2 * 0.16;
    const rumbleCol = rgb(lit(RUMBLE[b]));
    quad(ctx, rumbleCol, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2);
    quad(ctx, rumbleCol, x1 + w1, y1, x1 + w1 + r1, y1, x2 + w2 + r2, y2, x2 + w2, y2);

    // Asphalt.
    quad(ctx, rgb(litRoad(ROAD[b])), x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2);

    // Solid edge lines, always on.
    const e1 = w1 * 0.035, e2 = w2 * 0.035;
    const i1 = w1 * 0.90, i2 = w2 * 0.90;
    const paint = rgb(litRoad(PAINT));
    quad(ctx, paint, x1 - i1 - e1, y1, x1 - i1 + e1, y1, x2 - i2 + e2, y2, x2 - i2 - e2, y2);
    quad(ctx, paint, x1 + i1 - e1, y1, x1 + i1 + e1, y1, x2 + i2 + e2, y2, x2 + i2 - e2, y2);

    // Dashed centre line — one band on, one band off.
    if (b === 0) {
      const c1 = w1 * 0.028, c2 = w2 * 0.028;
      quad(ctx, paint, x1 - c1, y1, x1 + c1, y1, x2 + c2, y2, x2 - c2, y2);
    }
  }

  // --- sky ---------------------------------------------------------------------
  _drawSky(ctx, L) {
    const { top, mid, low } = L.sky;
    const g = ctx.createLinearGradient(0, 0, 0, this.horizon);
    g.addColorStop(0.00, rgb(top));
    g.addColorStop(0.28, rgb(mixRgb(top, mid, 0.55)));
    g.addColorStop(0.55, rgb(mid));
    g.addColorStop(0.78, rgb(mixRgb(mid, low, 0.65)));
    g.addColorStop(0.93, rgb(low));
    g.addColorStop(1.00, rgb(mixRgb(low, L.fog, 0.45)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.horizon + 1);

    if (L.stars > 0.02) this._drawStars(ctx, L.stars);
    if (L.sun.vis > 0.02) this._drawSun(ctx, L.sun, L);
    if (L.moon.vis > 0.02) this._drawMoon(ctx, L.moon);
    this._drawMountains(ctx, L);

    // A warm band of dusty heat-haze straddling the horizon — that dry,
    // hazy Indian afternoon look. Fades out at night so it doesn't fight
    // the darkness.
    const dusty = clamp((0.62 - Math.abs(L.ambient - 0.55)) * 1.9, 0, 1)
                * clamp((55 - (L.sky.low[0] * 0.299 + L.sky.low[1] * 0.587 + L.sky.low[2] * 0.114)) / 70, 0, 1);
    if (dusty > 0.02) {
      const hh = this.h * 0.055;
      const hg = ctx.createLinearGradient(0, this.horizon - hh, 0, this.horizon + hh);
      const base = mixRgb(mul([214, 178, 130], L.lum), L.fog, 0.25);
      hg.addColorStop(0, rgba(mixRgb(base, [244, 214, 170], 0.2), 0));
      hg.addColorStop(0.5, rgba(mixRgb(base, [244, 214, 170], 0.75), 0.6 * dusty));
      hg.addColorStop(1, rgba(base, 0));
      ctx.fillStyle = hg;
      ctx.fillRect(0, this.horizon - hh, this.w, hh * 2);
    }

    // Everything below the vanishing point starts as far-away haze; the road
    // ribbon paints over it from the horizon down.
    ctx.fillStyle = rgb(mixRgb(mul(GRASS[0], L.lum), L.fog, 0.45));
    ctx.fillRect(0, this.horizon, this.w, this.h - this.horizon);
  }

  _drawStars(ctx, alpha) {
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 150; i++) {
      const px = hash1(i, 1) * this.w;
      const py = hash1(i, 2) * this.horizon * 0.9;
      const tw = 0.5 + 0.5 * Math.sin(this.t * 1.5 + i * 1.7);
      ctx.globalAlpha = alpha * (0.2 + 0.8 * hash1(i, 3)) * (0.55 + 0.45 * tw);
      ctx.beginPath();
      ctx.arc(px, py, 0.5 + hash1(i, 4) * 1.1, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawSun(ctx, s, L) {
    ctx.globalAlpha = clamp(s.vis, 0, 1);
    const r = this.h * 0.16;
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    g.addColorStop(0, 'rgba(255,248,220,0.95)');
    g.addColorStop(0.35, 'rgba(255,226,160,0.45)');
    g.addColorStop(1, 'rgba(255,224,160,0)');
    ctx.fillStyle = g;
    ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);

    // Low sun spills a warm wash along the horizon.
    const lowSun = clamp(1 - Math.abs(s.y - this.horizon) / (this.h * 0.30), 0, 1);
    if (lowSun > 0.01) {
      ctx.globalAlpha = clamp(s.vis, 0, 1) * lowSun * 0.55;
      const gw = this.w * 0.5;
      const hg = ctx.createRadialGradient(s.x, this.horizon, 0, s.x, this.horizon, gw);
      hg.addColorStop(0, rgba(mixRgb(L.sky.low, [255, 214, 150], 0.6), 0.9));
      hg.addColorStop(1, rgba(L.sky.low, 0));
      ctx.fillStyle = hg;
      ctx.fillRect(s.x - gw, this.horizon - gw, gw * 2, gw);
    }
    ctx.globalAlpha = 1;
  }

  _drawMoon(ctx, m) {
    ctx.globalAlpha = clamp(m.vis, 0, 1);
    ctx.fillStyle = '#e9edf6';
    ctx.beginPath(); ctx.arc(m.x, m.y, this.h * 0.028, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba([10, 14, 24], 0.28);
    ctx.beginPath(); ctx.arc(m.x - this.h * 0.009, m.y - this.h * 0.007, this.h * 0.023, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /**
   * Snow-capped ranges on the horizon. Each layer drifts sideways at its own
   * rate off the same distance-travelled counter, and lifts with the crests,
   * so the near hills sweep past while the far peaks barely move.
   */
  _drawMountains(ctx, L) {
    const step = 5;
    const cols = Math.ceil(this.w / step) + 1;
    const ys = new Float32Array(cols);
    const snowLum = 0.42 + L.ambient * 0.58;   // snow keeps catching moonlight

    for (const ly of RANGES) {
      const rock = rgb(mixRgb(mul(ly.rock, L.lum), L.sky.low, ly.haze));
      const lift = this.playerY * ly.vpar;

      for (let c = 0; c < cols; c++) {
        const px = c * step;
        const u = (px + this.skyDrift * ly.drift) * ly.freq + ly.off;
        let n = (0.5 + 0.5 * Math.sin(u)) * 0.55
              + (0.5 + 0.5 * Math.sin(u * 2.3 + 1.7)) * 0.30
              + (0.5 + 0.5 * Math.sin(u * 4.7 + 0.4)) * 0.15;
        n = Math.pow(1 - Math.abs(1 - 2 * n), 0.85);   // ridged: sharp peaks
        ys[c] = this.horizon - n * ly.amp * this.h + lift;
      }

      ctx.fillStyle = rock;
      ctx.beginPath();
      ctx.moveTo(0, this.horizon + 1);
      for (let c = 0; c < cols; c++) ctx.lineTo(c * step, ys[c]);
      ctx.lineTo(this.w, this.horizon + 1);
      ctx.closePath();
      ctx.fill();

      if (ly.snow > 1) continue;

      // Snow line: anything above it is white. Wobble it slightly so the caps
      // don't all break at the same height.
      ctx.fillStyle = rgb(mixRgb(mul(SNOW, snowLum), L.sky.low, ly.haze * 0.55));
      ctx.beginPath();
      for (let c = 0; c < cols; c++) ctx.lineTo(c * step, ys[c]);
      for (let c = cols - 1; c >= 0; c--) {
        const px = c * step;
        const wobble = Math.sin((px + this.skyDrift * ly.drift) * ly.freq * 3.7) * this.h * 0.014;
        const line = this.horizon - ly.snow * ly.amp * this.h + lift + wobble;
        ctx.lineTo(px, Math.max(ys[c], line));
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  // --- roadside ----------------------------------------------------------------
  _drawSprite(ctx, seg, sp, haze, L) {
    const scale = seg.p1.screen.scale;
    const unit = scale * this.h / 2;                    // world units -> px, vertical
    const x = this.w / 2 + scale * (seg.p1.camera.x + sp.side * sp.offset * ROAD_WIDTH) * this.w / 2;
    const y = seg.p1.screen.y;
    if (x < -this.w * 0.3 || x > this.w * 1.3) return;

    const shade = clamp(1 - haze, 0.06, 1);
    const dim = L.lum;                                   // objects darken at night

    if (sp.kind === 'lamp') {
      const poleH = 2600 * unit;
      if (poleH < 3) return;
      const armW = 620 * unit;
      ctx.strokeStyle = rgba(mixRgb(mul([74, 78, 88], dim), L.fog, haze), shade);
      ctx.lineWidth = Math.max(1, 60 * unit);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - poleH);
      ctx.lineTo(x - sp.side * armW, y - poleH);
      ctx.stroke();

      const lampX = x - sp.side * armW;
      const lampY = y - poleH;
      const glow = clamp((0.42 - L.ambient) * 2.4, 0, 1) * shade;
      ctx.fillStyle = `rgba(255,226,172,${0.35 + glow * 0.65})`;
      ctx.beginPath(); ctx.arc(lampX, lampY, Math.max(1, 90 * unit), 0, TAU); ctx.fill();
      if (glow > 0.04) {
        ctx.globalCompositeOperation = 'lighter';
        const r = Math.max(2, 700 * unit);
        const g = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, r);
        g.addColorStop(0, `rgba(255,206,140,${0.55 * glow})`);
        g.addColorStop(1, 'rgba(255,206,140,0)');
        ctx.fillStyle = g;
        ctx.fillRect(lampX - r, lampY - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over';
      }
      return;
    }

    if (sp.kind === 'sign') {
      const postH = 1500 * unit;
      if (postH < 3) return;
      const bw = 1400 * unit, bh = 620 * unit;
      ctx.fillStyle = rgba(mixRgb(mul([70, 74, 82], dim), L.fog, haze), shade);
      ctx.fillRect(x - 45 * unit, y - postH, 90 * unit, postH);
      ctx.fillStyle = rgba(mixRgb(mul([26, 92, 58], dim), L.fog, haze), shade);
      ctx.fillRect(x - bw / 2, y - postH - bh, bw, bh);
      ctx.strokeStyle = rgba(mixRgb(mul([225, 232, 240], dim), L.fog, haze), shade * 0.9);
      ctx.lineWidth = Math.max(1, 40 * unit);
      ctx.strokeRect(x - bw / 2, y - postH - bh, bw, bh);
      return;
    }

    if (sp.kind === 'shrine') {
      // A small white shrine under a pole of flags. A classic Indian roadside
      // sight — the little temple with an orange jhandi poking above the trees.
      const h = 900 * unit;
      if (h < 2) return;
      const sx = x - 240 * unit, sw = 480 * unit, sh = 340 * unit;
      ctx.fillStyle = rgba(mixRgb(mul([224, 224, 228], dim), L.fog, haze), shade);
      ctx.fillRect(sx, y - h, sw, h);
      ctx.fillStyle = rgba(mixRgb(mul([210, 60, 42], dim), L.fog, haze), shade);
      ctx.fillRect(sx, y - h - 46 * unit, sw, 46 * unit);
      ctx.fillStyle = rgba(mixRgb(mul([70, 76, 84], dim), L.fog, haze), shade * 0.7);
      ctx.fillRect(sx + sw * 0.5 - 14 * unit, y - h - sh, 28 * unit, sh);
      // Little flags of orange, red, saffron strung up the pole.
      for (let f = 0; f < 4; f++) {
        const fy = y - h - 180 * unit - f * 150 * unit;
        const fl = 150 * unit * (0.8 + 0.2 * Math.sin(f * 2.8));
        const fc = rgba(mixRgb(mul([[235, 96, 32], [216, 52, 56], [244, 178, 40]][f % 3], dim), L.fog, haze), shade);
        ctx.fillStyle = fc;
        ctx.beginPath();
        ctx.moveTo(x, fy);
        ctx.lineTo(x - fl, fy + 60 * unit);
        ctx.lineTo(x, fy + 110 * unit);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }

    if (sp.kind === 'flowers') {
      // A scatter of marigold dots right at the verge — cheap to draw and
      // they break up the solid green edge like in a village.
      const fh = 520 * unit;
      if (fh < 2) return;
      const n = 7;
      for (let f = 0; f < n; f++) {
        const fx = x + (hash1(sp.idx, f * 7) - 0.5) * 900 * unit;
        const fy = y - hash1(sp.idx, f * 7 + 1) * fh;
        const fr = Math.max(0.6, 60 * unit * (0.6 + hash1(sp.idx, f * 7 + 2) * 0.8));
        ctx.fillStyle = rgba(mixRgb(mul(hash1(sp.idx, f * 7 + 3) > 0.5 ? [238, 148, 36] : [206, 62, 34], dim * 1.15), L.fog, haze), shade);
        ctx.beginPath();
        ctx.arc(fx, fy, fr, 0, TAU);
        ctx.fill();
      }
      return;
    }

    // Tree. There are hundreds on screen, so anything small collapses to a
    // single triangle — the detailed version only pays off up close. Species
    // vary the shape and shade:
    //   0 — round neem/mango, layered and dense
    //   1 — pointed tall palm/silver oak
    //   2 — drooping banyan/pipal with a spreading crown
    const trunkH = 1500 * sp.scale * unit;
    if (trunkH < 2) return;
    const canopyW = (sp.species === 2 ? 1450 : 1120) * sp.scale * unit;
    const species = sp.species === undefined ? 0 : sp.species;
    const greens = [
      [30, 68, 41], [34, 84, 46], [52, 96, 44],   // neem/mango green
      [40, 82, 38], [48, 96, 40], [64, 106, 44],  // palm/silver-oak sage
      [24, 58, 36], [38, 76, 40], [60, 90, 38],   // banyan deep green
    ];
    const greenT = (hash1(sp.idx, sp.species + 5) * 3) | 0;
    const green = mixRgb(mul(greens[species * 3 + greenT], dim), L.fog, haze);
    // Citrus highlight so the canopy reads as living foliage, not flat green.
    const hi = mixRgb(mul(greens[species * 3 + (greenT + 1) % 3], dim * 1.6), L.fog, haze);

    if (trunkH < 18) {
      ctx.fillStyle = rgba(green, shade);
      ctx.beginPath();
      ctx.moveTo(x, y - trunkH * 1.7);
      ctx.lineTo(x - canopyW * 0.8, y);
      ctx.lineTo(x + canopyW * 0.8, y);
      ctx.closePath();
      ctx.fill();
      return;
    }

    ctx.fillStyle = rgba(mixRgb(mul([58, 40, 26], dim), L.fog, haze), shade);
    ctx.fillRect(x - trunkH * 0.05, y - trunkH, trunkH * 0.10, trunkH);
    ctx.fillStyle = rgba(green, shade);

    if (species === 1) {
      // Tall palm/silver oak — slender trunk, relaxed crown of fans.
      const crownW = canopyW * 1.35;
      ctx.beginPath();
      ctx.moveTo(x, y - trunkH * 1.35);
      ctx.quadraticCurveTo(x - crownW, y - trunkH * 0.9, x - crownW, y - trunkH * 0.55);
      ctx.lineTo(x, y - trunkH * 0.9);
      ctx.lineTo(x + crownW, y - trunkH * 0.55);
      ctx.quadraticCurveTo(x + crownW, y - trunkH * 0.9, x, y - trunkH * 1.35);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba(hi, shade);
      ctx.beginPath();
      ctx.arc(x - canopyW * 0.42, y - trunkH * 0.82, canopyW * 0.42, 0, TAU);
      ctx.arc(x + canopyW * 0.42, y - trunkH * 0.80, canopyW * 0.38, 0, TAU);
      ctx.fill();
      return;
    }

    // Round (0) or spreading (2) crown, built from overlapping lobes so the
    // silhouette is soft instead of a hard triangle.
    const lobes = species === 2 ? 7 : 5;
    const topY = y - trunkH * (species === 2 ? 1.22 : 1.45);
    const spread = species === 2 ? 1.16 : 1.0;
    for (let l = 0; l < lobes; l++) {
      const a = (l / lobes) * Math.PI + (species === 2 ? 0.35 : 0.15);
      const lx = x + Math.cos(a) * canopyW * 0.52 * spread;
      const ly = topY + Math.sin(a) * canopyW * 0.5;
      const rad = canopyW * (0.5 + 0.16 * Math.sin(l * 2.7));
      ctx.beginPath();
      ctx.arc(lx, ly, rad, 0, TAU);
      ctx.fill();
    }
    // A lighter up-facing lobe for depth.
    ctx.fillStyle = rgba(hi, shade * 0.8);
    for (let l = 1; l <= 3; l++) {
      const a = (l / 4) * Math.PI - 0.3;
      const lx = x + Math.cos(a) * canopyW * 0.34 * spread;
      const ly = topY + Math.sin(a) * canopyW * 0.4;
      ctx.beginPath();
      ctx.arc(lx, ly, canopyW * (0.34 - l * 0.05), 0, TAU);
      ctx.fill();
    }
  }

  // --- cabin -------------------------------------------------------------------
  _drawHeadlights(ctx, L) {
    if (L.ambient >= 0.35) return;
    const a = (0.35 - L.ambient) * 1.1;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(this.cx, this.h * 0.88, this.w * 0.02, this.cx, this.h * 0.92, this.w * 0.62);
    g.addColorStop(0, `rgba(255,238,196,${0.30 * a})`);
    g.addColorStop(0.5, `rgba(255,232,180,${0.10 * a})`);
    g.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, this.horizon, this.w, this.h - this.horizon);
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * The cab: right-hand drive, painted dash, a fringe of jhalar across the top
   * of the windscreen and a garland swinging on the bends.
   */
  _drawCabin(ctx, L) {
    const w = this.w, h = this.h;
    const lum = 0.20 + L.ambient * 0.80;
    const night = clamp(1 - L.ambient * 2.2, 0, 1);

    const pillar = w * 0.075;
    const header = h * 0.105;
    const dashY  = h * 0.700;

    // --- windscreen opening -----------------------------------------------
    const glass = new Path2D();
    glass.moveTo(pillar * 1.5, header);
    glass.lineTo(w - pillar * 1.5, header);
    glass.quadraticCurveTo(w - pillar * 0.35, header + h * 0.03, w - pillar * 0.15, dashY - h * 0.045);
    glass.quadraticCurveTo(w / 2, dashY + h * 0.055, pillar * 0.15, dashY - h * 0.045);
    glass.quadraticCurveTo(pillar * 0.35, header + h * 0.03, pillar * 1.5, header);
    glass.closePath();

    // Cab shell = whole screen minus the glass.
    const shell = new Path2D();
    shell.rect(0, 0, w, h);
    shell.addPath(glass);
    const shellG = ctx.createLinearGradient(0, 0, 0, h);
    shellG.addColorStop(0, rgb(mul([26, 30, 40], lum)));
    shellG.addColorStop(0.45, rgb(mul([16, 19, 26], lum)));
    shellG.addColorStop(1, rgb(mul([9, 11, 15], lum)));
    ctx.fillStyle = shellG;
    ctx.fill(shell, 'evenodd');

    // --- dash: painted metal with a chrome lip and tricolour banding -------
    const cowl = (yOff) => {
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, dashY - h * 0.045 + yOff);
      ctx.quadraticCurveTo(w / 2, dashY + h * 0.055 + yOff, w, dashY - h * 0.045 + yOff);
      ctx.lineTo(w, h);
      ctx.closePath();
    };

    cowl(0);
    const dashG = ctx.createLinearGradient(0, dashY, 0, h);
    dashG.addColorStop(0, rgb(mul([28, 96, 104], lum)));    // painted teal
    dashG.addColorStop(0.35, rgb(mul([18, 62, 70], lum)));
    dashG.addColorStop(1, rgb(mul([8, 20, 24], lum)));
    ctx.fillStyle = dashG;
    ctx.fill();

    const bands = [[232, 126, 34], [244, 240, 232], [26, 128, 74]];
    bands.forEach((c, i) => {
      cowl(h * (0.030 + i * 0.016));
      ctx.strokeStyle = rgba(mul(c, lum), 0.85);
      ctx.lineWidth = Math.max(2, h * 0.010);
      ctx.stroke();
    });

    cowl(0);
    ctx.strokeStyle = rgba(mul([214, 222, 236], 0.35 + L.ambient * 0.65), 0.7);
    ctx.lineWidth = Math.max(1.5, h * 0.004);
    ctx.stroke();

    // --- jhalar: the fringe strung along the top of the windscreen ---------
    const span = w - pillar * 3;
    const n = 26;
    const bw = span / n;
    for (let i = 0; i < n; i++) {
      const swing = this.lean * bw * 3.2 + Math.sin(this.t * 1.6 + i * 0.5) * bw * 0.12;
      const x0 = pillar * 1.5 + i * bw + swing;
      const drop = h * (0.030 + 0.012 * (0.5 + 0.5 * Math.sin(i * 2.1)));
      const c = mul(JHALAR[i % JHALAR.length], 0.35 + L.ambient * 0.65);
      ctx.fillStyle = rgb(c);
      ctx.beginPath();
      ctx.moveTo(x0, header - 1);
      ctx.lineTo(x0 + bw, header - 1);
      ctx.lineTo(x0 + bw / 2, header + drop);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x0 + bw / 2, header + drop, Math.max(1, bw * 0.10), 0, TAU);
      ctx.fill();
    }

    // --- garland hanging off the header -----------------------------------
    const gx = w * 0.42, gy = header + h * 0.005;
    const ang = this.lean * 1.7 + Math.sin(this.t * 1.15) * 0.05;
    const len = h * 0.13;
    const ex = gx + Math.sin(ang) * len, ey = gy + Math.cos(ang) * len;
    ctx.strokeStyle = rgba(mul([206, 190, 150], lum), 0.85);
    ctx.lineWidth = Math.max(1, h * 0.0025);
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(ex, ey); ctx.stroke();
    for (let i = 0; i < 7; i++) {
      const f = 0.42 + i * 0.09;
      const bx = gx + Math.sin(ang) * len * f;
      const by = gy + Math.cos(ang) * len * f;
      ctx.fillStyle = rgb(mul(i % 2 ? [246, 178, 34] : [232, 96, 30], 0.4 + L.ambient * 0.6));
      ctx.beginPath(); ctx.arc(bx, by, h * 0.011, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = rgb(mul([228, 60, 72], 0.4 + L.ambient * 0.6));
    ctx.beginPath(); ctx.arc(ex, ey, h * 0.019, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(mul([246, 214, 120], 0.5 + L.ambient * 0.5), 0.9);
    ctx.lineWidth = Math.max(1, h * 0.003);
    ctx.stroke();

    // --- steering wheel, right-hand drive ---------------------------------
    const wx = w * 0.775, wy = h * 1.055, wr = h * 0.255;
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(this.wheel);
    ctx.strokeStyle = rgb(mul([32, 34, 40], 0.5 + L.ambient * 0.5));
    ctx.lineWidth = wr * 0.14;
    ctx.beginPath(); ctx.arc(0, 0, wr, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgba(mul([180, 190, 205], 0.35 + L.ambient * 0.65), 0.55);
    ctx.lineWidth = Math.max(1, wr * 0.02);
    ctx.beginPath(); ctx.arc(0, 0, wr * 1.06, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgb(mul([40, 42, 50], 0.5 + L.ambient * 0.5));
    ctx.lineWidth = wr * 0.10;
    for (const a of [-2.62, -0.52, 1.57]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * wr, Math.sin(a) * wr);
      ctx.stroke();
    }
    ctx.fillStyle = rgb(mul([48, 50, 58], 0.5 + L.ambient * 0.5));
    ctx.beginPath(); ctx.arc(0, 0, wr * 0.22, 0, TAU); ctx.fill();
    ctx.restore();

    // --- instrument glow --------------------------------------------------
    if (night > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      const r = h * 0.30;
      const g = ctx.createRadialGradient(w * 0.775, h * 0.82, 0, w * 0.775, h * 0.82, r);
      g.addColorStop(0, `rgba(255,168,64,${0.16 * night})`);
      g.addColorStop(1, 'rgba(255,168,64,0)');
      ctx.fillStyle = g;
      ctx.fillRect(w * 0.775 - r, h * 0.82 - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

/** Blend two three-stop sky palettes. */
function mixSky(a, b, t) {
  return {
    top: mixRgb(a.top, b.top, t),
    mid: mixRgb(a.mid, b.mid, t),
    low: mixRgb(a.low, b.low, t),
  };
}

/** Scale an rgb triple's brightness. */
function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

/** Filled quad from four corner pairs — the workhorse of the road renderer. */
function quad(ctx, color, x1, y1, x2, y2, x3, y3, x4, y4) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

function s01(x, a, b) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}
