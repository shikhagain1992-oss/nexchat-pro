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
// 1. PRE-CONFIGURED FIREBASE, CLOUDINARY & GITHUB SETTINGS FOR NEXCHAT PRO
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

// Free Cloudinary Media Storage Configuration (Replaces Paid Firebase Storage)
const CLOUDINARY_CLOUD_NAME = "Emoxfdx6".toLowerCase().trim();
const CLOUDINARY_UPLOAD_PRESET = "ml_default";

const GITHUB_REPO = "shikhagain1992-oss/nexchat-pro";
const APP_VERSION = "v1.0.0";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

// Keep user logged in persistently across app closes & phone restarts
setPersistence(auth, browserLocalPersistence);

// ============================================================================
// 2. CLOUDINARY UNIVERSAL UPLOAD ENGINE (IMAGES, VIDEOS, VOICE NOTES & FILES)
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
    const errMsg = data.error?.message || "Cloudinary upload failed";
    if (errMsg.toLowerCase().includes("unsigned")) {
      alert(
        "Cloudinary Error: অনুগ্রহ করে আপনার Cloudinary Settings -> Upload -> Upload presets-এ গিয়ে 'ml_default' প্রিসেটটির Signing Mode 'Unsigned' করে Save করুন।"
      );
    }
    throw new Error(errMsg);
  }
  return data.secure_url;
}

// ============================================================================
// 3. GLOBAL APPLICATION STATE
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
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ]
};

// ============================================================================
// 4. UI HELPERS & APK RELEASE CHECKER
// ============================================================================
function showAlert(msg, isError = true) {
  const el = document.getElementById("auth-alert");
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
      document.getElementById("direct-apk-download-link").href = apkAsset.browser_download_url;
    }
  } catch (e) {}
}
fetchLatestGithubApk();

document.querySelectorAll(".toggle-password").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    input.type = input.type === "password" ? "text" : "password";
  });
});

document.getElementById("tab-login").addEventListener("click", () => {
  document.getElementById("login-form").classList.remove("hidden");
  document.getElementById("register-form").classList.add("hidden");
  document.getElementById("tab-login").classList.add("border-blue-900", "text-blue-950", "bg-white");
  document.getElementById("tab-register").classList.remove("border-blue-900", "text-blue-950", "bg-white");
});

document.getElementById("tab-register").addEventListener("click", () => {
  document.getElementById("register-form").classList.remove("hidden");
  document.getElementById("login-form").classList.add("hidden");
  document.getElementById("tab-register").classList.add("border-blue-900", "text-blue-950", "bg-white");
  document.getElementById("tab-login").classList.remove("border-blue-900", "text-blue-950", "bg-white");
});

// ============================================================================
// 5. AUTHENTICATION & UNIQUE USERNAME REGISTRATION (WITH CLOUDINARY AVATAR)
// ============================================================================
document.getElementById("register-form").addEventListener("submit", async e => {
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
});

document.getElementById("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    showAlert(err.message);
  }
});

document.getElementById("forgot-password-btn").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim();
  if (!email) return showAlert("Enter your email address first to reset password.");
  try {
    await sendPasswordResetEmail(auth, email);
    showAlert("Password reset email sent! Check your inbox.", false);
  } catch (err) {
    showAlert(err.message);
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

document.getElementById("google-login-btn").addEventListener("click", () => handleOAuthLogin(new GoogleAuthProvider()));
document.getElementById("github-login-btn").addEventListener("click", () => handleOAuthLogin(new GithubAuthProvider()));
document.getElementById("logout-btn").addEventListener("click", async () => {
  if (currentUser) {
    await rtdbSet(rtdbRef(rtdb, `status/${currentUser.uid}`), { state: "offline", lastChanged: rtdbTimestamp() });
  }
  await signOut(auth);
  location.reload();
});

// ============================================================================
// 6. PERSISTENT SESSION, DEVICE SECURITY & REALTIME DATABASE PRESENCE
// ============================================================================
onAuthStateChanged(auth, async user => {
  if (!user) {
    document.getElementById("auth-view").classList.remove("hidden");
    document.getElementById("main-app").classList.add("hidden");
    return;
  }

  currentUser = user;
  document.getElementById("auth-view").classList.add("hidden");
  document.getElementById("main-app").classList.remove("hidden");

  onSnapshot(doc(db, "users", user.uid), snap => {
    if (!snap.exists()) return;
    currentUserProfile = snap.data();
    if (currentUserProfile.isBlocked) {
      alert("Your account has been restricted by the Platform Administrator.");
      signOut(auth);
      return;
    }
    document.getElementById("my-nav-name").textContent = currentUserProfile.displayName;
    document.getElementById("my-nav-username").textContent = "@" + currentUserProfile.username;
    document.getElementById("my-nav-avatar").src = currentUserProfile.photoURL;
    document.getElementById("profile-modal-avatar").src = currentUserProfile.photoURL;
    document.getElementById("edit-display-name").value = currentUserProfile.displayName || "";
    document.getElementById("edit-phone").value = currentUserProfile.phone || "";
    document.getElementById("edit-bio").value = currentUserProfile.bio || "";
  });

  registerDeviceSession(user.uid);
  setupRealtimePresence(user.uid);
  listenToConversations();
  listenToStatuses();
  listenForIncomingCalls();
  initNativePushNotifications(user.uid);
});

async function registerDeviceSession(uid) {
  let sessionId = localStorage.getItem("nexchat_device_session_id");
  const isNewDevice = !sessionId;
  if (!sessionId) {
    sessionId = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    localStorage.setItem("nexchat_device_session_id", sessionId);
  }
  const deviceAgent = navigator.userAgent.slice(0, 80);
  await setDoc(doc(db, "users", uid, "sessions", sessionId), {
    sessionId,
    device: deviceAgent,
    lastActive: serverTimestamp(),
    isNewAlert: isNewDevice
  }, { merge: true });

  onSnapshot(collection(db, "users", uid, "sessions"), snap => {
    const listEl = document.getElementById("active-sessions-list");
    listEl.innerHTML = "";
    snap.forEach(docSnap => {
      const s = docSnap.data();
      if (s.sessionId !== sessionId && s.isNewAlert) {
        const banner = document.getElementById("security-alert-banner");
        document.getElementById("security-alert-text").textContent = `Security Alert: New login detected on (${s.device.slice(0, 35)}...)`;
        banner.classList.remove("hidden");
      }
      const row = document.createElement("div");
      row.className = "flex items-center justify-between p-2 bg-slate-50 rounded-lg border";
      row.innerHTML = `
        <div class="truncate pr-2">
          <p class="font-semibold text-slate-800 truncate">${s.device}</p>
          <span class="text-[10px] text-emerald-600">${s.sessionId === sessionId ? "Current Device" : "Active Session"}</span>
        </div>
      `;
      listEl.appendChild(row);
    });
  });
}

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

// ============================================================================
// 7. USER PROFILE EDIT (CLOUDINARY) & USER SEARCH
// ============================================================================
document.getElementById("profile-update-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentUser) return;
  const displayName = document.getElementById("edit-display-name").value.trim();
  const phone = document.getElementById("edit-phone").value.trim();
  const bio = document.getElementById("edit-bio").value.trim();
  const file = document.getElementById("profile-avatar-upload").files[0];

  try {
    const updates = {
      displayName,
      displayNameLower: displayName.toLowerCase(),
      phone,
      bio
    };

    if (file) {
      updates.photoURL = await uploadToCloudinary(file, `nexchat_pro/avatars/${currentUser.uid}`);
    }

    await updateDoc(doc(db, "users", currentUser.uid), updates);
    alert("Profile updated across NexChat Pro!");
  } catch (err) {
    alert("Profile update failed: " + err.message);
  }
});

