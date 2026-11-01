import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  collection,
  query,
  where,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getDatabase,
  ref as rtdbRef,
  set as rtdbSet,
  update as rtdbUpdate,
  onValue as rtdbOnValue,
  onDisconnect as rtdbOnDisconnect,
  serverTimestamp as rtdbServerTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ================= FIREBASE & CLOUDINARY CONFIGURATION =================
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

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const googleProvider = new GoogleAuthProvider();

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Auth persistence warning:", err);
});

// ================= STRICT IDENTITY & SESSION STATE =================
let authSessionToken = 0;
let activeAuthUid = null;
let myVerifiedProfile = null;

let allUsersMap = new Map();
let latestChatItems = [];
let activeChatFilter = "all";
let activeChatId = null;
let activeChatIsGroup = false;
let activeGroupData = null;
let activePeerUser = null;
let activeMessagesMap = new Map();
let activeReplyTo = null;
let messageToForward = null;
let isSignUpMode = false;
let lastSendActionMs = 0;

// Active Firebase Listener Unsubscribe Handles
let unsubMyProfile = null;
let unsubUsers = null;
let unsubChats = null;
let unsubGroups = null;
let unsubMessages = null;
let unsubPeerPresence = null;
let unsubStatuses = null;
let unsubCalls = null;
let unsubCallHistory = null;
let unsubActiveCallDoc = null;
let unsubCalleeCandidates = null;
let unsubCallerCandidates = null;

// Voice Recording State
let mediaRecorder = null;
let recordedAudioChunks = [];
let isRecordingVoice = false;
let recordingStartTimeMs = 0;
let recordingTimerInterval = null;
let typingTimeout = null;

// WebRTC Call State
let peerConnection = null;
let localStream = null;
let currentCallDocId = null;
let pendingCallData = null;
let useFrontCamera = true;
let isAudioMuted = false;
let isVideoMuted = false;
let isSpeakerOn = true;
let isCallConnected = false;
let pendingIceCandidates = [];
let callDurationInterval = null;
let callStartedAtMs = 0;
  

const $ = (id) => document.getElementById(id);

// ================= MANDATORY IDENTITY GUARDS =================
function getAuthenticatedUid() {
  const user = auth.currentUser;
  if (!user || !user.uid) return null;
  return String(user.uid).trim();
}

function assertValidSenderIdentity() {
  const uid = getAuthenticatedUid();
  if (!uid) {
    throw new Error("You are not logged in. Please log in again.");
  }
  if (activeAuthUid && uid !== activeAuthUid) {
    throw new Error("Account session changed. Please retry.");
  }
  return uid;
}

function getAccountStorageKey(suffix) {
  const uid = getAuthenticatedUid();
  if (!uid) return null;
  return `nexchat_${uid}_${suffix}`;
}

// ================= COMPLETE SESSION TEARDOWN ON LOGOUT / SWITCH =================
function cleanupAccountSession() {
  authSessionToken += 1;

  const listeners = [
    unsubMyProfile,
    unsubUsers,
    unsubChats,
    unsubGroups,
    unsubMessages,
    unsubPeerPresence,
    unsubStatuses,
    unsubCalls,
    unsubActiveCallDoc,
    unsubCalleeCandidates,
    unsubCallerCandidates
  ];

  listeners.forEach((unsub) => {
    if (typeof unsub === "function") {
      try {
        unsub();
      } catch (e) {}
    }
  });

  unsubMyProfile = null;
  unsubUsers = null;
  unsubChats = null;
  unsubGroups = null;
  unsubMessages = null;
  unsubPeerPresence = null;
  unsubStatuses = null;
  unsubCalls = null;
  unsubActiveCallDoc = null;
  unsubCalleeCandidates = null;
  unsubCallerCandidates = null;

  endActiveCall();

  activeAuthUid = null;
  myVerifiedProfile = null;
  allUsersMap.clear();
  latestChatItems = [];
  activeChatId = null;
  activeChatIsGroup = false;
  activeGroupData = null;
  activePeerUser = null;
  activeMessagesMap.clear();
  activeReplyTo = null;
  messageToForward = null;

  try {
    localStorage.removeItem("nexchat_cached_user");
  } catch (e) {}

  const containersToClear = [
    "chatListContainer",
    "messagesList",
    "searchResultsList",
    "statusListContainer",
    "groupListContainer",
    "callLogsContainer",
    "forwardUserList"
  ];
  containersToClear.forEach((id) => {
    const el = $(id);
    if (el) el.innerHTML = "";
  });

  if ($("chatPeerName")) $("chatPeerName").textContent = "Contact";
  if ($("chatPeerStatus")) $("chatPeerStatus").textContent = "offline";
  if ($("totalUnreadBadge")) $("totalUnreadBadge").classList.add("hidden");
  if ($("replyPreviewBar")) $("replyPreviewBar").classList.add("hidden");
  if ($("searchResultsPanel")) $("searchResultsPanel").classList.add("hidden");
  hideChatErrorBanner();
}

// ================= HELPER UTILITIES =================
function getFallbackAvatar(name) {
  const cleanName = String(name || "U").trim();
  const initial = (cleanName.charAt(0) || "U").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="#00a884"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="44" font-weight="bold">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function setSafeAvatar(imgEl, url, displayName) {
  if (!imgEl) return;
  const fallback = getFallbackAvatar(displayName);
  imgEl.onerror = () => {
    imgEl.onerror = null;
    imgEl.src = fallback;
  };
  imgEl.src =
    url && (String(url).startsWith("http") || String(url).startsWith("data:"))
      ? url
      : fallback;
}

function normalizeUserRecord(raw, explicitDocId = "") {
  if (!raw) return null;
  const uid = String(explicitDocId || raw.uid || raw.id || "").trim();
  if (!uid) return null;

  const email = String(raw.email || "").trim();
  const emailPrefix = email ? email.split("@")[0] : "";
  const displayName = String(
    raw.displayName || raw.name || raw.fullName || emailPrefix || "NexChat User"
  ).trim();

  const rawUsername = String(
    raw.username || emailPrefix || displayName.toLowerCase().replace(/[^a-z0-9_]/g, "")
  )
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

  const rawPhoto = String(raw.photoURL || raw.avatar || "").trim();
  const photoURL =
    rawPhoto.startsWith("http") || rawPhoto.startsWith("data:")
      ? rawPhoto
      : getFallbackAvatar(displayName);

  const mobileNumber = String(raw.mobileNumber || raw.phone || "").trim();
  const bio = String(raw.bio || raw.about || "Hey there! I am using NexChat Pro.").trim();
  const online = Boolean(raw.online === true || raw.status === "online");
  const lastSeenMs = Number(raw.lastSeenMs || 0);
  const createdAtMs = Number(raw.createdAtMs || Date.now());

  return {
    uid,
    displayName,
    username: rawUsername || `user_${uid.slice(0, 6).toLowerCase()}`,
    email,
    mobileNumber,
    photoURL,
    bio,
    online,
    lastSeenMs,
    createdAtMs
  };
}

function getDeterministicChatId(uidA, uidB) {
  const a = String(uidA || "").trim();
  const b = String(uidB || "").trim();
  if (!a || !b || a === b) {
    throw new Error("Invalid participant UIDs for direct conversation.");
  }
  return [a, b].sort().join("_");
}

function formatTime(msOrTimestamp) {
  let ms = 0;
  if (typeof msOrTimestamp === "number") {
    ms = msOrTimestamp;
  } else if (msOrTimestamp && typeof msOrTimestamp.toMillis === "function") {
    ms = msOrTimestamp.toMillis();
  } else if (msOrTimestamp && msOrTimestamp.seconds) {
    ms = msOrTimestamp.seconds * 1000;
  }
  if (!ms) return "";
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ================= CLOUDINARY MEDIA UPLOAD =================
async function uploadMediaFile(file) {
  assertValidSenderIdentity();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  try {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`,
      {
        method: "POST",
        body: formData
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.secure_url) return data.secure_url;
    }
  } catch (err) {
    console.warn("Cloudinary direct upload warning, using DataURL fallback:", err);
  }

  if (file.size <= 750 * 1024) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("File read failed"));
      reader.readAsDataURL(file);
    });
  }

  throw new Error("Media upload failed. Please check your internet connection.");
}

// ================= RUNTIME LAYOUT & UI ENHANCEMENTS =================
function applyCriticalLayoutFixes() {
  const appRoot = $("appRoot");
  if (appRoot) {
    appRoot.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;";
  }

  document.querySelectorAll(".screen").forEach((scr) => {
    scr.style.width = "100%";
    scr.style.height = "100%";
    scr.style.flexDirection = "column";
    scr.style.overflow = "hidden";
  });

  const chatScreen = $("chatScreen");
  if (chatScreen) {
    chatScreen.style.position = "fixed";
    chatScreen.style.inset = "0";
    chatScreen.style.width = "100%";
    chatScreen.style.height = "100%";
  }

  const viewport = $("messagesViewport");
  if (viewport) {
    viewport.style.cssText =
      "flex:1 1 auto;min-height:0;width:100%;overflow-y:auto;overflow-x:hidden;padding:12px 10px;display:flex;flex-direction:column;";
  }

  const msgList = $("messagesList");
  if (msgList) {
    msgList.style.cssText =
      "display:flex;flex-direction:column;gap:8px;width:100%;margin-top:auto;";
  }

  const footer = document.querySelector(".wa-chat-footer");
  if (footer) {
    footer.style.cssText =
      "width:100%;max-width:100vw;display:flex;align-items:center;gap:6px;padding:6px 8px 8px 8px;flex-shrink:0;box-sizing:border-box;";
  }

  const inputPill = document.querySelector(".wa-input-pill");
  if (inputPill) {
    inputPill.style.cssText =
      "flex:1 1 0%;min-width:0;display:flex;align-items:center;border-radius:24px;padding:3px 6px;overflow:hidden;";
  }

  const msgInput = $("messageTextInput");
  if (msgInput) {
    msgInput.style.cssText =
      "flex:1 1 0%;width:0;min-width:0;border:none;background:transparent;outline:none;font-size:15px;padding:6px 4px;";
  }

  const sendBtn = $("sendOrMicBtn");
  if (sendBtn) {
    sendBtn.style.cssText =
      "width:44px;height:44px;min-width:44px;flex:0 0 44px;border-radius:50%;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;";
  }
}

function ensureExtendedDOMElements() {
  applyCriticalLayoutFixes();

  // 1. Mobile Number field inside Sign Up form
  const signupFields = $("signupFields");
  if (signupFields && !$("authMobileNumber")) {
    const mobileGroup = document.createElement("div");
    mobileGroup.className = "input-group";
    mobileGroup.innerHTML = `
      <i class="fa-solid fa-phone"></i>
      <input type="tel" id="authMobileNumber" placeholder="Mobile Number (e.g. +91 9876543210)" />
    `;
    signupFields.appendChild(mobileGroup);
  }

  // 2. Forgot Password button in Auth Form
  const authForm = $("authForm");
  if (authForm && !$("forgotPasswordBtn")) {
    const fpBtn = document.createElement("button");
    fpBtn.type = "button";
    fpBtn.id = "forgotPasswordBtn";
    fpBtn.style.cssText =
      "background:none;border:none;color:#008069;font-size:13px;font-weight:600;margin-top:10px;cursor:pointer;width:100%;text-align:center;";
    fpBtn.textContent = "Forgot Password?";
    authForm.appendChild(fpBtn);
  }

  // 3. Mobile Number field inside Profile Modal
  const editBioGroup = $("editBioInput")?.parentElement;
  if (editBioGroup && !$("editMobileInput")) {
    const mobEdit = document.createElement("div");
    mobEdit.className = "input-group";
    mobEdit.innerHTML = `
      <i class="fa-solid fa-phone"></i>
      <input type="tel" id="editMobileInput" placeholder="Mobile Number" />
    `;
    editBioGroup.parentElement.insertBefore(mobEdit, editBioGroup);
  }

  // 4. Dedicated Voice Note button in composer + In-Chat Search & Export buttons
  const inputPill = document.querySelector(".wa-input-pill");
  if (inputPill && !$("voiceRecordToggleBtn")) {
    const micBtn = document.createElement("button");
    micBtn.type = "button";
    micBtn.id = "voiceRecordToggleBtn";
    micBtn.className = "composer-icon-btn";
    micBtn.title = "Record Voice Message";
    micBtn.innerHTML = `<i class="fa-solid fa-microphone"></i>`;
    inputPill.appendChild(micBtn);
  }

  const chatHeaderActions = document.querySelector(".chat-header-actions");
  if (chatHeaderActions && !$("exportChatBtn")) {
    const searchMsgBtn = document.createElement("button");
    searchMsgBtn.type = "button";
    searchMsgBtn.id = "inChatSearchBtn";
    searchMsgBtn.className = "chat-header-btn icon-btn";
    searchMsgBtn.title = "Search messages";
    searchMsgBtn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i>`;

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.id = "exportChatBtn";
    exportBtn.className = "chat-header-btn icon-btn";
    exportBtn.title = "Export Chat (TXT/JSON)";
    exportBtn.innerHTML = `<i class="fa-solid fa-file-arrow-down"></i>`;

    chatHeaderActions.appendChild(searchMsgBtn);
    chatHeaderActions.appendChild(exportBtn);
  }

  // 5. Security Alert Banner on Main Screen
  const mainScreen = $("mainScreen");
  if (mainScreen && !$("securityAlertBanner")) {
    const banner = document.createElement("div");
    banner.id = "securityAlertBanner";
    banner.className = "hidden";
    banner.style.cssText =
      "background:#fff3cd;color:#664d03;padding:8px 14px;font-size:12.5px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ffecb5;flex-shrink:0;";
    mainScreen.insertBefore(banner, mainScreen.firstChild);
  }

  // 6. Visible Chat Error Banner inside Chat Screen
  const chatScreen = $("chatScreen");
  const viewport = $("messagesViewport");
  if (chatScreen && viewport && !$("chatErrorBanner")) {
    const errBanner = document.createElement("div");
    errBanner.id = "chatErrorBanner";
    errBanner.className = "hidden";
    errBanner.style.cssText =
      "background:#fde8e8;color:#9b1c1c;padding:8px 12px;font-size:12.5px;font-weight:600;border-bottom:1px solid #f8b4b4;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;";
    chatScreen.insertBefore(errBanner, viewport);
  }
}

function showChatErrorBanner(message) {
  const banner = $("chatErrorBanner");
  if (!banner) return;
  banner.innerHTML = `
    <span>⚠️ ${escapeHtml(message)}</span>
    <button type="button" style="border:none;background:transparent;color:#9b1c1c;font-weight:bold;cursor:pointer;margin-left:8px;">✕</button>
  `;
  banner.classList.remove("hidden");
  banner.querySelector("button")?.addEventListener("click", () => {
    banner.classList.add("hidden");
  });
}

function hideChatErrorBanner() {
  const banner = $("chatErrorBanner");
  if (banner) banner.classList.add("hidden");
}

function switchScreen(screenId) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.remove("active");
    s.style.display = "none";
  });
  const target = $(screenId);
  if (target) {
    target.classList.add("active");
    target.style.display = "flex";
  }
}

