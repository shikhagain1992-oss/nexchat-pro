import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ================= APPLICATION STATE =================
let currentUser = null;
let currentUserProfile = null;
let allUsersMap = new Map(); // uid -> normalized user profile
let activeChatId = null;
let activePeerUser = null;
let isSignUpMode = false;

let unsubUsers = null;
let unsubChats = null;
let unsubMessages = null;
let unsubStatuses = null;
let unsubCalls = null;

let peerConnection = null;
let localStream = null;
let currentCallDocId = null;

// ================= HELPER UTILITIES =================
const $ = (id) => document.getElementById(id);

function getFallbackAvatar(name) {
  const clean = encodeURIComponent(String(name || "User").trim());
  return `https://ui-avatars.com/api/?name=${clean}&background=00a884&color=fff`;
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

  const photoURL = String(raw.photoURL || raw.avatar || raw.photo || getFallbackAvatar(displayName)).trim();
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

function formatTime(ms) {
  if (!ms) return "";
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function saveLocalRecentChat(peerObj, lastMessage = "") {
  if (!currentUser || !peerObj || !peerObj.uid) return;
  try {
    const key = `nexchat_recent_${currentUser.uid}`;
    const existing = JSON.parse(localStorage.getItem(key) || "{}");
    const chatId = getDeterministicChatId(currentUser.uid, peerObj.uid);
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
  } catch (err) {
    console.warn("Local cache warning:", err);
  }
}

function getLocalRecentChats() {
  if (!currentUser) return {};
  try {
    const key = `nexchat_recent_${currentUser.uid}`;
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
  } catch (err) {
    console.warn("Cloudinary fallback to DataURL:", err);
  }
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
        const rawUser = $("authUsername").value.trim().replace(/^@+/, "").toLowerCase() || email.split("@")[0].toLowerCase();
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
      if (popupErr.code === "auth/popup-blocked" || popupErr.code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(auth, googleProvider);
      } else {
        authErrorMsg.textContent = popupErr.message || "Google Sign-In failed.";
        authErrorMsg.classList.remove("hidden");
      }
    }
  });

  getRedirectResult(auth).catch((err) => {
    console.warn("Redirect auth check:", err);
  });
}

async function ensureUserDocument(firebaseUser, customName = "", customUsername = "") {
  const userRef = doc(db, "users", firebaseUser.uid);
  let existingData = {};
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) existingData = snap.data() || {};
  } catch (e) {
    console.warn("User doc fetch warning:", e);
  }

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
  );

  currentUserProfile = normalized;
  allUsersMap.set(normalized.uid, normalized);
  updateMyHeaderUI();
}

function updateMyHeaderUI() {
  if (!currentUserProfile) return;
  $("myHeaderAvatar").src = currentUserProfile.photoURL;
  $("myStatusAvatar").src = currentUserProfile.photoURL;
  $("profileModalAvatar").src = currentUserProfile.photoURL;
  $("editDisplayNameInput").value = currentUserProfile.displayName;
  $("editUsernameInput").value = currentUserProfile.username;
  $("editBioInput").value = currentUserProfile.bio;
}

// ================= USERS DIRECTORY & SEARCH (BUG 1 FIXED) =================
function subscribeAllUsers() {
  if (unsubUsers) unsubUsers();
  unsubUsers = onSnapshot(
    collection(db, "users"),
    (snapshot) => {
      snapshot.docs.forEach((docSnap) => {
        const u = normalizeUserRecord(docSnap.data(), docSnap.id);
        if (u && u.uid) {
          allUsersMap.set(u.uid, u);
        }
      });
      if (activePeerUser && allUsersMap.has(activePeerUser.uid)) {
        activePeerUser = allUsersMap.get(activePeerUser.uid);
        refreshActiveChatHeader();
      }
    },
    (err) => console.error("Users listener error:", err)
  );
}

