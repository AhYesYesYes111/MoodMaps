# MoodMaps Chrome Web Store graphics

Ready-to-upload files:

- `screenshots/`: five 1280×800 listing screenshots.
- `promotional/moodmaps-small-promo-440x280.png`: required small promo tile.
- `promotional/moodmaps-marquee-1400x560.png`: optional marquee image.
- `real-screenshots/`: integration-reference captures from MoodMaps running on real Google Maps, Apple Maps, and Amap route pages. Recapture these before publication because map DOM and route data change over time.
- `ui/popup-results.png`: the canonical scoring capture, rendered from the current product code and used anywhere exact score inputs are shown.

All promotional copy in this asset set is English. The Amap product screenshot retains the website's real Chinese map interface.

To regenerate the files, run:

```sh
/Users/henry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  store-assets/source/render.mjs
```

The source compositions are in `source/design.html` and `source/styles.css`.
