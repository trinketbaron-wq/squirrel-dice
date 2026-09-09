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

## Notes

- The link is browser-to-browser through PeerJS's free public signalling
  server. Networks that block WebRTC (some corporate/VPN setups) will fail to
  connect; the lobby says so, and same-screen play still works.
- The host is authoritative: the guest sends actions, the host validates them
  and broadcasts state. If the guest drops and rejoins with the same code, the
  game resumes where it was.
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
