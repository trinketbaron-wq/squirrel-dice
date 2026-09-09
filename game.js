/* Neon Yahtzee
   Game logic (top, pure, unit-testable) → audio → announcer → networking → UI.
   Everything runs inside the Streamlit component iframe; no server state. */
(function () {
'use strict';

/* ===================== Game logic ===================== */

const CATS = [
  { key: 'ones',    label: 'Ones',             how: 'sum of 1s',  upper: true },
  { key: 'twos',    label: 'Twos',             how: 'sum of 2s',  upper: true },
  { key: 'threes',  label: 'Threes',           how: 'sum of 3s',  upper: true },
  { key: 'fours',   label: 'Fours',            how: 'sum of 4s',  upper: true },
  { key: 'fives',   label: 'Fives',            how: 'sum of 5s',  upper: true },
  { key: 'sixes',   label: 'Sixes',            how: 'sum of 6s',  upper: true },
  { key: 'three',   label: 'Three of a kind',  how: 'sum of all', upper: false },
  { key: 'four',    label: 'Four of a kind',   how: 'sum of all', upper: false },
  { key: 'full',    label: 'Full house',       how: '25',         upper: false },
  { key: 'small',   label: 'Small straight',   how: '30',         upper: false },
  { key: 'large',   label: 'Large straight',   how: '40',         upper: false },
  { key: 'yahtzee', label: 'Yahtzee',          how: '50',         upper: false },
  { key: 'chance',  label: 'Chance',           how: 'sum of all', upper: false },
];
const UPPER = CATS.filter(c => c.upper);
const LOWER = CATS.filter(c => !c.upper);
const CAT = Object.fromEntries(CATS.map(c => [c.key, c]));
const NUM_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six'];

const sum = a => a.reduce((x, y) => x + y, 0);
const isYahtzee = d => d.every(x => x === d[0]);
function counts(dice) { const c = [0, 0, 0, 0, 0, 0, 0]; for (const d of dice) c[d]++; return c; }

function hasStraight(dice, len) {
  const s = new Set(dice);
  const runs = len === 5 ? [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]]
                         : [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]];
  return runs.some(r => r.every(v => s.has(v)));
}

function rawScore(key, dice) {
  const c = counts(dice), t = sum(dice);
  switch (key) {
    case 'ones':   return c[1] * 1;
    case 'twos':   return c[2] * 2;
    case 'threes': return c[3] * 3;
    case 'fours':  return c[4] * 4;
    case 'fives':  return c[5] * 5;
    case 'sixes':  return c[6] * 6;
    case 'three':  return c.some(n => n >= 3) ? t : 0;
    case 'four':   return c.some(n => n >= 4) ? t : 0;
    case 'full':   return (c.includes(3) && c.includes(2)) ? 25 : 0;
    case 'small':  return hasStraight(dice, 4) ? 30 : 0;
    case 'large':  return hasStraight(dice, 5) ? 40 : 0;
    case 'yahtzee': return isYahtzee(dice) ? 50 : 0;
    case 'chance': return t;
    default: return 0;
  }
}

/* Joker rule: a Yahtzee rolled after the Yahtzee box is filled (50 or 0),
   with the matching upper box also filled, scores full points in
   full house / small straight / large straight. */
function jokerActive(player, dice) {
  if (!isYahtzee(dice) || player.scores.yahtzee === null) return false;
  return player.scores[UPPER[dice[0] - 1].key] !== null;
}

function scoreFor(key, dice, player) {
  if (jokerActive(player, dice)) {
    if (key === 'full') return 25;
    if (key === 'small') return 30;
    if (key === 'large') return 40;
  }
  return rawScore(key, dice);
}

/* Which boxes the current player may fill with these dice. */
function availableCats(player, dice) {
  const open = CATS.map(c => c.key).filter(k => player.scores[k] === null);
  if (isYahtzee(dice) && player.scores.yahtzee !== null) {
    const up = UPPER[dice[0] - 1].key;
    if (player.scores[up] === null) return { keys: [up], forced: true };
    const lower = open.filter(k => !CAT[k].upper);
    if (lower.length) return { keys: lower, forced: false };
  }
  return { keys: open, forced: false };
}

function totals(p) {
  const s = p.scores;
  const upper = sum(UPPER.map(c => s[c.key] || 0));
  const bonus = upper >= 63 ? 35 : 0;
  const lower = sum(LOWER.map(c => s[c.key] || 0));
  const filled = CATS.filter(c => s[c.key] !== null).length;
  return { upper, bonus, lower, yb: p.yahtzeeBonus, grand: upper + bonus + lower + p.yahtzeeBonus, filled };
}

function newPlayer(name) {
  return { name, scores: Object.fromEntries(CATS.map(c => [c.key, null])), yahtzeeBonus: 0 };
}

