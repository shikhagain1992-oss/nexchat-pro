import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ================= FIREBASE & CLOUDINARY CONFIG =================
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
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ================= APPLICATION STATE =================
let currentUser = null;
let currentUserProfile = null;
let allUsersMap = new Map();
let latestChatItems = [];
let activeChatFilter = "all";
let activeChatId = null;
let activePeerUser = null;
let activeReplyTo = null; // { msgId, senderName, text }
let messageToForward = null;
let isSignUpMode = false;

let unsubUsers = null;
let unsubChats = null;
let unsubMessages = null;
let unsubStatuses = null;
let unsubCalls = null;
let unsubActiveCallDoc = null;

let peerConnection = null;
let localStream = null;
let currentCallDocId = null;
let pendingCallData = null;
let useFrontCamera = true;
let isAudioMuted = false;

// ================= HELPER UTILITIES =================
const $ = (id) => document.getElementById(id);

function getFallbackAvatar(name) {
  const cleanName = String(name || "U").trim();
  const initial = (cleanName.charAt(0) || "U").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="#1daa61"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="44" font-weight="bold">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function setSafeAvatar(imgEl, url, displayName) {
  if (!imgEl) return;
  const fallback = getFallbackAvatar(displayName);
  imgEl.onerror = () => {
    imgEl.onerror = null;
    imgEl.src = fallback;
  };
  imgEl.src = url && (String(url).startsWith("http") || String(url).startsWith("data:")) ? url : fallback;
}

function normalizeUserRecord(raw, fallbackUid = "") {
  if (!raw) return null;
  const uid = String(raw.uid || raw.id || fallbackUid || "").trim();
  if (!uid) return null;

  const email = String(raw.email || "").trim();
  const emailPrefix = email ? email.split("@")[0] : "";
  const displayName = String(
    raw.displayName || raw.name || raw.fullName || raw.username || emailPrefix || "NexChat User"
  ).trim();

  const rawUsername = String(
    raw.username || raw.handle || emailPrefix || displayName.toLowerCase().replace(/[^a-z0-9_]/g, "")
  )
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

  const rawPhoto = String(raw.photoURL || raw.avatar || raw.photo || "").trim();
  const photoURL =
    rawPhoto.startsWith("http") || rawPhoto.startsWith("data:")
      ? rawPhoto
      : getFallbackAvatar(displayName);

  const bio = String(raw.bio || raw.about || "Hey there! I am using NexChat Pro.").trim();
  const online = Boolean(raw.online === true || raw.status === "online");
  const lastSeenMs = Number(raw.lastSeenMs || Date.now());

  return {
    uid,
    displayName,
    username: rawUsername || `user_${uid.slice(0, 5).toLowerCase()}`,
    email,
    photoURL,
    bio,
    online,
    lastSeenMs
  };
}

function getDeterministicChatId(uidA, uidB) {
  return [String(uidA).trim(), String(uidB).trim()].sort().join("_");
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
  if (!ms) ms = Date.now();
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

// ================= PERSISTENT SESSION & INSTANT BOOT CACHE =================
function saveCachedUserSession(profileObj) {
  if (!profileObj || !profileObj.uid) return;
  try {
    localStorage.setItem("nexchat_cached_user", JSON.stringify(profileObj));
  } catch (e) {}
}

function clearCachedUserSession() {
  try {
    localStorage.removeItem("nexchat_cached_user");
  } catch (e) {}
}

function getCachedUserSession() {
  try {
    const raw = localStorage.getItem("nexchat_cached_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocalRecentChat(peerObj, lastMessage = "") {
  const myUid = currentUser?.uid || currentUserProfile?.uid;
  if (!myUid || !peerObj || !peerObj.uid) return;
  try {
    const key = `nexchat_recent_${myUid}`;
    const existing = JSON.parse(localStorage.getItem(key) || "{}");
    const chatId = getDeterministicChatId(myUid, peerObj.uid);
    existing[chatId] = {
      chatId,
      peerUid: peerObj.uid,
      peerName: peerObj.displayName,
      peerUsername: peerObj.username,
      peerPhoto: peerObj.photoURL,
      lastMessage: lastMessage || existing[chatId]?.lastMessage || "",
      updatedAtMs: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(existing));
  } catch (err) {}
}

function getLocalRecentChats() {
  const myUid = currentUser?.uid || currentUserProfile?.uid;
  if (!myUid) return {};
  try {
    const key = `nexchat_recent_${myUid}`;
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

async function uploadToCloudinary(file) {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, {
      method: "POST",
      body: formData
    });
    if (res.ok) {
      const data = await res.json();
      if (data.secure_url) return data.secure_url;
    }
  } catch (err) {}
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ================= SCREEN NAVIGATION =================
function switchScreen(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const target = $(screenId);
  if (target) target.classList.add("active");
}

// ================= AUTHENTICATION LOGIC =================
function setupAuthUI() {
  const tabLoginBtn = $("tabLoginBtn");
  const tabSignupBtn = $("tabSignupBtn");
  const signupFields = $("signupFields");
  const authSubmitBtn = $("authSubmitBtn");
  const authErrorMsg = $("authErrorMsg");

  tabLoginBtn.addEventListener("click", () => {
    isSignUpMode = false;
    tabLoginBtn.classList.add("active");
    tabSignupBtn.classList.remove("active");
    signupFields.classList.add("hidden");
    authSubmitBtn.textContent = "Log In";
    authErrorMsg.classList.add("hidden");
  });

  tabSignupBtn.addEventListener("click", () => {
    isSignUpMode = true;
    tabSignupBtn.classList.add("active");
    tabLoginBtn.classList.remove("active");
    signupFields.classList.remove("hidden");
    authSubmitBtn.textContent = "Create Account";
    authErrorMsg.classList.add("hidden");
  });

  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    authErrorMsg.classList.add("hidden");
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;

    try {
      authSubmitBtn.disabled = true;
      if (isSignUpMode) {
        const displayName = $("authDisplayName").value.trim() || email.split("@")[0];
        const rawUser =
          $("authUsername").value.trim().replace(/^@+/, "").toLowerCase() ||
          email.split("@")[0].toLowerCase();
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName });
        await ensureUserDocument(cred.user, displayName, rawUser);
      } else {
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
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (popupErr) {
      await signInWithRedirect(auth, googleProvider);
    }
  });

  getRedirectResult(auth).catch(() => {});
}

async function ensureUserDocument(firebaseUser, customName = "", customUsername = "") {
  const userRef = doc(db, "users", firebaseUser.uid);
  let existingData = {};
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) existingData = snap.data() || {};
  } catch (e) {}

  const normalized = normalizeUserRecord(
    {
      ...existingData,
      uid: firebaseUser.uid,
      email: firebaseUser.email || existingData.email || "",
      displayName: customName || existingData.displayName || firebaseUser.displayName || "",
      username: customUsername || existingData.username || "",
      photoURL: existingData.photoURL || firebaseUser.photoURL || "",
      online: true,
      lastSeenMs: Date.now()
    },
    firebaseUser.uid
  );

  currentUserProfile = normalized;
  saveCachedUserSession(normalized);
  allUsersMap.set(normalized.uid, normalized);
  updateMyHeaderUI();

  await setDoc(
    userRef,
    {
      uid: normalized.uid,
      displayName: normalized.displayName,
      username: normalized.username,
      email: normalized.email,
      photoURL: normalized.photoURL,
      bio: normalized.bio,
      online: true,
      lastSeenMs: Date.now(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  ).catch(() => {});
}

function updateMyHeaderUI() {
  if (!currentUserProfile) return;
  setSafeAvatar($("myHeaderAvatar"), currentUserProfile.photoURL, currentUserProfile.displayName);
  setSafeAvatar($("myStatusAvatar"), currentUserProfile.photoURL, currentUserProfile.displayName);
  setSafeAvatar($("profileModalAvatar"), currentUserProfile.photoURL, currentUserProfile.displayName);
  $("editDisplayNameInput").value = currentUserProfile.displayName;
  $("editUsernameInput").value = currentUserProfile.username;
  $("editBioInput").value = currentUserProfile.bio;
}

// ================= USERS DIRECTORY & SEARCH =================
function subscribeAllUsers() {
  if (unsubUsers) unsubUsers();
  unsubUsers = onSnapshot(collection(db, "users"), (snapshot) => {
    snapshot.docs.forEach((docSnap) => {
      const u = normalizeUserRecord(docSnap.data(), docSnap.id);
      if (u && u.uid) allUsersMap.set(u.uid, u);
    });
    if (activePeerUser && allUsersMap.has(activePeerUser.uid)) {
      activePeerUser = allUsersMap.get(activePeerUser.uid);
      refreshActiveChatHeader();
    }
  });
}

async function performUserSearch(rawQuery) {
  const q = String(rawQuery || "").trim().toLowerCase().replace(/^@+/, "");
  const resultsList = $("searchResultsList");
  const statusText = $("searchStatusText");
  const myUid = currentUser?.uid || currentUserProfile?.uid;

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
    if (myUid && userObj.uid === myUid) return;
    if (!q) {
      candidates.push(userObj);
      return;
    }
    if (
      userObj.displayName.toLowerCase().includes(q) ||
      userObj.username.toLowerCase().includes(q) ||
      userObj.email.toLowerCase().includes(q)
    ) {
      candidates.push(userObj);
    }
  });

  resultsList.innerHTML = "";

  if (candidates.length === 0) {
    statusText.textContent = q ? `No users found for "${rawQuery}"` : "No users found yet";
    return;
  }

  statusText.textContent = q ? `Found ${candidates.length} user(s)` : `All Users (${candidates.length})`;

  candidates.forEach((targetUser) => {
    const item = document.createElement("div");
    item.className = "wa-item";
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

    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openOrCreateDirectChat(targetUser);
    });

    resultsList.appendChild(item);
  });
}

