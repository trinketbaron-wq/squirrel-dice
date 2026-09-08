import streamlit as st
import streamlit.components.v1 as components
from pathlib import Path

st.set_page_config(
    page_title="Squirrel Dice Showdown",
    page_icon="🐿️",
    layout="centered",
    initial_sidebar_state="collapsed",
)

st.markdown("""
<style>
header[data-testid="stHeader"] { background: transparent; }
.block-container { max-width: 980px; padding-top: 1rem; padding-bottom: 2rem; }
[data-testid="stAppViewContainer"] {
    background:
      radial-gradient(circle at 20% 0%, rgba(61,121,75,.16), transparent 28%),
      linear-gradient(#08150e,#0c1d13);
}
</style>
""", unsafe_allow_html=True)

html = Path(__file__).with_name("game.html").read_text(encoding="utf-8")
components.html(html, height=1580, scrolling=False)