function newGame(names, starter = 0, seq = 0) {
  const s = {
    phase: 'playing',
    players: [newPlayer(names[0]), newPlayer(names[1])],
    starter, current: starter,
    dice: [1, 2, 3, 4, 5],
    held: [false, false, false, false, false],
    rollsLeft: 3,
    seq: seq + 1,
    event: null,
  };
  s.event = { type: 'start', seq: s.seq };
  return s;
}

const clone = o => JSON.parse(JSON.stringify(o));

/* The one place state changes. Returns { ok, state } or { ok:false, error }. */
function applyAction(s, a, actor, rng = Math.random) {
  const fail = error => ({ ok: false, error });
  const ok = state => ({ ok: true, state });

  if (a.type === 'rematch') {
    if (s.phase !== 'over') return fail('The game is still going');
    return ok(newGame([s.players[0].name, s.players[1].name], (s.starter + 1) % 2, s.seq));
  }
  if (s.phase !== 'playing') return fail('The game is over');
  if (actor !== s.current) return fail("It's not your turn");

  const p = s.players[s.current];
  const rolled = s.rollsLeft < 3;
  const n = clone(s);
  n.seq = s.seq + 1;

  switch (a.type) {
    case 'roll': {
      if (s.rollsLeft <= 0) return fail('No rolls left — pick a box');
      n.dice = s.dice.map((d, i) => (rolled && s.held[i]) ? d : 1 + Math.floor(rng() * 6));
      n.rollsLeft = s.rollsLeft - 1;
      n.event = { type: 'roll', seq: n.seq, player: s.current, rollsLeft: n.rollsLeft,
                  yahtzee: isYahtzee(n.dice), prevHeld: rolled ? s.held.slice() : [false, false, false, false, false] };
      return ok(n);
    }
    case 'hold': {
      if (!rolled) return fail('Roll first');
      if (s.rollsLeft === 0) return fail('No rolls left — pick a box');
      if (!(a.i >= 0 && a.i < 5)) return fail('Bad die');
      n.held[a.i] = !s.held[a.i];
      n.event = { type: 'hold', seq: n.seq, i: a.i, held: n.held[a.i] };
      return ok(n);
    }
    case 'score': {
      if (!rolled) return fail('Roll first');
      const av = availableCats(p, s.dice);
      if (!av.keys.includes(a.key)) return fail('That box is not available');
      const np = n.players[s.current];
      const pts = scoreFor(a.key, s.dice, p);
      const bonus100 = isYahtzee(s.dice) && p.scores.yahtzee === 50;
      if (bonus100) np.yahtzeeBonus += 100;
      const hadBonus = totals(p).bonus === 35;
      np.scores[a.key] = pts;
      const upperBonus = !hadBonus && totals(np).bonus === 35;
      const joker = jokerActive(p, s.dice) && ['full', 'small', 'large'].includes(a.key);
      n.held = [false, false, false, false, false];
      n.rollsLeft = 3;
      n.current = (s.current + 1) % 2;
      n.event = { type: 'score', seq: n.seq, player: s.current, key: a.key, pts, bonus100, upperBonus, joker };
      if (n.players.every(pl => totals(pl).filled === CATS.length)) {
        n.phase = 'over';
        n.event.gameOver = true;
        n.event.final = n.players.map(pl => totals(pl).grand);
      }
      return ok(n);
    }
    default:
      return fail('Unknown action');
  }
}

/* What the announcer says and which effect plays, for the latest event. */
function describeEvent(s) {
  const e = s.event;
  if (!e) return null;
  const P = i => s.players[i].name;
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const nextUp = () => ` ${P(s.current)}, you're up.`;

  switch (e.type) {
    case 'start':
      return { text: `New game. ${P(s.current)} rolls first.`, sfx: 'turn', speak: true };
    case 'roll': {
      if (e.yahtzee) {
        return { text: `YAHTZEE on the table! ${P(e.player)} is looking at five ${NUM_WORDS[s.dice[0]]}s!`,
                 sfx: 'roll', after: 'yahtzee', speak: true, interrupt: true };
      }
      const text = e.rollsLeft === 2 ? pick([`${P(e.player)} rolls.`, 'Here we go.', 'Shake them up.', 'Dice are out.'])
                 : e.rollsLeft === 1 ? pick(['One roll left.', 'Last reroll coming up.', 'Hold what you like — one more.'])
                 : pick(['Final roll. Pick a box.', 'No more rolls. Score it.', 'That is the hand. Choose wisely.']);
      return { text, sfx: 'roll', speak: true };
    }
    case 'hold':
      return { text: null, sfx: e.held ? 'hold' : 'unhold', speak: false };
    case 'score': {
      const label = CAT[e.key].label;
      let text, sfx = 'score';
      if (e.key === 'yahtzee' && e.pts === 50) {
        text = `YAHTZEE! ${P(e.player)} banks fifty points!`; sfx = 'yahtzee';
      } else if (e.pts === 0) {
        text = pick([`${P(e.player)} zeroes out ${label}. Ouch.`, `A zero in ${label} for ${P(e.player)}.`, `${P(e.player)} scratches ${label}.`]);
        sfx = 'zero';
      } else {
        const pts = `${e.pts} point${e.pts === 1 ? '' : 's'}`;
        text = pick([`${P(e.player)} scores ${e.pts} in ${label}.`, `${pts}, ${label}, for ${P(e.player)}.`, `${P(e.player)} takes ${label} for ${e.pts}.`]);
      }
      if (e.bonus100) { text = `Another YAHTZEE! One hundred point bonus! ` + text; sfx = 'yahtzee'; }
      if (e.joker) text += ' Joker rules — full points.';
      if (e.upperBonus) { text += ' Upper bonus unlocked: thirty-five points.'; if (sfx === 'score') sfx = 'bonus'; }
      if (e.gameOver) {
        const [a, b] = e.final;
        const verdict = a === b ? `It's a tie at ${a}!`
          : `${a > b ? P(0) : P(1)} wins, ${Math.max(a, b)} to ${Math.min(a, b)}!`;
        return { text: `${text} Game over. ${verdict}`, sfx, after: 'gameover', speak: true, interrupt: true };
      }
      return { text: text + nextUp(), sfx, speak: true, interrupt: true };
    }
    default:
      return null;
  }
}