// ================= OPEN / CREATE CONVERSATION =================
async function openOrCreateDirectChat(rawTargetUser) {
  const myUid = currentUser?.uid || currentUserProfile?.uid;
  if (!myUid) return;

  const targetUid = String(rawTargetUser?.uid || rawTargetUser?.id || "").trim();
  if (!targetUid) return;

  let peerProfile = allUsersMap.get(targetUid) || normalizeUserRecord(rawTargetUser, targetUid);
  const chatId = getDeterministicChatId(myUid, targetUid);
  activeChatId = chatId;
  activePeerUser = peerProfile;
  clearActiveReply();

  $("searchResultsPanel").classList.add("hidden");
  $("userSearchInput").value = "";
  $("clearSearchInputBtn").classList.add("hidden");

  refreshActiveChatHeader();
  switchScreen("chatScreen");
  saveLocalRecentChat(peerProfile);

  try {
    const chatRef = doc(db, "chats", chatId);
    const myInfo = {
      uid: myUid,
      displayName: String(currentUserProfile?.displayName || "Me"),
      username: String(currentUserProfile?.username || "me"),
      photoURL: String(currentUserProfile?.photoURL || getFallbackAvatar("Me"))
    };
    const peerInfo = {
      uid: peerProfile.uid,
      displayName: String(peerProfile.displayName || "User"),
      username: String(peerProfile.username || "user"),
      photoURL: String(peerProfile.photoURL || getFallbackAvatar(peerProfile.displayName))
    };

    await setDoc(
      chatRef,
      {
        chatId,
        isGroup: false,
        participants: [myUid, peerProfile.uid],
        participantDetails: {
          [myUid]: myInfo,
          [peerProfile.uid]: peerInfo
        },
        [`unread_${myUid}`]: 0
      },
      { merge: true }
    );
  } catch (err) {}

  subscribeMessages(chatId);
}

