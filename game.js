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

/* Lower-section combos the dice score right now, strongest first. */
const COMBO_ORDER = ['yahtzee', 'large', 'full', 'four', 'small', 'three'];
const COMBO_NAME = { yahtzee: 'YAHTZEE', large: 'LARGE STRAIGHT', full: 'FULL HOUSE',
                     four: 'FOUR OF A KIND', small: 'SMALL STRAIGHT', three: 'THREE OF A KIND' };
function combosOnTable(dice, player) { return COMBO_ORDER.filter(k => scoreFor(k, dice, player) > 0); }
function bestCombo(dice, player) { return combosOnTable(dice, player)[0] || null; }

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
    combo: null,
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
      const best = bestCombo(n.dice, p);
      n.combo = best;
      n.event = { type: 'roll', seq: n.seq, player: s.current, rollsLeft: n.rollsLeft,
                  yahtzee: isYahtzee(n.dice), combo: best, newCombo: !!best && best !== (s.combo || null),
                  comboPts: best ? scoreFor(best, n.dice, p) : 0, comboUsed: !!best && p.scores[best] !== null,
                  prevHeld: rolled ? s.held.slice() : [false, false, false, false, false] };
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
      n.combo = null;
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
      if (e.newCombo) {
        const name = CAT[e.combo].label;
        let text = pick([`${name}! That's ${e.comboPts} on the table.`, `${P(e.player)} rolls a ${name.toLowerCase()} — ${e.comboPts} points.`, `Look at that: ${name.toLowerCase()}, worth ${e.comboPts}.`]);
        if (e.comboUsed) text = `${name} — but that box is already filled.`;
        else if (e.rollsLeft > 0 && e.combo !== 'large') text += pick([' Take it or push your luck.', ' Bank it or keep rolling.', '']);
        return { text, sfx: 'roll', after: e.comboUsed ? null : 'combo', speak: true, interrupt: true };
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
    combo() {
      const t0 = ctx.currentTime;
      [659, 880, 1319].forEach((f, i) =>
        tone({ freq: f, type: 'square', t: t0 + i * 0.07, dur: 0.22, vol: 0.18, bus: sfxBus, filter: 3000, echo: 0.5 }));
      noise({ t: t0, dur: 0.3, vol: 0.1, type: 'bandpass', freq: 1500, freqTo: 7000, q: 2, bus: sfxBus });
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
  /* STUN for the easy cases, TURN relays for phones on carrier NAT. */
  const ICE = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
      { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
      { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443'],
        username: 'openrelayproject', credential: 'openrelayproject' },
    ],
    sdpSemantics: 'unified-plan',
  };
  const tune = { retryMs: 4000, attempts: 12, linkTimeoutMs: 20000, reclaimMs: 3000, rejoinMs: 1500 };
  const st = { mode: 'none', me: 0, peer: null, conn: null, code: null, stage: 'idle', attempt: 0, keepCode: false };
  const handlers = { status: () => {}, message: () => {}, closed: () => {} };
  let retryTimer = null, linkTimer = null;

  const on = (k, fn) => { handlers[k] = fn; };
  const available = () => typeof window !== 'undefined' && typeof window.Peer === 'function';
  const makeCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
  const NO_LIB = 'Online play needs the PeerJS library, which did not load. Try "Two players, one screen".';
  const connected = () => !!(st.conn && st.conn.open);

  function setStage(stage, extra = {}) {
    st.stage = stage;
    handlers.status(Object.assign({ stage, mode: st.mode, code: st.code, attempt: st.attempt, max: tune.attempts }, extra));
  }
  function fail(message) { setStage('error', { message }); }

  function describeError(err) {
    const type = err && err.type;
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(type))
      return 'Could not reach the matchmaking server. Check your connection, then tap Retry.';
    if (type === 'browser-incompatible') return 'This browser does not support WebRTC. Try Chrome or Safari.';
    return (err && err.message) ? err.message : String(err);
  }

  function wire(conn) {
    st.conn = conn;
    conn.on('data', d => handlers.message(d));
    conn.on('close', () => { if (st.conn === conn) { st.conn = null; setStage('lost'); handlers.closed(); } });
    conn.on('error', () => { /* close follows */ });
    conn.on('iceStateChanged', state => {
      if (!conn.open && (state === 'checking' || state === 'connected' || state === 'completed')) setStage('linking');
    });
  }

  function reconnectSoon(peer, delay = 1000) {
    setTimeout(() => {
      try { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); } catch (e) { /* ignore */ }
    }, delay);
  }

  function teardown() {
    clearTimeout(retryTimer); clearTimeout(linkTimer);
    if (st.conn) { const c = st.conn; st.conn = null; try { c.close(); } catch (e) { /* ignore */ } }
    if (st.peer) { try { st.peer.destroy(); } catch (e) { /* ignore */ } }
    st.peer = null;
  }

  /* ---- Host ---- */
  function host(code) {
    if (!available()) { fail(NO_LIB); return; }
    teardown();
    st.mode = 'host'; st.me = 0; st.attempt = 0;
    st.keepCode = !!code;
    st.code = (code || makeCode()).toUpperCase();
    openHostPeer(0);
  }

  function openHostPeer(attempt) {
    const peer = new window.Peer(PREFIX + st.code, { debug: 0, config: ICE });
    st.peer = peer;
    setStage('server');
    peer.on('open', () => setStage(connected() ? 'connected' : 'waiting'));
    peer.on('connection', conn => {
      if (connected()) { try { conn.close(); } catch (e) { /* room full */ } return; }
      wire(conn);
      setStage('linking');
      conn.on('open', () => setStage('connected'));
    });
    peer.on('error', err => {
      const type = err && err.type;
      if (type === 'unavailable-id') {
        if (st.keepCode && attempt < 4) {           // reclaiming our old room after a reload
          setStage('server', { message: 'Reclaiming your room\u2026' });
          retryTimer = setTimeout(() => openHostPeer(attempt + 1), tune.reclaimMs);
        } else if (attempt < 6) {
          st.code = makeCode(); st.keepCode = false;
          openHostPeer(attempt + 1);
        } else fail('Could not open a room. Tap Retry.');
        return;
      }
      if (connected()) return;                        // server hiccups don't matter once linked
      if (type === 'peer-unavailable') return;
      fail(describeError(err));
    });
    peer.on('disconnected', () => { if (!connected()) setStage('server'); reconnectSoon(peer); });
  }

  /* ---- Guest ---- */
  function join(code) {
    if (!available()) { fail(NO_LIB); return; }
    code = (code || '').trim().toUpperCase();
    if (code.length !== 4) { fail('Enter the 4-character room code from the host.'); return; }
    teardown();
    st.mode = 'guest'; st.me = 1; st.code = code; st.attempt = 0;
    const peer = new window.Peer({ debug: 0, config: ICE });
    st.peer = peer;
    setStage('server');
    peer.on('open', attemptConnect);
    peer.on('error', err => {
      const type = err && err.type;
      if (type === 'peer-unavailable') {
        if (st.attempt < tune.attempts) {
          setStage('finding', { notFound: true });
          retryTimer = setTimeout(attemptConnect, tune.retryMs);
        } else {
          fail(`No room called ${st.code} right now. Check the code, and make sure the host still has the game open on their screen, then tap Retry.`);
        }
        return;
      }
      if (connected()) return;
      fail(describeError(err));
    });
    peer.on('disconnected', () => reconnectSoon(peer));
  }

  function attemptConnect() {
    const peer = st.peer;
    if (!peer || peer.destroyed || st.mode !== 'guest') return;
    if (peer.disconnected) { reconnectSoon(peer, 0); retryTimer = setTimeout(attemptConnect, 1500); return; }
    st.attempt++;
    setStage('finding');
    const conn = peer.connect(PREFIX + st.code, { reliable: true, serialization: 'json' });
    wire(conn);
    clearTimeout(linkTimer);
    linkTimer = setTimeout(() => {
      if (!conn.open) {
        try { conn.close(); } catch (e) { /* ignore */ }
        fail('Found the room but could not open a direct link. This is usually a mobile network or firewall: ' +
             'try switching one phone between Wi-Fi and mobile data, then tap Retry.');
      }
    }, tune.linkTimeoutMs);
    conn.on('open', () => { clearTimeout(linkTimer); setStage('connected'); });
  }

  function retry() {
    if (st.mode === 'guest' && st.code) join(st.code);
    else if (st.mode === 'host') host(st.code);
  }

  function send(obj) {
    if (connected()) { try { st.conn.send(obj); } catch (e) { /* ignore */ } }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !st.peer) return;
      reconnectSoon(st.peer, 0);                       // phone came back from the background
      if (st.mode === 'guest' && !connected() && st.stage !== 'idle' && st.stage !== 'error') {
        clearTimeout(retryTimer); retryTimer = setTimeout(attemptConnect, 300);
      }
    });
  }

  return { st, tune, on, host, join, retry, send, teardown, available, connected };
})();

