ON PAR COCKTAIL RECIPE PLAYER

Unzip the complete package. From its top folder, run:
  python3 serve_player.py --port 8129
Then open http://127.0.0.1:8129/
The server supports video byte ranges for immediate Back/Next seeking.
You can also open guided-player/index.html directly in a modern browser.
Keep the player files and assets together. Playback needs no account or external libraries.

Choose a cocktail from the menu. Next starts its first step. Each step pauses
at its end. Back and Next remain clickable throughout playback and while paused.
Back on the first step restarts it; Next on the last step replays the recipe.
Click the video to pause/resume. Fullscreen and mute are at top right.

The complete release contains 26 active recipes. Four source recipes remain
inactive and are omitted. While authoring is in progress, PENDING-RECIPES.txt
reports the current catalog; packaging is blocked until all 26 pass validation.

Cranberry Juice and all lemonade steps display the instruction to fill the
pitcher using the fountain drink machine in karaoke. The final label step says:
Name of cocktail, Cooler placement, total oz and date. Opening steps say:
Make sure the keg is clean and sanitized before adding ingredients.
These descriptions are saved in recipe metadata and shown by the
interactive player. They are not burned into the standalone MP4 files.

Each stated bottle gets a separate opening and pour. Videos use the actual
photographed keg/lid, four-quart pitcher and metal paddle. Sour mix uses the
yellow Daily's jug. The purple sticker goes on top of the closed lid; its Date
and Cooler fields remain blank for the operator to fill in.

The 31 original photo assets are unchanged. Eight temporary realistic replicas
based on real product photographs fill missing bottle gaps: six branded bottles
and two generic bottles, Cold Brew Concentrate 32 FL OZ and Vanilla Syrup 25 FL OZ.
See ASSET-SOURCES.json and replica-assets/ in the package root for source URLs,
full prompts, PNGs and cap geometry. Historical generation manifests retain
authoring paths for provenance; portable asset paths are in ASSET-SOURCES.json.

Lemon Drop uses nine distinct full 1 L lemon juice bottles by explicit user
instruction. Its original numeric 300 fl oz and configured dashboard yield are
retained separately as provenance. No dashboard data was changed.