document.getElementById("run-user-search-btn").addEventListener("click", async () => {
  const term = document.getElementById("global-user-search").value.trim().toLowerCase().replace(/^@/, "");
  if (!term) return;
  const container = document.getElementById("discover-results-list");
  container.innerHTML = `<p class="text-xs text-slate-400 p-3">Searching...</p>`;

  const usersSnap = await getDocs(collection(db, "users"));
  container.innerHTML = "";
  usersSnap.forEach(d => {
    const u = d.data();
    if (u.uid === currentUser.uid) return;
    if (u.username?.includes(term) || u.displayNameLower?.includes(term)) {
      const item = document.createElement("div");
      item.className = "p-2.5 flex items-center justify-between hover:bg-slate-50 rounded-lg";
      item.innerHTML = `
        <div class="flex items-center gap-2.5">
          <img src="${u.photoURL}" class="w-10 h-10 rounded-full object-cover" />
          <div>
            <p class="text-xs font-bold text-slate-800">${u.displayName}</p>
            <p class="text-[11px] text-slate-500">@${u.username}</p>
          </div>
        </div>
        <button class="bg-blue-950 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">Message</button>
      `;
      item.querySelector("button").addEventListener("click", () => startDirectConversation(u));
      container.appendChild(item);
    }
  });
});

async function startDirectConversation(otherUser) {
  const ids = [currentUser.uid, otherUser.uid].sort();
  const chatId = `${ids[0]}_${ids[1]}`;
  const chatRef = doc(db, "conversations", chatId);
  const snap = await getDoc(chatRef);
  if (!snap.exists()) {
    await setDoc(chatRef, {
      id: chatId,
      type: "direct",
      participants: ids,
      participantInfo: {
        [currentUser.uid]: {
          displayName: currentUserProfile.displayName,
          photoURL: currentUserProfile.photoURL,
          username: currentUserProfile.username
        },
        [otherUser.uid]: {
          displayName: otherUser.displayName,
          photoURL: otherUser.photoURL,
          username: otherUser.username
        }
      },
      lastMessage: "Conversation started",
      updatedAt: serverTimestamp(),
      typing: {}
    });
  }
  openConversation({
    id: chatId,
    type: "direct",
    otherUid: otherUser.uid,
    title: otherUser.displayName,
    avatar: otherUser.photoURL,
    data: (await getDoc(chatRef)).data()
  });
}

// ============================================================================
// 8. CONVERSATIONS LIST & REAL-TIME PERSONAL / GROUP CHAT
// ============================================================================
function listenToConversations() {
  const q = query(collection(db, "conversations"), where("participants", "array-contains", currentUser.uid));
  onSnapshot(q, snap => {
    const listEl = document.getElementById("conversation-list");
    listEl.innerHTML = "";

    snap.docChanges().forEach(change => {
      if (change.type === "modified") {
        const c = change.doc.data();
        if (c.lastSenderId && c.lastSenderId !== currentUser.uid && (!activeChat || activeChat.id !== c.id)) {
          triggerLocalAlertForMessage(c);
        }
      }
    });

    snap.forEach(docSnap => {
      const c = docSnap.data();
      let title = c.groupName || "Chat";
      let avatar = c.groupPhoto || "https://ui-avatars.com/api/?name=Group&background=0f172a&color=fff";
      let otherUid = null;

      if (c.type === "direct") {
        otherUid = c.participants.find(id => id !== currentUser.uid);
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
        <span class="text-[10px] text-slate-400 shrink-0">${c.type === "group" ? "GROUP" : ""}</span>
      `;
      row.addEventListener("click", () =>
        openConversation({ id: c.id, type: c.type, otherUid, title, avatar, data: c })
      );
      listEl.appendChild(row);
    });
  });
  }
  
