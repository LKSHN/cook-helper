// app.js — all UI logic for The Rail

let recipes = [];
let activeCategory = 'all';
let searchTerm = '';
let currentTicketId = null;

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
const photoThumbs = document.getElementById('photoThumbs');
const fPhotoInput = document.getElementById('fPhotoInput');
const addPhotoBtn = document.getElementById('addPhotoBtn');

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
  desserts: 'Desserts',
  sauces: 'Sauces & Dressings'
};

const UNITS = ['gr', 'kg', 'L', 'mL', 'CaS', 'CaC', 'pincée', 'pièce', 'botte', 'None'];

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
    const card = document.createElement('div');
    card.className = 'recipe-card';
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="card-top">
        <h3 class="card-name">${escapeHtml(r.name)}</h3>
        <span class="card-cat">${CAT_LABELS[r.category] || r.category}</span>
      </div>
      <div class="card-meta">${(r.ingredients || []).length} ingredients</div>
      ${r.notes ? `<span class="card-notes">${escapeHtml(r.notes)}</span>` : ''}
    `;
    card.addEventListener('click', () => openTicket(r.id));
    cardList.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
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

  const ingredientsHtml = (r.ingredients || []).map(ing => {
    const qty = ing.amount ? ing.amount + ' ' + escapeHtml(ing.unit || '') : '';
    return `<li><span>${escapeHtml(ing.name)}</span><span class="ingredient-qty">${qty}</span></li>`;
  }).join('');

  const stepsHtml = (r.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');

  ticketContent.innerHTML = `
    <button class="ticket-close" id="ticketCloseBtn" aria-label="Close">&times;</button>
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
    document.getElementById('fSteps').value = (r.steps || []).join('\n');
    document.getElementById('fNotes').value = r.notes || '';
    (r.ingredients || []).forEach(ing => addIngredientRow(ing.name, ing.amount, ing.unit));
    formPhotos = (r.photos || []).slice();
    originalPhotoPaths = new Set(formPhotos.map(p => p.path));
    fDelete.hidden = false;
  } else {
    formTitle.textContent = 'New Recipe';
    // Assign the id now (not at submit time) so photo uploads have a
    // stable folder to land in even before the recipe is first saved.
    document.getElementById('recipeId').value = uid();
    addIngredientRow();
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
      <button type="button" aria-label="Remove photo">&times;</button>
    `;
    thumb.querySelector('button').addEventListener('click', async () => {
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

addPhotoBtn.addEventListener('click', () => fPhotoInput.click());

fPhotoInput.addEventListener('change', async () => {
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
});

function addIngredientRow(name = '', amount = '', unit = '') {
  const row = document.createElement('div');
  row.className = 'ingredient-row';
  const unitOptions = UNITS.map(u => {
    const val = u === 'None' ? '' : u;
    return `<option value="${val}" ${unit === val ? 'selected' : ''}>${u}</option>`;
  }).join('');
  row.innerHTML = `
    <input type="text" placeholder="Ingredient" class="ing-name" value="${escapeHtml(name)}">
    <input type="text" placeholder="Qty" class="ing-amount" value="${escapeHtml(amount)}">
    <select class="ing-unit">${unitOptions}</select>
    <button type="button" aria-label="Remove ingredient">&times;</button>
  `;
  row.querySelector('button').addEventListener('click', () => row.remove());
  ingredientRows.appendChild(row);
}

addIngredientBtn.addEventListener('click', () => addIngredientRow());

recipeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('recipeId').value || uid();

  const ingredients = [...ingredientRows.querySelectorAll('.ingredient-row')]
    .map(row => ({
      name: row.querySelector('.ing-name').value.trim(),
      amount: row.querySelector('.ing-amount').value.trim(),
      unit: row.querySelector('.ing-unit').value.trim()
    }))
    .filter(ing => ing.name);

  const steps = document.getElementById('fSteps').value
    .split('\n').map(s => s.trim()).filter(Boolean);

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
  if (!confirm('Delete this recipe for good?')) return;
  const allPaths = new Set([...formPhotos.map(p => p.path), ...pendingDeletePaths]);
  await Promise.all([...allPaths].map(p => RailDB.deletePhoto(p)));
  await RailDB.remove(id);
  formSaved = true;
  closeOverlay();
  showToast('Recipe deleted');
});

// ---- Service worker for offline shell caching ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

loadRecipes();
