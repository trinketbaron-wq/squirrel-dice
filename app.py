"""Neon Yahtzee — Streamlit host.

Streamlit only serves the page. All game logic, audio, voice, particles and
the two-player link (PeerJS / WebRTC) live in game/, so there are no reruns
and the music never restarts. The iframe is pinned to the viewport and the
game lays itself out to fit — no scrolling.
"""

from pathlib import Path

import streamlit as st

st.set_page_config(
    page_title="Neon Yahtzee",
    page_icon="🎲",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Strip Streamlit's chrome and give the iframe the whole window.
st.markdown(
    """
    <style>
      html, body, .stApp { background: #06001a; overflow: hidden; }
      header[data-testid="stHeader"] { display: none; }
      #MainMenu, footer { visibility: hidden; }
      .stMainBlockContainer, .block-container {
        padding: 0 !important;
        max-width: 100% !important;
      }
      [data-testid="stAppViewContainer"], .stMain { overflow: hidden; }
      [data-testid="stIFrame"] { height: 100vh; height: 100dvh; }
      iframe.stIFrame, [data-testid="stIFrame"] iframe {
        display: block;
        border: 0;
        height: 100vh !important;
        height: 100dvh !important;
      }
      [data-testid="stElementContainer"] { margin: 0; }
    </style>
    """,
    unsafe_allow_html=True,
)

HERE = Path(__file__).resolve().parent
FILES = ("index.html", "style.css", "game.js")


def find_game_dir() -> Path | None:
    """Accept game/ next to app.py, or the three files sitting beside app.py."""
    for candidate in (HERE / "game", HERE):
        if all((candidate / f).is_file() for f in FILES):
            return candidate
    return None


def build_page(game_dir: Path) -> str:
    html = (game_dir / "index.html").read_text(encoding="utf-8")
    css = (game_dir / "style.css").read_text(encoding="utf-8")
    js = (game_dir / "game.js").read_text(encoding="utf-8")
    return html.replace("/*__CSS__*/", css).replace("/*__JS__*/", js)


game_dir = find_game_dir()

if game_dir is None:
    present = sorted(p.name + ("/" if p.is_dir() else "") for p in HERE.iterdir())
    st.error(
        "Game files not found. app.py expects a `game/` folder beside it "
        f"containing {', '.join(FILES)}.\n\n"
        f"Looked in `{HERE / 'game'}` and `{HERE}`. "
        f"What's actually next to app.py: {', '.join(present) or 'nothing'}."
    )
    st.stop()

page = build_page(game_dir)
if hasattr(st, "iframe"):
    st.iframe(page, height="stretch")
else:  # Streamlit < 1.63
    import streamlit.components.v1 as components

    components.html(page, height=900, scrolling=False)