async function performUserSearch(rawQuery) {
  const q = String(rawQuery || "").trim().toLowerCase().replace(/^@+/, "");
  const resultsList = $("searchResultsList");
  const statusText = $("searchStatusText");

  // Ensure users cache is populated if empty
  if (allUsersMap.size <= 1) {
    try {
      const snap = await getDocs(collection(db, "users"));
      snap.docs.forEach((d) => {
        const u = normalizeUserRecord(d.data(), d.id);
        if (u && u.uid) allUsersMap.set(u.uid, u);
      });
    } catch (e) {
      console.warn("Manual user fetch warning:", e);
    }
  }

  const candidates = [];
  allUsersMap.forEach((userObj) => {
    if (!currentUser || userObj.uid === currentUser.uid) return;
    if (!q) {
      candidates.push(userObj);
      return;
    }
    const nameMatch = userObj.displayName.toLowerCase().includes(q);
    const unameMatch = userObj.username.toLowerCase().includes(q);
    const emailMatch = userObj.email.toLowerCase().includes(q);
    if (nameMatch || unameMatch || emailMatch) {
      candidates.push(userObj);
    }
  });

  resultsList.innerHTML = "";

  if (candidates.length === 0) {
    statusText.textContent = q ? `No users found matching "${rawQuery}"` : "No other registered users found yet";
    return;
  }

  statusText.textContent = q
    ? `Found ${candidates.length} user(s) — Tap to start chatting`
    : `All Users (${candidates.length}) — Tap any account to chat`;

  candidates.forEach((targetUser) => {
    const item = document.createElement("div");
    item.className = "wa-item";
    item.dataset.uid = targetUser.uid;
    item.innerHTML = `
      <div class="avatar-wrap">
        <img src="${targetUser.photoURL}" alt="${targetUser.displayName}" />
        <span class="online-dot ${targetUser.online ? "" : "hidden"}"></span>
      </div>
      <div class="wa-item-info">
        <div class="wa-item-top">
          <span class="wa-item-title">${targetUser.displayName}</span>
        </div>
        <div class="wa-item-bottom">
          <span class="wa-item-sub">@${targetUser.username}</span>
        </div>
      </div>
    `;

    // Direct selection handler preserving targetUser object & UID
    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openOrCreateDirectChat(targetUser);
    });

    resultsList.appendChild(item);
  });
}

// ================= OPEN / CREATE CONVERSATION (BUG 1 FIXED) =================
async function openOrCreateDirectChat(rawTargetUser) {
  if (!currentUser) return;

  // Step 1: Preserve UID and retrieve normalized profile
  const targetUid = String(rawTargetUser?.uid || rawTargetUser?.id || "").trim();
  if (!targetUid) return;

  let peerProfile = allUsersMap.get(targetUid) || normalizeUserRecord(rawTargetUser, targetUid);
  try {
    const userSnap = await getDoc(doc(db, "users", targetUid));
    if (userSnap.exists()) {
      peerProfile = normalizeUserRecord(userSnap.data(), targetUid);
      allUsersMap.set(targetUid, peerProfile);
    }
  } catch (err) {
    console.warn("Using cached profile:", err);
  }

  const chatId = getDeterministicChatId(currentUser.uid, targetUid);
  activeChatId = chatId;
  activePeerUser = peerProfile;

  // Step 2: Hide search bar & immediately open Chat Screen UI
  $("searchBarContainer").classList.add("hidden");
  $("searchResultsPanel").classList.add("hidden");
  $("userSearchInput").value = "";

  refreshActiveChatHeader();
  switchScreen("chatScreen");

  // Step 3: Persist locally so conversation remains available on refresh
  saveLocalRecentChat(peerProfile);

  // Step 4: Ensure conversation document exists in Firestore with sanitized fields
  try {
    const chatRef = doc(db, "chats", chatId);
    const chatSnap = await getDoc(chatRef);

    const myInfo = {
      uid: currentUser.uid,
      displayName: String(currentUserProfile?.displayName || currentUser.displayName || "Me"),
      username: String(currentUserProfile?.username || "me"),
      photoURL: String(currentUserProfile?.photoURL || getFallbackAvatar("Me"))
    };

    const peerInfo = {
      uid: peerProfile.uid,
      displayName: String(peerProfile.displayName || "User"),
      username: String(peerProfile.username || "user"),
      photoURL: String(peerProfile.photoURL || getFallbackAvatar(peerProfile.displayName))
    };

    if (!chatSnap.exists()) {
      await setDoc(
        chatRef,
        {
          chatId,
          isGroup: false,
          participants: [currentUser.uid, peerProfile.uid],
          participantDetails: {
            [currentUser.uid]: myInfo,
            [peerProfile.uid]: peerInfo
          },
          lastMessage: "",
          lastSenderId: "",
          updatedAt: serverTimestamp(),
          updatedAtMs: Date.now(),
          [`unread_${currentUser.uid}`]: 0,
          [`unread_${peerProfile.uid}`]: 0
        },
        { merge: true }
      );
    } else {
      await setDoc(
        chatRef,
        {
          participantDetails: {
            [currentUser.uid]: myInfo,
            [peerProfile.uid]: peerInfo
          },
          [`unread_${currentUser.uid}`]: 0
        },
        { merge: true }
      );
    }
  } catch (err) {
    console.error("Chat document sync error:", err);
  }

  // Step 5: Subscribe to real-time messages for this conversation
  subscribeMessages(chatId);
}

