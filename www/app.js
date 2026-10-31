import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
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
// 1. PRE-CONFIGURED FIREBASE, CLOUDINARY & GITHUB SETTINGS
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

setPersistence(auth, browserLocalPersistence);

// ============================================================================
// 2. CLOUDINARY MEDIA UPLOAD ENGINE
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
  const response = await fetch(endpoint, {
    method: "POST",
    body: formData
  });

  const data = await response.json();
  if (!response.ok || !data.secure_url) {
    throw new Error(data.error?.message || "Cloudinary upload failed");
  }
  return data.secure_url;
}

// ============================================================================
// 3. GLOBAL APPLICATION STATE & UI INITIALIZATION (DOM LOADED SAFE)
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

const rtcConfig = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
};

document.addEventListener("DOMContentLoaded", () => {
  // Tab Switching Logic
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");

  if (tabLogin && tabRegister && loginForm && registerForm) {
    tabLogin.addEventListener("click", () => {
      loginForm.classList.remove("hidden");
      registerForm.classList.add("hidden");
      tabLogin.classList.add("border-blue-900", "text-blue-950", "bg-white");
      tabRegister.classList.remove("border-blue-900", "text-blue-950", "bg-white");
    });

    tabRegister.addEventListener("click", () => {
      registerForm.classList.remove("hidden");
      loginForm.classList.add("hidden");
      tabRegister.classList.add("border-blue-900", "text-blue-950", "bg-white");
      tabLogin.classList.remove("border-blue-900", "text-blue-950", "bg-white");
    });
  }

  // Password Visibility Toggles
  document.querySelectorAll(".toggle-password").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.target);
      if (input) input.type = input.type === "password" ? "text" : "password";
    });
  });

  fetchLatestGithubApk();
});