/* ===================== Particles (canvas overlay) ===================== */

const FX = (() => {
  let cv = null, cx = null, parts = [], raf = null, last = 0, W = 0, H = 0, reduced = false;
  const PALETTE = { magenta: [255, 43, 214], cyan: [34, 240, 255], gold: [255, 213, 74],
                    violet: [160, 90, 255], white: [255, 255, 255] };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pickc = names => PALETTE[names[Math.floor(rnd(0, names.length))]];

  function init(canvas) {
    cv = canvas; cx = cv.getContext('2d');
    if (!cx) { cv = null; return; }
    reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    if (!reduced) for (let i = 0; i < 34; i++) add(ember(true));
    kick();
  }
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function add(p) { if (parts.length < 900) parts.push(p); }
  function ember(anywhere) {
    return { kind: 'ember', x: rnd(0, W), y: anywhere ? rnd(0, H) : H + 6, vx: rnd(-6, 6), vy: rnd(-10, -26),
             life: Infinity, age: rnd(0, 10), size: rnd(0.8, 1.8), c: pickc(['magenta', 'cyan', 'violet']), phase: rnd(0, 6.28) };
  }

  /* Radial burst from a point. */
  function burst(x, y, o = {}) {
    if (!cx) return;
    const n = reduced ? Math.ceil((o.n || 30) / 4) : (o.n || 30);
    const cols = o.colors || ['magenta', 'cyan'];
    const spread = o.spread === undefined ? Math.PI : o.spread, angle = o.angle || 0;
    const [s0, s1] = o.speed || [60, 260], [l0, l1] = o.life || [0.5, 1.1], [z0, z1] = o.size || [1.5, 3.2];
    for (let i = 0; i < n; i++) {
      const a = angle + rnd(-spread, spread), sp = rnd(s0, s1);
      add({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(l0, l1), age: 0,
            size: rnd(z0, z1), c: PALETTE[cols[i % cols.length]], g: o.gravity === undefined ? 220 : o.gravity,
            drag: o.drag || 0.985 });
    }
    kick();
  }
  function confetti(n = 140) {
    if (!cx) return;
    n = reduced ? Math.ceil(n / 4) : n;
    for (let i = 0; i < n; i++) {
      add({ kind: 'confetti', x: rnd(0, W), y: rnd(-60, -5), vx: rnd(-50, 50), vy: rnd(80, 220), life: rnd(2.2, 3.8),
            age: 0, size: rnd(2, 4), c: pickc(['magenta', 'cyan', 'gold', 'white']), g: 40, drag: 0.995,
            spin: rnd(-6, 6), rot: rnd(0, 6.28) });
    }
    kick();
  }
  function fireworks(dur = 2600) {
    if (!cx) return;
    const t0 = performance.now();
    (function shoot() {
      if (performance.now() - t0 > dur) return;
      burst(rnd(W * 0.15, W * 0.85), rnd(H * 0.15, H * 0.6),
            { n: 70, colors: [['magenta', 'white'], ['cyan', 'white'], ['gold', 'magenta']][Math.floor(rnd(0, 3))],
              speed: [80, 340], life: [0.7, 1.5], gravity: 120 });
      setTimeout(shoot, rnd(180, 420));
    })();
  }
  function at(elm) {
    if (!elm) return [W / 2, H / 2];
    const r = elm.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  function dot(x, y, r, c, a) {
    cx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    cx.globalAlpha = a * 0.35; cx.beginPath(); cx.arc(x, y, r * 2.6, 0, 6.283); cx.fill();
    cx.globalAlpha = a;        cx.beginPath(); cx.arc(x, y, r, 0, 6.283);       cx.fill();
  }
  function kick() { if (cx && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(t) {
    raf = null;
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    cx.clearRect(0, 0, W, H);
    cx.globalCompositeOperation = 'lighter';
    let alive = 0;
    for (const p of parts) {
      p.age += dt;
      if (p.kind === 'ember') {
        p.x += (p.vx + Math.sin(p.age * 1.3 + p.phase) * 8) * dt; p.y += p.vy * dt;
        if (p.y < -8 || p.x < -8 || p.x > W + 8) Object.assign(p, ember(false));
        dot(p.x, p.y, p.size, p.c, 0.35 + 0.3 * Math.sin(p.age * 2 + p.phase));
        alive++; continue;
      }
      if (p.age >= p.life) continue;
      p.vy += p.g * dt; p.vx *= p.drag; p.vy *= p.drag; p.x += p.vx * dt; p.y += p.vy * dt;
      const a = 1 - p.age / p.life;
      if (p.kind === 'confetti') {
        p.rot += p.spin * dt;
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.globalAlpha = a;
        cx.fillStyle = `rgb(${p.c[0]},${p.c[1]},${p.c[2]})`; cx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
        cx.restore();
      } else {
        dot(p.x, p.y, p.size * (0.4 + 0.6 * a), p.c, a);
      }
      alive++;
    }
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = 'source-over';
    parts = parts.filter(p => p.kind === 'ember' || p.age < p.life);
    if (!alive) return;
    if (document.hidden) setTimeout(kick, 500); else raf = requestAnimationFrame(frame);
  }
  return { init, burst, confetti, fireworks, at };
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
const SHORT = { ones: '1s', twos: '2s', threes: '3s', fours: '4s', fives: '5s', sixes: '6s', three: '3 kind',
                four: '4 kind', full: 'Full hs', small: 'Sm str', large: 'Lg str', yahtzee: 'Yahtzee', chance: 'Chance' };

function dieSVG(v) {
  const pips = PIPS[v].map(([x, y]) =>
    `<circle class="pip" cx="${x}" cy="${y}" r="9" stroke="currentColor" stroke-width="3"/>`).join('');
  return `<svg viewBox="0 0 100 100" aria-hidden="true">` +
         `<rect class="face" x="5" y="5" width="90" height="90" rx="18" stroke="currentColor" stroke-width="4"/>${pips}</svg>`;
}

/* Sonar rings centred on an element, drawn in an overlay so board re-renders can't wipe them. */
function pulse(target, color = 'var(--cyan)', round = false) {
  if (!target || !el.waves) return;
  const r = target.getBoundingClientRect(), a = el.waves.getBoundingClientRect();
  if (!r.width) return;
  const cx = r.left - a.left + r.width / 2, cy = r.top - a.top + r.height / 2;
  for (let i = 0; i < 3; i++) {
    const w = document.createElement('span');
    w.className = 'wave' + (round ? ' round' : '');
    w.style.cssText = `left:${cx}px;top:${cy}px;width:${r.width + 8}px;height:${r.height + 8}px;` +
                      `--wave:${color};animation-delay:${i * 110}ms`;
    el.waves.appendChild(w);
    setTimeout(() => w.remove(), 900 + i * 110);
  }
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Survive a reload: the host keeps its room + state, the guest keeps its room. */
const Session = {
  save(obj) { try { sessionStorage.setItem('neon-yahtzee', JSON.stringify(obj)); } catch (e) { /* private mode */ } },
  load()    { try { return JSON.parse(sessionStorage.getItem('neon-yahtzee') || 'null'); } catch (e) { return null; } },
  clear()   { try { sessionStorage.removeItem('neon-yahtzee'); } catch (e) { /* ignore */ } },
};

/* The Streamlit page URL with ?room=CODE, so a tapped link lands with the code filled in. */
function shareLink(code) {
  try {
    const u = new URL(window.parent.location.href);
    u.searchParams.set('room', code);
    return u.href;
  } catch (e) { return null; }
}
function roomFromUrl() {
  try {
    const v = new URL(window.parent.location.href).searchParams.get('room');
    return v ? v.trim().toUpperCase().slice(0, 4) : null;
  } catch (e) { return null; }
}
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
  document.body.classList.toggle('playing', which !== 'lobby');
  el.conn.classList.toggle('hidden', which === 'lobby');
  if (which === 'lobby') el.turn.textContent = '';
}

function flash(msg) {
  el.hint.textContent = msg;
  el.hint.style.color = 'var(--gold)';
}

function setConn(cls, text) {
  el.conn.className = 'conn' + (cls ? ' ' + cls : '');
  el.conn.querySelector('span').textContent = text;
}

/* One line for the masthead pill, derived from the network stage. */
function connLine(m) {
  const opp = State ? State.players[Net.st.me === 0 ? 1 : 0].name : 'opponent';
  switch (m.stage) {
    case 'connected': return ['ok', `Linked with ${opp}`];
    case 'waiting':   return ['warn', `Room ${m.code} · waiting for ${State ? opp + ' to rejoin' : 'opponent'}`];
    case 'linking':   return ['warn', 'Opening link…'];
    case 'finding':   return ['warn', `Reconnecting to room ${m.code}… (${m.attempt}/${m.max})`];
    case 'server':    return ['warn', 'Reconnecting to server…'];
    case 'lost':      return ['bad', `${opp} dropped — waiting for them to rejoin`];
    case 'error':     return ['bad', 'Connection failed — tap to retry'];
    default:          return ['', ''];
  }
}

/* Scale the board down if it would overflow the viewport. Never scroll. */
function fitToScreen() {
  const g = el.game;
  if (!g || g.classList.contains('hidden')) return;
  g.style.transform = ''; g.style.width = '';
  const avail = g.clientHeight, need = g.scrollHeight;
  if (need > avail + 1) {
    const k = Math.max(0.5, avail / need);
    g.style.transform = `scale(${k})`;
    g.style.width = `${100 / k}%`;
  }
}
let fitRaf = null;
function scheduleFit() {
  if (fitRaf) return;
  fitRaf = requestAnimationFrame(() => { fitRaf = null; fitToScreen(); });
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
  if (Net.st.mode === 'host') {
    Net.send({ t: 'state', state: s });
    Session.save({ mode: 'host', code: Net.st.code, name: myName(), state: s });
  }
  render();
  react();
}

function flashCombo() {
  el.combo.classList.remove('flash');
  void el.combo.offsetWidth;   // restart the animation
  el.combo.classList.add('flash');
}

function cellFor(key, player) {
  const row = document.querySelector(`.card tr[data-key="${key}"]`);
  return row ? row.children[player + 1] : null;
}

/* Announce / sound / sparkle the latest event exactly once. */
function react() {
  const e = State && State.event;
  if (!e || e.seq <= announcedSeq) return;
  announcedSeq = e.seq;
  const d = describeEvent(State);
  if (!d) return;

  if (e.type === 'roll') {
    animateRoll(e);
    el.dice.querySelectorAll('.die').forEach((die, i) => {
      if (!e.prevHeld[i]) { const [x, y] = FX.at(die); FX.burst(x, y, { n: 7, speed: [40, 150], life: [0.3, 0.6], size: [1, 2], gravity: 320 }); }
    });
    setTimeout(() => {
      if (e.yahtzee) {
        flashCombo();
        FX.confetti(140);
        el.dice.querySelectorAll('.die').forEach(die => { const [x, y] = FX.at(die); FX.burst(x, y, { n: 40, colors: ['gold', 'white', 'magenta'], speed: [80, 320], life: [0.8, 1.6], gravity: 160 }); });
      } else if (e.newCombo && !e.comboUsed) {
        flashCombo();
        const [x, y] = FX.at(el.combo);
        FX.burst(x, y, { n: 60, colors: ['gold', 'white'], speed: [60, 280], life: [0.6, 1.3], gravity: 140 });
        const row = document.querySelector(`.card tr[data-key="${e.combo}"]`);
        if (row) { const [rx, ry] = FX.at(row.children[0]); FX.burst(rx, ry, { n: 24, colors: ['gold'], speed: [40, 180], life: [0.5, 1], gravity: 120, spread: 0.6, angle: 0 }); }
      }
    }, 650);
  } else if (e.type === 'hold') {
    const die = el.dice.querySelector(`.die[data-i="${e.i}"]`);
    if (die) { const [x, y] = FX.at(die); FX.burst(x, y, { n: 12, colors: e.held ? ['cyan', 'white'] : ['magenta'], speed: [40, 160], life: [0.3, 0.7], size: [1, 2.2], gravity: 200 }); }
  } else if (e.type === 'score') {
    const cell = cellFor(e.key, e.player);
    if (cell) {
      const [x, y] = FX.at(cell);
      if (e.pts === 0) FX.burst(x, y, { n: 8, colors: ['violet'], speed: [20, 80], life: [0.4, 0.8], size: [1, 2], gravity: 260 });
      else FX.burst(x, y, { n: Math.min(90, 26 + e.pts), colors: ['magenta', 'white', 'cyan'], speed: [60, 280], life: [0.6, 1.3], gravity: 180 });
    }
    if ((e.key === 'yahtzee' && e.pts === 50) || e.bonus100) {
      FX.confetti(160);
      if (cell) { const [x, y] = FX.at(cell); FX.burst(x, y, { n: 80, colors: ['gold', 'white'], speed: [100, 380], life: [0.8, 1.8], gravity: 120 }); }
    }
    if (e.upperBonus) {
      const bonus = el['card-upper'].querySelector('tr.bonus');
      if (bonus) { const [x, y] = FX.at(bonus.children[e.player + 1]); FX.burst(x, y, { n: 50, colors: ['gold', 'cyan'], speed: [60, 260], life: [0.6, 1.4], gravity: 140 }); }
    }
    if (e.gameOver) { setTimeout(() => { FX.fireworks(3200); FX.confetti(200); }, 400); }
  }

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
    el.turn.textContent = 'Final';
    showPanel('over');
    return;
  }
  showPanel('game');

  const filled = s.players.reduce((n, p) => n + totals(p).filled, 0);
  const round = Math.min(13, Math.floor(filled / 2) + 1);
  const who = s.players[s.current].name;
  if (Net.st.mode === 'local') {
    el.turn.textContent = `Round ${round} of 13 \u2014 ${who}'s turn`;
    el.turn.classList.remove('waiting');
  } else {
    el.turn.textContent = mine ? `Round ${round} of 13 \u2014 your turn` : `Round ${round} of 13 \u2014 waiting for ${who}`;
    el.turn.classList.toggle('waiting', !mine);
  }

  const diceDisabled = !mine || !rolled || s.rollsLeft === 0 || animating;
  el.dice.innerHTML = s.dice.map((v, i) =>
    `<button class="die${s.held[i] ? ' held' : ''}" data-i="${i}" ${diceDisabled ? 'disabled' : ''}` +
    ` style="${rolled ? '' : 'opacity:.35'}" aria-label="Die ${i + 1} shows ${v}${s.held[i] ? ', held' : ''}">` +
    `${dieSVG(v)}<span class="tag">HELD</span></button>`).join('');

  el.combo.textContent = (rolled && s.combo && !animating) ? COMBO_NAME[s.combo] : '';

  el['btn-roll'].disabled = !mine || s.rollsLeft === 0 || animating;
  el.rolls.innerHTML = [0, 1, 2].map(i => `<i class="${i < 3 - s.rollsLeft ? 'spent' : ''}"></i>`).join('');

  el.hint.style.color = '';
  if (mine) {
    el.hint.textContent = !rolled ? 'Roll to start your turn'
                        : s.rollsLeft > 0 ? 'Tap dice to hold, roll again, or pick a box'
                        : 'Pick a box';
  } else {
    el.hint.textContent = Net.st.mode === 'local' ? '' : `${who} is rolling`;
  }

  if (!opts.skipCard) renderCards();
  scheduleFit();
}

function renderCards() {
  const s = State, rolled = s.rollsLeft < 3, mine = isMyTurn();
  const cur = s.players[s.current];
  const av = (mine && rolled) ? availableCats(cur, s.dice) : { keys: [], forced: false };
  const hot = new Set(rolled ? combosOnTable(s.dice, cur) : []);
  const T = s.players.map(totals);
  const me = p => (p === s.current ? ' me' : '');

  const cell = (p, c) => {
    const pl = s.players[p], v = pl.scores[c.key];
    if (v !== null) {
      const cls = (v === 0 ? ' zero' : '') + ((c.key === 'yahtzee' && v === 50) ? ' big' : '');
      return `<td class="n${cls}${me(p)}">${v}</td>`;
    }
    if (p === s.current && av.keys.includes(c.key)) {
      const pts = scoreFor(c.key, s.dice, pl);
      const pcls = (hot.has(c.key) ? ' hot' : '') + (av.forced ? ' forced' : '');
      return `<td class="n open${me(p)}"><button class="pick${pcls}" data-key="${c.key}"` +
             ` aria-label="Score ${pts} in ${c.label}">${pts}</button></td>`;
    }
    return `<td class="n${me(p)}"></td>`;
  };
  const row = c => {
    let cls = '';
    if (hot.has(c.key)) cls = 'hot' + (cur.scores[c.key] !== null ? ' used' : '') + (c.key === s.combo ? ' best' : '');
    return `<tr class="${cls}" data-key="${c.key}"><td><span class="long">${c.label}</span><span class="short">${SHORT[c.key]}</span></td>${cell(0, c)}${cell(1, c)}</tr>`;
  };
  const sumRow = (label, f, cls = 'sum') =>
    `<tr class="${cls}"><td>${label}</td><td class="n${me(0)}">${f(T[0])}</td><td class="n${me(1)}">${f(T[1])}</td></tr>`;
  const head = first =>
    `<tr><th>${first}</th><th class="${s.current === 0 ? 'me' : ''}">${esc(s.players[0].name)}</th>` +
    `<th class="${s.current === 1 ? 'me' : ''}">${esc(s.players[1].name)}</th></tr>`;

  el['card-upper'].innerHTML =
    head('Upper') + UPPER.map(row).join('') +
    sumRow('Upper total', t => t.upper) +
    sumRow('Bonus at 63', t => t.bonus, 'sum bonus');
  el['card-lower'].innerHTML =
    head('Lower') + LOWER.map(row).join('') +
    sumRow('Yahtzee bonus', t => t.yb) +
    sumRow('Total', t => t.grand, 'sum grand');
}

const STEPS = {
  host:  [['server', 'Contact server'], ['waiting', 'Room open'], ['linking', 'Opponent found'], ['connected', 'Connected']],
  guest: [['server', 'Contact server'], ['finding', 'Find room'], ['linking', 'Open link'], ['connected', 'Connected']],
};

/* Big, obvious connection status: stepper + code + what to do next. */
function renderStatus(m) {
  const box = el['lobby-status'];
  if (!m) { box.className = 'status'; box.innerHTML = ''; return; }
  if (typeof m === 'string') { box.className = 'status'; box.innerHTML = `<div class="detail">${esc(m)}</div>`; return; }

  const steps = STEPS[m.mode] || STEPS.guest;
  const failed = m.stage === 'error' || m.stage === 'lost';
  let idx = steps.findIndex(x => x[0] === m.stage);
  if (m.stage === 'lost') idx = 3;
  if (m.stage === 'error') idx = Math.max(0, steps.findIndex(x => x[0] === (Net.st.mode === 'host' ? 'waiting' : 'finding')));
  const li = steps.map(([k, label], i) => {
    const cls = failed && i === idx ? 'fail' : i < idx ? 'done' : i === idx ? 'active' : '';
    return `<li class="${cls}">${label}</li>`;
  }).join('');

  let headline = '', detail = '', actions = '';
  const code = esc(m.code || '');
  const link = m.code ? shareLink(m.code) : null;
  const shareBtns = `<button class="neon" data-act="copy">Copy code</button>` +
    (link ? `<button class="neon" data-act="share">Share link</button>` : '');

  if (m.mode === 'host') {
    if (m.stage === 'server') { headline = m.message || 'Contacting server\u2026'; detail = 'This takes a second or two.'; }
    else if (m.stage === 'waiting') {
      headline = 'Your room is open';
      detail = `<span class="code">${code}</span>Send this code to your opponent and <b>keep this page open</b> \u2014 the room closes if this tab sleeps.` +
               (link ? `<span class="link">${esc(link)}</span>` : '');
      actions = shareBtns;
    }
    else if (m.stage === 'linking') { headline = 'Opponent found'; detail = 'Opening the link between your phones\u2026'; }
    else if (m.stage === 'connected') { headline = 'Connected'; detail = 'Starting the game\u2026'; }
  } else {
    if (m.stage === 'server') headline = 'Contacting server\u2026';
    else if (m.stage === 'finding') {
      headline = m.notFound ? `Room ${code} not found yet` : `Looking for room ${code}\u2026`;
      detail = m.notFound
        ? `The host may have switched apps \u2014 their room only exists while their page is open. Retrying (${m.attempt} of ${m.max})\u2026`
        : 'Asking the server for the host\u2026';
    }
    else if (m.stage === 'linking') { headline = 'Host found'; detail = 'Opening the link between your phones\u2026 up to 20 seconds on mobile data.'; }
    else if (m.stage === 'connected') { headline = 'Connected'; detail = 'Waiting for the host to deal you in\u2026'; }
  }
  if (m.stage === 'lost') { headline = 'Link dropped'; detail = 'Trying to reconnect\u2026'; }
  if (m.stage === 'error') {
    headline = 'Not connected';
    detail = esc(m.message || '');
    actions = `<button class="neon" data-act="retry">Retry</button>` +
              (m.code && Net.st.mode === 'host' ? shareBtns : '') +
              `<button class="neon quiet" data-act="local">Play on one screen instead</button>`;
  }

  box.className = 'status' + (m.stage === 'error' ? ' error' : '');
  box.innerHTML = `<ol class="steps">${li}</ol>` +
                  (headline ? `<div class="headline">${headline}</div>` : '') +
                  (detail ? `<div class="detail">${detail}</div>` : '') +
                  (actions ? `<div class="actions">${actions}</div>` : '');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove();
    return ok;
  } catch (e) { return false; }
}

function toast(msg) {
  const d = el['lobby-status'].querySelector('.detail');
  if (d) d.innerHTML = `<b>${esc(msg)}</b>`;
}

function startGame(names) {
  announcedSeq = 0;
  commit(newGame(names, 0));
}

function bindNet() {
  Net.on('status', m => {
    const inGame = !!State && !el.game.classList.contains('hidden') || (!!State && !el.over.classList.contains('hidden'));
    if (m.stage === 'connected') {
      Audio.play('connect');
      if (Net.st.mode === 'guest') {
        Net.send({ t: 'join', name: myName() });
        Session.save({ mode: 'guest', code: Net.st.code, name: myName() });
      }
    }
    if (m.stage === 'error' || m.stage === 'lost') Audio.play('error');
    if (inGame) {
      const [cls, text] = connLine(m);
      setConn(cls, text);
      if (m.stage === 'lost' && Net.st.mode === 'guest') setTimeout(() => Net.retry(), Net.tune.rejoinMs);   // guest reconnects itself
      if (m.stage === 'lost' || m.stage === 'connected') Voice.speak(m.stage === 'lost' ? 'Connection lost.' : 'Reconnected.', { interrupt: true });
    } else {
      renderStatus(m);
    }
  });
  Net.on('closed', () => { /* stage 'lost' is reported through status */ });
  Net.on('message', m => {
    if (!m || typeof m !== 'object') return;
    if (Net.st.mode === 'host') {
      if (m.t === 'join') {
        if (State && State.phase !== 'over') {
          State.players[1].name = cleanName(m.name) || State.players[1].name;
          commit(State);                       // resume: resend current state
        } else {
          startGame([myName(), cleanName(m.name) || 'Player 2']);
        }
        setConn('ok', `Linked with ${State.players[1].name}`);
      } else if (m.t === 'action' && State) {
        const r = applyAction(State, m.action, 1);
        if (!r.ok) Net.send({ t: 'deny', error: r.error });
        else commit(r.state);
      }
    } else if (Net.st.mode === 'guest') {
      if (m.t === 'state') {
        State = m.state;
        render();
        react();
        setConn('ok', `Linked with ${State.players[0].name}`);
      } else if (m.t === 'deny') {
        Audio.play('error');
        render();            // re-enable anything the tap disabled
        flash(m.error);
      }
    }
  });
}

function bindUI() {
  const startLocal = () => {
    Audio.ensure();
    Net.teardown();
    Net.st.mode = 'local';
    Session.clear();
    setConn('', 'Same screen');
    startGame([myName() === 'Player' ? 'Player 1' : myName(), 'Player 2']);
  };
  el['btn-local'].addEventListener('click', startLocal);
  el['btn-host'].addEventListener('click', () => { Audio.ensure(); Net.host(); });
  el['btn-join'].addEventListener('click', () => { Audio.ensure(); Net.join(el.code.value); });

  el['lobby-status'].addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act, code = Net.st.code || '';
    if (act === 'retry') Net.retry();
    else if (act === 'local') startLocal();
    else if (act === 'copy') toast((await copyText(code)) ? `Copied ${code}` : `Select the code and copy it: ${code}`);
    else if (act === 'share') {
      const url = shareLink(code);
      try {
        if (navigator.share) { await navigator.share({ title: 'Neon Yahtzee', text: `Join my Neon Yahtzee room ${code}`, url }); return; }
      } catch (err) { if (err && err.name === 'AbortError') return; }
      toast((await copyText(url)) ? 'Link copied' : 'Select the link below and copy it');
    }
  });

  el.resume.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const sv = Session.load();
    el.resume.classList.add('hidden');
    if (b.dataset.act === 'forget' || !sv) { Session.clear(); return; }
    Audio.ensure();
    if (sv.name) el.name.value = sv.name;
    if (sv.mode === 'host' && sv.state) {
      State = sv.state; announcedSeq = State.seq;
      render();
      setConn('warn', `Room ${sv.code} · waiting for ${State.players[1].name} to rejoin`);
      Net.host(sv.code);
    } else {
      el.code.value = sv.code;
      Net.join(sv.code);
    }
  });

  el.conn.addEventListener('click', () => { if (Net.st.stage === 'error') Net.retry(); });
  el.code.addEventListener('keydown', e => { if (e.key === 'Enter') el['btn-join'].click(); });
  el.code.addEventListener('input', () => { el.code.value = el.code.value.toUpperCase(); });

  el['btn-roll'].addEventListener('click', () => {
    pulse(el['btn-roll'], 'var(--magenta)');
    dispatch({ type: 'roll' });
  });
  el.dice.addEventListener('click', e => {
    const b = e.target.closest('.die');
    if (!b || b.disabled) return;
    pulse(b, b.classList.contains('held') ? 'var(--magenta)' : 'var(--cyan)');
    dispatch({ type: 'hold', i: Number(b.dataset.i) });
  });
  const onPick = e => {
    const b = e.target.closest('button.pick');
    if (!b || b.disabled) return;
    pulse(b, b.classList.contains('hot') ? 'var(--gold)' : 'var(--magenta)');
    document.querySelectorAll('button.pick').forEach(x => { x.disabled = true; });  // one tap, one score
    dispatch({ type: 'score', key: b.dataset.key });
  };
  el['card-upper'].addEventListener('click', onPick);
  el['card-lower'].addEventListener('click', onPick);
  el['btn-rematch'].addEventListener('click', () => {
    pulse(el['btn-rematch'], 'var(--gold)');
    dispatch({ type: 'rematch' });
  });

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

  window.addEventListener('resize', scheduleFit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleFit);
  window.addEventListener('beforeunload', () => Net.teardown());
}

