# S0L26-0s Hub Maintenance

This folder now contains the operating-system entry hub for the S0L26-0s lane.

## Files

- `index.html`: main launcher page and three-workspace shell.
- `hub-registry.json`: single source of truth for directory sections and default workspace frames.
- `background.partial.html`: swappable visual background layer loaded separately from the launcher UI.

## Add a new app or platform

1. Put the new surface in the correct public path.
2. Make sure the surface has a real browser entry page such as `index.html`.
3. Add one item to the appropriate section in `hub-registry.json`.
4. If the surface should load inside the launcher by default, add or replace an entry in `defaultWorkspaces`.

## Remove an app or platform

1. Remove the relevant item from `hub-registry.json`.
2. Remove or replace it from `defaultWorkspaces` if it is currently pinned into a launcher frame.

## Change the background

1. Edit or replace `background.partial.html`.
2. If you want to reference an image or video asset, place it in this folder and point the partial at that file.
3. The launcher UI stays separate from the background layer by design.

## Limits

- This is a static launcher page, so it cannot auto-discover arbitrary folders at runtime from the browser.
- The registry file is the explicit control point for add/remove behavior.