/* ===================== Audio: synthesized SFX + synthwave loop ===================== */

const BPM = 112;
const STEP = 60 / BPM / 4;              // one 16th note, seconds
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

const Audio = (() => {
  let ctx = null, master, sfxBus, musicBus, delaySend, noiseBuf;
  const st = { sfx: true, music: false };

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    master = ctx.createDynamicsCompressor();
    master.threshold.value = -14; master.ratio.value = 4; master.knee.value = 10;
    master.connect(ctx.destination);

    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.6; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);

    // Dotted-eighth feedback delay for that synthwave echo.
    const delay = ctx.createDelay(1.0); delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2800;
    delay.connect(damp); damp.connect(fb); fb.connect(delay);
    delay.connect(musicBus);
    delaySend = ctx.createGain(); delaySend.gain.value = 0.35; delaySend.connect(delay);

    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  /* Small voice: oscillator → optional filter → gain envelope → bus. */
  function tone({ freq, freqTo = null, type = 'square', t, dur = 0.12, vol = 0.25, attack = 0.005,
                  bus, filter = null, q = 1, detune = 0, echo = 0 }) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    if (freqTo !== null) o.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = q;
      f.frequency.setValueAtTime(filter, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(120, filter * 0.25), t + dur);
      o.connect(f); node = f;
    }
    node.connect(g); g.connect(bus);
    if (echo) { const e = ctx.createGain(); e.gain.value = echo; g.connect(e); e.connect(delaySend); }
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise({ t, dur = 0.1, vol = 0.3, type = 'bandpass', freq = 2000, q = 1, bus, freqTo = null }) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    src.loop = true; src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo !== null) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /* ---- Sound effects ---- */
  const sfx = {
    roll() {
      const t0 = ctx.currentTime;
      for (let i = 0; i < 7; i++) {
        const t = t0 + i * (0.05 + Math.random() * 0.04);
        noise({ t, dur: 0.05, vol: 0.35, freq: 900 + Math.random() * 1800, q: 6, bus: sfxBus });
        tone({ freq: 140 + Math.random() * 80, type: 'sine', t, dur: 0.05, vol: 0.2, bus: sfxBus });
      }
    },
    hold()   { tone({ freq: 660, freqTo: 990, type: 'square', t: ctx.currentTime, dur: 0.08, vol: 0.15, bus: sfxBus }); },
    unhold() { tone({ freq: 660, freqTo: 440, type: 'square', t: ctx.currentTime, dur: 0.08, vol: 0.15, bus: sfxBus }); },
    turn()   { tone({ freq: 440, type: 'sine', t: ctx.currentTime, dur: 0.15, vol: 0.18, bus: sfxBus, echo: 0.3 }); },
    score() {
      const t0 = ctx.currentTime;
      [523, 659, 784, 1047].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', t: t0 + i * 0.07, dur: 0.16, vol: 0.22, bus: sfxBus, echo: 0.4 }));
    },
    zero() {
      const t0 = ctx.currentTime;
      tone({ freq: 330, freqTo: 220, type: 'sawtooth', t: t0, dur: 0.18, vol: 0.18, bus: sfxBus, filter: 1200 });
      tone({ freq: 220, freqTo: 110, type: 'sawtooth', t: t0 + 0.18, dur: 0.3, vol: 0.18, bus: sfxBus, filter: 900 });
    },
    bonus() {
      const t0 = ctx.currentTime;
      [523, 659, 784, 1047, 1319].forEach((f, i) =>
        tone({ freq: f, type: 'square', t: t0 + i * 0.06, dur: 0.2, vol: 0.16, bus: sfxBus, echo: 0.5 }));
      noise({ t: t0, dur: 0.5, vol: 0.12, type: 'bandpass', freq: 800, freqTo: 6000, q: 2, bus: sfxBus });
    },
    yahtzee() {
      const t0 = ctx.currentTime;
      const riff = [523, 659, 784, 1047, 784, 1047, 1319];
      riff.forEach((f, i) => {
        tone({ freq: f, type: 'sawtooth', t: t0 + i * 0.11, dur: 0.22, vol: 0.2, bus: sfxBus, filter: 3500, echo: 0.5 });
        tone({ freq: f / 2, type: 'square', t: t0 + i * 0.11, dur: 0.22, vol: 0.12, bus: sfxBus });
      });
      const tEnd = t0 + riff.length * 0.11;
      [1047, 1319, 1568].forEach(f =>
        tone({ freq: f, type: 'sawtooth', t: tEnd, dur: 1.1, vol: 0.14, bus: sfxBus, filter: 4000, echo: 0.6, detune: 6 }));
      noise({ t: t0, dur: 1.0, vol: 0.15, type: 'bandpass', freq: 400, freqTo: 8000, q: 1.5, bus: sfxBus });
    },
    gameover() {
      const t0 = ctx.currentTime + 0.3;
      [392, 494, 587, 784, 587, 784, 988].forEach((f, i) =>
        tone({ freq: f, type: 'square', t: t0 + i * 0.16, dur: 0.3, vol: 0.18, bus: sfxBus, echo: 0.5 }));
    },
    error()  { tone({ freq: 120, freqTo: 80, type: 'sawtooth', t: ctx.currentTime, dur: 0.2, vol: 0.2, bus: sfxBus, filter: 500 }); },
    connect() {
      const t0 = ctx.currentTime;
      tone({ freq: 880, type: 'sine', t: t0, dur: 0.15, vol: 0.2, bus: sfxBus, echo: 0.4 });
      tone({ freq: 1320, type: 'sine', t: t0 + 0.12, dur: 0.3, vol: 0.2, bus: sfxBus, echo: 0.4 });
    },
  };

  function play(name) {
    if (!st.sfx || !name) return;
    if (!ensure()) return;
    if (sfx[name]) sfx[name]();
  }

  /* ---- Music: 4-bar synthwave loop, scheduled ahead of the clock ---- */
  const CHORDS = [[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62]]; // Am  F/A  C/G  G
  const ROOTS  = [45, 41, 48, 43];
  let playing = false, step = 0, nextT = 0, timer = null;

  function kick(t) {
    tone({ freq: 160, freqTo: 42, type: 'sine', t, dur: 0.18, vol: 0.9, bus: musicBus, attack: 0.002 });
    noise({ t, dur: 0.02, vol: 0.2, type: 'lowpass', freq: 900, bus: musicBus });
  }
  function snare(t) {
    noise({ t, dur: 0.16, vol: 0.35, type: 'bandpass', freq: 1900, q: 0.8, bus: musicBus });
    tone({ freq: 190, freqTo: 120, type: 'triangle', t, dur: 0.1, vol: 0.35, bus: musicBus });
  }
  function hat(t, vol) { noise({ t, dur: 0.035, vol, type: 'highpass', freq: 8000, bus: musicBus }); }
  function bass(t, m) {
    tone({ freq: mtof(m), type: 'sawtooth', t, dur: STEP * 1.7, vol: 0.32, bus: musicBus, filter: 700, q: 3 });
  }
  function arp(t, m, vol) {
    tone({ freq: mtof(m), type: 'square', t, dur: STEP * 0.9, vol, bus: musicBus, filter: 2600, q: 2, echo: 0.5 });
  }
  function pad(t, chord) {
    chord.forEach(m => [-8, 8].forEach(d =>
      tone({ freq: mtof(m), type: 'sawtooth', t, dur: STEP * 16, vol: 0.045, attack: 0.5, bus: musicBus, filter: 900, detune: d, echo: 0.2 })));
  }

  function playStep(s, t) {
    const bar = Math.floor(s / 16) % 4, i = s % 16;
    const chord = CHORDS[bar], root = ROOTS[bar];
    if (i % 4 === 0) kick(t);
    if (i === 4 || i === 12) snare(t);
    if (i % 2 === 0) hat(t, i === 14 ? 0.14 : 0.06);
    if (i % 2 === 0) bass(t, root + ((i / 2) % 2 === 1 ? 12 : 0));
    arp(t, chord[i % 3] + 12, i % 4 === 0 ? 0.09 : 0.06);
    if (i === 0) pad(t, chord);
  }

  function schedule() {
    if (!playing) return;
    while (nextT < ctx.currentTime + 0.15) {
      playStep(step, nextT);
      nextT += STEP; step = (step + 1) % 64;
    }
    timer = setTimeout(schedule, 30);
  }

  function musicOn(on) {
    st.music = on;
    if (!ensure()) return;
    const now = ctx.currentTime;
    if (on) {
      musicBus.gain.cancelScheduledValues(now);
      musicBus.gain.setValueAtTime(musicBus.gain.value, now);
      musicBus.gain.linearRampToValueAtTime(0.34, now + 0.8);
      if (!playing) { playing = true; step = 0; nextT = now + 0.05; schedule(); }
    } else {
      musicBus.gain.cancelScheduledValues(now);
      musicBus.gain.setValueAtTime(musicBus.gain.value, now);
      musicBus.gain.linearRampToValueAtTime(0, now + 0.4);
      playing = false; clearTimeout(timer);
    }
  }

  return { ensure, play, musicOn, st };
})();

