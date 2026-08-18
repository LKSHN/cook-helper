# Ideas

Drop anything here — one line or a whole paragraph, doesn't need to be polished.
When you want one built, just point me at it (or say "build the next one").

- Shop tab: currently just a placeholder ("Shop is coming soon.") — build out what it should actually do

## Done
(move items here once built, so the list above stays current)

- New tab feature: Added top-level "Recap" / "MEP" tabs above the station bar — Recap holds the existing recipe tool, MEP holds the setup-list tool

- MEP Tab: split into Before/After modes — Before is the prep checklist (editable qty/unit, tap the check to mark prepped and remove it); After lists every distinct ingredient across all recipes with a one-tap add into the Before list (already-added ones show a checkmark instead). Synced via Firestore like recipes.

- Recap interface: station bar moved from the fixed bottom to just below the header, and now works as scroll-to-section anchors instead of a filter — the list shows every recipe in one scroll, grouped by station, sorted by ingredient count (highest first) within each group

- Interface changes: Change the edit menu so it fits more the rest of the interface — matched the form's header bar to the main "THE RAIL" header (flat background, bottom border, edge-to-edge)

- Colors: Add in the edit menu a way to change colors of an ingredient when expending a recipe — each ingredient row has a swatch button opening an 8-color palette; the color shows as a dot next to the name in both the accordion and full recipe view

- Remove a tab: remove the "sauce & dressing" tab — dropped from filter tabs and the form's station dropdown

- Combine edit + full recipe view: "View full recipe" and the 3-dot Edit action now both open the same editable form — no more separate read-only screen. Photo lightbox (tap to zoom) carried over into the form.

- Search placement + Shop tab: moved search below the Recap/MEP/Shop selector (was inside the header); added a Shop tab (placeholder for now, listed above for what it should become)

- Ingredient separators: "+ Add separator" in the edit form inserts a labeled section divider (e.g. "For the sauce") into the ingredients list — drags/reorders alongside real ingredients, shown distinctly in the recipe view, excluded from ingredient counts and the MEP After list