function showAlert(msg, isError = true) {
  const el = document.getElementById("auth-alert");
  if (!el) return;
  el.textContent = msg;
  el.className = `mb-4 p-3 rounded-lg text-xs font-medium ${
    isError ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-800"
  }`;
  el.classList.remove("hidden");
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
// 4. AUTHENTICATION & REGISTRATION
// ============================================================================
document.addEventListener("submit", async e => {
  if (e.target && e.target.id === "register-form") {
    e.preventDefault();
    const displayName = document.getElementById("reg-name").value.trim();
    const username = document.getElementById("reg-username").value.trim().toLowerCase();
    const phone = document.getElementById("reg-phone").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;
    const avatarFile = document.getElementById("reg-avatar").files[0];

    try {
      const usernameRef = doc(db, "usernames", username);
      const usernameSnap = await getDoc(usernameRef);
      if (usernameSnap.exists()) {
        return showAlert("Username @" + username + " is already taken. Choose another.");
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      let photoURL = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1e3a8a&color=fff`;

      if (avatarFile) {
        photoURL = await uploadToCloudinary(avatarFile, `nexchat_pro/avatars/${cred.user.uid}`);
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

      await sendEmailVerification(cred.user);
    } catch (err) {
      showAlert(err.message);
    }
  }

  if (e.target && e.target.id === "login-form") {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      showAlert(err.message);
    }
  }
});

document.addEventListener("click", async e => {
  if (e.target && e.target.id === "forgot-password-btn") {
    const email = document.getElementById("login-email")?.value.trim();
    if (!email) return showAlert("Enter your email address first to reset password.");
    try {
      await sendPasswordResetEmail(auth, email);
      showAlert("Password reset email sent! Check your inbox.", false);
    } catch (err) {
      showAlert(err.message);
    }
  }

  if (e.target && e.target.id === "google-login-btn") handleOAuthLogin(new GoogleAuthProvider());
  if (e.target && e.target.id === "github-login-btn") handleOAuthLogin(new GithubAuthProvider());
  if (e.target && e.target.id === "logout-btn") {
    if (currentUser) {
      await rtdbSet(rtdbRef(rtdb, `status/${currentUser.uid}`), { state: "offline", lastChanged: rtdbTimestamp() });
    }
    await signOut(auth);
    location.reload();
  }
});

async function handleOAuthLogin(provider) {
  try {
    const cred = await signInWithPopup(auth, provider);
    const uRef = doc(db, "users", cred.user.uid);
    const snap = await getDoc(uRef);
    if (!snap.exists()) {
      const baseUsername = (cred.user.email?.split("@")[0] || "user") + "_" + Math.floor(100 + Math.random() * 900);
      await setDoc(doc(db, "usernames", baseUsername.toLowerCase()), { uid: cred.user.uid });
      await setDoc(uRef, {
        uid: cred.user.uid,
        displayName: cred.user.displayName || "NexChat User",
        displayNameLower: (cred.user.displayName || "NexChat User").toLowerCase(),
        username: baseUsername.toLowerCase(),
        email: cred.user.email || "",
        phone: cred.user.phoneNumber || "Not set",
        photoURL: cred.user.photoURL || "https://ui-avatars.com/api/?name=User&background=1e3a8a&color=fff",
        bio: "Available on NexChat Pro",
        isBlocked: false,
        createdAt: serverTimestamp()
      });
    }
  } catch (err) {
    showAlert(err.message);
  }
}

// ============================================================================
// 5. PERSISTENT SESSION & PRESENCE
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
      alert("Your account has been restricted by the Platform Administrator.");
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

function listenToConversations() {
  const q = query(collection(db, "conversations"), where("participants", "array-contains", currentUser.uid));
  onSnapshot(q, snap => {
    const listEl = document.getElementById("conversation-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    snap.forEach(docSnap => {
      const c = docSnap.data();
      let title = c.groupName || "Chat";
      let avatar = c.groupPhoto || "https://ui-avatars.com/api/?name=Group&background=0f172a&color=fff";
      if (c.type === "direct") {
        const otherUid = c.participants.find(id => id !== currentUser.uid);
        const info = c.participantInfo?.[otherUid] || {};
        title = info.displayName || "User";
        avatar = info.photoURL || "https://ui-avatars.com/api/?name=U";
      }
      const row = document.createElement("div");
      row.className = "p-3 flex items-center justify-between hover:bg-blue-50/60 cursor-pointer transition";
      row.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <img src="${avatar}" class="w-11 h-11 rounded-full object-cover shrink-0 border border-slate-200" />
          <div class="min-w-0">
            <h4 class="text-sm font-bold text-slate-800 truncate">${title}</h4>
            <p class="text-xs text-slate-500 truncate">${c.lastMessage || "No messages yet"}</p>
          </div>
        </div>
      `;
      row.addEventListener("click", () => openConversation({ id: c.id, type: c.type, title, avatar, data: c }));
      listEl.appendChild(row);
    });
  });
}

function openConversation(chatObj) {
  activeChat = chatObj;
  document.getElementById("empty-chat-placeholder")?.classList.add("hidden");
  document.getElementById("active-chat-container")?.classList.remove("hidden");
  document.getElementById("chat-panel")?.classList.remove("hidden");
  document.getElementById("chat-header-title").textContent = chatObj.title;
  document.getElementById("chat-header-avatar").src = chatObj.avatar;
}

function listenForIncomingCalls() {
  const q = query(collection(db, "calls"), where("calleeId", "==", currentUser.uid), where("status", "==", "ringing"));
  onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === "added") {
        const callData = change.doc.data();
        currentCallId = change.doc.id;
        document.getElementById("call-overlay")?.classList.remove("hidden");
        document.getElementById("incoming-call-controls")?.classList.remove("hidden");
        document.getElementById("active-call-controls")?.classList.add("hidden");
        document.getElementById("call-partner-name").textContent = callData.callerName;
      }
    });
  });
}

function listenToStatuses() {
  onSnapshot(collection(db, "statuses"), snap => {
    const feedEl = document.getElementById("status-feed-list");
    if (!feedEl) return;
    feedEl.innerHTML = "";
    snap.forEach(docSnap => {
      const s = docSnap.data();
      const card = document.createElement("div");
      card.className = "p-3 bg-white border rounded-xl space-y-2 shadow-sm";
      card.innerHTML = `<p class="text-xs font-bold">${s.displayName}</p><p class="text-xs">${s.text || ""}</p>`;
      feedEl.appendChild(card);
    });
  });
}