// ================= AUTHENTICATION & UNIQUE USERNAME VALIDATION =================
async function isUsernameAvailable(candidateUsername, excludeUid = "") {
  const clean = String(candidateUsername || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (!clean || clean.length < 3) return false;

  const q = query(collection(db, "users"), where("username", "==", clean));
  const snap = await getDocs(q);
  for (const docSnap of snap.docs) {
    if (docSnap.id !== excludeUid) {
      return false;
    }
  }
  return true;
}

function setupAuthUI() {
  ensureExtendedDOMElements();

  const tabLoginBtn = $("tabLoginBtn");
  const tabSignupBtn = $("tabSignupBtn");
  const signupFields = $("signupFields");
  const authSubmitBtn = $("authSubmitBtn");
  const authErrorMsg = $("authErrorMsg");
  const forgotPasswordBtn = $("forgotPasswordBtn");

  if (!tabLoginBtn) return;

  tabLoginBtn.addEventListener("click", () => {
    isSignUpMode = false;
    tabLoginBtn.classList.add("active");
    tabSignupBtn.classList.remove("active");
    signupFields.classList.add("hidden");
    authSubmitBtn.textContent = "Log In";
    authErrorMsg.classList.add("hidden");
    if (forgotPasswordBtn) forgotPasswordBtn.classList.remove("hidden");
  });

  tabSignupBtn.addEventListener("click", () => {
    isSignUpMode = true;
    tabSignupBtn.classList.add("active");
    tabLoginBtn.classList.remove("active");
    signupFields.classList.remove("hidden");
    authSubmitBtn.textContent = "Create Account";
    authErrorMsg.classList.add("hidden");
    if (forgotPasswordBtn) forgotPasswordBtn.classList.add("hidden");
  });

  if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener("click", async () => {
      const email = $("authEmail")?.value.trim();
      if (!email) {
        authErrorMsg.textContent = "Enter your email address above first to reset password.";
        authErrorMsg.classList.remove("hidden");
        return;
      }
      try {
        await sendPasswordResetEmail(auth, email);
        alert(`Password reset email sent to ${email}.`);
      } catch (err) {
        authErrorMsg.textContent = err.message || "Failed to send password reset email.";
        authErrorMsg.classList.remove("hidden");
      }
    });
  }

  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    authErrorMsg.classList.add("hidden");
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;

    try {
      authSubmitBtn.disabled = true;

      if (isSignUpMode) {
        const displayName = $("authDisplayName")?.value.trim() || "";
        const rawUsername = $("authUsername")?.value
          .trim()
          .replace(/^@+/, "")
          .toLowerCase();
        const mobileNumber = $("authMobileNumber")?.value.trim() || "";

        if (!displayName) throw new Error("Full Name / Display Name is required.");
        if (!rawUsername || rawUsername.length < 3) {
          throw new Error("Username must be at least 3 characters.");
        }
        if (!mobileNumber) {
          throw new Error("Mobile Number is required during registration.");
        }

        cleanupAccountSession();

        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const available = await isUsernameAvailable(rawUsername, cred.user.uid);
        const finalUsername = available
          ? rawUsername
          : `${rawUsername}_${cred.user.uid.slice(0, 4).toLowerCase()}`;

        await updateProfile(cred.user, { displayName });
        sendEmailVerification(cred.user).catch(() => {});

        await initializeAuthenticatedAccount(cred.user, {
          displayName,
          username: finalUsername,
          mobileNumber
        });
      } else {
        cleanupAccountSession();
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      authErrorMsg.textContent = err.message || "Authentication failed.";
      authErrorMsg.classList.remove("hidden");
    } finally {
      authSubmitBtn.disabled = false;
    }
  });

  $("googleSignInBtn").addEventListener("click", async () => {
    authErrorMsg.classList.add("hidden");
    cleanupAccountSession();
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (popupErr) {
      await signInWithRedirect(auth, googleProvider);
    }
  });

  getRedirectResult(auth).catch(() => {});
}

