# 🐿️ Squirrel Dice Showdown

A squirrel-themed two-player dice game hosted with Streamlit.

## What it includes

- CSS 3D six-faced polygon/cube dice
- Tap dice to hold/release
- Yahtzee-style scoring
- Roll button below the scoring area
- Squirrel runners, acorn rain, celebration popups
- Pass & Play mode
- Online room codes using PeerJS (peer-to-peer browser connection)
- Mobile-friendly layout for iPhone and Android browsers

## Run locally

```bash
pip install -r requirements.txt
streamlit run app.py
```

## Deploy on Streamlit Community Cloud

1. Create a new GitHub repository.
2. Upload all three files from this folder: `app.py`, `game.html`, and `requirements.txt`.
3. Go to https://share.streamlit.io and sign in with GitHub.
4. Choose **Create app**.
5. Select your repository and set the entrypoint to `app.py`.
6. Deploy.
7. Send the resulting `*.streamlit.app` link to your friend.

## Online play

One player enters a name and taps **Create Room**. Send the generated `NUT-XXXXX`
code to the other player. The other player enters their name and the room code and
taps **Join Room**.

Peer-to-peer online mode depends on WebRTC/network conditions. Pass & Play works
without any external connection beyond loading the page.
