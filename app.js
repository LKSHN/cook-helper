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

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  setTimeout(() => { t.hidden = true; }, 2000);
}

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
      <div class="card-meta">${(r.ingredients || []).length} ingredients &middot; serves ${r.servings || '—'}</div>
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
  currentTicketId = null;
}

function closeOverlay() {
  if (history.state && history.state.railOverlay) {
    history.back();
  } else {
    hideOverlays();
  }
}

window.addEventListener('popstate', hideOverlays);

// ---- Ticket detail view ----
function openTicket(id) {
  const r = recipes.find(x => x.id === id);
  if (!r) return;
  currentTicketId = id;
  renderTicket(r, r.servings || 4);
  pushOverlayState();
  ticketOverlay.hidden = false;
}

function renderTicket(r, servings) {
  const base = r.servings || 4;
  const factor = servings / base;

  const ingredientsHtml = (r.ingredients || []).map(ing => {
    const scaled = ing.amount ? scaleAmount(ing.amount, factor) : '';
    return `<li><span>${escapeHtml(ing.name)}</span><span class="ingredient-qty">${scaled ? scaled + ' ' + escapeHtml(ing.unit || '') : ''}</span></li>`;
  }).join('');

  const stepsHtml = (r.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');

  ticketContent.innerHTML = `
    <button class="ticket-close" id="ticketCloseBtn" aria-label="Close">&times;</button>
    <div class="ticket-cat">${CAT_LABELS[r.category] || r.category}</div>
    <h2 class="ticket-name">${escapeHtml(r.name)}</h2>
    ${r.notes ? `<span class="ticket-notes">${escapeHtml(r.notes)}</span>` : ''}

    <div class="servings-control">
      <button id="servDown">&minus;</button>
      <span class="servings-count" id="servCount">${servings} serving${servings == 1 ? '' : 's'}</span>
      <button id="servUp">+</button>
    </div>

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
  document.getElementById('servDown').addEventListener('click', () => {
    const next = Math.max(1, servings - 1);
    renderTicket(r, next);
  });
  document.getElementById('servUp').addEventListener('click', () => {
    renderTicket(r, servings + 1);
  });
}

function scaleAmount(amount, factor) {
  const n = parseFloat(amount);
  if (isNaN(n)) return amount;
  const scaled = n * factor;
  // round sensibly: 2 decimals max, trim trailing zeros
  return (Math.round(scaled * 100) / 100).toString();
}

// ---- Add / Edit form ----
addBtn.addEventListener('click', () => openForm());
formClose.addEventListener('click', closeOverlay);

function openForm(id) {
  recipeForm.reset();
  ingredientRows.innerHTML = '';
  fDelete.hidden = true;
  document.getElementById('recipeId').value = '';

  if (id) {
    const r = recipes.find(x => x.id === id);
    formTitle.textContent = 'Edit Recipe';
    document.getElementById('recipeId').value = r.id;
    document.getElementById('fName').value = r.name;
    document.getElementById('fCategory').value = r.category;
    document.getElementById('fSteps').value = (r.steps || []).join('\n');
    document.getElementById('fNotes').value = r.notes || '';
    (r.ingredients || []).forEach(ing => addIngredientRow(ing.name, ing.amount, ing.unit));
    fDelete.hidden = false;
  } else {
    formTitle.textContent = 'New Recipe';
    addIngredientRow();
  }

  pushOverlayState();
  formOverlay.hidden = false;
}

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
  const existing = recipes.find(x => x.id === id);

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
    servings: (existing && existing.servings) || 4,
    ingredients,
    steps,
    notes: document.getElementById('fNotes').value.trim(),
    updatedAt: Date.now()
  };

  await RailDB.put(recipe);
  closeOverlay();
  showToast('Recipe saved');
});

fDelete.addEventListener('click', async () => {
  const id = document.getElementById('recipeId').value;
  if (!id) return;
  if (!confirm('Delete this recipe for good?')) return;
  await RailDB.remove(id);
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