/* ===================== Announcer voice (Web Speech API) ===================== */

const Voice = (() => {
  const st = { on: true, voice: null, ready: false };
  const has = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

  function pick() {
    const vs = speechSynthesis.getVoices();
    if (!vs.length) return;
    st.voice = vs.find(v => /Google US English/i.test(v.name))
            || vs.find(v => /en[-_]US/i.test(v.lang) && /Microsoft (Guy|David|Mark|Aria)/i.test(v.name))
            || vs.find(v => /en[-_]US/i.test(v.lang))
            || vs.find(v => /^en/i.test(v.lang))
            || vs[0];
    st.ready = true;
  }
  function init() {
    if (!has()) { st.on = false; return; }
    pick();
    speechSynthesis.onvoiceschanged = pick;
  }
  function speak(text, { interrupt = false } = {}) {
    if (!st.on || !has() || !text) return;
    if (!st.ready) pick();
    const u = new SpeechSynthesisUtterance(text.replace(/YAHTZEE/g, 'Yahtzee!'));
    if (st.voice) u.voice = st.voice;
    u.pitch = 0.85; u.rate = 1.05; u.volume = 1;
    if (interrupt) { speechSynthesis.cancel(); setTimeout(() => speechSynthesis.speak(u), 40); }
    else speechSynthesis.speak(u);
  }
  function stop() { if (has()) speechSynthesis.cancel(); }
  return { init, speak, stop, st, has };
})();

