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
  const sourceId = sessionStorage.getItem("workday.sync.source") || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  sessionStorage.setItem("workday.sync.source", sourceId);

  let currentUser = null;
  let cloudApi = null;
  let syncingFromCloud = false;
  let unsubscribeCloud = null;
  let pendingRemoteState = null;
  let pendingLocalSignature = "";
  let lastOwnWriteId = "";
  let writeChain = Promise.resolve();
  let queuedBeforeAuth = null;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function getLocalState() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; } }
  function getLocalUpdatedAt() { return Number(localStorage.getItem(LOCAL_UPDATED_KEY) || 0) || 0; }
  function markLocalUpdated() { const now = Date.now(); originalSetItem.call(localStorage, LOCAL_UPDATED_KEY, String(now)); return now; }
  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") return Object.keys(value).sort().reduce((out,key)=>{ out[key]=canonicalize(value[key]); return out; },{});
    return value;
  }
  function stable(value) { try { return JSON.stringify(canonicalize(value)); } catch { return ""; } }

  function setSyncStatus(text, tone="") {
    let el=document.getElementById("cloudStatus");
    if(!el){el=document.createElement("span");el.id="cloudStatus";el.style.cssText="font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--muted);white-space:nowrap";document.querySelector(".header-actions")?.prepend(el)}
    if(el){el.textContent=text;el.dataset.tone=tone;el.title=tone==="error"?"Open the browser console for Firebase details":"Firebase cloud sync status"}
  }

  function applyPendingRemoteState(){if(!pendingRemoteState||typeof window.workdayApplyCloudState!=="function")return false;const next=pendingRemoteState;pendingRemoteState=null;return window.workdayApplyCloudState(next)}
  function ensureLiveUpdateBridge(){
    if(typeof window.workdayApplyCloudState==="function"){applyPendingRemoteState();return}
    if(document.querySelector('script[data-workday-live-bridge]'))return;
    const script=document.createElement("script");script.src="live-update.js";script.dataset.workdayLiveBridge="true";script.onload=()=>applyPendingRemoteState();script.onerror=()=>console.error("Could not load live-update.js");document.body.appendChild(script)
  }

  function ensureAuthButton(){
    const actions=document.querySelector(".header-actions");if(!actions||document.getElementById("authBtn"))return;
    const btn=document.createElement("button");btn.id="authBtn";btn.type="button";btn.className="button secondary";btn.textContent="Sign in";btn.title="Sign in to sync data across devices";
    btn.addEventListener("click",async()=>{if(!cloudApi){setSyncStatus("Still connecting…");return}try{if(currentUser)await cloudApi.signOut(cloudApi.auth);else{setSyncStatus("Opening sign-in…");await cloudApi.signInWithPopup(cloudApi.auth,cloudApi.provider)}}catch(error){console.error("Firebase sign-in error",error);const code=error?.code||"";if(code==="auth/popup-blocked"||code==="auth/operation-not-supported-in-this-environment"||code==="auth/cancelled-popup-request"){try{setSyncStatus("Redirecting to Google…");await cloudApi.signInWithRedirect(cloudApi.auth,cloudApi.provider);return}catch(e){console.error("Firebase redirect sign-in error",e)}}if(code==="auth/unauthorized-domain")setSyncStatus("Domain not authorized","error");else if(code!=="auth/popup-closed-by-user")setSyncStatus("Sign-in failed","error");else setSyncStatus("Local only")}});
    actions.prepend(btn)
  }
  function updateAuthUi(user){ensureAuthButton();const btn=document.getElementById("authBtn");if(!btn)return;if(user){btn.textContent=user.displayName?user.displayName.split(" ")[0]:"Signed in";btn.title=`${user.email||"Signed in"} — click to sign out`}else{btn.textContent="Sign in";btn.title="Sign in with Google to sync data across devices";setSyncStatus("Local only")}}

  async function writeAndVerify(stateToSave, localTimestamp) {
    const ref=cloudApi.doc(cloudApi.db,"users",currentUser.uid);
    const signature=stable(stateToSave);
    for(let attempt=1;attempt<=3;attempt++){
      const writeId=`${Date.now()}-${Math.random().toString(36).slice(2)}`;lastOwnWriteId=writeId;
      await cloudApi.setDoc(ref,{workday:stateToSave,email:currentUser.email||null,updatedAt:cloudApi.serverTimestamp(),clientUpdatedAt:localTimestamp,syncSource:sourceId,syncWriteId:writeId},{merge:true});
      const check=await cloudApi.getDocFromServer(ref);
      if(check.exists()&&stable(check.data()?.workday)===signature)return true;
      console.warn(`Cloud verification mismatch (attempt ${attempt})`);
    }
    throw new Error("Cloud verification failed after 3 attempts");
  }

  function saveToCloud(nextState, clientUpdatedAt){
    if(!nextState||syncingFromCloud)return;
    const stateToSave=clone(nextState),signatureToSave=stable(stateToSave),localTimestamp=clientUpdatedAt||getLocalUpdatedAt()||Date.now();
    pendingLocalSignature=signatureToSave;
    if(!currentUser||!cloudApi){queuedBeforeAuth={state:stateToSave,updatedAt:localTimestamp};setSyncStatus("Waiting to sync…");return}
    setSyncStatus("Saving…");
    writeChain=writeChain.then(async()=>{await writeAndVerify(stateToSave,localTimestamp);if(pendingLocalSignature===signatureToSave){pendingLocalSignature="";setSyncStatus("Synced")}}).catch(error=>{console.error("Firestore save/verify error",error);if(pendingLocalSignature===signatureToSave)pendingLocalSignature="";setSyncStatus(error?.code==="permission-denied"?"Rules blocked sync":"Sync error","error")})
  }

  Storage.prototype.setItem=function(key,value){
    originalSetItem.call(this,key,value);
    if(this===localStorage&&key===STORAGE_KEY&&!syncingFromCloud){try{const updatedAt=markLocalUpdated();saveToCloud(JSON.parse(value),updatedAt)}catch(error){console.error("Could not queue cloud save",error)}}
  };

  function applyRemoteState(remoteState,remoteUpdatedAt=0){
    if(!remoteState||stable(remoteState)===stable(getLocalState())){if(remoteUpdatedAt>getLocalUpdatedAt())originalSetItem.call(localStorage,LOCAL_UPDATED_KEY,String(remoteUpdatedAt));return false}
    syncingFromCloud=true;originalSetItem.call(localStorage,STORAGE_KEY,JSON.stringify(remoteState));originalSetItem.call(localStorage,LOCAL_UPDATED_KEY,String(remoteUpdatedAt||Date.now()));syncingFromCloud=false;
    pendingRemoteState=remoteState;if(typeof window.workdayApplyCloudState==="function")applyPendingRemoteState();else ensureLiveUpdateBridge();setSyncStatus("Updated from cloud");return true
  }

  function startRealtimeSync(user){
    if(unsubscribeCloud)unsubscribeCloud();const ref=cloudApi.doc(cloudApi.db,"users",user.uid);
    unsubscribeCloud=cloudApi.onSnapshot(ref,snap=>{if(!snap.exists()||!snap.data()?.workday)return;const data=snap.data(),remoteState=data.workday,remoteSignature=stable(remoteState),remoteUpdatedAt=Number(data.clientUpdatedAt||0)||0,localUpdatedAt=getLocalUpdatedAt();
      if(data.syncWriteId===lastOwnWriteId){if(!snap.metadata?.hasPendingWrites&&remoteSignature===pendingLocalSignature){pendingLocalSignature="";setSyncStatus("Synced")}return}
      if(pendingLocalSignature)return;
      if(localUpdatedAt>remoteUpdatedAt&&stable(getLocalState())!==remoteSignature){saveToCloud(getLocalState(),localUpdatedAt);return}
      if(!applyRemoteState(remoteState,remoteUpdatedAt))setSyncStatus("Synced")
    },error=>{console.error("Firestore realtime sync error",error);setSyncStatus(error?.code==="permission-denied"?"Rules blocked sync":"Sync error","error")})
  }

  async function syncAfterLogin(user){
    if(!cloudApi||!user)return;const ref=cloudApi.doc(cloudApi.db,"users",user.uid);setSyncStatus("Syncing…");
    try{
      if(queuedBeforeAuth){const queued=queuedBeforeAuth;queuedBeforeAuth=null;saveToCloud(queued.state,queued.updatedAt)}
      const snap=await cloudApi.getDocFromServer(ref),localState=getLocalState(),localUpdatedAt=getLocalUpdatedAt();
      if(snap.exists()&&snap.data()?.workday){const data=snap.data(),remoteState=data.workday,remoteUpdatedAt=Number(data.clientUpdatedAt||0)||0;
        if(localState&&localUpdatedAt>remoteUpdatedAt&&stable(localState)!==stable(remoteState))saveToCloud(localState,localUpdatedAt);else if(!pendingLocalSignature)applyRemoteState(remoteState,remoteUpdatedAt)
      }else if(localState){const updatedAt=localUpdatedAt||markLocalUpdated();saveToCloud(localState,updatedAt)}
      startRealtimeSync(user);if(!pendingLocalSignature)setSyncStatus("Synced")
    }catch(error){console.error("Firestore sync error",error);setSyncStatus(error?.code==="permission-denied"?"Rules blocked sync":"Sync error","error")}
  }

  async function init(){
    ensureAuthButton();ensureLiveUpdateBridge();setSyncStatus("Connecting…");
    try{
      const [appMod,authMod,firestoreMod]=await Promise.all([import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)]);
      const app=appMod.initializeApp(firebaseConfig),auth=authMod.getAuth(app);await authMod.setPersistence(auth,authMod.browserLocalPersistence);const db=firestoreMod.getFirestore(app),provider=new authMod.GoogleAuthProvider();provider.setCustomParameters({prompt:"select_account"});
      cloudApi={auth,db,provider,signInWithPopup:authMod.signInWithPopup,signInWithRedirect:authMod.signInWithRedirect,getRedirectResult:authMod.getRedirectResult,signOut:authMod.signOut,onAuthStateChanged:authMod.onAuthStateChanged,doc:firestoreMod.doc,getDoc:firestoreMod.getDoc,getDocFromServer:firestoreMod.getDocFromServer,setDoc:firestoreMod.setDoc,onSnapshot:firestoreMod.onSnapshot,serverTimestamp:firestoreMod.serverTimestamp};
      try{await cloudApi.getRedirectResult(auth)}catch(error){console.error("Firebase redirect result error",error)}
      cloudApi.onAuthStateChanged(auth,async user=>{currentUser=user;updateAuthUi(user);if(user)await syncAfterLogin(user);else{pendingLocalSignature="";lastOwnWriteId="";if(unsubscribeCloud){unsubscribeCloud();unsubscribeCloud=null}}})
    }catch(error){console.error("Firebase initialization error",error);setSyncStatus("Offline","error")}
  }

  init();
})();