// ================= STRICT ACCOUNT INITIALIZATION & PRESENCE =================
async function initializeAuthenticatedAccount(firebaseUser, registrationExtras = null) {
  if (!firebaseUser || !firebaseUser.uid) return;
  const uid = String(firebaseUser.uid).trim();
  const sessionToken = ++authSessionToken;
  activeAuthUid = uid;

  const userRef = doc(db, "users", uid);
  let existingData = {};
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) existingData = snap.data() || {};
  } catch (err) {
    console.warn("Profile read warning:", err);
  }

  if (sessionToken !== authSessionToken || getAuthenticatedUid() !== uid) return;

  const currentDeviceTag = `${navigator.platform || "Device"} (${
    navigator.userAgent.includes("Android") ? "Android" : "Web"
  })`;

  if (
    existingData.lastDeviceTag &&
    existingData.lastDeviceTag !== currentDeviceTag &&
    $("securityAlertBanner")
  ) {
    const banner = $("securityAlertBanner");
    banner.innerHTML = `
      <span><i class="fa-solid fa-shield-halved"></i> New device login: <b>${escapeHtml(
        currentDeviceTag
      )}</b> (Previous: ${escapeHtml(existingData.lastDeviceTag)})</span>
      <button type="button" style="border:none;background:transparent;font-weight:bold;cursor:pointer;">✕</button>
    `;
    banner.classList.remove("hidden");
    banner.querySelector("button")?.addEventListener("click", () => banner.classList.add("hidden"));
  }

  const normalized = normalizeUserRecord(
    {
      ...existingData,
      uid,
      email: firebaseUser.email || existingData.email || "",
      displayName:
        registrationExtras?.displayName ||
        existingData.displayName ||
        firebaseUser.displayName ||
        (firebaseUser.email ? firebaseUser.email.split("@")[0] : "NexChat User"),
      username:
        registrationExtras?.username ||
        existingData.username ||
        (firebaseUser.email
          ? `${firebaseUser.email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "")}_${uid
              .slice(0, 4)
              .toLowerCase()}`
          : `user_${uid.slice(0, 6).toLowerCase()}`),
      mobileNumber: registrationExtras?.mobileNumber || existingData.mobileNumber || "",
      photoURL: existingData.photoURL || firebaseUser.photoURL || "",
      online: true,
      lastSeenMs: Date.now(),
      createdAtMs: existingData.createdAtMs || Date.now()
    },
    uid
  );

  myVerifiedProfile = normalized;
  allUsersMap.set(uid, normalized);
  updateMyHeaderUI();

  await setDoc(
    userRef,
    {
      uid: normalized.uid,
      displayName: normalized.displayName,
      username: normalized.username,
      email: normalized.email,
      mobileNumber: normalized.mobileNumber,
      photoURL: normalized.photoURL,
      bio: normalized.bio,
      online: true,
      lastSeenMs: Date.now(),
      createdAtMs: normalized.createdAtMs,
      lastDeviceTag: currentDeviceTag,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  if (sessionToken !== authSessionToken || getAuthenticatedUid() !== uid) return;

  if (unsubMyProfile) unsubMyProfile();
  unsubMyProfile = onSnapshot(userRef, (snap) => {
    if (getAuthenticatedUid() !== uid || !snap.exists()) return;
    myVerifiedProfile = normalizeUserRecord(snap.data(), uid);
    allUsersMap.set(uid, myVerifiedProfile);
    updateMyHeaderUI();
  });

  setupRealtimePresence(uid);
}

function setupRealtimePresence(uid) {
  try {
    const connectedRef = rtdbRef(rtdb, ".info/connected");
    const myStatusRef = rtdbRef(rtdb, `status/${uid}`);

    rtdbOnValue(connectedRef, (snap) => {
      if (getAuthenticatedUid() !== uid) return;
      if (snap.val() === true) {
        rtdbOnDisconnect(myStatusRef)
          .set({
            online: false,
            lastSeenMs: rtdbServerTimestamp(),
            typingTo: "",
            recordingTo: ""
          })
          .then(() => {
            rtdbSet(myStatusRef, {
              online: true,
              lastSeenMs: Date.now(),
              typingTo: "",
              recordingTo: ""
            });
          })
          .catch(() => {});
      }
    });
  } catch (e) {}
}

function setMyLiveActivity(typingToChatId = "", recordingToChatId = "") {
  const uid = getAuthenticatedUid();
  if (!uid) return;
  try {
    rtdbUpdate(rtdbRef(rtdb, `status/${uid}`), {
      online: true,
      lastSeenMs: Date.now(),
      typingTo: typingToChatId,
      recordingTo: recordingToChatId
    }).catch(() => {});
  } catch (e) {}
}

function updateMyHeaderUI() {
  const uid = getAuthenticatedUid();
  if (!uid || !myVerifiedProfile || myVerifiedProfile.uid !== uid) return;

  setSafeAvatar($("myHeaderAvatar"), myVerifiedProfile.photoURL, myVerifiedProfile.displayName);
  setSafeAvatar($("myStatusAvatar"), myVerifiedProfile.photoURL, myVerifiedProfile.displayName);
  setSafeAvatar($("profileModalAvatar"), myVerifiedProfile.photoURL, myVerifiedProfile.displayName);

  if ($("editDisplayNameInput")) $("editDisplayNameInput").value = myVerifiedProfile.displayName;
  if ($("editUsernameInput")) $("editUsernameInput").value = myVerifiedProfile.username;
  if ($("editMobileInput")) $("editMobileInput").value = myVerifiedProfile.mobileNumber || "";
  if ($("editBioInput")) $("editBioInput").value = myVerifiedProfile.bio;
}

// ================= USER DIRECTORY & SEARCH =================
function subscribeAllUsers() {
  const uid = getAuthenticatedUid();
  if (!uid) return;
  if (unsubUsers) unsubUsers();

  unsubUsers = onSnapshot(
    collection(db, "users"),
    (snapshot) => {
      if (getAuthenticatedUid() !== uid) return;
      snapshot.docs.forEach((docSnap) => {
        const u = normalizeUserRecord(docSnap.data(), docSnap.id);
        if (u && u.uid) {
          allUsersMap.set(u.uid, u);
        }
      });

      if (activePeerUser && !activeChatIsGroup && allUsersMap.has(activePeerUser.uid)) {
        activePeerUser = allUsersMap.get(activePeerUser.uid);
        refreshActiveChatHeader();
      }
      renderChatList(latestChatItems);
    },
    (err) => console.error("Users listener error:", err)
  );
}

async function performUserSearch(rawQuery) {
  const myUid = getAuthenticatedUid();
  if (!myUid) return;

  const q = String(rawQuery || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
  const resultsList = $("searchResultsList");
  const statusText = $("searchStatusText");
  if (!resultsList || !statusText) return;

  if (allUsersMap.size <= 1) {
    try {
      const snap = await getDocs(collection(db, "users"));
      snap.docs.forEach((d) => {
        const u = normalizeUserRecord(d.data(), d.id);
        if (u && u.uid) allUsersMap.set(u.uid, u);
      });
    } catch (e) {}
  }

  const candidates = [];
  allUsersMap.forEach((userObj) => {
    if (!userObj || !userObj.uid || userObj.uid === myUid) return;
    if (!q) {
      candidates.push(userObj);
      return;
    }
    const matchName = userObj.displayName.toLowerCase().includes(q);
    const matchUsername = userObj.username.toLowerCase().includes(q);
    if (matchName || matchUsername) {
      candidates.push(userObj);
    }
  });

  resultsList.innerHTML = "";

  if (candidates.length === 0) {
    statusText.textContent = q
      ? `No user found matching "${rawQuery}"`
      : "No other registered users found";
    return;
  }

  statusText.textContent = q
    ? `Found ${candidates.length} user(s) — Tap to chat`
    : `Directory (${candidates.length} users)`;

  candidates.forEach((targetUser) => {
    const item = document.createElement("div");
    item.className = "wa-item";
    item.dataset.targetUid = targetUser.uid;
    item.innerHTML = `
      <div class="avatar-wrap">
        <img alt="${escapeHtml(targetUser.displayName)}" />
        <span class="online-dot ${targetUser.online ? "" : "hidden"}"></span>
      </div>
      <div class="wa-item-info">
        <div class="wa-item-top">
          <span class="wa-item-title">${escapeHtml(targetUser.displayName)}</span>
        </div>
        <div class="wa-item-bottom">
          <span class="wa-item-sub">@${escapeHtml(targetUser.username)}</span>
        </div>
      </div>
    `;
    setSafeAvatar(item.querySelector("img"), targetUser.photoURL, targetUser.displayName);

    item.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await openOrCreateDirectChat(targetUser.uid);
    });

    resultsList.appendChild(item);
  });
}

// ================= OPEN OR CREATE DIRECT CONVERSATION =================
async function openOrCreateDirectChat(targetUserUid) {
  const myUid = assertValidSenderIdentity();
  const cleanTargetUid = String(targetUserUid || "").trim();

  if (!cleanTargetUid || cleanTargetUid === myUid) return;

  const sessionToken = authSessionToken;

  let peerProfile = allUsersMap.get(cleanTargetUid) || null;
  try {
    const peerSnap = await getDoc(doc(db, "users", cleanTargetUid));
    if (peerSnap.exists()) {
      peerProfile = normalizeUserRecord(peerSnap.data(), cleanTargetUid);
      allUsersMap.set(cleanTargetUid, peerProfile);
    }
  } catch (err) {
    console.warn("Using cached peer profile:", err);
  }

  if (sessionToken !== authSessionToken || getAuthenticatedUid() !== myUid) return;
  if (!peerProfile) {
    alert("Could not load contact profile.");
    return;
  }

  const chatId = getDeterministicChatId(myUid, cleanTargetUid);
  activeChatId = chatId;
  activeChatIsGroup = false;
  activeGroupData = null;
  activePeerUser = peerProfile;
  clearActiveReply();
  hideChatErrorBanner();

  if ($("searchResultsPanel")) $("searchResultsPanel").classList.add("hidden");
  if ($("searchBarContainer")) $("searchBarContainer").classList.add("hidden");
  if ($("userSearchInput")) $("userSearchInput").value = "";
  if ($("clearSearchInputBtn")) $("clearSearchInputBtn").classList.add("hidden");

  refreshActiveChatHeader();
  switchScreen("chatScreen");
  applyCriticalLayoutFixes();

  const myProfile = myVerifiedProfile || normalizeUserRecord(auth.currentUser, myUid);
  const myInfo = {
    uid: myUid,
    displayName: myProfile.displayName,
    username: myProfile.username,
    photoURL: myProfile.photoURL
  };
  const peerInfo = {
    uid: peerProfile.uid,
    displayName: peerProfile.displayName,
    username: peerProfile.username,
    photoURL: peerProfile.photoURL
  };

  try {
    const chatRef = doc(db, "chats", chatId);
    const chatSnap = await getDoc(chatRef);

    if (!chatSnap.exists()) {
      await setDoc(chatRef, {
        chatId,
        isGroup: false,
        participants: [myUid, peerProfile.uid],
        participantDetails: {
          [myUid]: myInfo,
          [peerProfile.uid]: peerInfo
        },
        lastMessage: "",
        lastSenderId: "",
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now(),
        [`unread_${myUid}`]: 0,
        [`unread_${peerProfile.uid}`]: 0
      });
    } else {
      await setDoc(
        chatRef,
        {
          participants: [myUid, peerProfile.uid],
          participantDetails: {
            [myUid]: myInfo,
            [peerProfile.uid]: peerInfo
          },
          [`unread_${myUid}`]: 0
        },
        { merge: true }
      );
    }
  } catch (err) {
    console.error("Parent chat doc initialization error:", err);
  }

  if (sessionToken !== authSessionToken || getAuthenticatedUid() !== myUid) return;

  subscribePeerRealtimePresence(peerProfile.uid);
  subscribeMessages(chatId);
}

function subscribePeerRealtimePresence(peerUid) {
  if (unsubPeerPresence) unsubPeerPresence();
  try {
    const statusRef = rtdbRef(rtdb, `status/${peerUid}`);
    unsubPeerPresence = rtdbOnValue(statusRef, (snap) => {
      if (!activePeerUser || activePeerUser.uid !== peerUid) return;
      const val = snap.val();
      if (!val) return;

      activePeerUser.online = Boolean(val.online);
      if (val.lastSeenMs && typeof val.lastSeenMs === "number") {
        activePeerUser.lastSeenMs = val.lastSeenMs;
      }

      const statusEl = $("chatPeerStatus");
      if (!statusEl) return;

      if (val.recordingTo === activeChatId) {
        statusEl.textContent = "recording audio...";
      } else if (val.typingTo === activeChatId) {
        statusEl.textContent = "typing...";
      } else {
        refreshActiveChatHeader();
      }
    });
  } catch (e) {}
}