function refreshActiveChatHeader() {
  if (!activePeerUser) return;
  setSafeAvatar($("chatPeerAvatar"), activePeerUser.photoURL, activePeerUser.displayName);
  $("chatPeerName").textContent = activePeerUser.displayName;
  $("chatPeerStatus").textContent = activePeerUser.online
    ? "online"
    : `last seen ${formatTime(activePeerUser.lastSeenMs)} • @${activePeerUser.username}`;
  $("chatPeerOnlineDot").classList.toggle("hidden", !activePeerUser.online);
}

// ================= REAL-TIME CHAT LIST =================
function subscribeChatList() {
  const myUid = currentUser?.uid || currentUserProfile?.uid;
  if (!myUid) return;
  if (unsubChats) unsubChats();

  // Render local cached chats immediately (0ms wait)
  const initialLocal = Object.values(getLocalRecentChats());
  if (initialLocal.length > 0 && latestChatItems.length === 0) {
    latestChatItems = initialLocal;
    renderChatList(latestChatItems);
  }

  const chatsQuery = query(collection(db, "chats"), where("participants", "array-contains", myUid));

  unsubChats = onSnapshot(chatsQuery, (snapshot) => {
    const chatMap = new Map();

    Object.values(getLocalRecentChats()).forEach((lc) => {
      if (lc && lc.chatId && lc.peerUid) {
        chatMap.set(lc.chatId, {
          chatId: lc.chatId,
          peerUid: lc.peerUid,
          peerName: lc.peerName,
          peerUsername: lc.peerUsername,
          peerPhoto: lc.peerPhoto,
          lastMessage: lc.lastMessage || "Tap to start chatting",
          lastSenderId: "",
          updatedAtMs: lc.updatedAtMs || 0,
          unreadCount: 0
        });
      }
    });

    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const chatId = docSnap.id;
      const participants = Array.isArray(data.participants) ? data.participants : [];
      const peerUid = participants.find((id) => id !== myUid) || "";
      if (!peerUid) return;

      const details = (data.participantDetails && data.participantDetails[peerUid]) || {};
      const cachedUser = allUsersMap.get(peerUid);

      const peerName = cachedUser?.displayName || details.displayName || "NexChat User";
      const peerUsername = cachedUser?.username || details.username || "user";
      const peerPhoto = cachedUser?.photoURL || details.photoURL || getFallbackAvatar(peerName);

      const updatedAtMs =
        Number(data.updatedAtMs) ||
        (data.updatedAt?.toMillis ? data.updatedAt.toMillis() : 0) ||
        Date.now();

      const unreadCount = Number(data[`unread_${myUid}`] || 0);

      chatMap.set(chatId, {
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

    latestChatItems = Array.from(chatMap.values());
    renderChatList(latestChatItems);
  });
}

function renderChatList(chatItems) {
  const container = $("chatListContainer");
  const emptyState = $("emptyChatsState");
  const totalUnreadBadge = $("totalUnreadBadge");
  const myUid = currentUser?.uid || currentUserProfile?.uid;

  let filtered = [...chatItems];
  if (activeChatFilter === "unread") {
    filtered = filtered.filter((c) => (c.unreadCount || 0) > 0);
  }

  filtered.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  container.innerHTML = "";

  if (filtered.length === 0) {
    emptyState.classList.remove("hidden");
  } else {
    emptyState.classList.add("hidden");
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
          <span class="wa-item-time ${item.unreadCount > 0 ? "unread-time" : ""}">${formatTime(item.updatedAtMs)}</span>
        </div>
        <div class="wa-item-bottom">
          <span class="wa-item-sub">${tickHtml}${escapeHtml(item.lastMessage || "Tap to message")}</span>
          ${item.unreadCount > 0 ? `<span class="unread-badge">${item.unreadCount}</span>` : ""}
        </div>
      </div>
    `;

    setSafeAvatar(row.querySelector("img"), livePeer.photoURL, livePeer.displayName);
    row.addEventListener("click", () => openOrCreateDirectChat(livePeer));
    container.appendChild(row);
  });

  if (totalUnread > 0) {
    totalUnreadBadge.textContent = String(totalUnread);
    totalUnreadBadge.classList.remove("hidden");
  } else {
    totalUnreadBadge.classList.add("hidden");
  }
}

// ================= SWIPE-RIGHT REPLY & FORWARD HELPERS =================
function setActiveReply(msg) {
  const myUid = currentUser?.uid || currentUserProfile?.uid;
  const senderLabel =
    msg.senderId === myUid ? "You" : activePeerUser?.displayName || msg.senderName || "User";
  const snippet =
    msg.text || (msg.mediaType === "audio" ? "🎤 Voice message" : "📷 Photo/Media");

  activeReplyTo = {
    msgId: msg.id,
    senderName: senderLabel,
    text: snippet
  };

  $("replyPreviewSender").textContent = senderLabel;
  $("replyPreviewText").textContent = snippet;
  $("replyPreviewBar").classList.remove("hidden");
  $("messageTextInput").focus();
}

function clearActiveReply() {
  activeReplyTo = null;
  $("replyPreviewBar").classList.add("hidden");
}

function attachSwipeRightToReply(rowEl, wrapEl, indicatorEl, msg) {
  let startX = 0;
  let startY = 0;
  let currentDx = 0;
  let tracking = false;

  const onStart = (x, y) => {
    startX = x;
    startY = y;
    currentDx = 0;
    tracking = true;
    wrapEl.style.transition = "none";
  };

  const onMove = (x, y) => {
    if (!tracking) return;
    const dx = x - startX;
    const dy = y - startY;
    if (dx > 6 && dx > Math.abs(dy) * 1.2) {
      currentDx = Math.min(dx, 72);
      wrapEl.style.transform = `translateX(${currentDx}px)`;
      indicatorEl.style.opacity = String(Math.min(currentDx / 52, 1));
    }
  };

  const onEnd = () => {
    if (!tracking) return;
    tracking = false;
    wrapEl.style.transition = "transform 0.18s ease-out";
    wrapEl.style.transform = "translateX(0px)";
    indicatorEl.style.opacity = "0";
    if (currentDx >= 50) {
      if (navigator.vibrate) navigator.vibrate(20);
      setActiveReply(msg);
    }
    currentDx = 0;
  };

  rowEl.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) onStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  rowEl.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  rowEl.addEventListener("touchend", onEnd);
  rowEl.addEventListener("touchcancel", onEnd);

  rowEl.addEventListener("mousedown", (e) => onStart(e.clientX, e.clientY));
  window.addEventListener("mousemove", (e) => onMove(e.clientX, e.clientY));
  window.addEventListener("mouseup", onEnd);
}

function openForwardModal(msg) {
  messageToForward = msg;
  const listEl = $("forwardUserList");
  listEl.innerHTML = "";
  const myUid = currentUser?.uid || currentUserProfile?.uid;

  allUsersMap.forEach((u) => {
    if (myUid && u.uid === myUid) return;
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
      await openOrCreateDirectChat(u);
      await sendChatMessage(
        messageToForward.text || "",
        messageToForward.mediaUrl || "",
        messageToForward.mediaType || "",
        true
      );
      messageToForward = null;
    });

    listEl.appendChild(item);
  });

  $("forwardModal").classList.remove("hidden");
}

// ================= REAL-TIME MESSAGES =================
function subscribeMessages(chatId) {
  if (unsubMessages) unsubMessages();
  const listEl = $("messagesList");
  listEl.innerHTML = "";
  const myUid = currentUser?.uid || currentUserProfile?.uid;

  const msgsRef = collection(db, "chats", chatId, "messages");
  unsubMessages = onSnapshot(msgsRef, (snapshot) => {
    const msgs = [];
    snapshot.docs.forEach((d) => {
      const data = d.data() || {};
      if (Array.isArray(data.deletedFor) && data.deletedFor.includes(myUid)) return;
      msgs.push({ id: d.id, ...data });

      if (data.senderId && data.senderId !== myUid && !data.read) {
        updateDoc(doc(db, "chats", chatId, "messages", d.id), { read: true }).catch(() => {});
      }
    });

    msgs.sort((a, b) => (Number(a.createdAtMs) || 0) - (Number(b.createdAtMs) || 0));
    renderMessages(msgs);
  });
}

function renderMessages(messages) {
  const listEl = $("messagesList");
  const viewport = $("messagesViewport");
  const myUid = currentUser?.uid || currentUserProfile?.uid;
  listEl.innerHTML = "";

  messages.forEach((msg) => {
    const isMe = msg.senderId === myUid;
    const row = document.createElement("div");
    row.className = `msg-row ${isMe ? "outgoing" : "incoming"}`;

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
      if (msg.mediaType === "video") {
        mediaHtml = `<div class="msg-media"><video src="${msg.mediaUrl}" controls></video></div>`;
      } else if (msg.mediaType === "audio") {
        mediaHtml = `<div class="msg-media"><audio src="${msg.mediaUrl}" controls></audio></div>`;
      } else {
        mediaHtml = `<div class="msg-media"><img src="${msg.mediaUrl}" alt="Attachment" /></div>`;
      }
    }

    const timeText = formatTime(msg.createdAtMs || msg.createdAt);
    const ticks = isMe
      ? `<i class="fa-solid fa-check-double msg-ticks ${msg.read ? "read" : ""}"></i>`
      : "";

    row.innerHTML = `
      <div class="swipe-reply-indicator"><i class="fa-solid fa-reply"></i></div>
      <div class="msg-bubble-wrap">
        <div class="msg-bubble">
          ${forwardedHtml}
          ${quotedHtml}
          ${mediaHtml}
          ${msg.text ? `<div class="msg-text">${escapeHtml(msg.text)}</div>` : ""}
          <div class="msg-meta">
            <span class="msg-time">${timeText}</span>
            ${ticks}
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

    attachSwipeRightToReply(row, wrapEl, indicatorEl, msg);

    forwardBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openForwardModal(msg);
    });

    row.addEventListener("dblclick", async () => {
      if (!activeChatId) return;
      if (isMe && confirm("Delete this message for everyone?")) {
        await updateDoc(doc(db, "chats", activeChatId, "messages", msg.id), {
          text: "🚫 This message was deleted",
          mediaUrl: "",
          isForwarded: false,
          replyTo: null
        });
      }
    });

    listEl.appendChild(row);
  });

  viewport.scrollTop = viewport.scrollHeight;
}

