import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  GithubAuthProvider,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getDatabase,
  ref as rtdbRef,
  onValue,
  set as rtdbSet,
  onDisconnect,
  serverTimestamp as rtdbTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ============================================================================
// 1. FIREBASE, CLOUDINARY & GITHUB CONFIGURATION
// ============================================================================
const firebaseConfig = {
  apiKey: "AIzaSyAb6XQuA5QqqoglYSvtQ-cjpOuuV3s_vwo",
  authDomain: "nexchat-pro-8e480.firebaseapp.com",
  databaseURL: "https://nexchat-pro-8e480-default-rtdb.firebaseio.com",
  projectId: "nexchat-pro-8e480",
  storageBucket: "nexchat-pro-8e480.firebasestorage.app",
  messagingSenderId: "418090114272",
  appId: "1:418090114272:web:1391225432d0f9eb44c485"
};

const CLOUDINARY_CLOUD_NAME = "emoxfdx6";
const CLOUDINARY_UPLOAD_PRESET = "ml_default";
const GITHUB_REPO = "shikhagain1992-oss/nexchat-pro";
const APP_VERSION = "v1.0.0";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

setPersistence(auth, browserLocalPersistence).catch(() => {});

// ============================================================================
// 2. GLOBAL APPLICATION STATE
// ============================================================================
let currentUser = null;
let currentUserProfile = null;
let activeChat = null;
let messagesUnsubscribe = null;
let replyToMessage = null;
let selectedMessageForAction = null;
let currentChatMessages = [];

let mediaRecorder = null;
let audioChunks = [];
let recordStartTime = 0;
let recordTimerInterval = null;
let isRecordingCancelled = false;

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let currentCallId = null;
let currentFacingMode = "user";
let callTimerInterval = null;
let isMicMuted = false;
let isCamOff = false;

const rtcConfig = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ]
};

// ============================================================================
// 3. CLOUDINARY UPLOAD HELPER
// ============================================================================
async function uploadToCloudinary(fileOrBlob, folderName = "nexchat_pro", customFileName = null) {
  const formData = new FormData();
  if (customFileName && !(fileOrBlob instanceof File)) {
    formData.append("file", fileOrBlob, customFileName);
  } else {
    formData.append("file", fileOrBlob);
  }
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", folderName);

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
  const response = await fetch(endpoint, { method: "POST", body: formData });
  const data = await response.json();

  if (!response.ok || !data.secure_url) {
    throw new Error(data.error?.message || "মিডিয়া আপলোড ব্যর্থ হয়েছে");
  }
  return data.secure_url;
}

// ============================================================================
// 4. RELIABLE ALERT & TAB SWITCHER (RUNS IMMEDIATELY WITHOUT WAITING)
// ============================================================================
function showAlert(msg, isError = true) {
  let el = document.getElementById("auth-alert");
  if (!el) {
    el = document.createElement("div");
    el.id = "auth-alert";
    const formContainer = document.getElementById("login-form")?.parentElement || document.body;
    formContainer.prepend(el);
  }
  el.textContent = msg;
  el.className = `mb-4 p-3 rounded-lg text-xs font-semibold border ${
    isError
      ? "bg-red-100 text-red-700 border-red-300"
      : "bg-emerald-100 text-emerald-800 border-emerald-300"
  }`;
  el.classList.remove("hidden");
}

function switchAuthTab(mode) {
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const alertBox = document.getElementById("auth-alert");
  if (alertBox) alertBox.classList.add("hidden");

  if (mode === "register") {
    loginForm?.classList.add("hidden");
    registerForm?.classList.remove("hidden");
    tabRegister?.classList.add("border-blue-900", "text-blue-950", "bg-white", "border-b-2");
    tabLogin?.classList.remove("border-blue-900", "text-blue-950", "bg-white", "border-b-2");
  } else {
    registerForm?.classList.add("hidden");
    loginForm?.classList.remove("hidden");
    tabLogin?.classList.add("border-blue-900", "text-blue-950", "bg-white", "border-b-2");
    tabRegister?.classList.remove("border-blue-900", "text-blue-950", "bg-white", "border-b-2");
  }
}

window.switchAuthTab = switchAuthTab;

function initImmediateUI() {
  // Turn off browser autofill interference on all inputs
  document.querySelectorAll("input, form").forEach(el => {
    el.setAttribute("autocomplete", "off");
  });

  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");

  if (tabLogin) tabLogin.onclick = () => switchAuthTab("login");
  if (tabRegister) tabRegister.onclick = () => switchAuthTab("register");

  fetchLatestGithubApk();
}