function refreshActiveChatHeader() {
  if (activeChatIsGroup && activeGroupData) {
    setSafeAvatar($("chatPeerAvatar"), activeGroupData.photoURL, activeGroupData.name);
    $("chatPeerName").textContent = activeGroupData.name;
    const count = Array.isArray(activeGroupData.members) ? activeGroupData.members.length : 1;
    $("chatPeerStatus").textContent = `${count} members • Tap header for admin options`;
    if ($("chatPeerOnlineDot")) $("chatPeerOnlineDot").classList.add("hidden");
    return;
  }

  if (!activePeerUser) return;
  setSafeAvatar($("chatPeerAvatar"), activePeerUser.photoURL, activePeerUser.displayName);
  $("chatPeerName").textContent = activePeerUser.displayName;
  $("chatPeerStatus").textContent = activePeerUser.online
    ? "online"
    : activePeerUser.lastSeenMs
    ? `last seen ${formatTime(activePeerUser.lastSeenMs)}`
    : `@${activePeerUser.username}`;

  if ($("chatPeerOnlineDot")) {
    $("chatPeerOnlineDot").classList.toggle("hidden", !activePeerUser.online);
  }
}

// ================= REAL-TIME CHAT LIST =================
function subscribeChatList() {
  const myUid = getAuthenticatedUid();
  if (!myUid) return;
  if (unsubChats) unsubChats();

  const chatsQuery = query(
    collection(db, "chats"),
    where("participants", "array-contains", myUid)
  );

  unsubChats = onSnapshot(
    chatsQuery,
    (snapshot) => {
      if (getAuthenticatedUid() !== myUid) return;

      const items = [];
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const chatId = docSnap.id;
        const participants = Array.isArray(data.participants) ? data.participants : [];
        if (!participants.includes(myUid)) return;

        const peerUid = participants.find((id) => id !== myUid) || "";
        if (!peerUid) return;

        const directoryPeer = allUsersMap.get(peerUid);
        const storedPeer = (data.participantDetails && data.participantDetails[peerUid]) || {};

        const peerName =
          directoryPeer?.displayName || storedPeer.displayName || "NexChat User";
        const peerUsername =
          directoryPeer?.username || storedPeer.username || "user";
        const peerPhoto =
          directoryPeer?.photoURL || storedPeer.photoURL || getFallbackAvatar(peerName);

        const updatedAtMs =
          Number(data.updatedAtMs) ||
          (data.updatedAt?.toMillis ? data.updatedAt.toMillis() : 0) ||
          0;

        const unreadCount = Number(data[`unread_${myUid}`] || 0);

        items.push({
          chatId,
          peerUid,
          peerName,
          peerUsername,
          peerPhoto,
          lastMessage: data.lastMessage || "Tap to start chatting",
          lastSenderId: data.lastSenderId || "",
          updatedAtMs,
          unreadCount
        });
      });

      latestChatItems = items;
      renderChatList(items);
    },
    (err) => {
      console.error("Chat list subscription error:", err);
    }
  );
}

function renderChatList(chatItems) {
  const myUid = getAuthenticatedUid();
  if (!myUid) return;

  const container = $("chatListContainer");
  const emptyState = $("emptyChatsState");
  const totalUnreadBadge = $("totalUnreadBadge");
  if (!container) return;

  let filtered = [...chatItems];
  if (activeChatFilter === "unread") {
    filtered = filtered.filter((c) => (c.unreadCount || 0) > 0);
  }

  filtered.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  container.innerHTML = "";

  if (filtered.length === 0) {
    if (emptyState) emptyState.classList.remove("hidden");
  } else {
    if (emptyState) emptyState.classList.add("hidden");
  }

  let totalUnread = 0;
  chatItems.forEach((c) => {
    totalUnread += c.unreadCount || 0;
  });

  filtered.forEach((item) => {
    const livePeer = allUsersMap.get(item.peerUid) || {
      uid: item.peerUid,
      displayName: item.peerName,
      username: item.peerUsername,
      photoURL: item.peerPhoto,
      online: false
    };

    const row = document.createElement("div");
    row.className = "wa-item";
    const tickHtml =
      item.lastSenderId === myUid
        ? `<i class="fa-solid fa-check-double msg-ticks read"></i> `
        : "";

    row.innerHTML = `
      <div class="avatar-wrap">
        <img alt="${escapeHtml(livePeer.displayName)}" />
        <span class="online-dot ${livePeer.online ? "" : "hidden"}"></span>
      </div>
      <div class="wa-item-info">
        <div class="wa-item-top">
          <span class="wa-item-title">${escapeHtml(livePeer.displayName)}</span>
          <span class="wa-item-time ${item.unreadCount > 0 ? "unread-time" : ""}">${formatTime(
      item.updatedAtMs
    )}</span>
        </div>
        <div class="wa-item-bottom">
          <span class="wa-item-sub">${tickHtml}${escapeHtml(
      item.lastMessage || "Tap to message"
    )}</span>
          ${
            item.unreadCount > 0
              ? `<span class="unread-badge">${item.unreadCount}</span>`
              : ""
          }
        </div>
      </div>
    `;

    setSafeAvatar(row.querySelector("img"), livePeer.photoURL, livePeer.displayName);
    row.addEventListener("click", () => openOrCreateDirectChat(livePeer.uid));
    container.appendChild(row);
  });

  if (totalUnreadBadge) {
    if (totalUnread > 0) {
      totalUnreadBadge.textContent = String(totalUnread);
      totalUnreadBadge.classList.remove("hidden");
    } else {
      totalUnreadBadge.classList.add("hidden");
    }
  }
}

// ================= REAL-TIME MESSAGES (SENDING -> SENT -> READ / FAILED) =================
function subscribeMessages(chatId) {
  const myUid = getAuthenticatedUid();
  if (!myUid || !chatId) return;

  if (unsubMessages) {
    unsubMessages();
    unsubMessages = null;
  }

  activeMessagesMap.clear();
  if ($("messagesList")) $("messagesList").innerHTML = "";

  const collectionRoot = activeChatIsGroup ? "groups" : "chats";
  const msgsRef = collection(db, collectionRoot, chatId, "messages");

  unsubMessages = onSnapshot(
    msgsRef,
    (snapshot) => {
      if (getAuthenticatedUid() !== myUid || activeChatId !== chatId) return;
      hideChatErrorBanner();

      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (Array.isArray(data.deletedFor) && data.deletedFor.includes(myUid)) {
          activeMessagesMap.delete(docSnap.id);
          return;
        }

        const msgObj = {
          id: docSnap.id,
          ...data,
          status: data.read ? "read" : data.status || "sent"
        };
        activeMessagesMap.set(docSnap.id, msgObj);

        if (data.senderId && data.senderId !== myUid && !data.read) {
          updateDoc(doc(db, collectionRoot, chatId, "messages", docSnap.id), {
            read: true,
            status: "read"
          }).catch(() => {});

          if (!activeChatIsGroup) {
            updateDoc(doc(db, "chats", chatId), {
              [`unread_${myUid}`]: 0
            }).catch(() => {});
          }
        }
      });

      renderMessagesFromMap();
    },
    (err) => {
      console.error("Realtime message listener error:", err);
      showChatErrorBanner(
        `Message sync error (${err.code || "permission-denied"}). Check Firestore Rules.`
      );
    }
  );
}

function renderMessagesFromMap(searchHighlight = "") {
  const myUid = getAuthenticatedUid();
  if (!myUid) return;

  const listEl = $("messagesList");
  const viewport = $("messagesViewport");
  if (!listEl || !viewport) return;

  const messages = Array.from(activeMessagesMap.values()).sort((a, b) => {
    const timeA =
      Number(a.createdAtMs) ||
      (a.timestamp?.toMillis ? a.timestamp.toMillis() : 0) ||
      0;
    const timeB =
      Number(b.createdAtMs) ||
      (b.timestamp?.toMillis ? b.timestamp.toMillis() : 0) ||
      0;
    return timeA - timeB;
  });

  listEl.innerHTML = "";
  const filterLower = String(searchHighlight || "").trim().toLowerCase();

  messages.forEach((msg) => {
    if (filterLower && !String(msg.text || "").toLowerCase().includes(filterLower)) {
      return;
    }

    const isMe = String(msg.senderId || "").trim() === myUid;
    const row = document.createElement("div");
    row.className = `msg-row ${isMe ? "outgoing" : "incoming"}`;

    const senderProfile = allUsersMap.get(msg.senderId);
    const verifiedSenderName = isMe
      ? myVerifiedProfile?.displayName || "You"
      : senderProfile?.displayName || msg.senderName || "User";

    const groupSenderHeader =
      activeChatIsGroup && !isMe
        ? `<div style="font-size:12px;font-weight:700;color:#008069;margin-bottom:2px;">${escapeHtml(
            verifiedSenderName
          )}</div>`
        : "";

    const forwardedHtml = msg.isForwarded
      ? `<div class="msg-forwarded-tag"><i class="fa-solid fa-share"></i> Forwarded</div>`
      : "";

    const quotedHtml =
      msg.replyTo && msg.replyTo.text
        ? `<div class="msg-quoted-box">
             <span class="msg-quoted-sender">${escapeHtml(msg.replyTo.senderName || "User")}</span>
             <div class="msg-quoted-text">${escapeHtml(msg.replyTo.text)}</div>
           </div>`
        : "";

    let mediaHtml = "";
    if (msg.mediaUrl) {
      const mType = msg.messageType || msg.mediaType || "image";
      if (mType === "video") {
        mediaHtml = `<div class="msg-media"><video src="${msg.mediaUrl}" controls playsinline></video></div>`;
      } else if (mType === "audio") {
        mediaHtml = `<div class="msg-media"><audio src="${msg.mediaUrl}" controls></audio></div>`;
      } else if (mType === "file") {
        mediaHtml = `<div class="msg-media"><a href="${msg.mediaUrl}" target="_blank" rel="noopener" style="color:#008069;font-weight:600;"><i class="fa-solid fa-file-lines"></i> Open Attachment</a></div>`;
      } else {
        mediaHtml = `<div class="msg-media"><img src="${msg.mediaUrl}" alt="Attachment" /></div>`;
      }
    }

    const timeText = formatTime(msg.createdAtMs || msg.timestamp);
    let statusHtml = "";
    if (isMe) {
      if (msg.status === "sending") {
        statusHtml = `<span style="font-size:10.5px;color:#667781;">⏳ Sending...</span>`;
      } else if (msg.status === "failed") {
        statusHtml = `<span style="color:#ea0038;font-weight:700;cursor:pointer;font-size:11px;" class="retry-trigger">⚠️ Failed — Tap to Retry</span>`;
      } else if (msg.read || msg.status === "read") {
        statusHtml = `<i class="fa-solid fa-check-double msg-ticks read" title="Read"></i>`;
      } else {
        statusHtml = `<i class="fa-solid fa-check-double msg-ticks" title="Sent"></i>`;
      }
    }

    row.innerHTML = `
      <div class="swipe-reply-indicator"><i class="fa-solid fa-reply"></i></div>
      <div class="msg-bubble-wrap">
        <div class="msg-bubble">
          ${groupSenderHeader}
          ${forwardedHtml}
          ${quotedHtml}
          ${mediaHtml}
          ${msg.text ? `<div class="msg-text">${escapeHtml(msg.text)}</div>` : ""}
          <div class="msg-meta">
            <span class="msg-time">${timeText}</span>
            ${statusHtml}
          </div>
        </div>
        <button type="button" class="msg-forward-btn" title="Forward message">
          <i class="fa-solid fa-share"></i>
        </button>
      </div>
    `;

    const wrapEl = row.querySelector(".msg-bubble-wrap");
    const indicatorEl = row.querySelector(".swipe-reply-indicator");
    const forwardBtn = row.querySelector(".msg-forward-btn");
    const retryTrigger = row.querySelector(".retry-trigger");

    attachSwipeRightToReply(row, wrapEl, indicatorEl, msg);

    if (forwardBtn) {
      forwardBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openForwardModal(msg);
      });
    }

    if (retryTrigger) {
      retryTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        retryFailedMessage(msg);
      });
    }

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      promptMessageDeletion(msg, isMe);
    });
    row.addEventListener("dblclick", () => {
      promptMessageDeletion(msg, isMe);
    });

    listEl.appendChild(row);
  });

  requestAnimationFrame(() => {
    viewport.scrollTop = viewport.scrollHeight;
  });
}

