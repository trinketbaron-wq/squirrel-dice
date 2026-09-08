# Squirrel Dice Showdown v5 — Embedded Artwork Fix

This version fixes Streamlit iframe asset loading by embedding the PNG artwork
directly inside `game.html` as base64 data URIs.

Upload only:
- app.py
- game.html
- requirements.txt

No assets directory is required for rendering.

The game now also displays a visible woodland illustration strip so you can
immediately confirm the artwork loaded.