// Run immediately if DOM is already ready, otherwise on DOMContentLoaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initImmediateUI);
} else {
  initImmediateUI();
}

async function fetchLatestGithubApk() {
  document.querySelectorAll(".app-version-label").forEach(el => (el.textContent = APP_VERSION));
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!res.ok) return;
    const release = await res.json();
    if (release.tag_name) {
      document.querySelectorAll(".app-version-label").forEach(el => (el.textContent = release.tag_name));
    }
    const apkAsset = (release.assets || []).find(a => a.name.endsWith(".apk"));
    if (apkAsset) {
      const dlLink = document.getElementById("direct-apk-download-link");
      if (dlLink) dlLink.href = apkAsset.browser_download_url;
    }
  } catch (e) {}
}

// ============================================================================
// 5. GLOBAL CLICK & SUBMIT DELEGATION (WORKS EVEN IF ICONS/SPANS ARE CLICKED)
// ============================================================================
document.addEventListener("click", async e => {
  // 1. Auth Tabs Fallback (by ID or button text)
  const clickedLoginTab = e.target.closest("#tab-login") || (e.target.closest("button")?.textContent.trim() === "Sign In" && !e.target.closest("form"));
  const clickedRegisterTab = e.target.closest("#tab-register") || (e.target.closest("button")?.textContent.trim() === "Create Account" && !e.target.closest("form"));

  if (clickedLoginTab) {
    e.preventDefault();
    switchAuthTab("login");
    return;
  }
  if (clickedRegisterTab) {
    e.preventDefault();
    switchAuthTab("register");
    return;
  }

  // 2. Password visibility toggle
  const toggleBtn = e.target.closest(".toggle-password");
  if (toggleBtn) {
    const input = document.getElementById(toggleBtn.dataset.target);
    if (input) input.type = input.type === "password" ? "text" : "password";
    return;
  }

  // 3. Forgot Password
  if (e.target.closest("#forgot-password-btn")) {
    e.preventDefault();
    const email = document.getElementById("login-email")?.value.trim();
    if (!email) return showAlert("পাসওয়ার্ড রিসেট করতে আগে ইমেইল বক্সে আপনার ইমেইল লিখুন।");
    try {
      await sendPasswordResetEmail(auth, email);
      showAlert("পাসওয়ার্ড রিসেট লিংক আপনার ইমেইলে পাঠানো হয়েছে!", false);
    } catch (err) {
      showAlert(err.message);
    }
    return;
  }

  // 4. Google & GitHub OAuth Login
  if (e.target.closest("#google-login-btn")) {
    e.preventDefault();
    handleOAuthLogin(new GoogleAuthProvider());
    return;
  }
  if (e.target.closest("#github-login-btn")) {
    e.preventDefault();
    handleOAuthLogin(new GithubAuthProvider());
    return;
  }

  // 5. Logout
  if (e.target.closest("#logout-btn")) {
    e.preventDefault();
    if (currentUser) {
      await rtdbSet(rtdbRef(rtdb, `status/${currentUser.uid}`), {
        state: "offline",
        lastChanged: rtdbTimestamp()
      }).catch(() => {});
    }
    await signOut(auth);
    location.reload();
    return;
  }

  // 6. Back to Conversation List on Mobile
  if (e.target.closest("#back-to-list-btn")) {
    document.getElementById("chat-panel")?.classList.add("hidden");
    return;
  }

  // 7. Cancel Reply
  if (e.target.closest("#cancel-reply-btn")) {
    replyToMessage = null;
    document.getElementById("reply-preview-bar")?.classList.add("hidden");
    return;
  }

  // 8. Attach Media in Chat
  if (e.target.closest("#attach-file-btn")) {
    document.getElementById("chat-file-input")?.click();
    return;
  }

  // 9. Voice & Video Call Triggers
  if (e.target.closest("#voice-call-btn")) {
    startCall(false);
    return;
  }
  if (e.target.closest("#video-call-btn")) {
    startCall(true);
    return;
  }
  if (e.target.closest("#accept-call-btn")) {
    acceptIncomingCall();
    return;
  }
  if (e.target.closest("#reject-call-btn") || e.target.closest("#end-call-btn")) {
    endActiveCall();
    return;
  }
  if (e.target.closest("#toggle-mic-btn")) {
    toggleMicrophone();
    return;
  }
  if (e.target.closest("#switch-cam-btn")) {
    switchCameraFacing();
    return;
  }

  // 10. Add Status Trigger
  if (e.target.closest("#add-status-btn")) {
    document.getElementById("status-file-input")?.click();
    return;
  }

  // 11. Create Group Trigger
  if (e.target.closest("#create-group-btn")) {
    createNewGroupPrompt();
    return;
  }
});