async function sendChatMessage(text = "", mediaUrl = "", mediaType = "", isForwarded = false) {
  const myUid = currentUser?.uid || currentUserProfile?.uid;
  if (!myUid || !activeChatId || !activePeerUser) return;
  const cleanText = String(text || "").trim();
  if (!cleanText && !mediaUrl) return;

  const nowMs = Date.now();
  const previewText =
    cleanText || (mediaType === "audio" ? "🎤 Voice message" : "📷 Media attachment");

  const replyPayload = activeReplyTo ? { ...activeReplyTo } : null;
  $("messageTextInput").value = "";
  clearActiveReply();
  saveLocalRecentChat(activePeerUser, previewText);

  try {
    await addDoc(collection(db, "chats", activeChatId, "messages"), {
      senderId: myUid,
      senderName: String(currentUserProfile?.displayName || "User"),
      text: cleanText,
      mediaUrl: String(mediaUrl || ""),
      mediaType: String(mediaType || ""),
      isForwarded: Boolean(isForwarded),
      replyTo: replyPayload,
      createdAtMs: nowMs,
      createdAt: serverTimestamp(),
      read: false
    });

    const myInfo = {
      uid: myUid,
      displayName: String(currentUserProfile?.displayName || "Me"),
      username: String(currentUserProfile?.username || "me"),
      photoURL: String(currentUserProfile?.photoURL || getFallbackAvatar("Me"))
    };

    const peerInfo = {
      uid: activePeerUser.uid,
      displayName: String(activePeerUser.displayName || "User"),
      username: String(activePeerUser.username || "user"),
      photoURL: String(activePeerUser.photoURL || getFallbackAvatar(activePeerUser.displayName))
    };

    await setDoc(
      doc(db, "chats", activeChatId),
      {
        chatId: activeChatId,
        participants: [myUid, activePeerUser.uid],
        participantDetails: {
          [myUid]: myInfo,
          [activePeerUser.uid]: peerInfo
        },
        lastMessage: previewText,
        lastSenderId: myUid,
        updatedAt: serverTimestamp(),
        updatedAtMs: nowMs
      },
      { merge: true }
    );
  } catch (err) {
    console.error("Send message error:", err);
  }
}