function refreshActiveChatHeader() {
  if (!activePeerUser) return;
  $("chatPeerAvatar").src = activePeerUser.photoURL || getFallbackAvatar(activePeerUser.displayName);
  $("chatPeerName").textContent = activePeerUser.displayName;
  $("chatPeerStatus").textContent = activePeerUser.online
    ? "online"
    : `@${activePeerUser.username}`;
  const dot = $("chatPeerOnlineDot");
  if (activePeerUser.online) {
    dot.classList.remove("hidden");
  } else {
    dot.classList.add("hidden");
  }
}

// ================= REAL-TIME CHAT LIST =================
function subscribeChatList() {
  if (!currentUser) return;
  if (unsubChats) unsubChats();

  const chatsQuery = query(
    collection(db, "chats"),
    where("participants", "array-contains", currentUser.uid)
  );

  unsubChats = onSnapshot(
    chatsQuery,
    (snapshot) => {
      const chatMap = new Map();

      // Merge local recent chats first so newly opened chats never vanish
      const localChats = getLocalRecentChats();
      Object.values(localChats).forEach((lc) => {
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
        const peerUid = participants.find((id) => id !== currentUser.uid) || "";
        if (!peerUid) return;

        const details = (data.participantDetails && data.participantDetails[peerUid]) || {};
        const cachedUser = allUsersMap.get(peerUid);

        const peerName =
          cachedUser?.displayName || details.displayName || "NexChat User";
        const peerUsername =
          cachedUser?.username || details.username || "user";
        const peerPhoto =
          cachedUser?.photoURL || details.photoURL || getFallbackAvatar(peerName);

        const updatedAtMs =
          Number(data.updatedAtMs) ||
          (data.updatedAt?.toMillis ? data.updatedAt.toMillis() : 0) ||
          Date.now();

        const unreadCount = Number(data[`unread_${currentUser.uid}`] || 0);

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

      renderChatList(Array.from(chatMap.values()));
    },
    (err) => {
      console.error("Chat list listener error:", err);
      const localChats = Object.values(getLocalRecentChats());
      renderChatList(localChats);
    }
  );
}

function renderChatList(chatItems) {
  const container = $("chatListContainer");
  const emptyState = $("emptyChatsState");
  const totalUnreadBadge = $("totalUnreadBadge");

  chatItems.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  container.innerHTML = "";

  if (chatItems.length === 0) {
    emptyState.classList.remove("hidden");
    totalUnreadBadge.classList.add("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  let totalUnread = 0;

  chatItems.forEach((item) => {
    totalUnread += item.unreadCount || 0;
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
      item.lastSenderId === currentUser.uid
        ? `<i class="fa-solid fa-check-double msg-ticks read"></i> `
        : "";

    row.innerHTML = `
      <div class="avatar-wrap">
        <img src="${livePeer.photoURL || getFallbackAvatar(livePeer.displayName)}" alt="${livePeer.displayName}" />
        <span class="online-dot ${livePeer.online ? "" : "hidden"}"></span>
      </div>
      <div class="wa-item-info">
        <div class="wa-item-top">
          <span class="wa-item-title">${livePeer.displayName}</span>
          <span class="wa-item-time">${formatTime(item.updatedAtMs)}</span>
        </div>
        <div class="wa-item-bottom">
          <span class="wa-item-sub">${tickHtml}${item.lastMessage || "Tap to message"}</span>
          ${item.unreadCount > 0 ? `<span class="unread-badge">${item.unreadCount}</span>` : ""}
        </div>
      </div>
    `;

    row.addEventListener("click", () => {
      openOrCreateDirectChat(livePeer);
    });

    container.appendChild(row);
  });

  if (totalUnread > 0) {
    totalUnreadBadge.textContent = String(totalUnread);
    totalUnreadBadge.classList.remove("hidden");
  } else {
    totalUnreadBadge.classList.add("hidden");
  }
}

// ================= REAL-TIME MESSAGES =================
function subscribeMessages(chatId) {
  if (unsubMessages) unsubMessages();
  const listEl = $("messagesList");
  listEl.innerHTML = "";

  const msgsRef = collection(db, "chats", chatId, "messages");
  unsubMessages = onSnapshot(
    msgsRef,
    (snapshot) => {
      const msgs = [];
      snapshot.docs.forEach((d) => {
        const data = d.data() || {};
        if (Array.isArray(data.deletedFor) && data.deletedFor.includes(currentUser.uid)) {
          return;
        }
        msgs.push({ id: d.id, ...data });

        // Mark incoming unread messages as read
        if (data.senderId && data.senderId !== currentUser.uid && !data.read) {
          updateDoc(doc(db, "chats", chatId, "messages", d.id), { read: true }).catch(() => {});
        }
      });

      msgs.sort((a, b) => (Number(a.createdAtMs) || 0) - (Number(b.createdAtMs) || 0));
      renderMessages(msgs);
    },
    (err) => console.error("Messages listener error:", err)
  );
}

function renderMessages(messages) {
  const listEl = $("messagesList");
  const viewport = $("messagesViewport");
  listEl.innerHTML = "";

  messages.forEach((msg) => {
    const isMe = msg.senderId === currentUser.uid;
    const row = document.createElement("div");
    row.className = `msg-row ${isMe ? "outgoing" : "incoming"}`;

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

    const ticks = isMe
      ? `<i class="fa-solid fa-check-double msg-ticks ${msg.read ? "read" : ""}"></i>`
      : "";

    row.innerHTML = `
      <div class="msg-bubble">
        ${mediaHtml}
        ${msg.text ? `<div class="msg-text">${escapeHtml(msg.text)}</div>` : ""}
        <div class="msg-meta">
          <span>${formatTime(msg.createdAtMs)}</span>
          ${ticks}
        </div>
      </div>
    `;

    // Long press / double click to delete message
    row.addEventListener("dblclick", async () => {
      if (!activeChatId) return;
      if (isMe && confirm("Delete this message for everyone?")) {
        await updateDoc(doc(db, "chats", activeChatId, "messages", msg.id), {
          text: "🚫 This message was deleted",
          mediaUrl: ""
        });
      }
    });

    listEl.appendChild(row);
  });

  viewport.scrollTop = viewport.scrollHeight;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendChatMessage(text = "", mediaUrl = "", mediaType = "") {
  if (!currentUser || !activeChatId || !activePeerUser) return;
  const cleanText = String(text || "").trim();
  if (!cleanText && !mediaUrl) return;

  const nowMs = Date.now();
  const previewText =
    cleanText || (mediaType === "audio" ? "🎤 Voice message" : "📷 Media attachment");

  $("messageTextInput").value = "";
  saveLocalRecentChat(activePeerUser, previewText);

  try {
    await addDoc(collection(db, "chats", activeChatId, "messages"), {
      senderId: currentUser.uid,
      senderName: String(currentUserProfile?.displayName || "User"),
      text: cleanText,
      mediaUrl: String(mediaUrl || ""),
      mediaType: String(mediaType || ""),
      createdAtMs: nowMs,
      createdAt: serverTimestamp(),
      read: false
    });

    const myInfo = {
      uid: currentUser.uid,
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
        participants: [currentUser.uid, activePeerUser.uid],
        participantDetails: {
          [currentUser.uid]: myInfo,
          [activePeerUser.uid]: peerInfo
        },
        lastMessage: previewText,
        lastSenderId: currentUser.uid,
        updatedAt: serverTimestamp(),
        updatedAtMs: nowMs
      },
      { merge: true }
    );
  } catch (err) {
    console.error("Failed to send message:", err);
  }
}

// ================= STATUS UPDATES & GROUPS =================
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
          <img src="${st.userPhoto || getFallbackAvatar(st.userName)}" alt="${st.userName}" />
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
      container.appendChild(div);
    });
  });
}

