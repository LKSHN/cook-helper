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
  }
};