/* ===================== Networking: PeerJS / WebRTC, host is authoritative ===================== */

const Net = (() => {
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const PREFIX = 'neon-yahtzee-';
  const st = { mode: 'none', me: 0, peer: null, conn: null, code: null };
  const handlers = { status: () => {}, error: () => {}, message: () => {}, closed: () => {} };
  let joinTimer = null;

  const on = (k, fn) => { handlers[k] = fn; };
  const available = () => typeof window !== 'undefined' && typeof window.Peer === 'function';
  const makeCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
  const NO_LIB = 'Online play needs the PeerJS library, which did not load. Try "Two players, one screen".';

  function describeError(err) {
    const type = err && err.type;
    if (type === 'peer-unavailable') return `No room called ${st.code}. Check the code with the host.`;
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(type))
      return 'Could not reach the matchmaking server. Check your connection and try again.';
    if (type === 'browser-incompatible') return 'This browser does not support WebRTC.';
    return (err && err.message) ? err.message : String(err);
  }

  function wire(conn) {
    st.conn = conn;
    conn.on('data', d => handlers.message(d));
    conn.on('close', () => handlers.closed());
    conn.on('error', e => handlers.error(describeError(e)));
  }

  function teardown() {
    clearTimeout(joinTimer);
    if (st.conn) { try { st.conn.close(); } catch (e) { /* ignore */ } }
    if (st.peer) { try { st.peer.destroy(); } catch (e) { /* ignore */ } }
    st.conn = null; st.peer = null;
  }

  function host(attempt = 0) {
    if (!available()) { handlers.error(NO_LIB); return; }
    teardown();
    st.mode = 'host'; st.me = 0; st.code = makeCode();
    const peer = new window.Peer(PREFIX + st.code, { debug: 0 });
    st.peer = peer;
    handlers.status('Reaching the matchmaking server…');
    peer.on('open', () => handlers.status({ code: st.code }));
    peer.on('connection', conn => {
      if (st.conn && st.conn.open) { try { conn.close(); } catch (e) { /* room full */ } return; }
      wire(conn);
      conn.on('open', () => handlers.status('connected'));
    });
    peer.on('error', err => {
      if (err && err.type === 'unavailable-id' && attempt < 3) { host(attempt + 1); return; }
      handlers.error(describeError(err));
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
  }

  function join(code) {
    if (!available()) { handlers.error(NO_LIB); return; }
    code = (code || '').trim().toUpperCase();
    if (code.length !== 4) { handlers.error('Enter the 4-character room code from the host.'); return; }
    teardown();
    st.mode = 'guest'; st.me = 1; st.code = code;
    const peer = new window.Peer({ debug: 0 });
    st.peer = peer;
    handlers.status('Reaching the matchmaking server…');
    peer.on('open', () => {
      handlers.status(`Looking for room ${code}…`);
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      wire(conn);
      joinTimer = setTimeout(() => {
        if (!conn.open) handlers.error('Found the room but could not open a direct link. A strict firewall on either side can block this.');
      }, 15000);
      conn.on('open', () => { clearTimeout(joinTimer); handlers.status('connected'); });
    });
    peer.on('error', err => handlers.error(describeError(err)));
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
  }

  function send(obj) {
    if (st.conn && st.conn.open) { try { st.conn.send(obj); } catch (e) { /* ignore */ } }
  }

  return { st, on, host, join, send, teardown, available };
})();

/* ===================== UI ===================== */

const PIPS = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 28], [72, 28], [28, 50], [72, 50], [28, 72], [72, 72]],
};