// ================= WEBRTC VOICE & VIDEO CALLING =================
function subscribeIncomingCalls() {
  if (!currentUser) return;
  if (unsubCalls) unsubCalls();

  const qCalls = query(collection(db, "calls"), where("calleeId", "==", currentUser.uid));
  unsubCalls = onSnapshot(qCalls, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added") {
        const data = change.doc.data();
        if (data.status === "offering" && Date.now() - (data.createdAtMs || 0) < 60000) {
          currentCallDocId = change.doc.id;
          $("callPeerName").textContent = data.callerName || "Incoming Call";
          $("callPeerAvatar").src = data.callerPhoto || getFallbackAvatar(data.callerName);
          $("callStatusLabel").textContent = `Incoming ${data.callType || "voice"} call...`;
          $("acceptCallBtn").classList.remove("hidden");
          $("callModal").classList.remove("hidden");
        }
      }
    });
  });
}

async function initiateCall(callType = "voice") {
  if (!currentUser || !activePeerUser) return;
  try {
    $("callPeerName").textContent = activePeerUser.displayName;
    $("callPeerAvatar").src = activePeerUser.photoURL;
    $("callStatusLabel").textContent = `Calling (${callType})...`;
    $("acceptCallBtn").classList.add("hidden");
    $("callModal").classList.remove("hidden");

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === "video"
    });
    $("localVideo").srcObject = localStream;

    const callDoc = await addDoc(collection(db, "calls"), {
      callerId: currentUser.uid,
      callerName: currentUserProfile?.displayName || "User",
      callerPhoto: currentUserProfile?.photoURL || "",
      calleeId: activePeerUser.uid,
      calleeName: activePeerUser.displayName,
      callType,
      status: "offering",
      createdAtMs: Date.now()
    });
    currentCallDocId = callDoc.id;
  } catch (err) {
    alert("Microphone/Camera permission is required for calling.");
    $("callModal").classList.add("hidden");
  }
}