async function promptMessageDeletion(msg, isMe) {
  const myUid = getAuthenticatedUid();
  if (!myUid || !activeChatId) return;
  const collectionRoot = activeChatIsGroup ? "groups" : "chats";
  const msgRef = doc(db, collectionRoot, activeChatId, "messages", msg.id);

  if (isMe) {
    const choice = prompt(
      'Type "1" to Delete for Everyone, or "2" to Delete for Me:',
      "1"
    );
    if (choice === "1") {
      await updateDoc(msgRef, {
        text: "🚫 This message was deleted",
        mediaUrl: "",
        isForwarded: false,
        replyTo: null
      });
    } else if (choice === "2") {
      await updateDoc(msgRef, {
        deletedFor: arrayUnion(myUid)
      });
    }
  } else {
    if (confirm("Delete this message for you?")) {
      await updateDoc(msgRef, {
        deletedFor: arrayUnion(myUid)
      });
    }
  }
}

// ================= FIXED MESSAGE SENDING FLOW =================
async function sendChatMessage(
  text = "",
  mediaUrl = "",
  messageType = "text",
  isForwarded = false
) {
  let senderUid = "";
  try {
    senderUid = assertValidSenderIdentity();
  } catch (err) {
    showChatErrorBanner(err.message);
    return;
  }

  if (!activeChatIsGroup && !activeChatId && activePeerUser && activePeerUser.uid) {
    activeChatId = getDeterministicChatId(senderUid, activePeerUser.uid);
  }

  if (!activeChatId) {
    showChatErrorBanner("No active conversation selected.");
    return;
  }
  if (!activeChatIsGroup && (!activePeerUser || !activePeerUser.uid)) {
    showChatErrorBanner("Recipient profile is missing. Please reopen the chat.");
    return;
  }

  const cleanText = String(text || "").trim();
  if (!cleanText && !mediaUrl) return;

  const receiverUid = activeChatIsGroup
    ? String(activeChatId).trim()
    : String(activePeerUser.uid || "").trim();

  if (!activeChatIsGroup && (!receiverUid || receiverUid === senderUid)) {
    showChatErrorBanner("Invalid recipient UID.");
    return;
  }

  const nowMs = Date.now();
  const msgId = `msg_${nowMs}_${Math.random().toString(36).slice(2, 8)}`;

  const senderProfile =
    myVerifiedProfile || normalizeUserRecord(auth.currentUser, senderUid);
  const senderName = String(senderProfile?.displayName || "NexChat User").trim();
  const senderUsername = String(senderProfile?.username || "user").trim();
  const senderPhoto = String(
    senderProfile?.photoURL || getFallbackAvatar(senderName)
  ).trim();

  const replyPayload = activeReplyTo
    ? {
        msgId: String(activeReplyTo.msgId || ""),
        senderName: String(activeReplyTo.senderName || "User"),
        text: String(activeReplyTo.text || "")
      }
    : null;

  const participantsList = activeChatIsGroup
    ? Array.isArray(activeGroupData?.members) && activeGroupData.members.length > 0
      ? activeGroupData.members
      : [senderUid]
    : [senderUid, receiverUid];

  const msgData = {
    id: msgId,
    chatId: activeChatId,
    senderId: senderUid,
    receiverId: receiverUid, // FIXED: Properly mapped to receiverUid
    participants: participantsList,
    senderName,
    senderUsername,
    senderPhoto,
    text: cleanText,
    mediaUrl: String(mediaUrl || ""),
    messageType: String(messageType || "text"),
    mediaType: String(messageType || "text"),
    isForwarded: Boolean(isForwarded),
    replyTo: replyPayload,
    createdAtMs: nowMs,
    status: "sending",
    read: false
  };

  if ($("messageTextInput")) {
    $("messageTextInput").value = "";
  }
  clearActiveReply();
  setMyLiveActivity("", "");

  // 1. Render immediately in "sending" state
  activeMessagesMap.set(msgId, { ...msgData, status: "sending" });
  renderMessagesFromMap();

  // 2. Persist to Firestore and update status to "sent" or "failed"
  await persistMessageToFirestore(msgData);
}

async function persistMessageToFirestore(msgData) {
  let senderUid = "";
  try {
    senderUid = assertValidSenderIdentity();
  } catch (err) {
    showChatErrorBanner(err.message);
    return;
  }

  if (msgData.senderId !== senderUid) {
    showChatErrorBanner("Account changed before message could be sent.");
    return;
  }

  const collectionRoot = activeChatIsGroup ? "groups" : "chats";
  const msgRef = doc(db, collectionRoot, msgData.chatId, "messages", msgData.id);

  const previewText =
    msgData.text ||
    (msgData.messageType === "audio"
      ? "🎤 Voice message"
      : msgData.messageType === "video"
      ? "🎥 Video"
      : "📷 Attachment");

  try {
    // Step A: Update/Create parent chat document FIRST so Firestore security rules find participants
    if (!activeChatIsGroup && activePeerUser && activePeerUser.uid) {
      const myInfo = {
        uid: senderUid,
        displayName: msgData.senderName,
        username: msgData.senderUsername,
        photoURL: msgData.senderPhoto
      };
      const peerInfo = {
        uid: activePeerUser.uid,
        displayName: activePeerUser.displayName,
        username: activePeerUser.username,
        photoURL: activePeerUser.photoURL
      };

      await setDoc(
        doc(db, "chats", msgData.chatId),
        {
          chatId: msgData.chatId,
          isGroup: false,
          participants: [senderUid, activePeerUser.uid],
          participantDetails: {
            [senderUid]: myInfo,
            [activePeerUser.uid]: peerInfo
          },
          lastMessage: previewText,
          lastSenderId: senderUid,
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
          [`unread_${activePeerUser.uid}`]: increment(1)
        },
        { merge: true }
      );
    } else if (activeChatIsGroup) {
      await updateDoc(doc(db, "groups", msgData.chatId), {
        lastMessage: `${msgData.senderName}: ${previewText}`,
        updatedAtMs: Date.now()
      });
    }

    // Step B: Write the message document to chats/{chatId}/messages/{messageId}
    await setDoc(msgRef, {
      ...msgData,
      status: "sent",
      timestamp: serverTimestamp()
    });

    hideChatErrorBanner();
    activeMessagesMap.set(msgData.id, { ...msgData, status: "sent" });
    renderMessagesFromMap();
  } catch (err) {
    console.error("Firestore message write failed:", err);
    activeMessagesMap.set(msgData.id, { ...msgData, status: "failed" });
    renderMessagesFromMap();
    showChatErrorBanner(
      `Failed to send message (${err.code || err.message}). Tap the red message to retry.`
    );
  }
}

async function retryFailedMessage(msgObj) {
  if (!msgObj) return;
  activeMessagesMap.set(msgObj.id, { ...msgObj, status: "sending" });
  renderMessagesFromMap();
  await persistMessageToFirestore(msgObj);
}

// ================= SWIPE-TO-REPLY & FORWARDING =================
function setActiveReply(msg) {
  const myUid = getAuthenticatedUid();
  if (!$("replyPreviewBar") || !myUid) return;
  const senderLabel =
    msg.senderId === myUid
      ? "You"
      : allUsersMap.get(msg.senderId)?.displayName || msg.senderName || "User";
  const snippet =
    msg.text || (msg.messageType === "audio" ? "🎤 Voice message" : "📷 Media");

  activeReplyTo = {
    msgId: msg.id,
    senderName: senderLabel,
    text: snippet
  };

  $("replyPreviewSender").textContent = senderLabel;
  $("replyPreviewText").textContent = snippet;
  $("replyPreviewBar").classList.remove("hidden");
  $("messageTextInput")?.focus();
}

function clearActiveReply() {
  activeReplyTo = null;
  if ($("replyPreviewBar")) $("replyPreviewBar").classList.add("hidden");
}

