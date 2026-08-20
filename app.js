// app.js — all UI logic for The Rail

let recipes = [];
let searchTerm = '';
let expandedCardId = null;
let openCardMenuId = null;

let activeView = 'recap';
let mepMode = 'before';

// MEP Before list, schema v2: one document per item (mepBeforeItems),
// referencing a canonical ingredient by id rather than embedding its own
// name/color. Drives the Before list UI and the After list's "already
// added" check.
let mepBefore = [];
let mepBeforeItemsEverLoaded = false;

// The legacy mep/beforeList array-doc. No longer read by any UI — kept
// loaded only to feed maybeMigrateSchemaV2 (PR 1) and the one-time resync
// below (PR 4), both one-shot migrations into the new collections.
let legacyMepBeforeItems = [];
let legacyMepBeforeEverLoaded = false;

// Ingredient names excluded from MEP everywhere they appear, not just in
// one recipe — see toggleMepExclusion(). mepExclusionsDocExists tracks
// whether the shared doc exists yet, so the one-time migration below only
// ever runs once (recipesEverLoaded/mepMigrationDone gate the same thing).
let mepExcludedNames = [];
let mepExclusionsDocExists = null;
let recipesEverLoaded = false;
let mepMigrationDone = false;
let schemaV2MigrationStarted = false;
let ingredientsEverLoaded = false;
let schemaV2BackfillStarted = false;
let schemaV2BeforeSyncStarted = false;

// Schema v2 canonical ingredient records (see IDEAS.md "Data structure").
// Recap, the recipe edit form, and the MEP After/Before lists all read
// and write through these now — see resolveIngredientDisplay below for
// how recipe docs that still carry only the legacy embedded name/color
// (not yet resaved through the new form path) keep displaying correctly.
let ingredients = [];
let ingredientsById = new Map();

const cardList = document.getElementById('cardList');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const searchWrap = document.getElementById('searchWrap');
const stationTabs = document.getElementById('stationTabs');
const addBtn = document.getElementById('addBtn');

const viewTabs = document.getElementById('viewTabs');
const recapView = document.getElementById('recapView');
const mepView = document.getElementById('mepView');
const shopView = document.getElementById('shopView');
const mepModeTabs = document.getElementById('mepModeTabs');
const mepSortTabs = document.getElementById('mepSortTabs');
const mepAfterSortTabs = document.getElementById('mepAfterSortTabs');
const mepBeforeListEl = document.getElementById('mepBeforeList');
const mepAfterListEl = document.getElementById('mepAfterList');

const STATION_ORDER = ['starters', 'mains', 'desserts'];

const formOverlay = document.getElementById('formOverlay');
const recipeForm = document.getElementById('recipeForm');
const formTitle = document.getElementById('formTitle');
const formClose = document.getElementById('formClose');
const fDelete = document.getElementById('fDelete');
const ingredientRows = document.getElementById('ingredientRows');
const addIngredientBtn = document.getElementById('addIngredient');
const addSeparatorBtn = document.getElementById('addSeparator');
const stepRows = document.getElementById('stepRows');
const addStepBtn = document.getElementById('addStep');
const photoThumbs = document.getElementById('photoThumbs');
const fPhotoInput = document.getElementById('fPhotoInput');

const lightboxOverlay = document.getElementById('lightboxOverlay');
const lightboxImg = document.getElementById('lightboxImg');

const dupBanner = document.getElementById('dupBanner');
const dupOverlay = document.getElementById('dupOverlay');
const dupClose = document.getElementById('dupClose');
const dupList = document.getElementById('dupList');

// Photo state for the form currently open. originalPhotoPaths tracks what's
// actually persisted on the recipe, so we know which Storage deletes are
// safe to do immediately (never-saved uploads) vs. must wait until Save is
// confirmed (removing an already-saved photo) or be undone on cancel.
let formPhotos = [];
let originalPhotoPaths = new Set();
let pendingDeletePaths = [];
let formSaved = false;

const CAT_LABELS = {
  starters: 'Starters',
  mains: 'Mains',
  desserts: 'Desserts'
};

const UNITS = ['gr', 'kg', 'L', 'mL', 'CaS', 'CaC', 'pincée', 'pièce', 'botte', 'None'];

const INGREDIENT_COLORS = ['#E85D4C', '#FFB627', '#F5D547', '#6FCF6F', '#4ECDC4', '#3EA8FF', '#9B7EDE', '#E87EC0'];
let openColorPickerRow = null;

