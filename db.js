// db.js — Firestore-backed store, shared across everyone who opens the app.
// Offline-first: writes/reads work without a connection and sync when back online.

// 1. Go to https://console.firebase.google.com -> create a project
// 2. Build > Firestore Database -> Create database (start in production mode)
// 3. Project settings (gear icon) > General > Your apps > Add app > Web (</>)
// 4. Copy the firebaseConfig object it gives you and paste it below.
const firebaseConfig = {
  apiKey: "AIzaSyA_ukZROtZ4GGybwmzxdi8O5_DNitjs_Fs",
  authDomain: "the-rail-36c77.firebaseapp.com",
  projectId: "the-rail-36c77",
  storageBucket: "the-rail-36c77.firebasestorage.app",
  messagingSenderId: "515103130548",
  appId: "1:515103130548:web:82121adcab2eaed8cc28e1"
};

firebase.initializeApp(firebaseConfig);
const firestore = firebase.firestore();
firestore.enablePersistence({ synchronizeTabs: true }).catch(() => {});
const storage = firebase.storage();

const recipesRef = firestore.collection('recipes');
const mepBeforeRef = firestore.collection('mep').doc('beforeList');
const mepExclusionsRef = firestore.collection('mep').doc('excludedIngredients');

// Schema v2 (see IDEAS.md "Data structure"): a normalized `ingredients`
// collection is the canonical record for a name/color/prepColor/mep flag,
// referenced by id from both recipes and mepBeforeItems, instead of that
// data being embedded and duplicated across every recipe. Rolling out in
// stages — this collection and the migration that populates it land first,
// inert until later work switches the read/write paths over to it.
const ingredientsRef = firestore.collection('ingredients');
const mepBeforeItemsRef = firestore.collection('mepBeforeItems');
const schemaMigrationRef = firestore.collection('migrations').doc('schemaV2');
const schemaBackfillRef = firestore.collection('migrations').doc('schemaV2Backfill');

const RailDB = {
  // Subscribes to live changes; calls cb(recipes) immediately and on every
  // local or remote change. Returns an unsubscribe function.
  onChange(cb) {
    return recipesRef.onSnapshot((snap) => {
      cb(snap.docs.map((d) => d.data()));
    });
  },
  async put(recipe) {
    await recipesRef.doc(recipe.id).set(recipe);
    return recipe;
  },
  async remove(id) {
    await recipesRef.doc(id).delete();
  },
  // Uploads a photo under the recipe's folder and returns its {url, path}.
  async uploadPhoto(recipeId, file) {
    const path = `recipes/${recipeId}/${Date.now()}_${file.name}`;
    const ref = storage.ref(path);
    await ref.put(file);
    const url = await ref.getDownloadURL();
    return { url, path };
  },
  async deletePhoto(path) {
    await storage.ref(path).delete().catch(() => {});
  },
  // MEP "before service" prep checklist — one shared doc, synced like recipes.
  onChangeMepList(cb) {
    return mepBeforeRef.onSnapshot((snap) => {
      cb((snap.data() && snap.data().items) || []);
    });
  },
  async setMepList(items) {
    await mepBeforeRef.set({ items });
  },
  // Ingredient names excluded from MEP, shared across every recipe that
  // uses them (e.g. salt, water) — one doc, same pattern as the before
  // list. cb's second arg tells the caller whether the doc exists yet, so
  // a one-time migration from the old per-recipe flag can run exactly once.
  onChangeMepExclusions(cb) {
    return mepExclusionsRef.onSnapshot((snap) => {
      cb((snap.data() && snap.data().names) || [], snap.exists);
    });
  },
  async setMepExclusions(names) {
    await mepExclusionsRef.set({ names });
  },
  // Canonical ingredient records (schema v2) — not yet read by the UI;
  // populated by the one-time migration in app.js.
  onChangeIngredients(cb) {
    return ingredientsRef.onSnapshot((snap) => {
      cb(snap.docs.map((d) => d.data()));
    });
  },
  async putIngredient(ingredient) {
    await ingredientsRef.doc(ingredient.id).set(ingredient);
    return ingredient;
  },
  async deleteIngredient(id) {
    await ingredientsRef.doc(id).delete();
  },
  // MEP before-list items as individual documents (schema v2) instead of
  // one array inside a single doc — avoids two devices editing different
  // items at once clobbering each other's write.
  onChangeMepBeforeItems(cb) {
    return mepBeforeItemsRef.onSnapshot((snap) => {
      cb(snap.docs.map((d) => d.data()));
    });
  },
  async putMepBeforeItem(item) {
    await mepBeforeItemsRef.doc(item.id).set(item);
    return item;
  },
  async removeMepBeforeItem(id) {
    await mepBeforeItemsRef.doc(id).delete();
  },
  async isSchemaV2Migrated() {
    const snap = await schemaMigrationRef.get();
    return snap.exists;
  },
  async markSchemaV2Migrated() {
    await schemaMigrationRef.set({ migratedAt: Date.now() });
  },
  // Separate marker from schemaV2Migrated above: that one seeds the
  // `ingredients` collection without touching recipe docs; this one tracks
  // the follow-up pass that attaches ingredientId onto every recipe's
  // ingredient entries so the MEP After list can rely on it being there.
  async isIngredientIdBackfillDone() {
    const snap = await schemaBackfillRef.get();
    return snap.exists;
  },
  async markIngredientIdBackfillDone() {
    await schemaBackfillRef.set({ migratedAt: Date.now() });
  }
};
