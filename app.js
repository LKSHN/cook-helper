// app.js — all UI logic for The Rail

let recipes = [];
let searchTerm = '';
let expandedCardId = null;
let openCardMenuId = null;

let activeView = 'recap';
let mepMode = 'before';
let mepBefore = [];
// Ingredient names excluded from MEP everywhere they appear, not just in
// one recipe — see toggleMepExclusion(). mepExclusionsDocExists tracks
// whether the shared doc exists yet, so the one-time migration below only
// ever runs once (recipesEverLoaded/mepMigrationDone gate the same thing).
let mepExcludedNames = [];
let mepExclusionsDocExists = null;
let recipesEverLoaded = false;
let mepMigrationDone = false;

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
  });
}

function loadMep() {
  RailDB.onChangeMepList((items) => {
    mepBefore = items;
    if (activeView === 'mep') renderMep();
  });
}

function isMepExcluded(name) {
  return mepExcludedNames.includes((name || '').trim().toLowerCase());
}

function loadMepExclusions() {
  RailDB.onChangeMepExclusions((names, exists) => {
    mepExcludedNames = names;
    mepExclusionsDocExists = exists;
    maybeMigrateLegacyMepFlags();
    syncAllMepButtons();
    if (activeView === 'mep' && mepMode === 'after') renderMepAfter();
  });
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
    const hay = (r.name + ' ' + (r.ingredients || []).map(i => i.name).join(' ')).toLowerCase();
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
  const qty = ing.amount ? ing.amount + ' ' + escapeHtml(ing.unit || '') : '';
  const dot = ing.color ? `<span class="ing-dot" style="background:${ing.color}"></span>` : '';
  return `<li><span class="ing-name-wrap">${dot}${escapeHtml(ing.name)}</span><span class="ingredient-qty">${qty}</span></li>`;
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
  if (mepMode === 'before') renderMepBefore();
  else renderMepAfter();
}

// Palette position of a container color, for sorting groups in a stable,
// consistent order; no-color items sort last. Shared by both the Before
// and After "By container" sorts.
function colorSortIndex(color) {
  const i = INGREDIENT_COLORS.indexOf(color);
  return i === -1 ? INGREDIENT_COLORS.length : i;
}

// 'added' keeps Firestore array order (insertion order); 'container'
// groups items by their color tag, in palette order, with no-container
// items last. Not persisted — purely a local view preference.
let mepBeforeSort = 'added';

function sortedMepBefore() {
  if (mepBeforeSort !== 'container') return mepBefore;
  return [...mepBefore].sort((a, b) => colorSortIndex(a.color) - colorSortIndex(b.color));
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
    const unitOptions = UNITS.map(u => {
      const val = u === 'None' ? '' : u;
      return `<option value="${val}" ${item.unit === val ? 'selected' : ''}>${u}</option>`;
    }).join('');

    const row = document.createElement('div');
    row.className = 'mep-row';
    row.innerHTML = `
      <button type="button" class="mep-check" aria-label="Mark prepped">&#10003;</button>
      <button type="button" class="ing-color-btn" aria-label="Set container color" style="${item.color ? `background:${item.color}` : ''}"></button>
      <span class="mep-row-name">${escapeHtml(item.name)}</span>
      <input type="text" class="ing-amount" placeholder="Qty" value="${escapeHtml(item.amount || '')}">
      <select class="ing-unit">${unitOptions}</select>
      <button type="button" class="mep-row-remove" aria-label="Remove">&times;</button>
    `;

    row.querySelector('.mep-check').addEventListener('click', () => removeFromBeforeList(item.id));
    row.querySelector('.mep-row-remove').addEventListener('click', () => removeFromBeforeList(item.id));
    row.querySelector('.ing-amount').addEventListener('change', (e) => {
      updateBeforeItem(item.id, { amount: e.target.value.trim() });
    });
    row.querySelector('.ing-unit').addEventListener('change', (e) => {
      updateBeforeItem(item.id, { unit: e.target.value });
    });
    row.querySelector('.ing-color-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleColorPicker(row, item.color || '', (color) => updateBeforeItem(item.id, { color }));
    });

    mepBeforeListEl.appendChild(row);
  });
}

function aggregatedIngredients() {
  const map = new Map();
  recipes.forEach(r => {
    realIngredients(r).forEach(ing => {
      if (isMepExcluded(ing.name)) return;
      const key = (ing.name || '').trim().toLowerCase();
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, { name: ing.name.trim(), unit: ing.unit || '', color: ing.color || '', recipeIds: new Set() });
      }
      map.get(key).recipeIds.add(r.id);
    });
  });
  return [...map.values()]
    .map(v => ({ ...v, recipeIds: [...v.recipeIds] }))
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
  const items = sortedAfterItems(aggregatedIngredients());
  if (!items.length) {
    mepAfterListEl.innerHTML = '<div class="mep-empty">No ingredients yet.<br>Add some recipes on the Recap tab first.</div>';
    return;
  }

  items.forEach(ing => {
    const key = ing.name.toLowerCase();
    const already = mepBefore.some(i => i.name.trim().toLowerCase() === key);
    const dot = ing.color ? `<span class="ing-dot" style="background:${ing.color}"></span>` : '';

    const row = document.createElement('div');
    row.className = 'mep-add-row';
    row.innerHTML = `
      <span class="mep-add-name clickable">${dot}${escapeHtml(ing.name)}</span>
      <button type="button" class="mep-add-btn" ${already ? 'disabled' : ''} aria-label="Add to prep list">${already ? '&check;' : '+'}</button>
    `;
    row.querySelector('.mep-add-name').addEventListener('click', (e) => {
      e.stopPropagation();
      const matches = recipes.filter(r => ing.recipeIds.includes(r.id));
      toggleIngredientRecipePicker(row, matches);
    });
    if (!already) {
      row.querySelector('.mep-add-btn').addEventListener('click', () => addToBeforeList(ing.name, ing.unit, ing.color));
    }
    mepAfterListEl.appendChild(row);
  });
}