function uid() {
  return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function showToast(msg, duration = 2000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(showToast._hideTimer);
  showToast._hideTimer = setTimeout(() => { t.hidden = true; }, duration);
}

// Surfaces otherwise-silent JS errors as a toast — useful for diagnosing
// issues on devices we can't attach devtools to.
window.addEventListener('error', (e) => {
  showToast('Error: ' + e.message, 6000);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason && e.reason.message ? e.reason.message : String(e.reason);
  showToast('Error: ' + reason, 6000);
});

function loadRecipes() {
  RailDB.onChange((data) => {
    recipes = data;
    recipesEverLoaded = true;
    render();
    if (activeView === 'mep' && mepMode === 'after') renderMep();
    maybeMigrateLegacyMepFlags();
    maybeMigrateSchemaV2();
    maybeBackfillIngredientIds();
  });
}

function loadMepBeforeItems() {
  RailDB.onChangeMepBeforeItems((items) => {
    mepBefore = items;
    mepBeforeItemsEverLoaded = true;
    if (activeView === 'mep') renderMep();
    maybeSyncMepBeforeItems();
  });
}

function loadLegacyMepBefore() {
  RailDB.onChangeMepList((items) => {
    legacyMepBeforeItems = items;
    legacyMepBeforeEverLoaded = true;
    maybeMigrateSchemaV2();
    maybeSyncMepBeforeItems();
  });
}

function loadIngredients() {
  RailDB.onChangeIngredients((data) => {
    ingredients = data;
    ingredientsById = new Map(data.map(i => [i.id, i]));
    ingredientsEverLoaded = true;
    render();
    syncAllMepButtons();
    if (activeView === 'mep') renderMep();
    maybeBackfillIngredientIds();
    maybeSyncMepBeforeItems();
  });
}

// Resolves a recipe's embedded ingredient entry to a display-ready
// {name, color} pair. Prefers the canonical ingredients/{id} record via
// ingredientId (schema v2); falls back to the legacy embedded fields for
// any recipe not yet resaved through the new write path below — both
// shapes coexist on recipe docs during the rollout (see the submit
// handler's comment for why).
function resolveIngredientDisplay(ing) {
  const canonical = ing.ingredientId ? ingredientsById.get(ing.ingredientId) : null;
  return {
    name: canonical ? canonical.name : (ing.name || ''),
    color: canonical ? (canonical.color || '') : (ing.color || '')
  };
}

function isMepExcluded(name) {
  return mepExcludedNames.includes((name || '').trim().toLowerCase());
}

function loadMepExclusions() {
  RailDB.onChangeMepExclusions((names, exists) => {
    mepExcludedNames = names;
    mepExclusionsDocExists = exists;
    maybeMigrateLegacyMepFlags();
    maybeMigrateSchemaV2();
    syncAllMepButtons();
    if (activeView === 'mep' && mepMode === 'after') renderMepAfter();
  });
}

// ---- Schema v2 migration (see IDEAS.md "Data structure") ----
// Builds the new canonical `ingredients` collection and per-item
// `mepBeforeItems` docs from the current embedded/array-doc data, purely
// additively — nothing here rewrites a recipe doc or the old mep/beforeList
// doc, so the rest of the app keeps reading/writing exactly as it does
// today until later work switches those paths over to the new collections.
//
// Runs once per deploy (guarded by the schemaV2 migration doc's existence),
// after recipes, the before list, and the exclusion list have all loaded at
// least once — registerIngredient needs isMepExcluded, which needs the
// exclusion list. Like the legacy-mep-flag migration above, this doesn't
// guard against two devices racing to run it the very first time; at this
// app's scale (one small team, one migration, one-time) that's an accepted
// risk rather than something worth a distributed lock for.
async function maybeMigrateSchemaV2() {
  if (schemaV2MigrationStarted) return;
  if (!recipesEverLoaded || !legacyMepBeforeEverLoaded || mepExclusionsDocExists === null) return;
  schemaV2MigrationStarted = true;
  if (await RailDB.isSchemaV2Migrated()) return;

  // Dedupe by fuzzyKey (the same folding the duplicate-detection banner
  // uses) so migration doesn't reintroduce spelling variants as separate
  // ingredients. First-seen name/color wins as the canonical record.
  const byFuzzy = new Map();
  const existingToFuzzy = new Map();

  function registerIngredient(name, color, mepIncluded) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const fk = fuzzyKey(trimmed);
    if (!byFuzzy.has(fk)) {
      byFuzzy.set(fk, {
        id: uid(),
        name: trimmed,
        color: color || '',
        prepColor: '',
        mep: mepIncluded !== false,
        defaultUnit: ''
      });
    }
    existingToFuzzy.set(existingKey(trimmed), fk);
    return byFuzzy.get(fk);
  }

  recipes.forEach(r => realIngredients(r).forEach(ing => {
    registerIngredient(ing.name, ing.color, !isMepExcluded(ing.name));
  }));
  // Also fold in Before-list items with no recipe left using that name
  // (e.g. added once, the recipe since deleted) — they still need a
  // canonical ingredient record so the migrated mepBeforeItems doc has an
  // ingredientId to point at.
  legacyMepBeforeItems.forEach(item => registerIngredient(item.name, item.color, true));

  await Promise.all([...byFuzzy.values()].map(ing => RailDB.putIngredient(ing)));

  await Promise.all(legacyMepBeforeItems.map(item => {
    const canonical = byFuzzy.get(existingToFuzzy.get(existingKey(item.name)));
    return RailDB.putMepBeforeItem({
      id: item.id,
      ingredientId: canonical.id,
      amount: item.amount || '',
      unit: item.unit || '',
      addedAt: Date.now()
    });
  }));

  await RailDB.markSchemaV2Migrated();
}

// Follow-up to maybeMigrateSchemaV2 above: that one populates the
// `ingredients` collection without touching recipe docs at all, so most
// existing recipes only get an `ingredientId` the next time someone
// happens to open and save them through the new edit-form path (PR 2).
// The MEP After list (this PR) needs every recipe ingredient to already
// have one to resolve against, so this pass attaches it everywhere it's
// still missing — matched against the canonical records by the same
// fuzzyKey folding, additive only (never touches name/amount/unit/color,
// never bumps updatedAt). Guarded the same way: waits for recipes and the
// canonical ingredients to have loaded at least once, runs once, and bails
// out without marking itself done if `ingredients` is still empty (e.g. a
// brand-new install where maybeMigrateSchemaV2 hasn't populated it yet) so
// it naturally retries on the next relevant load instead of silently
// completing having done nothing.
async function maybeBackfillIngredientIds() {
  if (schemaV2BackfillStarted) return;
  if (!recipesEverLoaded || !ingredientsEverLoaded) return;
  if (!ingredients.length) return;
  schemaV2BackfillStarted = true;
  if (await RailDB.isIngredientIdBackfillDone()) return;

  const byFuzzy = new Map();
  ingredients.forEach(ing => byFuzzy.set(fuzzyKey(ing.name), ing));

  const updates = [];
  recipes.forEach(r => {
    let changed = false;
    const nextIngredients = (r.ingredients || []).map(ing => {
      if (ing.type === 'separator' || ing.ingredientId) return ing;
      const canonical = byFuzzy.get(fuzzyKey(ing.name || ''));
      if (!canonical) return ing; // shouldn't happen — every recipe ingredient was registered by maybeMigrateSchemaV2 — but don't crash if it does
      changed = true;
      return { ...ing, ingredientId: canonical.id };
    });
    if (changed) updates.push({ ...r, ingredients: nextIngredients });
  });

  await Promise.all(updates.map(r => RailDB.put(r)));
  await RailDB.markIngredientIdBackfillDone();
}

// One-time resync (PR 4): maybeMigrateSchemaV2 above seeded mepBeforeItems
// once from whatever the legacy mep/beforeList doc held at that moment,
// but nothing kept the two in sync afterward — PR 2/3 never touched the
// Before list, so any add/remove/edit made through the old UI between
// that migration and this PR's deploy only reached the legacy doc. This
// pass makes mepBeforeItems authoritative again: removes any
// mepBeforeItems doc no longer present in the legacy list, and
// creates/updates one for every current legacy item (matching or creating
// a canonical ingredient the same way the other migrations do — items are
// processed sequentially so two legacy items needing the same new
// ingredient don't create it twice). After this, the Before list reads
// and writes mepBeforeItems exclusively; the legacy doc stays loaded only
// to feed this one-time pass.
async function maybeSyncMepBeforeItems() {
  if (schemaV2BeforeSyncStarted) return;
  if (!legacyMepBeforeEverLoaded || !mepBeforeItemsEverLoaded || !ingredientsEverLoaded) return;
  schemaV2BeforeSyncStarted = true;
  if (await RailDB.isMepBeforeSynced()) return;

  const currentLegacyIds = new Set(legacyMepBeforeItems.map(i => i.id));
  const staleDocs = mepBefore.filter(i => !currentLegacyIds.has(i.id));
  await Promise.all(staleDocs.map(i => RailDB.removeMepBeforeItem(i.id)));

  for (const item of legacyMepBeforeItems) {
    let canonical = ingredients.find(i => existingKey(i.name) === existingKey(item.name));
    if (!canonical) {
      canonical = { id: uid(), name: (item.name || '').trim(), color: item.color || '', prepColor: '', mep: true, defaultUnit: '' };
      await RailDB.putIngredient(canonical);
      ingredients.push(canonical);
      ingredientsById.set(canonical.id, canonical);
    }
    await RailDB.putMepBeforeItem({
      id: item.id,
      ingredientId: canonical.id,
      amount: item.amount || '',
      unit: item.unit || '',
      addedAt: Date.now()
    });
  }

  await RailDB.markMepBeforeSynced();
}