function attachSwipeRightToReply(rowEl, wrapEl, indicatorEl, msg) {
  if (!wrapEl || !indicatorEl) return;
  let startX = 0;
  let startY = 0;
  let currentDx = 0;
  let tracking = false;

  rowEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentDx = 0;
      tracking = true;
      wrapEl.style.transition = "none";
    },
    { passive: true }
  );

  rowEl.addEventListener(
    "touchmove",
    (e) => {
      if (!tracking || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (dx > 6 && dx > Math.abs(dy) * 1.2) {
        currentDx = Math.min(dx, 72);
        wrapEl.style.transform = `translateX(${currentDx}px)`;
        indicatorEl.style.opacity = String(Math.min(currentDx / 52, 1));
      }
    },
    { passive: true }
  );

  const finishSwipe = () => {
    if (!tracking) return;
    tracking = false;
    wrapEl.style.transition = "transform 0.18s ease-out";
    wrapEl.style.transform = "translateX(0px)";
    indicatorEl.style.opacity = "0";
    if (currentDx >= 48) {
      if (navigator.vibrate) navigator.vibrate(20);
      setActiveReply(msg);
    }
    currentDx = 0;
  };

  rowEl.addEventListener("touchend", finishSwipe);
  rowEl.addEventListener("touchcancel", finishSwipe);
}

function openForwardModal(msg) {
  const myUid = getAuthenticatedUid();
  if (!myUid || !$("forwardModal")) return;
  messageToForward = msg;
  const listEl = $("forwardUserList");
  listEl.innerHTML = "";

  allUsersMap.forEach((u) => {
    if (!u || u.uid === myUid) return;
    const item = document.createElement("div");
    item.className = "wa-item";
    item.innerHTML = `
      <div class="avatar-wrap">
        <img alt="${escapeHtml(u.displayName)}" />
      </div>
      <div class="wa-item-info">
        <div class="wa-item-top">
          <span class="wa-item-title">${escapeHtml(u.displayName)}</span>
        </div>
        <div class="wa-item-bottom">
          <span class="wa-item-sub">@${escapeHtml(u.username)}</span>
        </div>
      </div>
    `;
    setSafeAvatar(item.querySelector("img"), u.photoURL, u.displayName);

    item.addEventListener("click", async () => {
      $("forwardModal").classList.add("hidden");
      await openOrCreateDirectChat(u.uid);
      await sendChatMessage(
        messageToForward.text || "",
        messageToForward.mediaUrl || "",
        messageToForward.messageType || "text",
        true
      );
      messageToForward = null;
    });

    listEl.appendChild(item);
  });

  $("forwardModal").classList.remove("hidden");
}

// ================= VOICE MESSAGES =================
async function toggleVoiceRecording() {
  if (!activeChatId) return;

  if (isRecordingVoice && mediaRecorder) {
    isRecordingVoice = false;
    if (mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedAudioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedAudioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recordingTimerInterval);
      setMyLiveActivity("", "");
      if ($("messageTextInput")) $("messageTextInput").placeholder = "Message";
      const micBtn = $("voiceRecordToggleBtn");
      if (micBtn) micBtn.style.color = "";

      if (recordedAudioChunks.length === 0) return;

      const audioBlob = new Blob(recordedAudioChunks, { type: "audio/webm" });
      const audioFile = new File([audioBlob], `voice_${Date.now()}.webm`, {
        type: "audio/webm"
      });
      try {
        const url = await uploadMediaFile(audioFile);
        await sendChatMessage("", url, "audio", false);
      } catch (err) {
        showChatErrorBanner(err.message);
      }
    };

    isRecordingVoice = true;
    recordingStartTimeMs = Date.now();
    mediaRecorder.start();
    setMyLiveActivity("", activeChatId);

    const micBtn = $("voiceRecordToggleBtn");
    if (micBtn) micBtn.style.color = "#ea0038";

    recordingTimerInterval = setInterval(() => {
      const secs = Math.floor((Date.now() - recordingStartTimeMs) / 1000);
      if ($("messageTextInput")) {
        $("messageTextInput").placeholder = `🔴 Recording ${secs}s... Tap mic again to send`;
      }
    }, 500);
  } catch (err) {
    alert("Microphone permission is required to record voice notes.");
  }
}

// ================= GROUP CHAT & ADMIN PERMISSIONS =================
function subscribeGroups() {
  const myUid = getAuthenticatedUid();
  if (!myUid) return;
  if (unsubGroups) unsubGroups();

  const qGroups = query(
    collection(db, "groups"),
    where("members", "array-contains", myUid)
  );

  unsubGroups = onSnapshot(
    qGroups,
    (snap) => {
      if (getAuthenticatedUid() !== myUid) return;
      const container = $("groupListContainer");
      if (!container) return;
      container.innerHTML = "";

      snap.docs.forEach((docSnap) => {
        const g = { id: docSnap.id, ...docSnap.data() };
        const row = document.createElement("div");
        row.className = "wa-item";
        row.innerHTML = `
          <div class="group-icon-circle"><i class="fa-solid fa-users"></i></div>
          <div class="wa-item-info">
            <div class="wa-item-top">
              <span class="wa-item-title">${escapeHtml(g.name || "Group")}</span>
              <span class="wa-item-time">${formatTime(g.updatedAtMs || g.createdAtMs)}</span>
            </div>
            <div class="wa-item-bottom">
              <span class="wa-item-sub">${escapeHtml(
                g.lastMessage || g.description || "Tap to open group chat"
              )}</span>
            </div>
          </div>
        `;
        row.addEventListener("click", () => openGroupChat(g));
        container.appendChild(row);
      });
    },
    () => {}
  );
}

function openGroupChat(groupObj) {
  assertValidSenderIdentity();
  activeChatId = groupObj.id;
  activeChatIsGroup = true;
  activeGroupData = groupObj;
  activePeerUser = null;
  clearActiveReply();
  hideChatErrorBanner();

  refreshActiveChatHeader();
  switchScreen("chatScreen");
  applyCriticalLayoutFixes();
  subscribeMessages(groupObj.id);
}

async function manageActiveGroupAdmins() {
  const myUid = getAuthenticatedUid();
  if (!myUid || !activeChatIsGroup || !activeGroupData) return;

  const admins = Array.isArray(activeGroupData.admins) ? activeGroupData.admins : [];
  const isAdmin =
    activeGroupData.primaryAdmin === myUid || admins.includes(myUid);

  if (!isAdmin) {
    alert(
      `Group: ${activeGroupData.name}\nOnly Group Admins can manage members.`
    );
    return;
  }

  const action = prompt(
    `Group Admin Menu (${activeGroupData.name}):\n1 = Add member by @username\n2 = Promote member to Admin\n3 = Remove member`,
    "1"
  );
  if (!action) return;

  const targetUname = prompt("Enter @username:")
    ?.trim()
    .replace(/^@+/, "")
    .toLowerCase();
  if (!targetUname) return;

  let targetUser = null;
  allUsersMap.forEach((u) => {
    if (u.username.toLowerCase() === targetUname) targetUser = u;
  });

  if (!targetUser) {
    alert(`User @${targetUname} not found.`);
    return;
  }

  const groupRef = doc(db, "groups", activeGroupData.id);
  if (action === "1") {
    await updateDoc(groupRef, { members: arrayUnion(targetUser.uid) });
    alert(`${targetUser.displayName} added to the group.`);
  } else if (action === "2") {
    await updateDoc(groupRef, {
      members: arrayUnion(targetUser.uid),
      admins: arrayUnion(targetUser.uid)
    });
    alert(`${targetUser.displayName} promoted to Group Admin.`);
  } else if (action === "3") {
    if (targetUser.uid === activeGroupData.primaryAdmin) {
      alert("Cannot remove the Primary Group Creator.");
      return;
    }
    await updateDoc(groupRef, {
      members: arrayRemove(targetUser.uid),
      admins: arrayRemove(targetUser.uid)
    });
    alert(`${targetUser.displayName} removed from the group.`);
  }
}

// ================= 24-HOUR STATUS / STORIES =================
function subscribeStatuses() {
  const myUid = getAuthenticatedUid();
  if (!myUid) return;
  if (unsubStatuses) unsubStatuses();

  unsubStatuses = onSnapshot(
    collection(db, "statuses"),
    (snap) => {
      if (getAuthenticatedUid() !== myUid) return;
      const container = $("statusListContainer");
      if (!container) return;
      container.innerHTML = "";
      const now = Date.now();

      snap.docs.forEach((d) => {
        const st = { id: d.id, ...d.data() };
        const expiresAt = Number(st.expiresAtMs) || Number(st.createdAtMs || 0) + 86400000;
        if (now > expiresAt) return;

        const viewers = Array.isArray(st.viewers) ? st.viewers : [];
        const div = document.createElement("div");
        div.className = "wa-item";
        div.innerHTML = `
          <div class="avatar-wrap">
            <img alt="${escapeHtml(st.userName || "User")}" />
          </div>
          <div class="wa-item-info">
            <div class="wa-item-top">
              <span class="wa-item-title">${escapeHtml(st.userName || "User")}</span>
              <span class="wa-item-time">${formatTime(st.createdAtMs)}</span>
            </div>
            <div class="wa-item-bottom">
              <span class="wa-item-sub">${escapeHtml(st.caption || "Status update")}</span>
              <span style="font-size:12px;color:#008069;"><i class="fa-regular fa-eye"></i> ${
                viewers.length
              }</span>
            </div>
          </div>
        `;
        setSafeAvatar(div.querySelector("img"), st.userPhoto, st.userName);

        div.addEventListener("click", async () => {
          if (st.uid !== myUid && !viewers.includes(myUid)) {
            await updateDoc(doc(db, "statuses", st.id), {
              viewers: arrayUnion(myUid)
            }).catch(() => {});
          }
          alert(
            `Status by ${st.userName} (${formatTime(st.createdAtMs)}):\n\n"${
              st.caption
            }"\n\n👁️ Viewed by ${viewers.length} user(s)`
          );
        });

        container.appendChild(div);
      });
    },
    () => {}
  );
}

