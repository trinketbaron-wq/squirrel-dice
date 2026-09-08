import streamlit as st
import streamlit.components.v1 as components
from pathlib import Path

st.set_page_config(page_title="Squirrel Dice Showdown", page_icon="🐿️", layout="centered", initial_sidebar_state="collapsed")
st.markdown("""
<style>
header[data-testid="stHeader"]{display:none}
.block-container{max-width:820px;padding:0}
[data-testid="stAppViewContainer"]{background:#07140d}
</style>
""", unsafe_allow_html=True)

components.html(Path(__file__).with_name("game.html").read_text(encoding="utf-8"), height=860, scrolling=False)