// One-time migration from the old per-recipe-ingredient `mep: false` flag
// (which couldn't be shared across recipes) to the new shared exclusion
// list. Waits for both the exclusions doc's existence and the recipes to
// be known before deciding — whichever of the two listeners fires first
// just records its half and returns.
function maybeMigrateLegacyMepFlags() {
  if (mepMigrationDone) return;
  if (mepExclusionsDocExists === null || !recipesEverLoaded) return;
  mepMigrationDone = true;
  if (mepExclusionsDocExists) return; // already has a real doc — nothing to migrate

  const legacy = new Set();
  recipes.forEach(r => (r.ingredients || []).forEach(ing => {
    if (ing.mep === false && ing.name) legacy.add(ing.name.trim().toLowerCase());
  }));
  if (legacy.size) {
    mepExcludedNames = [...legacy];
    RailDB.setMepExclusions(mepExcludedNames);
  }
}

function filteredRecipes() {
  return recipes.filter(r => {
    if (!searchTerm) return true;
    const ingredientNames = realIngredients(r).map(i => resolveIngredientDisplay(i).name);
    const hay = (r.name + ' ' + ingredientNames.join(' ')).toLowerCase();
    return hay.includes(searchTerm.toLowerCase());
  });
}

// Separators are section labels mixed into the ingredients array, not
// real ingredients — exclude them from counts.
function realIngredients(r) {
  return (r.ingredients || []).filter(i => i.type !== 'separator');
}

function render() {
  const list = filteredRecipes();
  cardList.innerHTML = '';
  emptyState.hidden = list.length > 0;

  STATION_ORDER.forEach(cat => {
    const group = list
      .filter(r => r.category === cat)
      .sort((a, b) => realIngredients(b).length - realIngredients(a).length || a.name.localeCompare(b.name));
    if (!group.length) return;

    const header = document.createElement('div');
    header.className = 'station-section-header';
    header.id = 'section-' + cat;
    header.textContent = CAT_LABELS[cat] || cat;
    cardList.appendChild(header);

    group.forEach(r => cardList.appendChild(buildCard(r)));
  });
}

function buildCard(r) {
  const thumbUrl = r.photos && r.photos[0] ? r.photos[0].url : null;
  const ingredientsHtml = (r.ingredients || []).map(ingredientLiHtml).join('');

  // Native <details>/<summary> instead of a hand-rolled JS/CSS toggle:
  // the browser owns the open/close state and layout reflow, which
  // sidesteps a class of real-world rendering bugs a custom height
  // toggle kept hitting on at least one device.
  const card = document.createElement('details');
  card.className = 'recipe-card';
  card.innerHTML = `
    <summary class="card-main">
      ${thumbUrl ? `<img class="card-thumb" src="${escapeHtml(thumbUrl)}" alt="" loading="lazy">` : ''}
      <div class="card-body">
        <div class="card-top">
          <h3 class="card-name">${escapeHtml(r.name)}</h3>
          <span class="card-cat">${CAT_LABELS[r.category] || r.category}</span>
        </div>
        <div class="card-meta">${realIngredients(r).length} ingredients</div>
        ${r.notes ? `<span class="card-notes">${escapeHtml(r.notes)}</span>` : ''}
      </div>
      <div class="card-menu-wrap">
        <button type="button" class="card-menu-btn" aria-label="Recipe actions">&#8942;</button>
        <div class="card-menu" hidden>
          <button type="button" class="card-menu-edit">Edit</button>
          <button type="button" class="card-menu-delete">Delete</button>
        </div>
      </div>
    </summary>
    <div class="card-accordion-inner">
      <ul class="ingredient-list">${ingredientsHtml || '<li>No ingredients listed</li>'}</ul>
      <button type="button" class="card-view-full">View full recipe &rarr;</button>
    </div>
  `;

  card.addEventListener('toggle', () => {
    if (card.open) {
      cardList.querySelectorAll('details.recipe-card[open]').forEach(other => {
        if (other !== card) other.open = false;
      });
      expandedCardId = r.id;
    } else if (expandedCardId === r.id) {
      expandedCardId = null;
    }
  });
  card.querySelector('.card-menu-btn').addEventListener('click', (e) => {
    e.preventDefault(); // don't let the native <summary> toggle fire
    e.stopPropagation();
    toggleCardMenu(card, r.id);
  });
  card.querySelector('.card-menu-edit').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeCardMenu();
    openForm(r.id);
  });
  card.querySelector('.card-menu-delete').addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeCardMenu();
    await deleteRecipeById(r.id, r.photos);
  });
  card.querySelector('.card-view-full').addEventListener('click', (e) => {
    e.stopPropagation();
    openForm(r.id);
  });

  if (r.id === openCardMenuId) card.querySelector('.card-menu').hidden = false;
  if (r.id === expandedCardId) card.open = true;

  return card;
}

function toggleCardMenu(card, id) {
  const wasOpen = openCardMenuId === id;
  closeCardMenu();
  if (!wasOpen) {
    card.querySelector('.card-menu').hidden = false;
    openCardMenuId = id;
  }
}

function closeCardMenu() {
  cardList.querySelectorAll('.card-menu').forEach(el => { el.hidden = true; });
  openCardMenuId = null;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.card-menu-wrap')) closeCardMenu();
});

async function deleteRecipeById(id, photos) {
  if (!confirm('Delete this recipe for good?')) return false;
  await Promise.all((photos || []).map(p => RailDB.deletePhoto(p.path)));
  await RailDB.remove(id);
  showToast('Recipe deleted');
  return true;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function ingredientLiHtml(ing) {
  if (ing.type === 'separator') {
    return `<li class="ingredient-separator">${escapeHtml(ing.name)}</li>`;
  }
  const { name, color } = resolveIngredientDisplay(ing);
  const qty = ing.amount ? ing.amount + ' ' + escapeHtml(ing.unit || '') : '';
  const dot = color ? `<span class="ing-dot" style="background:${color}"></span>` : '';
  return `<li><span class="ing-name-wrap">${dot}${escapeHtml(name)}</span><span class="ingredient-qty">${qty}</span></li>`;
}

// ---- Station tabs (scroll-to-section anchors, not filters) ----
stationTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  const cat = btn.dataset.cat;
  if (cat === 'all') {
    cardList.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const section = document.getElementById('section-' + cat);
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---- Top-level view tabs (Recap / MEP / Shop) ----
viewTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.view-tab');
  if (!btn) return;
  activeView = btn.dataset.view;
  [...viewTabs.children].forEach(t => t.classList.toggle('active', t === btn));
  recapView.hidden = activeView !== 'recap';
  mepView.hidden = activeView !== 'mep';
  shopView.hidden = activeView !== 'shop';
  searchWrap.hidden = activeView !== 'recap';
  addBtn.hidden = activeView !== 'recap';
  if (activeView === 'mep') renderMep();
});

// ---- MEP mode tabs (Before / After) ----
mepModeTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.mep-mode-tab');
  if (!btn) return;
  mepMode = btn.dataset.mode;
  [...mepModeTabs.children].forEach(t => t.classList.toggle('active', t === btn));
  renderMep();
});

function renderMep() {
  mepBeforeListEl.hidden = mepMode !== 'before';
  mepAfterListEl.hidden = mepMode !== 'after';
  mepSortTabs.hidden = mepMode !== 'before';
  mepAfterSortTabs.hidden = mepMode !== 'after';
  if (mepMode === 'before') { updateDupBanner(); renderMepBefore(); }
  else renderMepAfter();
}