// ============================================================================
// 6. FORM SUBMISSIONS (LOGIN, REGISTER, SEND MESSAGE)
// ============================================================================
document.addEventListener("submit", async e => {
  // REGISTRATION FORM
  if (e.target && e.target.id === "register-form") {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : "Create Account";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "অ্যাকাউন্ট তৈরি হচ্ছে...";
    }

    const displayName = (document.getElementById("reg-name")?.value || "User").trim();
    const rawUsername = (document.getElementById("reg-username")?.value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    const username = rawUsername || "user_" + Math.floor(1000 + Math.random() * 9000);
    const phone = (document.getElementById("reg-phone")?.value || "").trim();
    const email = (document.getElementById("reg-email")?.value || "").trim();
    const password = document.getElementById("reg-password")?.value || "";
    const avatarFile = document.getElementById("reg-avatar")?.files?.[0];

    try {
      showAlert("অ্যাকাউন্ট ভেরিফাই করা হচ্ছে, অনুগ্রহ করে অপেক্ষা করুন...", false);
      const usernameRef = doc(db, "usernames", username);
      const usernameSnap = await getDoc(usernameRef);
      if (usernameSnap.exists()) {
        throw new Error(`@${username} ইউজারনেমটি আগে থেকেই নেওয়া হয়েছে। অন্য নাম দিন।`);
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      let photoURL = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1e3a8a&color=fff`;

      if (avatarFile) {
        try {
          photoURL = await uploadToCloudinary(avatarFile, `nexchat_pro/avatars/${cred.user.uid}`);
        } catch (uploadErr) {
          console.warn("Avatar upload skipped:", uploadErr);
        }
      }

      await setDoc(usernameRef, { uid: cred.user.uid });
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        displayName,
        displayNameLower: displayName.toLowerCase(),
        username,
        email,
        phone,
        photoURL,
        bio: "Hey there! I am using NexChat Pro.",
        isBlocked: false,
        createdAt: serverTimestamp()
      });

      sendEmailVerification(cred.user).catch(() => {});
      showAlert("সফলভাবে অ্যাকাউন্ট তৈরি হয়েছে!", false);
    } catch (err) {
      showAlert(err.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }
  }

  // LOGIN FORM
  if (e.target && e.target.id === "login-form") {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : "Sign In";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "লগইন হচ্ছে...";
    }

    const email = (document.getElementById("login-email")?.value || "").trim();
    const password = document.getElementById("login-password")?.value || "";

    try {
      showAlert("লগইন করা হচ্ছে, অপেক্ষা করুন...", false);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      showAlert("ইমেইল বা পাসওয়ার্ড সঠিক নয়: " + err.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }
  }

  // CHAT MESSAGE FORM
  if (e.target && (e.target.id === "message-form" || e.target.id === "send-message-form")) {
    e.preventDefault();
    const input = document.getElementById("message-input");
    if (!input || !input.value.trim() || !activeChat) return;
    const text = input.value.trim();
    input.value = "";
    await sendChatMessage({ text, type: "text" });
  }
});

// ============================================================================
// 7. OAUTH LOGIN (GOOGLE / GITHUB) WITH POPUP + REDIRECT FALLBACK
// ============================================================================
async function ensureOAuthUserDoc(user) {
  const uRef = doc(db, "users", user.uid);
  const snap = await getDoc(uRef);
  if (!snap.exists()) {
    const cleanBase = (user.email?.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9]/g, "");
    const baseUsername = `${cleanBase}_${Math.floor(100 + Math.random() * 900)}`;
    await setDoc(doc(db, "usernames", baseUsername), { uid: user.uid });
    await setDoc(uRef, {
      uid: user.uid,
      displayName: user.displayName || "NexChat User",
      displayNameLower: (user.displayName || "NexChat User").toLowerCase(),
      username: baseUsername,
      email: user.email || "",
      phone: user.phoneNumber || "Not set",
      photoURL: user.photoURL || "https://ui-avatars.com/api/?name=User&background=1e3a8a&color=fff",
      bio: "Available on NexChat Pro",
      isBlocked: false,
      createdAt: serverTimestamp()
    });
  }
}

async function handleOAuthLogin(provider) {
  try {
    showAlert("গুগল সাইন-ইন ওপেন হচ্ছে...", false);
    const cred = await signInWithPopup(auth, provider);
    await ensureOAuthUserDoc(cred.user);
  } catch (err) {
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else if (err.code === "auth/unauthorized-domain") {
      showAlert("Firebase Console -> Authentication -> Settings -> Authorized domains-এ গিয়ে shikhagain1992-oss.github.io ডোমেইনটি Add করুন।");
    } else {
      showAlert(err.message);
    }
  }
}

getRedirectResult(auth)
  .then(async res => {
    if (res && res.user) await ensureOAuthUserDoc(res.user);
  })
  .catch(err => showAlert(err.message));

// ============================================================================
// 8. SESSION MANAGEMENT, USER SEARCH & REAL-TIME MESSAGING
// ============================================================================
onAuthStateChanged(auth, async user => {
  if (!user) {
    document.getElementById("auth-view")?.classList.remove("hidden");
    document.getElementById("main-app")?.classList.add("hidden");
    return;
  }

  currentUser = user;
  document.getElementById("auth-view")?.classList.add("hidden");
  document.getElementById("main-app")?.classList.remove("hidden");

  onSnapshot(doc(db, "users", user.uid), snap => {
    if (!snap.exists()) return;
    currentUserProfile = snap.data();
    if (currentUserProfile.isBlocked) {
      alert("Your account has been restricted by the Administrator.");
      signOut(auth);
      return;
    }
    const nameEl = document.getElementById("my-nav-name");
    const unameEl = document.getElementById("my-nav-username");
    const avatarEl = document.getElementById("my-nav-avatar");
    if (nameEl) nameEl.textContent = currentUserProfile.displayName;
    if (unameEl) unameEl.textContent = "@" + currentUserProfile.username;
    if (avatarEl) avatarEl.src = currentUserProfile.photoURL;
  });

  setupRealtimePresence(user.uid);
  setupUserSearch();
  setupMediaInputs();
  listenToConversations();
  listenToStatuses();
  listenForIncomingCalls();
});

function setupRealtimePresence(uid) {
  const connectedRef = rtdbRef(rtdb, ".info/connected");
  const userStatusRef = rtdbRef(rtdb, `status/${uid}`);
  onValue(connectedRef, snap => {
    if (snap.val() === false) return;
    onDisconnect(userStatusRef)
      .set({ state: "offline", lastChanged: rtdbTimestamp() })
      .then(() => {
        rtdbSet(userStatusRef, { state: "online", lastChanged: rtdbTimestamp() });
      });
  });
}

function setupUserSearch() {
  const searchInput = document.getElementById("user-search-input") || document.getElementById("search-user-input");
  if (!searchInput) return;

  searchInput.addEventListener("input", async e => {
    const term = e.target.value.trim().toLowerCase().replace(/^@/, "");
    const resultsBox = document.getElementById("search-results-list");
    if (!term) {
      if (resultsBox) resultsBox.innerHTML = "";
      return;
    }
    const snap = await getDocs(collection(db, "users"));
    const matches = [];
    snap.forEach(d => {
      const u = d.data();
      if (u.uid !== currentUser.uid && (u.username?.includes(term) || u.displayNameLower?.includes(term))) {
        matches.push(u);
      }
    });

    const targetList = resultsBox || document.getElementById("conversation-list");
    if (!targetList) return;
    targetList.innerHTML = "";
    matches.forEach(u => {
      const item = document.createElement("div");
      item.className = "p-3 flex items-center gap-3 hover:bg-blue-50 cursor-pointer border-b border-slate-100";
      item.innerHTML = `
        <img src="${u.photoURL}" class="w-10 h-10 rounded-full object-cover border" />
        <div>
          <h4 class="text-sm font-bold text-slate-800">${u.displayName}</h4>
          <p class="text-xs text-blue-700">@${u.username}</p>
        </div>
      `;
      item.onclick = () => startOrOpenDirectChat(u);
      targetList.appendChild(item);
    });
  });
}

async function startOrOpenDirectChat(otherUser) {
  const sortedIds = [currentUser.uid, otherUser.uid].sort();
  const convId = `${sortedIds[0]}_${sortedIds[1]}`;
  const convRef = doc(db, "conversations", convId);
  const
