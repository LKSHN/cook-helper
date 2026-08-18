// app.js — all UI logic for The Rail

let recipes = [];
let activeCategory = 'all';
let searchTerm = '';
let currentTicketId = null;
let expandedCardId = null;
let openCardMenuId = null;

const cardList = document.getElementById('cardList');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const stationTabs = document.getElementById('stationTabs');
const addBtn = document.getElementById('addBtn');

const ticketOverlay = document.getElementById('ticketOverlay');
const ticketContent = document.getElementById('ticketContent');

const formOverlay = document.getElementById('formOverlay');
const recipeForm = document.getElementById('recipeForm');
const formTitle = document.getElementById('formTitle');
const formClose = document.getElementById('formClose');
const fDelete = document.getElementById('fDelete');
const ingredientRows = document.getElementById('ingredientRows');
const addIngredientBtn = document.getElementById('addIngredient');
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
    render();
  });
}

function filteredRecipes() {
  return recipes
    .filter(r => activeCategory === 'all' || r.category === activeCategory)
    .filter(r => {
      if (!searchTerm) return true;
      const hay = (r.name + ' ' + (r.ingredients || []).map(i => i.name).join(' ')).toLowerCase();
      return hay.includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function render() {
  const list = filteredRecipes();
  cardList.innerHTML = '';
  emptyState.hidden = list.length > 0;

  list.forEach(r => {
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
          <div class="card-meta">${(r.ingredients || []).length} ingredients</div>
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
      openTicket(r.id);
    });

    if (r.id === openCardMenuId) card.querySelector('.card-menu').hidden = false;
    if (r.id === expandedCardId) card.open = true;

    cardList.appendChild(card);
  });
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
  const qty = ing.amount ? ing.amount + ' ' + escapeHtml(ing.unit || '') : '';
  const dot = ing.color ? `<span class="ing-dot" style="background:${ing.color}"></span>` : '';
  return `<li><span class="ing-name-wrap">${dot}${escapeHtml(ing.name)}</span><span class="ingredient-qty">${qty}</span></li>`;
}

// ---- Station tabs ----
stationTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  [...stationTabs.children].forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  activeCategory = btn.dataset.cat;
  render();
});

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
  ticketOverlay.hidden = true;
  formOverlay.hidden = true;
  lightboxOverlay.hidden = true;
  currentTicketId = null;
}

function closeOverlay() {
  if (history.state && history.state.railOverlay) {
    history.back();
  } else {
    hideOverlays();
  }
}

// The lightbox always pushes its own history entry (even on top of an
// already-open ticket), so back-from-photo returns to the recipe instead
// of skipping straight to the list.
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

// ---- Ticket detail view ----
function openTicket(id) {
  const r = recipes.find(x => x.id === id);
  if (!r) return;
  currentTicketId = id;
  renderTicket(r);
  pushOverlayState();
  ticketOverlay.hidden = false;
}

function renderTicket(r) {
  const photosHtml = (r.photos || [])
    .map(p => `<img src="${escapeHtml(p.url)}" alt="" loading="lazy">`)
    .join('');

  const ingredientsHtml = (r.ingredients || []).map(ingredientLiHtml).join('');

  const stepsHtml = (r.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');

  ticketContent.innerHTML = `
    <div class="ticket-header">
      <button class="ticket-close" id="ticketCloseBtn" aria-label="Close">&times;</button>
    </div>
    <div class="ticket-cat">${CAT_LABELS[r.category] || r.category}</div>
    <h2 class="ticket-name">${escapeHtml(r.name)}</h2>
    ${r.notes ? `<span class="ticket-notes">${escapeHtml(r.notes)}</span>` : ''}

    ${photosHtml ? `<div class="ticket-photos">${photosHtml}</div>` : ''}

    <div class="ticket-section-title">Ingredients</div>
    <ul class="ingredient-list">${ingredientsHtml || '<li>No ingredients listed</li>'}</ul>

    <div class="ticket-section-title">Method</div>
    <ol class="steps-list">${stepsHtml || '<li>No steps listed</li>'}</ol>

    <button class="ticket-edit-btn" id="ticketEditBtn">Edit recipe</button>
  `;

  document.getElementById('ticketCloseBtn').addEventListener('click', closeOverlay);
  document.getElementById('ticketEditBtn').addEventListener('click', () => {
    ticketOverlay.hidden = true;
    openForm(r.id);
  });
  ticketContent.querySelectorAll('.ticket-photos img').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.src));
  });
}

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
    (r.ingredients || []).forEach(ing => addIngredientRow(ing.name, ing.amount, ing.unit, ing.color));
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
    <div class="drag-handle" aria-label="Drag to reorder"></div>
    <button type="button" class="row-remove" aria-label="Remove ingredient">&times;</button>
  `;
  makeDraggable(row, ingredientRows);
  row.querySelector('.row-remove').addEventListener('click', () => row.remove());
  row.querySelector('.ing-color-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleColorPicker(row);
  });
  ingredientRows.appendChild(row);
}

function toggleColorPicker(row) {
  const alreadyOpenOnThisRow = openColorPickerRow === row;
  closeColorPicker();
  if (alreadyOpenOnThisRow) return;

  const picker = document.createElement('div');
  picker.className = 'color-picker';
  const currentColor = row.dataset.color || '';
  picker.innerHTML = `
    <button type="button" class="none-swatch" aria-label="No color">&times;</button>
    ${INGREDIENT_COLORS.map(c => `<button type="button" class="swatch${c === currentColor ? ' selected' : ''}" style="background:${c}" data-color="${c}" aria-label="Set color"></button>`).join('')}
  `;
  picker.querySelector('.none-swatch').addEventListener('click', (e) => {
    e.stopPropagation();
    setIngredientColor(row, '');
  });
  picker.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setIngredientColor(row, btn.dataset.color);
    });
  });
  row.appendChild(picker);
  openColorPickerRow = row;
}

function setIngredientColor(row, color) {
  row.dataset.color = color;
  row.querySelector('.ing-color-btn').style.background = color || '';
  closeColorPicker();
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
    .map(row => ({
      name: row.querySelector('.ing-name').value.trim(),
      amount: row.querySelector('.ing-amount').value.trim(),
      unit: row.querySelector('.ing-unit').value.trim(),
      color: row.dataset.color || ''
    }))
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