function init() {
  ['lobby', 'game', 'over', 'dice', 'demo-dice', 'card-upper', 'card-lower', 'combo', 'turn', 'conn', 'rolls',
   'hint', 'ticker', 'lobby-status', 'name', 'code', 'btn-host', 'btn-join', 'btn-local', 'btn-roll',
   'btn-rematch', 'btn-music', 'btn-voice', 'btn-sfx', 'over-title', 'over-score', 'waves', 'fx', 'resume']
    .forEach(id => { el[id] = document.getElementById(id); });

  Voice.init();
  if (!Voice.has()) { el['btn-voice'].disabled = true; el['btn-voice'].setAttribute('aria-pressed', 'false'); }
  el['demo-dice'].innerHTML = [1, 2, 3, 4, 5].map(v => `<button class="die" disabled tabindex="-1">${dieSVG(v)}</button>`).join('');
  try { FX.init(el.fx); } catch (e) { /* no canvas: skip particles */ }
  bindNet();
  bindUI();
  if (!Net.available()) {
    renderStatus({ stage: 'error', mode: 'guest', message: 'Online play is unavailable right now (PeerJS did not load).' });
  }

  const sv = Session.load();
  if (sv && sv.code && (sv.mode === 'guest' || (sv.state && sv.state.phase !== 'over'))) {
    if (sv.name) el.name.value = sv.name;
    el.resume.innerHTML = (sv.mode === 'host'
      ? `You were hosting room <b>${esc(sv.code)}</b> — your game is saved.`
      : `You were in room <b>${esc(sv.code)}</b>.`) +
      `<div class="actions"><button class="neon" data-act="resume">${sv.mode === 'host' ? 'Reopen room and resume' : 'Rejoin'}</button>` +
      `<button class="neon quiet" data-act="forget">Start fresh</button></div>`;
    el.resume.classList.remove('hidden');
  }

  const fromUrl = roomFromUrl();
  if (fromUrl && !(sv && sv.code === fromUrl)) {
    el.code.value = fromUrl;
    renderStatus(`Room code ${fromUrl} filled in from your link. Enter your name and tap Join.`);
    el.name.focus();
  }

  window.NeonYahtzee = { Net, Session };   // for debugging in the console
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CATS, rawScore, scoreFor, availableCats, totals, newGame, applyAction, describeEvent, combosOnTable, bestCombo };
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

})();