// ================= CHAT EXPORT (TXT / JSON) =================
function exportActiveConversation() {
  if (!activeChatId || activeMessagesMap.size === 0) {
    alert("No messages in this conversation to export.");
    return;
  }
  const format = prompt('Export format: Type "txt" or "json":', "txt")
    ?.trim()
    .toLowerCase();
  if (!format) return;

  const sorted = Array.from(activeMessagesMap.values()).sort(
    (a, b) => (Number(a.createdAtMs) || 0) - (Number(b.createdAtMs) || 0)
  );

  let content = "";
  let mime = "text/plain";
  let ext = "txt";

  if (format === "json") {
    content = JSON.stringify(sorted, null, 2);
    mime = "application/json";
    ext = "json";
  } else {
    content = sorted
      .map(
        (m) =>
          `[${new Date(Number(m.createdAtMs || Date.now())).toLocaleString()}] ${
            m.senderName
          }: ${m.text || m.mediaUrl || ""}`
      )
      .join("\n");
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nexchat_${activeChatId}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

// ================= WEBRTC VOICE & VIDEO CALLING =================
function initDraggablePiP(pipEl) {
  if (!pipEl) return;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  const startDrag = (clientX, clientY) => {
    const rect = pipEl.getBoundingClientRect();
    isDragging = true;
    startX = clientX;
    startY = clientY;
    initialLeft = rect.left;
    initialTop = rect.top;
    pipEl.style.right = "auto";
    pipEl.style.bottom = "auto";
    pipEl.style.left = `${initialLeft}px`;
    pipEl.style.top = `${initialTop}px`;
  };

  const moveDrag = (clientX, clientY) => {
    if (!isDragging) return;
    const dx = clientX - startX;
    const dy = clientY - startY;
    const maxLeft = window.innerWidth - pipEl.offsetWidth - 8;
    const maxTop = window.innerHeight - pipEl.offsetHeight - 8;
    pipEl.style.left = `${Math.max(8, Math.min(initialLeft + dx, maxLeft))}px`;
    pipEl.style.top = `${Math.max(12, Math.min(initialTop + dy, maxTop))}px`;
  };

  pipEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.target.closest("button")) return;
      if (e.touches.length === 1) startDrag(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: true }
  );

  window.addEventListener(
    "touchmove",
    (e) => {
      if (isDragging && e.touches.length === 1) {
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    },
    { passive: true }
  );

  window.addEventListener("touchend", () => {
    isDragging = false;
  });
}

function subscribeIncomingCalls() {
  const myUid = getAuthenticatedUid();
  if (!myUid) return;
  if (unsubCalls) unsubCalls();

  const qCalls = query(collection(db, "calls"), where("calleeId", "==", myUid));
  unsubCalls = onSnapshot(
    qCalls,
    (snap) => {
      if (getAuthenticatedUid() !== myUid) return;
      snap.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data() || {};
          if (data.status === "offering" && Date.now() - (data.createdAtMs || 0) < 60000) {
            currentCallDocId = change.doc.id;
            pendingCallData = data;
            if ($("callInfoHeader")) $("callInfoHeader").classList.remove("video-active");
            $("callPeerName").textContent = data.callerName || "Incoming Call";
            setSafeAvatar($("callPeerAvatar"), data.callerPhoto, data.callerName);
            $("callStatusLabel").textContent = `Incoming ${data.callType || "voice"} call...`;
            $("acceptCallBtn").classList.remove("hidden");
            $("callModal").classList.remove("hidden");
          }
        }
      });
    },
    () => {}
  );
}

async function initiateCall(callType = "voice") {
  const myUid = assertValidSenderIdentity();
  if (!activePeerUser) return;

  try {
    if ($("callInfoHeader")) {
      $("callInfoHeader").classList.toggle("video-active", callType === "video");
    }
    $("callPeerName").textContent = activePeerUser.displayName;
    setSafeAvatar($("callPeerAvatar"), activePeerUser.photoURL, activePeerUser.displayName);
    $("callStatusLabel").textContent = `Calling (${callType})...`;
    $("acceptCallBtn").classList.add("hidden");
    $("callModal").classList.remove("hidden");
    if ($("localVideoWrap")) {
      $("localVideoWrap").style.display = callType === "video" ? "block" : "none";
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === "video" ? { facingMode: useFrontCamera ? "user" : "environment" } : false
    });
    $("localVideo").srcObject = localStream;

    peerConnection = new RTCPeerConnection(RTC_CONFIG);
    const remoteStream = new MediaStream();
    $("remoteVideo").srcObject = remoteStream;

    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
    peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
    };

    const callDocRef = await addDoc(collection(db, "calls"), {
      callerId: myUid,
      callerName: myVerifiedProfile?.displayName || "User",
      callerPhoto: myVerifiedProfile?.photoURL || "",
      calleeId: activePeerUser.uid,
      calleeName: activePeerUser.displayName,
      participants: [myUid, activePeerUser.uid],
      callType,
      status: "offering",
      createdAtMs: Date.now()
    });
    currentCallDocId = callDocRef.id;

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && currentCallDocId) {
        addDoc(
          collection(db, "calls", currentCallDocId, "callerCandidates"),
          event.candidate.toJSON()
        ).catch(() => {});
      }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await updateDoc(callDocRef, { offer: { type: offer.type, sdp: offer.sdp } });

    if (unsubActiveCallDoc) unsubActiveCallDoc();
    unsubActiveCallDoc = onSnapshot(callDocRef, async (snap) => {
      const data = snap.data() || {};
      if (data.status === "ended" || data.status === "rejected") {
        endActiveCall();
        return;
      }
      if (data.answer && peerConnection && !peerConnection.currentRemoteDescription) {
        startCallDurationTimer();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    if (unsubCalleeCandidates) unsubCalleeCandidates();
    unsubCalleeCandidates = onSnapshot(
      collection(db, "calls", currentCallDocId, "calleeCandidates"),
      (snap) => {
        snap.docChanges().forEach((c) => {
          if (c.type === "added" && peerConnection) {
            peerConnection.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(() => {});
          }
        });
      }
    );
  } catch (err) {
    alert("Microphone/Camera permission is required for calls.");
    endActiveCall();
  }
}

async function acceptIncomingCall() {
  if (!currentCallDocId || !pendingCallData) return;
  try {
    const callType = pendingCallData.callType || "voice";
    $("acceptCallBtn").classList.add("hidden");
    $("callStatusLabel").textContent = "Connecting...";
    if ($("callInfoHeader")) {
      $("callInfoHeader").classList.toggle("video-active", callType === "video");
    }
    if ($("localVideoWrap")) {
      $("localVideoWrap").style.display = callType === "video" ? "block" : "none";
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === "video" ? { facingMode: useFrontCamera ? "user" : "environment" } : false
    });
    $("localVideo").srcObject = localStream;

    peerConnection = new RTCPeerConnection(RTC_CONFIG);
    const remoteStream = new MediaStream();
    $("remoteVideo").srcObject = remoteStream;

    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
    peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && currentCallDocId) {
        addDoc(
          collection(db, "calls", currentCallDocId, "calleeCandidates"),
          event.candidate.toJSON()
        ).catch(() => {});
      }
    };

    const callDocRef = doc(db, "calls", currentCallDocId);
    const callSnap = await getDoc(callDocRef);
    const callData = callSnap.data() || {};

    if (callData.offer) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await updateDoc(callDocRef, {
        answer: { type: answer.type, sdp: answer.sdp },
        status: "connected"
      });
      startCallDurationTimer();
    }

    if (unsubCallerCandidates) unsubCallerCandidates();
    unsubCallerCandidates = onSnapshot(
      collection(db, "calls", currentCallDocId, "callerCandidates"),
      (snap) => {
        snap.docChanges().forEach((c) => {
          if (c.type === "added" && peerConnection) {
            peerConnection.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(() => {});
          }
        });
      }
    );

    if (unsubActiveCallDoc) unsubActiveCallDoc();
    unsubActiveCallDoc = onSnapshot(callDocRef, (snap) => {
      if (snap.data()?.status === "ended") endActiveCall();
    });
  } catch (err) {
    endActiveCall();
  }
}

function startCallDurationTimer() {
  clearInterval(callDurationInterval);
  callStartedAtMs = Date.now();
  callDurationInterval = setInterval(() => {
    const totalSecs = Math.floor((Date.now() - callStartedAtMs) / 1000);
    const mins = String(Math.floor(totalSecs / 60)).padStart(2, "0");
    const secs = String(totalSecs % 60).padStart(2, "0");
    if ($("callStatusLabel")) $("callStatusLabel").textContent = `${mins}:${secs}`;
  }, 1000);
}

async function switchCameraFacingMode() {
  if (!localStream) return;
  useFrontCamera = !useFrontCamera;
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: useFrontCamera ? "user" : "environment" }
    });
    const newVideoTrack = newStream.getVideoTracks()[0];
    if (peerConnection) {
      const sender = peerConnection
        .getSenders()
        .find((s) => s.track && s.track.kind === "video");
      if (sender && newVideoTrack) await sender.replaceTrack(newVideoTrack);
    }
    localStream.getTracks().forEach((t) => t.stop());
    localStream = newStream;
    $("localVideo").srcObject = localStream;
  } catch (e) {}
}