// Tapping an ingredient's name in the After list opens a small popover
// listing the recipe(s) it belongs to — tap one to jump straight into its
// edit form. Always shown (even for a single match) so the interaction is
// consistent regardless of how many recipes share the ingredient.
let openIngredientPickerRow = null;

function toggleIngredientRecipePicker(row, recipeMatches) {
  const alreadyOpenOnThisRow = openIngredientPickerRow === row;
  closeIngredientRecipePicker();
  if (alreadyOpenOnThisRow) return;

  const picker = document.createElement('div');
  picker.className = 'recipe-picker';
  picker.innerHTML = recipeMatches
    .map(r => `<button type="button" class="recipe-picker-item" data-id="${r.id}">${escapeHtml(r.name)}</button>`)
    .join('');
  picker.querySelectorAll('.recipe-picker-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeIngredientRecipePicker();
      openForm(btn.dataset.id);
    });
  });
  row.appendChild(picker);
  openIngredientPickerRow = row;
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

// New items inherit the color the ingredient already has in its recipe
// (if any) as a starting "container" tag — editable afterward from the
// Before list, independent of the recipe from then on.
function addToBeforeList(name, unit, color) {
  const key = name.trim().toLowerCase();
  if (mepBefore.some(i => i.name.trim().toLowerCase() === key)) return;
  const items = [...mepBefore, { id: uid(), name: name.trim(), amount: '', unit: unit || '', color: color || '' }];
  RailDB.setMepList(items);
}

function removeFromBeforeList(id) {
  RailDB.setMepList(mepBefore.filter(i => i.id !== id));
}

function updateBeforeItem(id, patch) {
  RailDB.setMepList(mepBefore.map(i => (i.id === id ? { ...i, ...patch } : i)));
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
      if (ing.type === 'separator') addSeparatorRow(ing.name);
      else addIngredientRow(ing.name, ing.amount, ing.unit, ing.color);
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

function addIngredientRow(name = '', amount = '', unit = '', color = '') {
  const row = document.createElement('div');
  row.className = 'ingredient-row';
  row.dataset.color = color;
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
    });
  });
  row.querySelector('.ing-mep-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const currentName = row.querySelector('.ing-name').value.trim();
    if (currentName) toggleMepExclusion(currentName);
  });
  // The MEP toggle's state is keyed by ingredient name, not by this row —
  // re-sync it live as the name changes so typing "Salt" immediately shows
  // whatever the shared setting for "Salt" already is.
  row.querySelector('.ing-name').addEventListener('input', () => syncMepButton(row));
  ingredientRows.appendChild(row);
  syncMepButton(row);
}

// Toggles whether `name` is excluded from MEP everywhere it's used — this
// is shared across every recipe, not just the row that was clicked. See
// mepExcludedNames.
function toggleMepExclusion(name) {
  const key = name.trim().toLowerCase();
  if (!key) return;
  const wasExcluded = isMepExcluded(key);
  const next = wasExcluded
    ? mepExcludedNames.filter(n => n !== key)
    : [...mepExcludedNames, key];
  RailDB.setMepExclusions(next);
  showToast(wasExcluded ? 'Included in MEP again' : 'Excluded from MEP everywhere');
}

function syncMepButton(row) {
  const name = row.querySelector('.ing-name').value.trim();
  const included = !isMepExcluded(name);
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

recipeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('recipeId').value || uid();

  const ingredients = [...ingredientRows.querySelectorAll('.ingredient-row')]
    .map(row => {
      if (row.dataset.type === 'separator') {
        return { type: 'separator', name: row.querySelector('.sep-label').value.trim() };
      }
      return {
        name: row.querySelector('.ing-name').value.trim(),
        amount: row.querySelector('.ing-amount').value.trim(),
        unit: row.querySelector('.ing-unit').value.trim(),
        color: row.dataset.color || ''
      };
    })
    .filter(ing => ing.name);

  const steps = [...stepRows.querySelectorAll('.step-row .step-text')]
    .map(input => input.value.trim())
    .filter(Boolean);

  const recipe = {
    id,
    name: document.getElementById('fName').value.trim(),
    category: document.getElementById('fCategory').value,
    ingredients,
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
loadMep();
loadMepExclusions();
