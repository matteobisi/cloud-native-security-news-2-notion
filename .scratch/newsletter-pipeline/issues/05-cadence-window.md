# 05: Cadence gate and digest window

**What to build:** The pipeline publishes only when enough Qualifying Items have accumulated, forces a digest after the configured interval, caps the window, rolls quiet weeks forward and clears published Items from the buffer.

**Blocked by:** 03, 04

**Status:** resolved

- [x] A run holds without publishing when Qualifying Items are below the minimum and no force interval has elapsed
- [x] The first run bootstraps the configured lookback
- [x] A digest is forced when the configured number of days has passed since the last publish
- [x] The Digest window starts at the last publish and never exceeds the maximum lookback
- [x] Skipped Items roll forward, and published Items are removed from the buffer