function endActiveCall() {
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
  $("callModal").classList.add("hidden");
}

// ================= UI EVENT BINDINGS =================
function bindUIEvents() {
  // Search bar toggle
  const openSearchUI = () => {
    $("searchBarContainer").classList.remove("hidden");
    $("searchResultsPanel").classList.remove("hidden");
    $("userSearchInput").focus();
    performUserSearch($("userSearchInput").value);
  };

  $("toggleSearchBtn").addEventListener("click", openSearchUI);
  $("fabNewChatBtn").addEventListener("click", openSearchUI);

  $("closeSearchBtn").addEventListener("click", () => {
    $("searchBarContainer").classList.add("hidden");
    $("searchResultsPanel").classList.add("hidden");
    $("userSearchInput").value = "";
  });

  $("clearSearchInputBtn").addEventListener("click", () => {
    $("userSearchInput").value = "";
    $("clearSearchInputBtn").classList.add("hidden");
    performUserSearch("");
  });

  $("userSearchInput").addEventListener("input", (e) => {
    const val = e.target.value;
    if (val.length > 0) {
      $("clearSearchInputBtn").classList.remove("hidden");
    } else {
      $("clearSearchInputBtn").classList.add("hidden");
    }
    performUserSearch(val);
  });

  // Theme toggle
  if (localStorage.getItem("nexchat_theme") === "dark") {
    document.body.classList.add("dark-theme");
  }
  $("themeToggleBtn").addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    const isDark = document.body.classList.contains("dark-theme");
    localStorage.setItem("nexchat_theme", isDark ? "dark" : "light");
  });

  // Bottom Navigation Tabs
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      const targetTab = $(btn.dataset.tab);
      if (targetTab) targetTab.classList.add("active");
    });
  });

  // Chat screen Back button
  $("chatBackBtn").addEventListener("click", () => {
    activeChatId = null;
    if (unsubMessages) {
      unsubMessages();
      unsubMessages = null;
    }
    switchScreen("mainScreen");
  });

  // Send message on button click or Enter key
  $("sendOrMicBtn").addEventListener("click", () => {
    sendChatMessage($("messageTextInput").value);
  });

  $("messageTextInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChatMessage($("messageTextInput").value);
    }
  });

  // Emoji bar toggle & selection
  $("emojiToggleBtn").addEventListener("click", () => {
    $("emojiPickerBar").classList.toggle("hidden");
  });

  document.querySelectorAll("#emojiPickerBar span").forEach((sp) => {
    sp.addEventListener("click", () => {
      $("messageTextInput").value += sp.textContent;
      $("messageTextInput").focus();
    });
  });

  // Media file & camera attachment upload
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

  // Status update creation
  $("addStatusCardBtn").addEventListener("click", async () => {
    if (!currentUserProfile) return;
    const caption = prompt("Enter your 24-hour Status update:");
    if (!caption || !caption.trim()) return;
    await addDoc(collection(db, "statuses"), {
      uid: currentUser.uid,
      userName: currentUserProfile.displayName,
      userPhoto: currentUserProfile.photoURL,
      caption: caption.trim(),
      createdAtMs: Date.now()
    });
  });

  // Create Group
  $("openCreateGroupBtn").addEventListener("click", async () => {
    const groupName = prompt("Enter new Group Name:");
    if (!groupName || !groupName.trim()) return;
    const groupRef = await addDoc(collection(db, "groups"), {
      name: groupName.trim(),
      createdBy: currentUser.uid,
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

  // Profile Modal
  $("openProfileModalBtn").addEventListener("click", () => {
    updateMyHeaderUI();
    $("profileModal").classList.remove("hidden");
  });

  $("closeProfileModalBtn").addEventListener("click", () => {
    $("profileModal").classList.add("hidden");
  });

  $("profilePhotoInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;
    const url = await uploadToCloudinary(file);
    $("profileModalAvatar").src = url;
    await setDoc(doc(db, "users", currentUser.uid), { photoURL: url }, { merge: true });
    if (currentUserProfile) currentUserProfile.photoURL = url;
    updateMyHeaderUI();
  });

  $("saveProfileBtn").addEventListener("click", async () => {
    if (!currentUser) return;
    const displayName = $("editDisplayNameInput").value.trim() || "NexChat User";
    const username = $("editUsernameInput").value.trim().replace(/^@+/, "").toLowerCase() || "user";
    const bio = $("editBioInput").value.trim();

    await setDoc(
      doc(db, "users", currentUser.uid),
      { displayName, username, bio, updatedAt: serverTimestamp() },
      { merge: true }
    );
    if (currentUserProfile) {
      currentUserProfile.displayName = displayName;
      currentUserProfile.username = username;
      currentUserProfile.bio = bio;
    }
    updateMyHeaderUI();
    $("profileModal").classList.add("hidden");
  });

  $("logoutBtn").addEventListener("click", async () => {
    if (currentUser) {
      await setDoc(doc(db, "users", currentUser.uid), { online: false, lastSeenMs: Date.now() }, { merge: true }).catch(() => {});
    }
    await signOut(auth);
    $("profileModal").classList.add("hidden");
  });

  // Call buttons
  $("startVoiceCallBtn").addEventListener("click", () => initiateCall("voice"));
  $("startVideoCallBtn").addEventListener("click", () => initiateCall("video"));
  $("endCallBtn").addEventListener("click", endActiveCall);
  $("acceptCallBtn").addEventListener("click", () => {
    $("callStatusLabel").textContent = "Connected";
    $("acceptCallBtn").classList.add("hidden");
  });
}

// ================= INITIALIZATION =================
document.addEventListener("DOMContentLoaded", () => {
  setupAuthUI();
  bindUIEvents();

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      await ensureUserDocument(user);
      subscribeAllUsers();
      subscribeChatList();
      subscribeStatuses();
      subscribeIncomingCalls();
      switchScreen("mainScreen");
    } else {
      currentUser = null;
      currentUserProfile = null;
      activeChatId = null;
      switchScreen("authScreen");
    }
  });
});
