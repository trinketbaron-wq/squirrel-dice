# Neon Yahtzee

Two-player Yahtzee in a neon-80s wireframe style, hosted on Streamlit.
Streamlit only serves the page; the game itself is `game/` — plain HTML, CSS
and JavaScript with no build step.

- Two players over the internet via PeerJS (WebRTC, browser to browser). No
  server-side game state, so it runs fine on Streamlit Community Cloud.
- Same-screen mode for two people on one device.
- Synthwave music, dice/score/Yahtzee sound effects — all synthesized with the
  Web Audio API, so there are no audio files to host.
- An announcer that calls the rolls and scores, using the browser's built-in
  speech (Web Speech API). Voice quality depends on the browser; Chrome's
  "Google US English" is the best of the free ones.
- Full rules: upper bonus at 63, Yahtzee bonus (100 per extra Yahtzee), and
  the joker rules for a Yahtzee rolled after the Yahtzee box is filled.
- Everything fits on one screen — the board sizes itself to the viewport and
  scales down rather than scrolling. Dice and roll on the left, upper and
  lower scorecards side by side on the right (stacked on phones).
- Combo callouts: when the dice make a straight, full house, three or four of
  a kind, the matching row gets a swept gold bar, the score button pulses, a
  banner flashes over the dice and the announcer calls it.
- Particles: sparks on every roll and hold, bursts on every score, confetti
  and fireworks for Yahtzees and the final result. All drawn on a canvas
  overlay; honours `prefers-reduced-motion`.

## Deploy

1. Push this folder to a GitHub repository.
2. On share.streamlit.io, create a new app pointing at `app.py`.
3. That's it — `requirements.txt` only needs `streamlit`.

## Play

- **Host online game** shows a 4-character room code. Send it to your opponent.
- **Join** with that code from any other browser. The host is player 1 and
  rolls first; the game starts the moment the guest connects.
- **Two players, one screen** skips the network entirely.
- Keyboard: `R` rolls, `1`–`5` hold a die.

## Connecting: what to expect

- The host taps **Host online game**, gets a 4-character code and a link.
  **Copy code** / **Share link** send it; the link opens the app with the code
  already filled in.
- The room only exists while the host's page is open. If the host switches
  apps to send the code, some phones suspend the tab and the room briefly
  disappears — the guest's Join keeps retrying for about a minute, so just
  come back to the game. The status panel shows which step you're on.
- The link is browser-to-browser (WebRTC) with STUN and TURN relays, so it
  works on mobile data and behind most home routers. Some corporate/VPN
  networks block it; the lobby says so and offers same-screen play.
- A coloured pill in the top bar shows the live state during a game: green
  linked, amber reconnecting, red dropped. Tap it to retry.
- Reloads are survivable. The host's game is saved in the tab; on reload the
  lobby offers **Reopen room and resume**. The guest reconnects automatically
  (or taps **Rejoin**), and the host resends the board.
- The host is authoritative: the guest sends actions, the host validates them
  and broadcasts state.
- Browsers require a click before playing audio — the first button you press in
  the lobby unlocks it. Music is off by default; toggle it in the top right.

## Local run

```bash
pip install -r requirements.txt
streamlit run app.py
```

Game logic is pure and exported for Node; a quick check:

```bash
node -e "const G=require('./game/game.js'); console.log(G.rawScore('full',[2,2,3,3,3]))"
```