function dieSVG(v) {
  const pips = PIPS[v].map(([x, y]) =>
    `<circle cx="${x}" cy="${y}" r="8.5" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="3"/>`).join('');
  return `<svg viewBox="0 0 100 100" aria-hidden="true">` +
         `<rect x="5" y="5" width="90" height="90" rx="18" fill="none" stroke="currentColor" stroke-width="3.5"/>${pips}</svg>`;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanName = s => String(s || '').replace(/[^\w .'-]/g, '').trim().slice(0, 12);

let State = null;
let announcedSeq = 0;
let animating = false;
let animTimer = null;
const el = {};

function isMyTurn() {
  return !!State && State.phase === 'playing' && (Net.st.mode === 'local' || State.current === Net.st.me);
}

function myName() { return cleanName(el.name.value) || 'Player'; }

function showPanel(which) {
  ['lobby', 'game', 'over'].forEach(id => el[id].classList.toggle('hidden', id !== which));
}

function flash(msg) {
  el.hint.textContent = msg;
  el.hint.style.color = 'var(--gold)';
}

/* Apply an action locally (host/local) or send it to the host (guest). */
function dispatch(action) {
  Audio.ensure();
  if (!State) return;
  if (Net.st.mode === 'guest') { Net.send({ t: 'action', action }); return; }
  const actor = Net.st.mode === 'local' ? State.current : 0;
  const r = applyAction(State, action, actor);
  if (!r.ok) { Audio.play('error'); flash(r.error); return; }
  commit(r.state);
}

function commit(s) {
  State = s;
  if (Net.st.mode === 'host') Net.send({ t: 'state', state: s });
  render();
  react();
}

/* Announce / sound the latest event exactly once. */
function react() {
  const e = State && State.event;
  if (!e || e.seq <= announcedSeq) return;
  announcedSeq = e.seq;
  const d = describeEvent(State);
  if (!d) return;
  if (e.type === 'roll') animateRoll(e);
  Audio.play(d.sfx);
  if (d.after) setTimeout(() => Audio.play(d.after), e.type === 'roll' ? 700 : 900);
  if (d.text) el.ticker.textContent = d.text;
  if (d.speak && d.text) Voice.speak(d.text, { interrupt: !!d.interrupt });
}

function animateRoll(e) {
  animating = true;
  render({ skipCard: true });
  const dice = [...el.dice.querySelectorAll('.die')];
  const moving = dice.filter((d, i) => !e.prevHeld[i]);
  moving.forEach(d => d.classList.add('rolling'));
  const t0 = Date.now();
  clearInterval(animTimer);
  animTimer = setInterval(() => {
    moving.forEach(d => { d.querySelector('svg').outerHTML = dieSVG(1 + Math.floor(Math.random() * 6)); });
    if (Date.now() - t0 > 620) {
      clearInterval(animTimer);
      animating = false;
      render();
    }
  }, 70);
}

function render(opts = {}) {
  if (!State) return;
  const s = State, rolled = s.rollsLeft < 3, mine = isMyTurn();

  if (s.phase === 'over') {
    const [a, b] = s.players.map(p => totals(p).grand);
    el['over-title'].textContent = a === b ? 'TIE GAME' : `${(a > b ? s.players[0] : s.players[1]).name.toUpperCase()} WINS`;
    el['over-score'].textContent = `${s.players[0].name} ${a}  \u2014  ${s.players[1].name} ${b}`;
    showPanel('over');
    return;
  }
  showPanel('game');

  const filled = s.players.reduce((n, p) => n + totals(p).filled, 0);
  const round = Math.min(13, Math.floor(filled / 2) + 1);
  const who = s.players[s.current].name;
  if (Net.st.mode === 'local') {
    el.turn.textContent = `Round ${round} of 13: ${who}'s turn`;
    el.turn.classList.remove('waiting');
  } else {
    el.turn.textContent = mine ? `Round ${round} of 13: your turn` : `Round ${round} of 13: waiting for ${who}`;
    el.turn.classList.toggle('waiting', !mine);
  }

  const diceDisabled = !mine || !rolled || s.rollsLeft === 0 || animating;
  el.dice.innerHTML = s.dice.map((v, i) =>
    `<button class="die${s.held[i] ? ' held' : ''}" data-i="${i}" ${diceDisabled ? 'disabled' : ''}` +
    ` style="${rolled ? '' : 'opacity:.35'}" aria-label="Die ${i + 1} shows ${v}${s.held[i] ? ', held' : ''}">` +
    `${dieSVG(v)}<span class="tag">HELD</span></button>`).join('');

  el['btn-roll'].disabled = !mine || s.rollsLeft === 0 || animating;
  el.rolls.innerHTML = [0, 1, 2].map(i => `<i class="${i < 3 - s.rollsLeft ? 'spent' : ''}"></i>`).join('');

  el.hint.style.color = '';
  if (mine) {
    el.hint.textContent = !rolled ? 'Roll to start your turn'
                        : s.rollsLeft > 0 ? 'Click dice to hold them, roll again, or pick a box below'
                        : 'Pick a box below';
  } else {
    el.hint.textContent = Net.st.mode === 'local' ? '' : `${who} is rolling`;
  }

  if (!opts.skipCard) renderCard();
}

function renderCard() {
  const s = State, rolled = s.rollsLeft < 3, mine = isMyTurn();
  const av = (mine && rolled) ? availableCats(s.players[s.current], s.dice) : { keys: [], forced: false };
  const T = s.players.map(totals);

  const cell = (p, c) => {
    const pl = s.players[p], v = pl.scores[c.key];
    if (v !== null) {
      const cls = (v === 0 ? ' zero' : '') + ((c.key === 'yahtzee' && v === 50) ? ' big' : '');
      return `<td class="n${cls}">${v}</td>`;
    }
    if (p === s.current && av.keys.includes(c.key)) {
      const pts = scoreFor(c.key, s.dice, pl);
      return `<td class="n open${av.forced ? ' forced' : ''}" data-key="${c.key}" tabindex="0" role="button"` +
             ` aria-label="Score ${pts} in ${c.label}">${pts}</td>`;
    }
    return '<td class="n"></td>';
  };
  const row = c => `<tr><td>${c.label}<span class="how">${c.how}</span></td>${cell(0, c)}${cell(1, c)}</tr>`;
  const sumRow = (label, f, cls = 'sum') =>
    `<tr class="${cls}"><td>${label}</td><td class="n">${f(T[0])}</td><td class="n">${f(T[1])}</td></tr>`;
  const section = label => `<tr class="section"><td colspan="3">${label}</td></tr>`;

  el.card.innerHTML =
    `<tr><th>Round ${Math.min(13, Math.floor((T[0].filled + T[1].filled) / 2) + 1)}</th>` +
    `<th class="${s.current === 0 ? 'me' : ''}">${esc(s.players[0].name)}</th>` +
    `<th class="${s.current === 1 ? 'me' : ''}">${esc(s.players[1].name)}</th></tr>` +
    section('Upper section') +
    UPPER.map(row).join('') +
    sumRow('Upper total', t => t.upper) +
    sumRow('Bonus at 63', t => t.bonus) +
    section('Lower section') +
    LOWER.map(row).join('') +
    sumRow('Yahtzee bonus', t => t.yb) +
    sumRow('Lower total', t => t.lower) +
    sumRow('Total', t => t.grand, 'sum grand');
}

function setLobbyStatus(msg, isError = false) {
  el['lobby-status'].classList.toggle('error', isError);
  if (msg && typeof msg === 'object' && msg.code) {
    el['lobby-status'].innerHTML =
      `Room code <span class="code">${esc(msg.code)}</span><br>Send it to your opponent. The game starts when they join.`;
  } else {
    el['lobby-status'].textContent = msg || '';
  }
}

function startGame(names) {
  announcedSeq = 0;
  commit(newGame(names, 0));
}

function bindNet() {
  Net.on('status', msg => {
    if (msg === 'connected') {
      Audio.play('connect');
      if (Net.st.mode === 'guest') {
        Net.send({ t: 'join', name: myName() });
        setLobbyStatus('Connected. Waiting for the host to deal you in…');
      } else {
        setLobbyStatus('Opponent connected. Starting…');
      }
      return;
    }
    setLobbyStatus(msg);
  });
  Net.on('error', msg => { Audio.play('error'); setLobbyStatus(msg, true); });
  Net.on('closed', () => {
    el.conn.textContent = 'Opponent disconnected';
    el.conn.classList.add('lost');
    Voice.speak('Connection lost.', { interrupt: true });
  });
  Net.on('message', m => {
    if (!m || typeof m !== 'object') return;
    if (Net.st.mode === 'host') {
      if (m.t === 'join') {
        el.conn.textContent = `Online \u00b7 room ${Net.st.code}`;
        el.conn.classList.remove('lost');
        if (State && State.phase === 'playing') {
          State.players[1].name = cleanName(m.name) || State.players[1].name;
          commit(State);                       // resume: resend current state
        } else {
          startGame([myName(), cleanName(m.name) || 'Player 2']);
        }
      } else if (m.t === 'action' && State) {
        const r = applyAction(State, m.action, 1);
        if (!r.ok) Net.send({ t: 'deny', error: r.error });
        else commit(r.state);
      }
    } else if (Net.st.mode === 'guest') {
      if (m.t === 'state') {
        if (!State) el.conn.textContent = `Online \u00b7 room ${Net.st.code}`;
        State = m.state;
        render();
        react();
      } else if (m.t === 'deny') {
        Audio.play('error');
        flash(m.error);
      }
    }
  });
}

function bindUI() {
  el['btn-local'].addEventListener('click', () => {
    Audio.ensure();
    Net.teardown();
    Net.st.mode = 'local';
    el.conn.textContent = 'Same screen';
    startGame([myName() === 'Player' ? 'Player 1' : myName(), 'Player 2']);
  });
  el['btn-host'].addEventListener('click', () => { Audio.ensure(); Net.host(); });
  el['btn-join'].addEventListener('click', () => { Audio.ensure(); Net.join(el.code.value); });
  el.code.addEventListener('keydown', e => { if (e.key === 'Enter') el['btn-join'].click(); });
  el.code.addEventListener('input', () => { el.code.value = el.code.value.toUpperCase(); });

  el['btn-roll'].addEventListener('click', () => dispatch({ type: 'roll' }));
  el.dice.addEventListener('click', e => {
    const b = e.target.closest('.die');
    if (b && !b.disabled) dispatch({ type: 'hold', i: Number(b.dataset.i) });
  });
  el.card.addEventListener('click', e => {
    const td = e.target.closest('td.open');
    if (td) dispatch({ type: 'score', key: td.dataset.key });
  });
  el.card.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const td = e.target.closest('td.open');
    if (td) { e.preventDefault(); dispatch({ type: 'score', key: td.dataset.key }); }
  });
  el['btn-rematch'].addEventListener('click', () => dispatch({ type: 'rematch' }));

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || el.game.classList.contains('hidden')) return;
    if (e.key === 'r' || e.key === 'R') { if (!el['btn-roll'].disabled) el['btn-roll'].click(); }
    else if (/^[1-5]$/.test(e.key)) {
      const b = el.dice.querySelector(`.die[data-i="${Number(e.key) - 1}"]`);
      if (b && !b.disabled) b.click();
    }
  });

  const setPressed = (btn, on) => btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  el['btn-music'].addEventListener('click', () => {
    Audio.ensure();
    Audio.musicOn(!Audio.st.music);
    setPressed(el['btn-music'], Audio.st.music);
  });
  el['btn-voice'].addEventListener('click', () => {
    Voice.st.on = !Voice.st.on;
    if (!Voice.st.on) Voice.stop(); else Voice.speak('Announcer on.');
    setPressed(el['btn-voice'], Voice.st.on);
  });
  el['btn-sfx'].addEventListener('click', () => {
    Audio.st.sfx = !Audio.st.sfx;
    setPressed(el['btn-sfx'], Audio.st.sfx);
    Audio.play('hold');
  });

  window.addEventListener('beforeunload', () => Net.teardown());
}

function init() {
  ['lobby', 'game', 'over', 'dice', 'demo-dice', 'card', 'turn', 'conn', 'rolls', 'hint', 'ticker',
   'lobby-status', 'name', 'code', 'btn-host', 'btn-join', 'btn-local', 'btn-roll', 'btn-rematch',
   'btn-music', 'btn-voice', 'btn-sfx', 'over-title', 'over-score']
    .forEach(id => { el[id] = document.getElementById(id); });

  Voice.init();
  if (!Voice.has()) { el['btn-voice'].disabled = true; el['btn-voice'].setAttribute('aria-pressed', 'false'); }
  el['demo-dice'].innerHTML = [1, 2, 3, 4, 5].map(v => `<button class="die" disabled tabindex="-1">${dieSVG(v)}</button>`).join('');
  bindNet();
  bindUI();
  if (!Net.available()) {
    setLobbyStatus('Online play is unavailable right now (PeerJS did not load). Same-screen play still works.', true);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CATS, rawScore, scoreFor, availableCats, totals, newGame, applyAction, describeEvent };
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

})();
