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
    st.iframe(page, height=1240)
else:  # Streamlit < 1.63
    import streamlit.components.v1 as components

    components.html(page, height=1240, scrolling=True)