// Palette position of a container color, for sorting groups in a stable,
// consistent order; no-color items sort last. Shared by both the Before
// and After "By color" sorts.
function colorSortIndex(color) {
  const i = INGREDIENT_COLORS.indexOf(color);
  return i === -1 ? INGREDIENT_COLORS.length : i;
}

// A Before item's color always comes from its canonical ingredient now —
// editing it (see renderMepBefore) is "everywhere", same as the After
// list's color button, since color no longer has anywhere per-item to
// live independently.
function beforeItemColor(item) {
  const canonical = ingredientsById.get(item.ingredientId);
  return canonical ? (canonical.color || '') : '';
}

// 'added' keeps Firestore array order (insertion order); 'container'
// groups items by their color tag, in palette order, with no-container
// items last. Not persisted — purely a local view preference.
let mepBeforeSort = 'added';

function sortedMepBefore() {
  if (mepBeforeSort !== 'container') return mepBefore;
  return [...mepBefore].sort((a, b) => colorSortIndex(beforeItemColor(a)) - colorSortIndex(beforeItemColor(b)));
}

mepSortTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.mep-sort-tab');
  if (!btn) return;
  mepBeforeSort = btn.dataset.sort;
  [...mepSortTabs.children].forEach(t => t.classList.toggle('active', t === btn));
  renderMepBefore();
});

function renderMepBefore() {
  mepBeforeListEl.innerHTML = '';
  if (!mepBefore.length) {
    mepBeforeListEl.innerHTML = '<div class="mep-empty">Nothing to prep yet.<br>Add ingredients from the After tab.</div>';
    return;
  }

  sortedMepBefore().forEach(item => {
    const canonical = ingredientsById.get(item.ingredientId);
    const name = canonical ? canonical.name : '';
    const color = canonical ? (canonical.color || '') : '';

    const row = document.createElement('div');
    row.className = 'mep-row';
    row.innerHTML = `
      <button type="button" class="mep-check" aria-label="Mark prepped">&#10003;</button>
      <button type="button" class="ing-color-btn" aria-label="Set container color" style="${color ? `background:${color}` : ''}"></button>
      <span class="mep-row-name">${escapeHtml(name)}</span>
      <input type="text" class="ing-amount" placeholder="Qty" value="${escapeHtml(item.amount || '')}">
      <button type="button" class="mep-row-remove" aria-label="Remove">&times;</button>
    `;

    row.querySelector('.mep-check').addEventListener('click', () => removeFromBeforeList(item.id));
    row.querySelector('.mep-row-remove').addEventListener('click', () => removeFromBeforeList(item.id));
    row.querySelector('.ing-amount').addEventListener('change', (e) => {
      updateBeforeItem(item.id, { amount: e.target.value.trim() });
    });
    row.querySelector('.ing-color-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleColorPicker(row, color, (newColor) => {
        if (canonical) RailDB.putIngredient({ ...canonical, color: newColor });
      });
    });

    mepBeforeListEl.appendChild(row);
  });
}

// Which recipes use each canonical ingredient, plus a display unit (the
// first non-empty embedded unit found, matching the pre-schema-v2
// behavior) — the shared basis for both the After list and duplicate
// detection below. Ingredients with no ingredientId reference yet (not
// backfilled/resaved) are invisible here; maybeBackfillIngredientIds
// closes that gap for existing recipes shortly after load.
function ingredientUsage() {
  const map = new Map();
  recipes.forEach(r => {
    realIngredients(r).forEach(ing => {
      if (!ing.ingredientId) return;
      if (!map.has(ing.ingredientId)) map.set(ing.ingredientId, { recipeIds: new Set(), unit: '' });
      const usage = map.get(ing.ingredientId);
      usage.recipeIds.add(r.id);
      if (!usage.unit && ing.unit) usage.unit = ing.unit;
    });
  });
  return map;
}

function aggregatedIngredients() {
  const usage = ingredientUsage();
  return ingredients
    .filter(ing => ing.mep !== false && usage.has(ing.id))
    .map(ing => {
      const u = usage.get(ing.id);
      return { id: ing.id, name: ing.name, color: ing.color || '', unit: u.unit, recipeIds: [...u.recipeIds] };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// 'name' is aggregatedIngredients()'s default alphabetical order;
// 'container' groups by color in palette order, no-color items last. Not
// persisted — purely a local view preference, same as mepBeforeSort.
let mepAfterSort = 'name';

function sortedAfterItems(items) {
  if (mepAfterSort !== 'container') return items;
  return [...items].sort((a, b) => colorSortIndex(a.color) - colorSortIndex(b.color));
}

mepAfterSortTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.mep-sort-tab');
  if (!btn) return;
  mepAfterSort = btn.dataset.sort;
  [...mepAfterSortTabs.children].forEach(t => t.classList.toggle('active', t === btn));
  renderMepAfter();
});

function renderMepAfter() {
  mepAfterListEl.innerHTML = '';
  openIngredientPickerRow = null;
  updateDupBanner();
  const items = sortedAfterItems(aggregatedIngredients());
  if (!items.length) {
    mepAfterListEl.innerHTML = '<div class="mep-empty">No ingredients yet.<br>Add some recipes on the Recap tab first.</div>';
    return;
  }

  items.forEach(ing => {
    const already = mepBefore.some(i => i.ingredientId === ing.id);

    const row = document.createElement('div');
    row.className = 'mep-add-row';
    row.innerHTML = `
      <button type="button" class="ing-color-btn" aria-label="Set container color" style="${ing.color ? `background:${ing.color}` : ''}"></button>
      <span class="mep-add-name clickable">${escapeHtml(ing.name)}</span>
      <button type="button" class="mep-add-btn" ${already ? 'disabled' : ''} aria-label="Add to prep list">${already ? '&check;' : '+'}</button>
    `;
    row.querySelector('.mep-add-name').addEventListener('click', (e) => {
      e.stopPropagation();
      const matches = recipes.filter(r => ing.recipeIds.includes(r.id));
      toggleIngredientRecipePicker(row, matches, ing);
    });
    row.querySelector('.ing-color-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleColorPicker(row, ing.color || '', (color) => RailDB.putIngredient({ ...ingredientsById.get(ing.id), color }));
    });
    if (!already) {
      row.querySelector('.mep-add-btn').addEventListener('click', () => addToBeforeList(ing.id, ing.unit));
    }
    mepAfterListEl.appendChild(row);
  });
}

// ---- Possible-duplicate ingredient detection ----
// Schema v2 identifies an ingredient by canonical id, not by name string,
// so exact-name duplicates can't recur once merged — but
// resolveIngredientIdForRow only matches by *exact* name, so two rows
// typed as slightly different spellings ("Ciboulette" / "Ciboulettes")
// still create two separate canonical records. fuzzyKey folds away
// accents, doubled-up whitespace, and a trailing French/English plural
// "s", purely to *detect* likely near-misses among canonical ingredients —
// existingKey (exact match) stays what the rest of the app treats as
// identical.
function existingKey(name) {
  return (name || '').trim().toLowerCase();
}

function stripAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function fuzzyKey(name) {
  let s = stripAccents(existingKey(name)).replace(/\s+/g, ' ');
  if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

// Groups canonical ingredients (that are actually in use — see
// ingredientUsage) by fuzzyKey. Only groups with 2+ ingredients are real
// candidates; a lone ingredient isn't a duplicate of anything.
function findDuplicateGroups() {
  const usage = ingredientUsage();
  const byFuzzy = new Map();
  ingredients.forEach(ing => {
    if (!usage.has(ing.id)) return;
    const fk = fuzzyKey(ing.name);
    if (!byFuzzy.has(fk)) byFuzzy.set(fk, []);
    const u = usage.get(ing.id);
    byFuzzy.get(fk).push({
      id: ing.id,
      name: ing.name,
      count: u.recipeIds.size,
      recipeNames: [...u.recipeIds].map(rid => recipes.find(r => r.id === rid)).filter(Boolean).map(r => r.name)
    });
  });

  return [...byFuzzy.values()]
    .filter(group => group.length > 1)
    .map(group => group.sort((a, b) => b.count - a.count))
    .sort((a, b) => a[0].name.localeCompare(b[0].name));
}

function updateDupBanner() {
  if (!(activeView === 'mep' && mepMode === 'after')) { dupBanner.hidden = true; return; }
  const groups = findDuplicateGroups();
  if (!groups.length) { dupBanner.hidden = true; return; }
  dupBanner.hidden = false;
  dupBanner.textContent = `⚠ ${groups.length} possible duplicate ingredient${groups.length > 1 ? 's' : ''} — Review`;
}

dupBanner.addEventListener('click', () => {
  renderDupList();
  pushOverlayState();
  dupOverlay.hidden = false;
});
dupClose.addEventListener('click', closeOverlay);

function renderDupList() {
  const groups = findDuplicateGroups();
  dupList.innerHTML = '';
  if (!groups.length) {
    dupList.innerHTML = '<div class="mep-empty">No duplicates found.<br>Nice and tidy.</div>';
    return;
  }

  groups.forEach((group, idx) => {
    const card = document.createElement('div');
    card.className = 'dup-group';
    card.innerHTML = `
      <div class="dup-variants">
        ${group.map((v, i) => `
          <label class="dup-variant${i === 0 ? ' selected' : ''}">
            <input type="radio" name="dup-${idx}" value="${v.id}" ${i === 0 ? 'checked' : ''}>
            <span class="dup-variant-name">${escapeHtml(v.name)}</span>
            <span class="dup-variant-meta">${v.count} use${v.count > 1 ? 's' : ''} · ${escapeHtml(v.recipeNames.slice(0, 2).join(', '))}${v.recipeNames.length > 2 ? '…' : ''}</span>
          </label>
        `).join('')}
      </div>
      <button type="button" class="btn-secondary dup-merge-btn">Merge into one</button>
    `;
    card.querySelectorAll('.dup-variant input').forEach(input => {
      input.addEventListener('change', () => {
        card.querySelectorAll('.dup-variant').forEach(label => {
          label.classList.toggle('selected', label.querySelector('input').checked);
        });
      });
    });
    card.querySelector('.dup-merge-btn').addEventListener('click', async () => {
      const chosenId = card.querySelector(`input[name="dup-${idx}"]:checked`).value;
      const chosenName = group.find(v => v.id === chosenId).name;
      if (!confirm(`Merge these into "${chosenName}"? This repoints every recipe that uses one of the others.`)) return;
      await mergeIngredientVariants(group, chosenId);
      showToast(`Merged into "${chosenName}"`);
      renderDupList();
    });
    dupList.appendChild(card);
  });
}

// Merges `group` (canonical ingredient records from findDuplicateGroups,
// or a single-item group from quickRenameIngredient) into whichever one
// matches `keepId` — repoints every recipe ingredient entry referencing
// one of the others to keepId, then deletes the now-unused canonical
// docs. If the Before list has an item under one of the merged-away
// ingredients, repoints that too (or drops it, if a Before item for the
// kept ingredient already exists — no point prepping the same thing twice).
async function mergeIngredientVariants(group, keepId) {
  const staleIds = new Set(group.map(v => v.id).filter(gid => gid !== keepId));
  if (!staleIds.size) return;
  const keep = ingredientsById.get(keepId);

  const affected = recipes.filter(r => realIngredients(r).some(i => staleIds.has(i.ingredientId)));
  await Promise.all(affected.map(r => RailDB.put({
    ...r,
    ingredients: (r.ingredients || []).map(i =>
      i.type !== 'separator' && staleIds.has(i.ingredientId)
        ? { ...i, ingredientId: keepId, name: keep.name, color: keep.color }
        : i
    )
  })));

  const beforeItemsForStale = mepBefore.filter(i => staleIds.has(i.ingredientId));
  if (beforeItemsForStale.length) {
    if (mepBefore.some(i => i.ingredientId === keepId)) {
      await Promise.all(beforeItemsForStale.map(i => RailDB.removeMepBeforeItem(i.id)));
    } else {
      const [first, ...rest] = beforeItemsForStale;
      await RailDB.putMepBeforeItem({ ...first, ingredientId: keepId });
      await Promise.all(rest.map(i => RailDB.removeMepBeforeItem(i.id)));
    }
  }

  await Promise.all([...staleIds].map(sid => RailDB.deleteIngredient(sid)));
}

// Tapping an ingredient's name in the After list opens a small popover
// listing the recipe(s) it belongs to — tap one to jump straight into its
// edit form. Always shown (even for a single match) so the interaction is
// consistent regardless of how many recipes share the ingredient. A
// "Rename" entry sits above those — a quick fix for a lone typo, without
// going through the duplicate-merge review flow below.
let openIngredientPickerRow = null;

function toggleIngredientRecipePicker(row, recipeMatches, ing) {
  const alreadyOpenOnThisRow = openIngredientPickerRow === row;
  closeIngredientRecipePicker();
  if (alreadyOpenOnThisRow) return;

  const picker = document.createElement('div');
  picker.className = 'recipe-picker';
  picker.innerHTML = `
    <button type="button" class="recipe-picker-item recipe-picker-rename">&#9998; Rename</button>
    ${recipeMatches.map(r => `<button type="button" class="recipe-picker-item" data-id="${r.id}">${escapeHtml(r.name)}</button>`).join('')}
  `;
  picker.querySelector('.recipe-picker-rename').addEventListener('click', (e) => {
    e.stopPropagation();
    closeIngredientRecipePicker();
    quickRenameIngredient(ing);
  });
  picker.querySelectorAll('.recipe-picker-item[data-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeIngredientRecipePicker();
      openForm(btn.dataset.id);
    });
  });
  row.appendChild(picker);
  openIngredientPickerRow = row;
}

// A direct rename of the canonical ingredient (single-doc write) — the
// common case of fixing a lone typo with nothing else to fold in. Reuses
// mergeIngredientVariants with a single-item "group" so a rename that
// happens to collide with another existing ingredient's exact name still
// merges correctly instead of producing two ingredients with the same name.
async function quickRenameIngredient(ing) {
  const next = prompt('Rename ingredient', ing.name);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed || existingKey(trimmed) === existingKey(ing.name)) return;

  const collision = ingredients.find(i => i.id !== ing.id && existingKey(i.name) === existingKey(trimmed));
  if (collision) {
    await mergeIngredientVariants([{ id: ing.id, name: ing.name }, { id: collision.id, name: collision.name }], collision.id);
  } else {
    await RailDB.putIngredient({ ...ingredientsById.get(ing.id), name: trimmed });
  }
  showToast(`Renamed to "${trimmed}"`);
}

