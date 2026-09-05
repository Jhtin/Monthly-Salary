(() => {
  const STORAGE_KEY = "workday.salary.tracker.v1";
  const LOCAL_UPDATED_KEY = "workday.salary.tracker.updatedAt";
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
  const originalRemoveItem = Storage.prototype.removeItem;
  originalRemoveItem.call(localStorage, STORAGE_KEY);
  originalRemoveItem.call(localStorage, LOCAL_UPDATED_KEY);

  let currentUser = null;
  let cloudApi = null;
  let unsubscribeCloud = null;
  let pendingRemoteState = null;
  let writeChain = Promise.resolve();
  let authResolved = false;

  const clone = value => JSON.parse(JSON.stringify(value));
  const defaultState = () => ({
    theme: "light",
    links: [],
    employees: [{ id: "emp-1", name: "Employee", rate: 500, color: "#1f7a4d" }],
    attendance: {},
    activeEmployeeId: "emp-1"
  });

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") return Object.keys(value).sort().reduce((out,key)=>{out[key]=canonicalize(value[key]);return out;},{});
    return value;
  }
  function stable(value){try{return JSON.stringify(canonicalize(value))}catch{return ""}}

  /* The app may still call localStorage.setItem(), but account data is never persisted there. */
  Storage.prototype.setItem = function(key, value) {
    if (this === localStorage && (key === STORAGE_KEY || key === LOCAL_UPDATED_KEY)) {
      if (key === STORAGE_KEY && currentUser && cloudApi) {
        try { saveToCloud(JSON.parse(value)); } catch (error) { console.error("Could not save cloud state", error); }
      }
      return;
    }
    originalSetItem.call(this, key, value);
  };

  function setSyncStatus(text, tone="") {
    let el=document.getElementById("cloudStatus");
    if(!el){el=document.createElement("span");el.id="cloudStatus";el.style.cssText="font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--muted);white-space:nowrap";document.querySelector(".header-actions")?.prepend(el)}
    if(el){el.textContent=text;el.dataset.tone=tone;el.title=tone==="error"?"Open the browser console for Firebase details":"Firebase cloud status"}
  }

  function ensureLiveUpdateBridge(){
    if(typeof window.workdayApplyCloudState==="function"){applyPendingRemoteState();return}
    if(document.querySelector('script[data-workday-live-bridge]'))return;
    const script=document.createElement("script");script.src="live-update.js";script.dataset.workdayLiveBridge="true";script.onload=applyPendingRemoteState;document.body.appendChild(script);
  }
  function applyPendingRemoteState(){
    if(!pendingRemoteState||typeof window.workdayApplyCloudState!=="function")return false;
    const next=pendingRemoteState;pendingRemoteState=null;return window.workdayApplyCloudState(next);
  }
  function applyState(next){pendingRemoteState=clone(next);if(typeof window.workdayApplyCloudState==="function")applyPendingRemoteState();else ensureLiveUpdateBridge()}

  function ensureAuthGate(){
    if(document.getElementById("authGate"))return;
    const gate=document.createElement("div");gate.id="authGate";gate.innerHTML=`<div class="auth-gate-card"><div class="auth-gate-mark">✓</div><span class="eyebrow">Workday Salary Tracker</span><h2>Sign in to continue</h2><p>Your employees, attendance, salary records, and links are stored in your account. This device does not keep a local copy.</p><button type="button" class="button primary" id="gateSignInBtn">Continue with Google</button><small id="gateStatus">Connecting securely…</small></div>`;
    const style=document.createElement("style");style.textContent=`#authGate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;background:var(--bg);color:var(--text)}#authGate[hidden]{display:none!important}.auth-gate-card{width:min(430px,100%);padding:34px;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:24px;box-shadow:var(--shadow)}.auth-gate-mark{width:54px;height:54px;margin:0 auto 18px;display:grid;place-items:center;border-radius:16px;background:var(--green);color:#fff;font-size:25px;font-weight:900}.auth-gate-card h2{margin:8px 0 10px;font-size:28px;letter-spacing:-.03em}.auth-gate-card p{margin:0 auto 22px;max-width:340px;color:var(--muted);font-size:13px;line-height:1.65}.auth-gate-card .button{width:100%;height:46px}.auth-gate-card small{display:block;margin-top:14px;color:var(--muted);font-size:10px}@media(max-width:520px){.auth-gate-card{padding:27px 20px;border-radius:20px}.auth-gate-card h2{font-size:24px}}`;
    document.head.appendChild(style);document.body.appendChild(gate);
    document.getElementById("gateSignInBtn").onclick=signIn;
  }
  function showGate(message="Sign in required") { ensureAuthGate();const gate=document.getElementById("authGate");gate.hidden=false;const s=document.getElementById("gateStatus");if(s)s.textContent=message; }
  function hideGate(){const gate=document.getElementById("authGate");if(gate)gate.hidden=true}

  async function signIn(){
    if(!cloudApi){showGate("Still connecting…");return}
    try{setSyncStatus("Opening sign-in…");const s=document.getElementById("gateStatus");if(s)s.textContent="Opening Google sign-in…";await cloudApi.signInWithPopup(cloudApi.auth,cloudApi.provider)}
    catch(error){console.error("Firebase sign-in error",error);const code=error?.code||"";if(code==="auth/popup-blocked"||code==="auth/operation-not-supported-in-this-environment"||code==="auth/cancelled-popup-request"){await cloudApi.signInWithRedirect(cloudApi.auth,cloudApi.provider);return}if(code==="auth/unauthorized-domain")showGate("This domain is not authorized in Firebase.");else if(code!=="auth/popup-closed-by-user")showGate("Sign-in failed. Please try again.")}
  }

  function requestLogout(){
    if(!currentUser||!cloudApi)return;
    const dialog=document.getElementById("actionConfirmDialog");
    const card=document.getElementById("actionConfirmCard");
    const kicker=document.getElementById("actionConfirmKicker");
    const title=document.getElementById("actionConfirmTitle");
    const message=document.getElementById("actionConfirmMessage");
    const details=document.getElementById("actionConfirmDetails");
    const cancel=document.getElementById("actionConfirmCancel");
    const accept=document.getElementById("actionConfirmAccept");
    const close=document.getElementById("actionConfirmClose");
    if(!dialog||!card||!title||!message||!cancel||!accept){
      if(window.confirm("Log out of Workday?"))cloudApi.signOut(cloudApi.auth);
      return;
    }
    card.classList.remove("warning");card.classList.add("danger");
    if(kicker)kicker.textContent="Account session";
    title.textContent="Log out of Workday?";
    message.textContent="You will be signed out and this device will return to the default sign-in screen.";
    if(details){details.textContent="Your saved employees, attendance, salary records, and links will remain safely stored in your account.";details.classList.add("show")}
    cancel.textContent="Stay signed in";
    accept.textContent="Log out";
    accept.className="button danger-fill";
    const cleanup=()=>{cancel.onclick=null;accept.onclick=null;if(close)close.onclick=null;dialog.onclick=null};
    const dismiss=()=>{cleanup();if(dialog.open)dialog.close()};
    cancel.onclick=dismiss;
    if(close)close.onclick=dismiss;
    dialog.onclick=e=>{if(e.target===dialog)dismiss()};
    accept.onclick=async()=>{dismiss();setSyncStatus("Signing out…");try{await cloudApi.signOut(cloudApi.auth)}catch(error){console.error("Firebase sign-out error",error);setSyncStatus("Sign-out failed","error")}};
    dialog.showModal();
  }

  function ensureAuthButton(){
    const actions=document.querySelector(".header-actions");if(!actions||document.getElementById("authBtn"))return;
    const btn=document.createElement("button");btn.id="authBtn";btn.type="button";btn.className="button secondary";btn.textContent="Sign in";
    btn.onclick=()=>{if(currentUser)requestLogout();else signIn()};actions.prepend(btn);
  }
  function updateAuthUi(user){ensureAuthButton();const btn=document.getElementById("authBtn");if(!btn)return;if(user){btn.textContent=user.displayName?user.displayName.split(" ")[0]:"Account";btn.title=`${user.email||"Signed in"} — click to sign out`}else{btn.textContent="Sign in";btn.title="Sign in with Google"}}

  function saveToCloud(nextState){
    if(!currentUser||!cloudApi||!nextState)return;
    const stateToSave=clone(nextState);setSyncStatus("Saving…");
    writeChain=writeChain.then(async()=>{
      const ref=cloudApi.doc(cloudApi.db,"users",currentUser.uid);
      await cloudApi.setDoc(ref,{workday:stateToSave,email:currentUser.email||null,updatedAt:cloudApi.serverTimestamp()});
      setSyncStatus("Synced");
    }).catch(error=>{console.error("Firestore save error",error);setSyncStatus(error?.code==="permission-denied"?"Rules blocked sync":"Sync error","error")});
  }

  function startRealtimeSync(user){
    if(unsubscribeCloud)unsubscribeCloud();
    const ref=cloudApi.doc(cloudApi.db,"users",user.uid);
    unsubscribeCloud=cloudApi.onSnapshot(ref,snap=>{
      if(!snap.exists()||!snap.data()?.workday)return;
      const remote=snap.data().workday;
      if(stable(remote)!==stable(pendingRemoteState))applyState(remote);
      setSyncStatus("Synced");
    },error=>{console.error("Firestore realtime sync error",error);setSyncStatus(error?.code==="permission-denied"?"Rules blocked sync":"Sync error","error")});
  }

  async function loadAccount(user){
    setSyncStatus("Loading account…");
    try{
      const ref=cloudApi.doc(cloudApi.db,"users",user.uid);
      const snap=await cloudApi.getDoc(ref);
      if(snap.exists()&&snap.data()?.workday){applyState(snap.data().workday)}
      else{const fresh=defaultState();applyState(fresh);await cloudApi.setDoc(ref,{workday:fresh,email:user.email||null,updatedAt:cloudApi.serverTimestamp()})}
      startRealtimeSync(user);hideGate();setSyncStatus("Synced");
    }catch(error){console.error("Firestore account load error",error);showGate(error?.code==="permission-denied"?"Firestore rules blocked your account.":"Could not load your account.");setSyncStatus("Sync error","error")}
  }

  function resetLoggedOutState(){
    originalRemoveItem.call(localStorage,STORAGE_KEY);originalRemoveItem.call(localStorage,LOCAL_UPDATED_KEY);
    applyState(defaultState());setSyncStatus("Sign in required");showGate(authResolved?"Sign in to access your data.":"Checking your account…");
  }

  async function init(){
    ensureAuthButton();ensureLiveUpdateBridge();ensureAuthGate();showGate("Checking your account…");setSyncStatus("Connecting…");
    try{
      const [appMod,authMod,firestoreMod]=await Promise.all([import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)]);
      const app=appMod.initializeApp(firebaseConfig),auth=authMod.getAuth(app);await authMod.setPersistence(auth,authMod.browserLocalPersistence);const db=firestoreMod.getFirestore(app),provider=new authMod.GoogleAuthProvider();provider.setCustomParameters({prompt:"select_account"});
      cloudApi={auth,db,provider,signInWithPopup:authMod.signInWithPopup,signInWithRedirect:authMod.signInWithRedirect,getRedirectResult:authMod.getRedirectResult,signOut:authMod.signOut,onAuthStateChanged:authMod.onAuthStateChanged,doc:firestoreMod.doc,getDoc:firestoreMod.getDoc,setDoc:firestoreMod.setDoc,onSnapshot:firestoreMod.onSnapshot,serverTimestamp:firestoreMod.serverTimestamp};
      try{await cloudApi.getRedirectResult(auth)}catch(error){console.error("Firebase redirect result error",error)}
      cloudApi.onAuthStateChanged(auth,async user=>{
        authResolved=true;currentUser=user;updateAuthUi(user);
        if(user)await loadAccount(user);else{if(unsubscribeCloud){unsubscribeCloud();unsubscribeCloud=null}resetLoggedOutState()}
      });
    }catch(error){console.error("Firebase initialization error",error);showGate("Could not connect. Check your internet and refresh.");setSyncStatus("Offline","error")}
  }

  init();
})();