// ================= STATUS UPDATES =================
function subscribeStatuses() {
  if (unsubStatuses) unsubStatuses();
  unsubStatuses = onSnapshot(collection(db, "statuses"), (snap) => {
    const container = $("statusListContainer");
    container.innerHTML = "";
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    snap.docs.forEach((d) => {
      const st = d.data() || {};
      if ((st.createdAtMs || 0) < cutoff) return;
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
          </div>
        </div>
      `;
      setSafeAvatar(div.querySelector("img"), st.userPhoto, st.userName);
      container.appendChild(div);
    });
  });
}

// ================= DRAGGABLE PIP VIDEO + WEBRTC CALLING =================
function initDraggablePiP(pipEl) {
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
    const nextLeft = Math.max(8, Math.min(initialLeft + dx, maxLeft));
    const nextTop = Math.max(12, Math.min(initialTop + dy, maxTop));
    pipEl.style.left = `${nextLeft}px`;
    pipEl.style.top = `${nextTop}px`;
  };

  const stopDrag = () => {
    isDragging = false;
  };

  pipEl.addEventListener("touchstart", (e) => {
    if (e.target.closest("button")) return;
    if (e.touches.length === 1) startDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (isDragging && e.touches.length === 1) moveDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  window.addEventListener("touchend", stopDrag);

  pipEl.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    startDrag(e.clientX, e.clientY);
  });
  window.addEventListener("mousemove", (e) => moveDrag(e.clientX, e.clientY));
  window.addEventListener("mouseup", stopDrag);
}

function subscribeIncomingCalls() {
  const myUid = currentUser?.uid || currentUserProfile?.uid;
  if (!myUid) return;
  if (unsubCalls) unsubCalls();

  const qCalls = query(collection(db, "calls"), where("calleeId", "==", myUid));
  unsubCalls = onSnapshot(qCalls, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added") {
        const data = change.doc.data() || {};
        if (data.status === "offering" && Date.now() - (data.createdAtMs || 0) < 60000) {
          currentCallDocId = change.doc.id;
          pendingCallData = data;
          $("callInfoHeader").classList.remove("video-active");
          $("callPeerName").textContent = data.callerName || "Incoming Call";
          setSafeAvatar($("callPeerAvatar"), data.callerPhoto, data.callerName);
          $("callStatusLabel").textContent = `Incoming ${data.callType || "voice"} call...`;
          $("acceptCallBtn").classList.remove("hidden");
          $("callModal").classList.remove("hidden");
        }
      }
    });
  });
}

async function initiateCall(callType = "voice") {
  const myUid = currentUser?.uid || currentUserProfile?.uid;
  if (!myUid || !activePeerUser) return;
  try {
    $("callInfoHeader").classList.toggle("video-active", callType === "video");
    $("callPeerName").textContent = activePeerUser.displayName;
    setSafeAvatar($("callPeerAvatar"), activePeerUser.photoURL, activePeerUser.displayName);
    $("callStatusLabel").textContent = `Calling (${callType})...`;
    $("acceptCallBtn").classList.add("hidden");
    $("callModal").classList.remove("hidden");
    $("localVideoWrap").style.display = callType === "video" ? "block" : "none";

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
      callerName: currentUserProfile?.displayName || "User",
      callerPhoto: currentUserProfile?.photoURL || "",
      calleeId: activePeerUser.uid,
      calleeName: activePeerUser.displayName,
      callType,
      status: "offering",
      createdAtMs: Date.now()
    });
    currentCallDocId = callDocRef.id;

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && currentCallDocId) {
        addDoc(collection(db, "calls", currentCallDocId, "callerCandidates"), event.candidate.toJSON()).catch(() => {});
      }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await updateDoc(callDocRef, { offer: { type: offer.type, sdp: offer.sdp } });

    if (unsubActiveCallDoc) unsubActiveCallDoc();
    unsubActiveCallDoc = onSnapshot(callDocRef, async (snap) => {
      const data = snap.data() || {};
      if (data.status === "ended") {
        endActiveCall();
        return;
      }
      if (data.answer && peerConnection && !peerConnection.currentRemoteDescription) {
        $("callStatusLabel").textContent = "Connected";
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    onSnapshot(collection(db, "calls", currentCallDocId, "calleeCandidates"), (snap) => {
      snap.docChanges().forEach((c) => {
        if (c.type === "added" && peerConnection) {
          peerConnection.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(() => {});
        }
      });
    });
  } catch (err) {
    alert("Microphone/Camera permission is required for calling.");
    endActiveCall();
  }
}

async function acceptIncomingCall() {
  if (!currentCallDocId || !pendingCallData) return;
  try {
    const callType = pendingCallData.callType || "voice";
    $("acceptCallBtn").classList.add("hidden");
    $("callStatusLabel").textContent = "Connecting...";
    $("callInfoHeader").classList.toggle("video-active", callType === "video");
    $("localVideoWrap").style.display = callType === "video" ? "block" : "none";

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
        addDoc(collection(db, "calls", currentCallDocId, "calleeCandidates"), event.candidate.toJSON()).catch(() => {});
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
      $("callStatusLabel").textContent = "Connected";
    }

    onSnapshot(collection(db, "calls", currentCallDocId, "callerCandidates"), (snap) => {
      snap.docChanges().forEach((c) => {
        if (c.type === "added" && peerConnection) {
          peerConnection.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(() => {});
        }
      });
    });

    if (unsubActiveCallDoc) unsubActiveCallDoc();
    unsubActiveCallDoc = onSnapshot(callDocRef, (snap) => {
      if (snap.data()?.status === "ended") endActiveCall();
    });
  } catch (err) {
    endActiveCall();
  }
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
      const sender = peerConnection.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender && newVideoTrack) await sender.replaceTrack(newVideoTrack);
    }
    localStream.getTracks().forEach((t) => t.stop());
    localStream = newStream;
    $("localVideo").srcObject = localStream;
  } catch (e) {}
}

function endActiveCall() {
  if (unsubActiveCallDoc) {
    unsubActiveCallDoc();
    unsubActiveCallDoc = null;
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
  $("remoteVideo").srcObject = null;
  $("localVideo").srcObject = null;
  $("callModal").classList.add("hidden");
}

// ================= UI EVENT BINDINGS =================
function bindUIEvents() {
  initDraggablePiP($("localVideoWrap"));

  const openSearchOverlay = () => {
    $("searchResultsPanel").classList.remove("hidden");
    $("userSearchInput").focus();
    performUserSearch($("userSearchInput").value);
  };

  $("fabNewChatBtn").addEventListener("click", openSearchOverlay);
  $("userSearchInput").addEventListener("focus", () => {
    $("searchResultsPanel").classList.remove("hidden");
    performUserSearch($("userSearchInput").value);
  });

  $("closeSearchPanelBtn").addEventListener("click", () => {
    $("searchResultsPanel").classList.add("hidden");
  });

  $("clearSearchInputBtn").addEventListener("click", () => {
    $("userSearchInput").value = "";
    $("clearSearchInputBtn").classList.add("hidden");
    performUserSearch("");
  });

  $("userSearchInput").addEventListener("input", (e) => {
    const val = e.target.value;
    $("clearSearchInputBtn").classList.toggle("hidden", val.length === 0);
    $("searchResultsPanel").classList.remove("hidden");
    performUserSearch(val);
  });

  // Filter chips
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeChatFilter = chip.dataset.filter || "all";
      if (activeChatFilter === "groups") {
        document.querySelector('[data-tab="tabGroupsView"]').click();
      } else {
        document.querySelector('[data-tab="tabChatsView"]').click();
        renderChatList(latestChatItems);
      }
    });
  });

  if (localStorage.getItem("nexchat_theme") === "dark") {
    document.body.classList.add("dark-theme");
  }
  $("themeToggleBtn").addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    const isDark = document.body.classList.contains("dark-theme");
    localStorage.setItem("nexchat_theme", isDark ? "dark" : "light");
  });

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      const targetTab = $(btn.dataset.tab);
      if (targetTab) targetTab.classList.add("active");
    });
  });

  $("chatBackBtn").addEventListener("click", () => {
    activeChatId = null;
    clearActiveReply();
    if (unsubMessages) {
      unsubMessages();
      unsubMessages = null;
    }
    switchScreen("mainScreen");
  });

  $("cancelReplyBtn").addEventListener("click", clearActiveReply);

  $("sendOrMicBtn").addEventListener("click", () => {
    sendChatMessage($("messageTextInput").value);
  });

  $("messageTextInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChatMessage($("messageTextInput").value);
    }
  });

  $("emojiToggleBtn").addEventListener("click", () => {
    $("emojiPickerBar").classList.toggle("hidden");
  });

  document.querySelectorAll("#emojiPickerBar span").forEach((sp) => {
    sp.addEventListener("click", () => {
      $("messageTextInput").value += sp.textContent;
      $("messageTextInput").focus();
    });
  });

  const handleMediaInput = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const mediaType = file.type.startsWith("video")
      ? "video"
      : file.type.startsWith("audio")
      ? "audio"
      : "image";
    const url = await uploadToCloudinary(file);
    await sendChatMessage("", url, mediaType);
    e.target.value = "";
  };

  $("mediaFileInput").addEventListener("change", handleMediaInput);
  $("cameraCaptureInput").addEventListener("change", handleMediaInput);
  $("headerCameraBtn").addEventListener("click", () => $("cameraCaptureInput").click());

  $("closeForwardModalBtn").addEventListener("click", () => {
    $("forwardModal").classList.add("hidden");
  });

  $("addStatusCardBtn").addEventListener("click", async () => {
    if (!currentUserProfile) return;
    const caption = prompt("Enter your 24-hour Status update:");
    if (!caption || !caption.trim()) return;
    await addDoc(collection(db, "statuses"), {
      uid: currentUserProfile.uid,
      userName: currentUserProfile.displayName,
      userPhoto: currentUserProfile.photoURL,
      caption: caption.trim(),
      createdAtMs: Date.now()
    });
  });

  $("openCreateGroupBtn").addEventListener("click", async () => {
    const groupName = prompt("Enter new Group Name:");
    if (!groupName || !groupName.trim()) return;
    const groupRef = await addDoc(collection(db, "groups"), {
      name: groupName.trim(),
      createdBy: currentUserProfile?.uid || "",
      createdAtMs: Date.now()
    });
    const row = document.createElement("div");
    row.className = "wa-item";
    row.innerHTML = `
      <div class="group-icon-circle"><i class="fa-solid fa-users"></i></div>
      <div class="wa-item-info">
        <div class="wa-item-top"><span class="wa-item-title">${escapeHtml(groupName)}</span></div>
        <div class="wa-item-bottom"><span class="wa-item-sub">Group ID: ${groupRef.id.slice(0, 6)}</span></div>
      </div>
    `;
    $("groupListContainer").appendChild(row);
  });

  $("openProfileModalBtn").addEventListener("click", () => {
    updateMyHeaderUI();
    $("profileModal").classList.remove("hidden");
  });

  $("closeProfileModalBtn").addEventListener("click", () => {
    $("profileModal").classList.add("hidden");
  });

  $("profilePhotoInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentUserProfile) return;
    const url = await uploadToCloudinary(file);
    setSafeAvatar($("profileModalAvatar"), url, currentUserProfile.displayName);
    await setDoc(doc(db, "users", currentUserProfile.uid), { photoURL: url }, { merge: true });
    currentUserProfile.photoURL = url;
    saveCachedUserSession(currentUserProfile);
    updateMyHeaderUI();
  });

  $("saveProfileBtn").addEventListener("click", async () => {
    if (!currentUserProfile) return;
    const displayName = $("editDisplayNameInput").value.trim() || "NexChat User";
    const username = $("editUsernameInput").value.trim().replace(/^@+/, "").toLowerCase() || "user";
    const bio = $("editBioInput").value.trim();

    await setDoc(
      doc(db, "users", currentUserProfile.uid),
      { displayName, username, bio, updatedAt: serverTimestamp() },
      { merge: true }
    );
    currentUserProfile.displayName = displayName;
    currentUserProfile.username = username;
    currentUserProfile.bio = bio;
    saveCachedUserSession(currentUserProfile);
    updateMyHeaderUI();
    $("profileModal").classList.add("hidden");
  });

  // Explicit Log Out: Only place where cached session is cleared and authScreen is shown
  $("logoutBtn").addEventListener("click", async () => {
    const uid = currentUser?.uid || currentUserProfile?.uid;
    clearCachedUserSession();
    if (uid) {
      await setDoc(doc(db, "users", uid), { online: false, lastSeenMs: Date.now() }, { merge: true }).catch(() => {});
    }
    await signOut(auth).catch(() => {});
    currentUser = null;
    currentUserProfile = null;
    activeChatId = null;
    $("profileModal").classList.add("hidden");
    switchScreen("authScreen");
  });

  $("startVoiceCallBtn").addEventListener("click", () => initiateCall("voice"));
  $("startVideoCallBtn").addEventListener("click", () => initiateCall("video"));
  $("endCallBtn").addEventListener("click", endActiveCall);
  $("acceptCallBtn").addEventListener("click", acceptIncomingCall);
  $("switchCamBtn").addEventListener("click", switchCameraFacingMode);

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

// ================= INITIALIZATION (ZERO-FLASH DIRECT CHAT BOOT) =================
document.addEventListener("DOMContentLoaded", () => {
  setupAuthUI();
  bindUIEvents();

  // Immediately hydrate UI from local cache if user logged in previously
  const cachedProfile = getCachedUserSession();
  if (cachedProfile && cachedProfile.uid) {
    currentUserProfile = cachedProfile;
    updateMyHeaderUI();
    switchScreen("mainScreen");
    const cachedChats = Object.values(getLocalRecentChats());
    if (cachedChats.length > 0) {
      latestChatItems = cachedChats;
      renderChatList(cachedChats);
    }
  } else {
    switchScreen("authScreen");
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      switchScreen("mainScreen");
      await ensureUserDocument(user);
      subscribeAllUsers();
      subscribeChatList();
      subscribeStatuses();
      subscribeIncomingCalls();
    } else if (!getCachedUserSession()) {
      currentUser = null;
      currentUserProfile = null;
      activeChatId = null;
      switchScreen("authScreen");
    }
  });
});