function closeIngredientRecipePicker() {
  if (!openIngredientPickerRow) return;
  const picker = openIngredientPickerRow.querySelector('.recipe-picker');
  if (picker) picker.remove();
  openIngredientPickerRow = null;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.recipe-picker') && !e.target.closest('.mep-add-name')) closeIngredientRecipePicker();
});

// Each doc is its own write now (mepBeforeItems), not a whole-array
// overwrite — two devices adding/editing/removing different items at once
// no longer clobber each other. Color isn't stored here at all: it always
// resolves from the canonical ingredient (see beforeItemColor), so there's
// nothing to inherit or keep independent — editing it is "everywhere",
// same as the After list's color button.
function addToBeforeList(ingredientId, unit) {
  if (mepBefore.some(i => i.ingredientId === ingredientId)) return;
  RailDB.putMepBeforeItem({ id: uid(), ingredientId, amount: '', unit: unit || '', addedAt: Date.now() });
}

function removeFromBeforeList(id) {
  RailDB.removeMepBeforeItem(id);
}

function updateBeforeItem(id, patch) {
  const item = mepBefore.find(i => i.id === id);
  if (!item) return;
  RailDB.putMepBeforeItem({ ...item, ...patch });
}

// ---- Search ----
searchInput.addEventListener('input', (e) => {
  searchTerm = e.target.value;
  render();
});

// ---- Overlay navigation (supports phone back button / swipe-back) ----
// Opening a recipe or the form pushes one history entry; the back button
// or gesture then closes it instead of leaving the app. The X buttons still
// work — they just go through history.back() so the state stays in sync.
function pushOverlayState() {
  if (!(history.state && history.state.railOverlay)) {
    history.pushState({ railOverlay: true }, '');
  }
}

function hideOverlays() {
  formOverlay.hidden = true;
  lightboxOverlay.hidden = true;
  dupOverlay.hidden = true;
}

function closeOverlay() {
  if (history.state && history.state.railOverlay) {
    history.back();
  } else {
    hideOverlays();
  }
}

// The lightbox always pushes its own history entry (even on top of an
// already-open form), so back-from-photo returns to the recipe view
// instead of skipping straight to the list.
function openLightbox(url) {
  lightboxImg.src = url;
  history.pushState({ railOverlay: true, railLightbox: true }, '');
  lightboxOverlay.hidden = false;
}

function closeLightbox() {
  history.back();
}

window.addEventListener('popstate', () => {
  if (history.state && history.state.railOverlay) {
    lightboxOverlay.hidden = true;
  } else {
    if (!formOverlay.hidden && !formSaved) {
      // Form is being abandoned without saving — purge any photos that
      // were uploaded this session but never got attached to a saved
      // recipe. Photos marked for removal (pendingDeletePaths) are left
      // alone in Storage since the recipe doc still references them.
      formPhotos.forEach(p => {
        if (!originalPhotoPaths.has(p.path)) RailDB.deletePhoto(p.path);
      });
    }
    hideOverlays();
  }
});

lightboxOverlay.addEventListener('click', closeLightbox);

// ---- Add / Edit form ----
addBtn.addEventListener('click', () => openForm());
formClose.addEventListener('click', closeOverlay);

function openForm(id) {
  recipeForm.reset();
  ingredientRows.innerHTML = '';
  stepRows.innerHTML = '';
  fDelete.hidden = true;
  formPhotos = [];
  originalPhotoPaths = new Set();
  pendingDeletePaths = [];
  formSaved = false;

  if (id) {
    const r = recipes.find(x => x.id === id);
    formTitle.textContent = 'Edit Recipe';
    document.getElementById('recipeId').value = r.id;
    document.getElementById('fName').value = r.name;
    document.getElementById('fCategory').value = r.category;
    document.getElementById('fNotes').value = r.notes || '';
    (r.ingredients || []).forEach(ing => {
      if (ing.type === 'separator') { addSeparatorRow(ing.name); return; }
      const { name, color } = resolveIngredientDisplay(ing);
      addIngredientRow(name, ing.amount, ing.unit, color, ing.ingredientId || null);
    });
    (r.steps || []).forEach(step => addStepRow(step));
    formPhotos = (r.photos || []).slice();
    originalPhotoPaths = new Set(formPhotos.map(p => p.path));
    fDelete.hidden = false;
  } else {
    formTitle.textContent = 'New Recipe';
    // Assign the id now (not at submit time) so photo uploads have a
    // stable folder to land in even before the recipe is first saved.
    document.getElementById('recipeId').value = uid();
    addIngredientRow();
    addStepRow();
  }

  renderPhotoThumbs();
  pushOverlayState();
  formOverlay.hidden = false;
}

function renderPhotoThumbs() {
  photoThumbs.innerHTML = '';
  formPhotos.forEach((photo, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'photo-thumb';
    thumb.innerHTML = `
      <img src="${escapeHtml(photo.url)}" alt="">
      <button type="button" class="thumb-remove" aria-label="Remove photo">&times;</button>
      <div class="thumb-reorder">
        <button type="button" class="thumb-left" aria-label="Move earlier" ${index === 0 ? 'disabled' : ''}>&larr;</button>
        <button type="button" class="thumb-right" aria-label="Move later" ${index === formPhotos.length - 1 ? 'disabled' : ''}>&rarr;</button>
      </div>
    `;
    thumb.querySelector('img').addEventListener('click', () => openLightbox(photo.url));
    thumb.querySelector('.thumb-left').addEventListener('click', () => {
      [formPhotos[index - 1], formPhotos[index]] = [formPhotos[index], formPhotos[index - 1]];
      renderPhotoThumbs();
    });
    thumb.querySelector('.thumb-right').addEventListener('click', () => {
      [formPhotos[index + 1], formPhotos[index]] = [formPhotos[index], formPhotos[index + 1]];
      renderPhotoThumbs();
    });
    thumb.querySelector('.thumb-remove').addEventListener('click', async () => {
      formPhotos.splice(index, 1);
      if (originalPhotoPaths.has(photo.path)) {
        // Already saved on the recipe — don't touch Storage until the
        // form is actually saved, in case this edit gets cancelled.
        pendingDeletePaths.push(photo.path);
      } else {
        await RailDB.deletePhoto(photo.path);
      }
      renderPhotoThumbs();
    });
    photoThumbs.appendChild(thumb);
  });
}

// KNOWN ISSUE: photo upload doesn't work on at least one Android phone —
// the picker opens, but no change/input event (nor even a raw alert())
// ever fires afterward. Tried: display:none vs visually-hidden input,
// JS .click() vs native <label for>, listening on both change and input.
// None of it reproduced or fixed it. Uploading from a PC works fine in
// the meantime. Revisit with a real device/remote-debugging session.
async function handlePhotoSelect() {
  const recipeId = document.getElementById('recipeId').value;
  const files = [...fPhotoInput.files];
  fPhotoInput.value = '';
  for (const file of files) {
    try {
      showToast('Uploading photo…');
      const photo = await RailDB.uploadPhoto(recipeId, file);
      formPhotos.push(photo);
      renderPhotoThumbs();
      showToast('Photo added');
    } catch (e) {
      showToast('Photo upload failed: ' + e.message);
    }
  }
}

