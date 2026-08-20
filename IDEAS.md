# WIP Features/Changes

Drop anything here — one line or a whole paragraph, doesn't need to be polished.
When you want one built, just point me at it (or say "build the next one").

- Changes sort name: Change container sorting by color sorting (which is the same idea but a different name)

- Ingredients input of recipe edit view: 
    - Can you also make it apply or force some sort of norm (like "Butter Sliced" type of norm) so the list looks more consistent and professional
    - Make it show the list of similar ingredient or some sort of autofilling proposal so it's easier to add ingredient that is present in another recipe    

- Recipe edit view: I want to be able to change the two colors we have for each ingredient (one is for the container color, which is used in the recap view and the after mep list, and the other which is more about the time needed to prep them so it sort it out, that will be used for the before mep list)

- Data structure: Want to work on something that could scale later on :
    - maybe something more "proper" like a table for recipes, for the recap view, that has ingredients linked into another table for them that will be used for the mep list
    - a table for the mep before list would be cleaner i think

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

- MEP list / edit view: each ingredient row in the edit form now has a toggle (next to the unit dropdown) to include or exclude it from MEP — on by default, tap to exclude things that never need prepping (e.g. salt, water). The MEP After list respects it, only showing ingredients still marked for MEP.

- Shared MEP toggle: excluding an ingredient (e.g. "Beurre") now applies everywhere that name is used, not just the recipe you toggled it from — moved from a per-recipe flag to one shared synced list, same pattern as the before-list. Existing per-recipe exclusions were migrated automatically on first load.

- MEP container colors: Before-list items have a color swatch (the same 8-color palette used on recipe ingredients) marking which container/bin they go in — new items inherit the color from their recipe ingredient as a starting default, editable afterward independent of the recipe. Added a sort toggle to the Before list ("Order added" / "By container") to group prepped items by that color. Time-limit/expiry tracking per item was discussed but held off for now.

- MEP After sort: added the same "By container" sort toggle to the After tab (alongside its default Alphabetical order), grouping the source ingredient list by the recipe's color tag — same palette-order grouping logic as the Before list, so the two stay consistent.

- Edit recipe from MEP After list: tapping an ingredient's name in the After tab opens a small popover listing every recipe that uses it — tap one to jump straight into its edit form. Shown consistently even when only one recipe matches, so the interaction never changes shape.

- MEP Before list: removed the unit dropdown from each row (qty field stays) — it wasn't pulling its weight next to the free-text amount.

- MEP After list: the color dot is now an editable swatch button, same as the Before list's — changing it there updates that ingredient's container color across every recipe that uses it. Colors already set on Before-list items stay independent once added, as before.

- Duplicate ingredient detection: the After tab now flags likely-duplicate ingredient names it wouldn't already merge on its own — accents, extra spaces, or a trailing French/English plural "s" (e.g. "Ciboulette" vs "Ciboulettes"). A banner appears when any are found; tapping it opens a review list per group, pick which spelling to keep and merge — renames the ingredient in every recipe that uses it, and folds matching Before-list items / MEP exclusions into the kept spelling too.

- MEP After quick rename: tapping an ingredient's name in the After list now shows a "Rename" entry above the recipe-jump list — fixes a single typo directly (prompts for the new spelling, renames it everywhere) without going through the full duplicate-merge review flow.
