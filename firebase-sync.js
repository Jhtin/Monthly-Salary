(() => {
  const STORAGE_KEY = "workday.salary.tracker.v1";
  const FIREBASE_VERSION = "12.18.0";
  const firebaseConfig = {
    apiKey: "AIzaSyAsT2xjwwctgZA7SLxGPUCekbgZcRBp9co",
    authDomain: "workday-salary-tracker.firebaseapp.com",
    projectId: "workday-salary-tracker",
    storageBucket: "workday-salary-tracker.firebasestorage.app",
    messagingSenderId: "1030934538072",
    appId: "1:1030934538072:web:2d9438f49f51265993672d",
    measurementId: "G-974CLENM0Z"
  };

  const originalSetItem = Storage.prototype.setItem;
  let currentUser = null;
  let cloudApi = null;
  let syncingFromCloud = false;
  let saveTimer = null;
  let unsubscribeCloud = null;

  function getLocalState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch { return null; }
  }

  function stable(value) {
    try { return JSON.stringify(value); }
    catch { return ""; }
  }

  function setSyncStatus(text, tone = "") {
    let el = document.getElementById("cloudStatus");
    if (!el) {
      el = document.createElement("span");
      el.id = "cloudStatus";
      el.style.cssText = "font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--muted);white-space:nowrap";
      document.querySelector(".header-actions")?.prepend(el);
    }
    if (el) {
      el.textContent = text;
      el.dataset.tone = tone;
      el.title = tone === "error" ? "Open the browser console for Firebase details" : "Firebase cloud sync status";
    }
  }

  function ensureAuthButton() {
    const actions = document.querySelector(".header-actions");
    if (!actions || document.getElementById("authBtn")) return;
    const btn = document.createElement("button");
    btn.id = "authBtn";
    btn.type = "button";
    btn.className = "button secondary";
    btn.textContent = "Sign in";
    btn.title = "Sign in to sync data across devices";
    btn.addEventListener("click", async () => {
      if (!cloudApi) {
        setSyncStatus("Still connecting…");
        return;
      }
      try {
        if (currentUser) {
          await cloudApi.signOut(cloudApi.auth);
        } else {
          setSyncStatus("Opening sign-in…");
          await cloudApi.signInWithPopup(cloudApi.auth, cloudApi.provider);
        }
      } catch (error) {
        console.error("Firebase sign-in error", error);
        const code = error?.code || "";
        if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment" || code === "auth/cancelled-popup-request") {
          try {
            setSyncStatus("Redirecting to Google…");
            await cloudApi.signInWithRedirect(cloudApi.auth, cloudApi.provider);
            return;
          } catch (redirectError) {
            console.error("Firebase redirect sign-in error", redirectError);
          }
        }
        if (code === "auth/unauthorized-domain") {
          setSyncStatus("Domain not authorized", "error");
        } else if (code !== "auth/popup-closed-by-user") {
          setSyncStatus("Sign-in failed", "error");
        } else {
          setSyncStatus("Local only");
        }
      }
    });
    actions.prepend(btn);
  }

  function updateAuthUi(user) {
    ensureAuthButton();
    const btn = document.getElementById("authBtn");
    if (!btn) return;
    if (user) {
      btn.textContent = user.displayName ? user.displayName.split(" ")[0] : "Signed in";
      btn.title = `${user.email || "Signed in"} — click to sign out`;
    } else {
      btn.textContent = "Sign in";
      btn.title = "Sign in with Google to sync data across devices";
      setSyncStatus("Local only");
    }
  }

  async function saveToCloud(state) {
    if (!currentUser || !cloudApi || syncingFromCloud || !state) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        setSyncStatus("Saving…");
        const ref = cloudApi.doc(cloudApi.db, "users", currentUser.uid);
        await cloudApi.setDoc(ref, {
          workday: state,
          email: currentUser.email || null,
          updatedAt: cloudApi.serverTimestamp()
        }, { merge: true });
        setSyncStatus("Synced");
      } catch (error) {
        console.error("Firestore save error", error);
        setSyncStatus(error?.code === "permission-denied" ? "Rules blocked sync" : "Sync error", "error");
      }
    }, 250);
  }

  Storage.prototype.setItem = function(key, value) {
    originalSetItem.call(this, key, value);
    if (this === localStorage && key === STORAGE_KEY && !syncingFromCloud) {
      try { saveToCloud(JSON.parse(value)); } catch {}
    }
  };

  function applyRemoteState(remoteState) {
    if (!remoteState || stable(remoteState) === stable(getLocalState())) return false;
    syncingFromCloud = true;
    originalSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(remoteState));
    syncingFromCloud = false;
    setSyncStatus("Updated from cloud");
    return true;
  }

  function startRealtimeSync(user) {
    if (unsubscribeCloud) {
      unsubscribeCloud();
      unsubscribeCloud = null;
    }
    const ref = cloudApi.doc(cloudApi.db, "users", user.uid);
    unsubscribeCloud = cloudApi.onSnapshot(ref, snap => {
      if (!snap.exists() || !snap.data()?.workday) return;
      if (applyRemoteState(snap.data().workday)) {
        setTimeout(() => location.reload(), 120);
      } else {
        setSyncStatus("Synced");
      }
    }, error => {
      console.error("Firestore realtime sync error", error);
      setSyncStatus(error?.code === "permission-denied" ? "Rules blocked sync" : "Sync error", "error");
    });
  }

  async function syncAfterLogin(user) {
    if (!cloudApi || !user) return;
    const ref = cloudApi.doc(cloudApi.db, "users", user.uid);
    setSyncStatus("Syncing…");
    try {
      const snap = await cloudApi.getDoc(ref);
      const localState = getLocalState();
      if (snap.exists() && snap.data()?.workday) {
        applyRemoteState(snap.data().workday);
      } else if (localState) {
        await cloudApi.setDoc(ref, {
          workday: localState,
          email: user.email || null,
          updatedAt: cloudApi.serverTimestamp()
        }, { merge: true });
      }
      startRealtimeSync(user);
      setSyncStatus("Synced");
      if (stable(snap.data?.()?.workday || null) !== stable(localState) && snap.exists() && snap.data()?.workday) {
        setTimeout(() => location.reload(), 120);
      }
    } catch (error) {
      console.error("Firestore sync error", error);
      setSyncStatus(error?.code === "permission-denied" ? "Rules blocked sync" : "Sync error", "error");
    }
  }

  async function init() {
    ensureAuthButton();
    setSyncStatus("Connecting…");
    try {
      const [appMod, authMod, firestoreMod] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
      ]);
      const app = appMod.initializeApp(firebaseConfig);
      const auth = authMod.getAuth(app);
      await authMod.setPersistence(auth, authMod.browserLocalPersistence);
      const db = firestoreMod.getFirestore(app);
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      cloudApi = {
        auth, db, provider,
        signInWithPopup: authMod.signInWithPopup,
        signInWithRedirect: authMod.signInWithRedirect,
        getRedirectResult: authMod.getRedirectResult,
        signOut: authMod.signOut,
        onAuthStateChanged: authMod.onAuthStateChanged,
        doc: firestoreMod.doc,
        getDoc: firestoreMod.getDoc,
        setDoc: firestoreMod.setDoc,
        onSnapshot: firestoreMod.onSnapshot,
        serverTimestamp: firestoreMod.serverTimestamp
      };

      try { await cloudApi.getRedirectResult(auth); }
      catch (error) { console.error("Firebase redirect result error", error); }

      cloudApi.onAuthStateChanged(auth, async user => {
        currentUser = user;
        updateAuthUi(user);
        if (user) {
          await syncAfterLogin(user);
        } else if (unsubscribeCloud) {
          unsubscribeCloud();
          unsubscribeCloud = null;
        }
      });
    } catch (error) {
      console.error("Firebase initialization error", error);
      setSyncStatus("Offline", "error");
    }
  }

  init();
})();