// Listening on both events: some mobile browsers/webviews are inconsistent
// about which one fires for file inputs. Clearing .value after reading
// files means if both fire for the same selection, the second run just
// sees an empty FileList and no-ops.
fPhotoInput.addEventListener('change', handlePhotoSelect);
fPhotoInput.addEventListener('input', handlePhotoSelect);

// Ingredients and steps are read straight from DOM order at submit time,
// so reordering just moves the row element itself — no separate array to
// keep in sync.
function moveRow(row, direction) {
  if (direction === 'up' && row.previousElementSibling) {
    row.parentNode.insertBefore(row, row.previousElementSibling);
  } else if (direction === 'down' && row.nextElementSibling) {
    row.parentNode.insertBefore(row.nextElementSibling, row);
  }
}

// Drag-to-reorder via Pointer Events (unifies mouse/touch/pen, unlike the
// HTML5 drag-and-drop API which has poor touch support).
//
// The row only follows the pointer visually while dragging (a cheap
// transform, nothing else) — other rows don't shift and no DOM reordering
// happens until the drop, when the row's final position determines a
// single insert. Continuously reordering mid-drag was both expensive
// (forced-layout geometry reads on every pointermove) and felt twitchy;
// settling everything in one shot on release is both simpler and smoother.
//
// Tracking is done via document-level listeners added on pointerdown and
// removed on pointerup, instead of Element.setPointerCapture — more
// universally reliable than depending on capture semantics.
function makeDraggable(row, container) {
  const handle = row.querySelector('.drag-handle');
  let startY = 0;
  let originalTop = 0;
  let originalHeight = 0;
  let latestDeltaY = 0;

  function onMove(e) {
    latestDeltaY = e.clientY - startY;
    row.style.transform = `translateY(${latestDeltaY}px)`;
  }

  function onEnd() {
    row.classList.remove('dragging');
    row.style.transform = '';
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    document.removeEventListener('pointercancel', onEnd);

    const rowCenter = originalTop + originalHeight / 2 + latestDeltaY;
    const siblings = [...container.querySelectorAll('.ingredient-row')].filter(el => el !== row);
    const target = siblings.find(sib => {
      const sibRect = sib.getBoundingClientRect();
      return rowCenter < sibRect.top + sibRect.height / 2;
    });
    if (target) {
      container.insertBefore(row, target);
    } else {
      container.appendChild(row);
    }
  }

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startY = e.clientY;
    latestDeltaY = 0;
    const rect = row.getBoundingClientRect();
    originalTop = rect.top;
    originalHeight = rect.height;
    row.classList.add('dragging');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  });
}

function reorderButtonsHtml() {
  return `
    <div class="reorder-btns">
      <button type="button" class="row-up" aria-label="Move up">&uarr;</button>
      <button type="button" class="row-down" aria-label="Move down">&darr;</button>
    </div>
  `;
}

function wireReorderButtons(row) {
  row.querySelector('.row-up').addEventListener('click', () => moveRow(row, 'up'));
  row.querySelector('.row-down').addEventListener('click', () => moveRow(row, 'down'));
}

// `ingredientId` (schema v2) is the canonical ingredient this row was
// loaded as, if any — null for a brand-new row or one whose recipe hasn't
// been resaved through the new write path yet. Kept on the row's dataset,
// along with the name it was resolved from (boundName), so the submit
// handler can tell whether the row is still "the same ingredient" (typed
// name unchanged) or should look up/create a different one (typed name
// changed) — see resolveIngredientIdForRow.
function addIngredientRow(name = '', amount = '', unit = '', color = '', ingredientId = null) {
  const row = document.createElement('div');
  row.className = 'ingredient-row';
  row.dataset.color = color;
  row.dataset.ingredientId = ingredientId || '';
  row.dataset.boundName = name;
  // Local staging for a row not yet bound to any canonical ingredient
  // (new row, or typed name doesn't match an existing one) — used by
  // resolveIngredientIdForRow when it creates the new record on save.
  // Once bound, the canonical record's own `mep` field is the live source
  // (see syncMepButton) and this is ignored.
  row.dataset.mepIncluded = 'true';
  const unitOptions = UNITS.map(u => {
    const val = u === 'None' ? '' : u;
    return `<option value="${val}" ${unit === val ? 'selected' : ''}>${u}</option>`;
  }).join('');
  row.innerHTML = `
    <button type="button" class="ing-color-btn" aria-label="Set ingredient color" style="${color ? `background:${color}` : ''}"></button>
    <input type="text" placeholder="Ingredient" class="ing-name" value="${escapeHtml(name)}">
    <input type="text" placeholder="Qty" class="ing-amount" value="${escapeHtml(amount)}">
    <select class="ing-unit">${unitOptions}</select>
    <button type="button" class="ing-mep-btn" aria-label="Include in MEP prep list" title="Include in MEP — applies to this ingredient in every recipe"></button>
    <div class="drag-handle" aria-label="Drag to reorder"></div>
    <button type="button" class="row-remove" aria-label="Remove ingredient">&times;</button>
  `;
  makeDraggable(row, ingredientRows);
  row.querySelector('.row-remove').addEventListener('click', () => row.remove());
  row.querySelector('.ing-color-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleColorPicker(row, row.dataset.color || '', (color) => {
      row.dataset.color = color;
      row.querySelector('.ing-color-btn').style.background = color || '';
      // Once a row is bound to a canonical ingredient, its color is
      // shared everywhere that ingredient is used — same "everywhere"
      // semantics as the MEP After list's color button, since color now
      // lives on the canonical record rather than per-recipe. A row not
      // yet bound to an id (new/unmatched) just updates its own dataset;
      // the color reaches the canonical record when the row gets
      // resolved to an ingredientId on save.
      if (row.dataset.ingredientId) {
        const current = ingredientsById.get(row.dataset.ingredientId);
        if (current) RailDB.putIngredient({ ...current, color });
      }
    });
  });
  row.querySelector('.ing-mep-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const currentName = row.querySelector('.ing-name').value.trim();
    if (!currentName) return;
    const match = ingredients.find(i => existingKey(i.name) === existingKey(currentName));
    if (match) {
      const next = match.mep === false;
      RailDB.putIngredient({ ...match, mep: next });
      showToast(next ? 'Included in MEP again' : 'Excluded from MEP everywhere');
    } else {
      row.dataset.mepIncluded = row.dataset.mepIncluded === 'false' ? 'true' : 'false';
      syncMepButton(row);
    }
  });
  // The MEP toggle's state is keyed by ingredient name, not by this row —
  // re-sync it live as the name changes so typing "Salt" immediately shows
  // whatever the shared setting for "Salt" already is.
  row.querySelector('.ing-name').addEventListener('input', () => syncMepButton(row));
  ingredientRows.appendChild(row);
  syncMepButton(row);
}

function syncMepButton(row) {
  const name = row.querySelector('.ing-name').value.trim();
  const match = ingredients.find(i => existingKey(i.name) === existingKey(name));
  const included = match ? match.mep !== false : row.dataset.mepIncluded !== 'false';
  const btn = row.querySelector('.ing-mep-btn');
  btn.classList.toggle('active', included);
  btn.innerHTML = included ? '&#10003;' : '';
}

