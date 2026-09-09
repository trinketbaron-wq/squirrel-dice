"""Neon Yahtzee — Streamlit host.

Streamlit only serves the page. All game logic, audio, voice and the
two-player link (PeerJS / WebRTC) live in game/, so there are no reruns
and the music never restarts.
"""

from pathlib import Path

import streamlit as st

st.set_page_config(
    page_title="Neon Yahtzee",
    page_icon="🎲",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Kill Streamlit's chrome and match the game's void background.
st.markdown(
    """
    <style>
      .stApp { background: #06001a; }
      header[data-testid="stHeader"] { background: transparent; }
      #MainMenu, footer { visibility: hidden; }
      .block-container {
        padding: 0.25rem 0.5rem 0 0.5rem;
        max-width: 1000px;
      }
      iframe { border: 0; }
    </style>
    """,
    unsafe_allow_html=True,
)

GAME_DIR = Path(__file__).parent / "game"


def build_page() -> str:
    html = (GAME_DIR / "index.html").read_text(encoding="utf-8")
    css = (GAME_DIR / "style.css").read_text(encoding="utf-8")
    js = (GAME_DIR / "game.js").read_text(encoding="utf-8")
    return html.replace("/*__CSS__*/", css).replace("/*__JS__*/", js)


page = build_page()
if hasattr(st, "iframe"):
    st.iframe(page, height=1240)
else:  # Streamlit < 1.63
    import streamlit.components.v1 as components
    components.html(page, height=1240, scrolling=True)