function endActiveCall() {
  clearInterval(callDurationInterval);
  if (unsubActiveCallDoc) {
    unsubActiveCallDoc();
    unsubActiveCallDoc = null;
  }
  if (unsubCalleeCandidates) {
    unsubCalleeCandidates();
    unsubCalleeCandidates = null;
  }
  if (unsubCallerCandidates) {
    unsubCallerCandidates();
    unsubCallerCandidates = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (currentCallDocId) {
    updateDoc(doc(db, "calls", currentCallDocId), { status: "ended" }).catch(() => {});
    currentCallDocId = null;
  }
  pendingCallData = null;
  if ($("remoteVideo")) $("remoteVideo").srcObject = null;
  if ($("localVideo")) $("localVideo").srcObject = null;
  if ($("callModal")) $("callModal").classList.add("hidden");
}

// ================= UI EVENT BINDINGS =================
function bindUIEvents() {
  ensureExtendedDOMElements();
  initDraggablePiP($("localVideoWrap"));

  const openSearchOverlay = () => {
    if ($("searchBarContainer")) $("searchBarContainer").classList.remove("hidden");
    if ($("searchResultsPanel")) $("searchResultsPanel").classList.remove("hidden");
    if ($("userSearchInput")) {
      $("userSearchInput").focus();
      performUserSearch($("userSearchInput").value);
    }
  };

  if ($("toggleSearchBtn")) $("toggleSearchBtn").addEventListener("click", openSearchOverlay);
  if ($("fabNewChatBtn")) $("fabNewChatBtn").addEventListener("click", openSearchOverlay);

  if ($("userSearchInput")) {
    $("userSearchInput").addEventListener("focus", () => {
      if ($("searchResultsPanel")) $("searchResultsPanel").classList.remove("hidden");
      performUserSearch($("userSearchInput").value);
    });

    $("userSearchInput").addEventListener("input", (e) => {
      const val = e.target.value;
      if ($("clearSearchInputBtn")) {
        $("clearSearchInputBtn").classList.toggle("hidden", val.length === 0);
      }
      if ($("searchResultsPanel")) $("searchResultsPanel").classList.remove("hidden");
      performUserSearch(val);
    });
  }

  if ($("closeSearchBtn")) {
    $("closeSearchBtn").addEventListener("click", () => {
      if ($("searchBarContainer")) $("searchBarContainer").classList.add("hidden");
      if ($("searchResultsPanel")) $("searchResultsPanel").classList.add("hidden");
      if ($("userSearchInput")) $("userSearchInput").value = "";
    });
  }

  if ($("closeSearchPanelBtn")) {
    $("closeSearchPanelBtn").addEventListener("click", () => {
      if ($("searchResultsPanel")) $("searchResultsPanel").classList.add("hidden");
    });
  }

  if ($("clearSearchInputBtn")) {
    $("clearSearchInputBtn").addEventListener("click", () => {
      if ($("userSearchInput")) $("userSearchInput").value = "";
      $("clearSearchInputBtn").classList.add("hidden");
      performUserSearch("");
    });
  }

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeChatFilter = chip.dataset.filter || "all";
      if (activeChatFilter === "groups") {
        document.querySelector('[data-tab="tabGroupsView"]')?.click();
      } else {
        document.querySelector('[data-tab="tabChatsView"]')?.click();
        renderChatList(latestChatItems);
      }
    });
  });

  if ($("themeToggleBtn")) {
    $("themeToggleBtn").addEventListener("click", () => {
      document.body.classList.toggle("dark-theme");
      const isDark = document.body.classList.contains("dark-theme");
      const prefKey = getAccountStorageKey("theme") || "nexchat_theme";
      localStorage.setItem(prefKey, isDark ? "dark" : "light");
    });
  }

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      const targetTab = $(btn.dataset.tab);
      if (targetTab) targetTab.classList.add("active");
    });
  });

  if ($("chatBackBtn")) {
    $("chatBackBtn").addEventListener("click", () => {
      setMyLiveActivity("", "");
      activeChatId = null;
      activeChatIsGroup = false;
      activeGroupData = null;
      clearActiveReply();
      hideChatErrorBanner();
      if (unsubMessages) {
        unsubMessages();
        unsubMessages = null;
      }
      switchScreen("mainScreen");
    });
  }

  if ($("chatPeerHeaderInfo")) {
    $("chatPeerHeaderInfo").addEventListener("click", () => {
      if (activeChatIsGroup) {
        manageActiveGroupAdmins();
      }
    });
  }

  if ($("inChatSearchBtn")) {
    $("inChatSearchBtn").addEventListener("click", () => {
      const term = prompt("Search messages in this conversation:");
      renderMessagesFromMap(term || "");
    });
  }

  if ($("exportChatBtn")) {
    $("exportChatBtn").addEventListener("click", exportActiveConversation);
  }

  if ($("cancelReplyBtn")) $("cancelReplyBtn").addEventListener("click", clearActiveReply);

  if ($("voiceRecordToggleBtn")) {
    $("voiceRecordToggleBtn").addEventListener("click", (e) => {
      e.preventDefault();
      toggleVoiceRecording();
    });
  }

  // Reliable Send Action for Android Touch, Mouse & Enter Key
  const handleSendButtonAction = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const now = Date.now();
    if (now - lastSendActionMs < 250) return;
    lastSendActionMs = now;

    const inputEl = $("messageTextInput");
    const val = inputEl ? inputEl.value.trim() : "";
    if (val.length > 0) {
      sendChatMessage(val, "", "text", false);
    } else if (isRecordingVoice) {
      toggleVoiceRecording();
    }
  };

  if ($("sendOrMicBtn")) {
    $("sendOrMicBtn").addEventListener("pointerdown", handleSendButtonAction);
    $("sendOrMicBtn").addEventListener("click", handleSendButtonAction);
  }

  if ($("messageTextInput")) {
    $("messageTextInput").addEventListener("input", (e) => {
      const text = e.target.value.trim();
      if (activeChatId && text.length > 0) {
        setMyLiveActivity(activeChatId, "");
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => setMyLiveActivity("", ""), 2500);
      }
    });

    $("messageTextInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        handleSendButtonAction(e);
      }
    });
  }

  if ($("emojiToggleBtn")) {
    $("emojiToggleBtn").addEventListener("click", () => {
      $("emojiPickerBar")?.classList.toggle("hidden");
    });
  }

  document.querySelectorAll("#emojiPickerBar span").forEach((sp) => {
    sp.addEventListener("click", () => {
      if ($("messageTextInput")) {
        $("messageTextInput").value += sp.textContent;
        $("messageTextInput").focus();
      }
    });
  });

  const handleMediaInput = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const messageType = file.type.startsWith("video")
      ? "video"
      : file.type.startsWith("audio")
      ? "audio"
      : file.type.startsWith("image")
      ? "image"
      : "file";
    try {
      const url = await uploadMediaFile(file);
      await sendChatMessage("", url, messageType, false);
    } catch (err) {
      showChatErrorBanner(err.message);
    }
    e.target.value = "";
  };

  if ($("mediaFileInput")) $("mediaFileInput").addEventListener("change", handleMediaInput);
  if ($("cameraCaptureInput")) $("cameraCaptureInput").addEventListener("change", handleMediaInput);
  if ($("headerCameraBtn") && $("cameraCaptureInput")) {
    $("headerCameraBtn").addEventListener("click", () => $("cameraCaptureInput").click());
  }

  if ($("closeForwardModalBtn")) {
    $("closeForwardModalBtn").addEventListener("click", () => {
      $("forwardModal").classList.add("hidden");
    });
  }

  if ($("addStatusCardBtn")) {
    $("addStatusCardBtn").addEventListener("click", async () => {
      const myUid = assertValidSenderIdentity();
      const caption = prompt("Enter your 24-hour Status text:");
      if (!caption || !caption.trim()) return;
      const now = Date.now();
      await addDoc(collection(db, "statuses"), {
        uid: myUid,
        userName: myVerifiedProfile?.displayName || "User",
        userPhoto: myVerifiedProfile?.photoURL || "",
        caption: caption.trim(),
        viewers: [],
        createdAtMs: now,
        expiresAtMs: now + 24 * 60 * 60 * 1000
      });
    });
  }

  if ($("openCreateGroupBtn")) {
    $("openCreateGroupBtn").addEventListener("click", async () => {
      const myUid = assertValidSenderIdentity();
      const groupName = prompt("Enter new Group Name:");
      if (!groupName || !groupName.trim()) return;
      const groupDesc = prompt("Enter Group Description (optional):") || "";

      await addDoc(collection(db, "groups"), {
        name: groupName.trim(),
        description: groupDesc.trim(),
        photoURL: getFallbackAvatar(groupName),
        primaryAdmin: myUid,
        admins: [myUid],
        members: [myUid],
        createdBy: myUid,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        lastMessage: "Group created"
      });
    });
  }

  if ($("openProfileModalBtn")) {
    $("openProfileModalBtn").addEventListener("click", () => {
      updateMyHeaderUI();
      $("profileModal").classList.remove("hidden");
    });
  }

  if ($("closeProfileModalBtn")) {
    $("closeProfileModalBtn").addEventListener("click", () => {
      $("profileModal").classList.add("hidden");
    });
  }

  if ($("profilePhotoInput")) {
    $("profilePhotoInput").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      const myUid = getAuthenticatedUid();
      if (!file || !myUid) return;
      try {
        const url = await uploadMediaFile(file);
        await setDoc(doc(db, "users", myUid), { photoURL: url }, { merge: true });
      } catch (err) {
        alert(err.message);
      }
    });
  }

  if ($("saveProfileBtn")) {
    $("saveProfileBtn").addEventListener("click", async () => {
      const myUid = assertValidSenderIdentity();
      const displayName = $("editDisplayNameInput")?.value.trim() || "NexChat User";
      const username =
        $("editUsernameInput")?.value.trim().replace(/^@+/, "").toLowerCase() || "user";
      const mobileNumber = $("editMobileInput")?.value.trim() || "";
      const bio = $("editBioInput")?.value.trim() || "";

      const available = await isUsernameAvailable(username, myUid);
      if (!available) {
        alert(`Username @${username} is already taken by another account.`);
        return;
      }

      await setDoc(
        doc(db, "users", myUid),
        {
          displayName,
          username,
          mobileNumber,
          bio,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      $("profileModal").classList.add("hidden");
    });
  }

  if ($("logoutBtn")) {
    $("logoutBtn").addEventListener("click", async () => {
      const uidBeforeLogout = getAuthenticatedUid();
      if (uidBeforeLogout) {
        try {
          await setDoc(
            doc(db, "users", uidBeforeLogout),
            { online: false, lastSeenMs: Date.now() },
            { merge: true }
          );
          await rtdbSet(rtdbRef(rtdb, `status/${uidBeforeLogout}`), {
            online: false,
            lastSeenMs: Date.now(),
            typingTo: "",
            recordingTo: ""
          });
        } catch (e) {}
      }

      cleanupAccountSession();
      if ($("profileModal")) $("profileModal").classList.add("hidden");
      await signOut(auth);
      switchScreen("authScreen");
    });
  }

  if ($("startVoiceCallBtn")) {
    $("startVoiceCallBtn").addEventListener("click", () => initiateCall("voice"));
  }
  if ($("startVideoCallBtn")) {
    $("startVideoCallBtn").addEventListener("click", () => initiateCall("video"));
  }
  if ($("endCallBtn")) $("endCallBtn").addEventListener("click", endActiveCall);
  if ($("acceptCallBtn")) $("acceptCallBtn").addEventListener("click", acceptIncomingCall);
  if ($("switchCamBtn")) $("switchCamBtn").addEventListener("click", switchCameraFacingMode);

  if ($("toggleMicMuteBtn")) {
    $("toggleMicMuteBtn").addEventListener("click", () => {
      if (!localStream) return;
      isAudioMuted = !isAudioMuted;
      localStream.getAudioTracks().forEach((t) => {
        t.enabled = !isAudioMuted;
      });
      $("toggleMicMuteBtn").innerHTML = isAudioMuted
        ? `<i class="fa-solid fa-microphone-slash"></i>`
        : `<i class="fa-solid fa-microphone"></i>`;
    });
  }
}

// ================= INITIALIZATION =================
document.addEventListener("DOMContentLoaded", () => {
  setupAuthUI();
  bindUIEvents();

  onAuthStateChanged(auth, async (user) => {
    if (!user || (activeAuthUid && user.uid !== activeAuthUid)) {
      cleanupAccountSession();
    }

    if (user && user.uid) {
      const themePref = localStorage.getItem(`nexchat_${user.uid}_theme`);
      document.body.classList.toggle("dark-theme", themePref === "dark");

      switchScreen("mainScreen");
      await initializeAuthenticatedAccount(user);
      subscribeAllUsers();
      subscribeChatList();
      subscribeGroups();
      subscribeStatuses();
      subscribeIncomingCalls();
    } else {
      switchScreen("authScreen");
    }
  });
});