function syncAllMepButtons() {
  ingredientRows.querySelectorAll('.ing-mep-btn').forEach(btn => syncMepButton(btn.closest('.ingredient-row')));
}

// A separator is a section label mixed into the same ingredient-rows list
// (e.g. "For the sauce") rather than a real ingredient. It shares the
// .ingredient-row class and container so it rides along with the existing
// drag-to-reorder system for free — makeDraggable() and the submit-time
// DOM-order read don't need to know separators exist as a separate thing.
function addSeparatorRow(label = '') {
  const row = document.createElement('div');
  row.className = 'ingredient-row ingredient-row--separator';
  row.dataset.type = 'separator';
  row.innerHTML = `
    <input type="text" placeholder="Section label (e.g. For the sauce)" class="sep-label" value="${escapeHtml(label)}">
    <div class="drag-handle" aria-label="Drag to reorder"></div>
    <button type="button" class="row-remove" aria-label="Remove separator">&times;</button>
  `;
  makeDraggable(row, ingredientRows);
  row.querySelector('.row-remove').addEventListener('click', () => row.remove());
  ingredientRows.appendChild(row);
}

// Generic color-swatch picker, anchored to `row` (which must be
// position:relative). `currentColor` is the color to show pre-selected;
// `onSelect(color)` fires with the picked hex (or '' for "no color") and
// is left to decide how/where that gets persisted — the ingredient-row
// form field and a MEP row's synced Firestore item both reuse this.
function toggleColorPicker(row, currentColor, onSelect) {
  const alreadyOpenOnThisRow = openColorPickerRow === row;
  closeColorPicker();
  if (alreadyOpenOnThisRow) return;

  const picker = document.createElement('div');
  picker.className = 'color-picker';
  picker.innerHTML = `
    <button type="button" class="none-swatch" aria-label="No color">&times;</button>
    ${INGREDIENT_COLORS.map(c => `<button type="button" class="swatch${c === currentColor ? ' selected' : ''}" style="background:${c}" data-color="${c}" aria-label="Set color"></button>`).join('')}
  `;
  picker.querySelector('.none-swatch').addEventListener('click', (e) => {
    e.stopPropagation();
    onSelect('');
    closeColorPicker();
  });
  picker.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(btn.dataset.color);
      closeColorPicker();
    });
  });
  row.appendChild(picker);
  openColorPickerRow = row;
}

function closeColorPicker() {
  if (!openColorPickerRow) return;
  const picker = openColorPickerRow.querySelector('.color-picker');
  if (picker) picker.remove();
  openColorPickerRow = null;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.color-picker') && !e.target.closest('.ing-color-btn')) closeColorPicker();
});

addIngredientBtn.addEventListener('click', () => addIngredientRow());
addSeparatorBtn.addEventListener('click', () => addSeparatorRow());

function addStepRow(text = '') {
  const row = document.createElement('div');
  row.className = 'step-row';
  row.innerHTML = `
    <input type="text" placeholder="Step" class="step-text" value="${escapeHtml(text)}">
    ${reorderButtonsHtml()}
    <button type="button" class="row-remove" aria-label="Remove step">&times;</button>
  `;
  wireReorderButtons(row);
  row.querySelector('.row-remove').addEventListener('click', () => row.remove());
  stepRows.appendChild(row);
}

addStepBtn.addEventListener('click', () => addStepRow());

// Finds or creates the canonical ingredient a row should save against.
// If the row is still bound to the id it was loaded/resolved with (typed
// name unchanged, case-insensitively), reuses that id as-is. Otherwise —
// a brand-new row, or one whose text no longer matches what it was bound
// to — looks up an existing ingredient by exact name match, or creates a
// new canonical record. Renaming a shared ingredient (so it changes
// everywhere at once) is deliberately reserved for the MEP After list's
// Rename / duplicate-merge flows, not implicit here: typing a different
// name in a recipe's own form just points this row at a different
// ingredient, same as it always has.
async function resolveIngredientIdForRow(row) {
  const name = row.querySelector('.ing-name').value.trim();
  const color = row.dataset.color || '';
  const boundId = row.dataset.ingredientId || '';
  const boundName = row.dataset.boundName || '';

  if (boundId && existingKey(name) === existingKey(boundName)) {
    return boundId;
  }

  const existing = ingredients.find(i => existingKey(i.name) === existingKey(name));
  if (existing) return existing.id;

  const created = {
    id: uid(),
    name,
    color,
    prepColor: '',
    mep: row.dataset.mepIncluded !== 'false',
    defaultUnit: ''
  };
  await RailDB.putIngredient(created);
  ingredients.push(created);
  ingredientsById.set(created.id, created);
  return created.id;
}

recipeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('recipeId').value || uid();

  // Ingredient rows are resolved sequentially (not Promise.all) so that
  // typing the same brand-new name into two rows in this same save
  // reuses the first row's freshly-created ingredient instead of
  // creating a duplicate.
  const ingredientEntries = [];
  for (const row of [...ingredientRows.querySelectorAll('.ingredient-row')]) {
    if (row.dataset.type === 'separator') {
      const label = row.querySelector('.sep-label').value.trim();
      if (label) ingredientEntries.push({ type: 'separator', name: label });
      continue;
    }
    const name = row.querySelector('.ing-name').value.trim();
    if (!name) continue;
    const amount = row.querySelector('.ing-amount').value.trim();
    const unit = row.querySelector('.ing-unit').value.trim();
    const color = row.dataset.color || '';
    const ingredientId = await resolveIngredientIdForRow(row);
    // ingredientId is the live reference every read path now uses; name/
    // color are kept embedded alongside it only as a fallback for a
    // recipe doc that predates schema v2 and hasn't been resaved yet (see
    // resolveIngredientDisplay). Safe to drop once PR 5 confirms nothing
    // still needs the fallback.
    ingredientEntries.push({ ingredientId, name, amount, unit, color });
  }

  const steps = [...stepRows.querySelectorAll('.step-row .step-text')]
    .map(input => input.value.trim())
    .filter(Boolean);

  const recipe = {
    id,
    name: document.getElementById('fName').value.trim(),
    category: document.getElementById('fCategory').value,
    ingredients: ingredientEntries,
    steps,
    photos: formPhotos,
    notes: document.getElementById('fNotes').value.trim(),
    updatedAt: Date.now()
  };

  await RailDB.put(recipe);
  formSaved = true;
  await Promise.all(pendingDeletePaths.map(p => RailDB.deletePhoto(p)));
  closeOverlay();
  showToast('Recipe saved');
});

fDelete.addEventListener('click', async () => {
  const id = document.getElementById('recipeId').value;
  if (!id) return;
  const allPaths = [...new Set([...formPhotos.map(p => p.path), ...pendingDeletePaths])];
  const deleted = await deleteRecipeById(id, allPaths.map(path => ({ path })));
  if (deleted) {
    formSaved = true;
    closeOverlay();
  }
});

// ---- Service worker for offline shell caching ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// Shows which cached build is actually active on this device — handy for
// confirming whether a device has picked up a new deploy yet.
if ('caches' in window) {
  caches.keys().then(keys => {
    document.getElementById('buildVersion').textContent = keys.join(', ') || 'no cache yet';
  });
}

loadRecipes();
loadMepBeforeItems();
loadLegacyMepBefore();
loadMepExclusions();
loadIngredients();
