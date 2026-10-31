import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
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
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getDatabase,
  ref as rtdbRef,
  onValue,
  set as rtdbSet,
  onDisconnect,
  serverTimestamp as rtdbTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

window.switchAuthTab = function(mode) {
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const alertBox = document.getElementById("auth-alert");
  if (alertBox) alertBox.classList.add("hidden");

  if (mode === "register") {
    loginForm.classList.add("hidden");
    registerForm.classList.remove("hidden");
    tabRegister.className = "py-3.5 text-sm font-bold text-blue-950 bg-white border-b-2 border-blue-900 transition";
    tabLogin.className = "py-3.5 text-sm font-bold text-slate-500 hover:text-slate-800 transition";
  } else {
    registerForm.classList.add("hidden");
    loginForm.classList.remove("hidden");
    tabLogin.className = "py-3.5 text-sm font-bold text-blue-950 bg-white border-b-2 border-blue-900 transition";
    tabRegister.className = "py-3.5 text-sm font-bold text-slate-500 hover:text-slate-800 transition";
  }
};

window.togglePasswordVisibility = function(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === "password" ? "text" : "password";
  }
};

window.switchAppTab = function(tabName) {
  document.querySelectorAll(".app-tab-view").forEach(function(el) {
    el.classList.add("hidden");
    el.classList.remove("flex");
  });
  const target = document.getElementById("view-" + tabName);
  if (target) {
    target.classList.remove("hidden");
    target.classList.add("flex");
  }
  document.querySelectorAll(".app-nav-btn").forEach(function(btn) {
    btn.className = "app-nav-btn flex-1 md:flex-none flex items-center justify-center md:justify-start gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold text-blue-200 hover:bg-blue-900/50 transition";
  });
  const activeBtn = document.getElementById("nav-" + tabName);
  if (activeBtn) {
    activeBtn.className = "app-nav-btn flex-1 md:flex-none flex items-center justify-center md:justify-start gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-blue-600 text-white transition";
  }
  document.getElementById("left-list-panel")?.classList.remove("hidden");
  if (window.innerWidth < 768) {
    document.getElementById("chat-panel")?.classList.add("hidden");
  }
};

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

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

setPersistence(auth, browserLocalPersistence).catch(() => {});

let currentUser = null;
let currentUserProfile = null;
let activeChat = null;
let messagesUnsubscribe = null;
let replyToMessage = null;
let mediaRecorder = null;
let audioChunks = [];
let peerConnection = null;
let localStream = null;
let currentCallId = null;
let currentFacingMode = "user";
let isMicMuted = false;

const rtcConfig = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
};

function showAlert(msg, isError = true) {
  const el = document.getElementById("auth-alert");
  if (!el) return;
  el.textContent = msg;
  el.className = `mb-4 p-3 rounded-xl text-xs font-semibold border ${
    isError ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"
  }`;
  el.classList.remove("hidden");
}

async function uploadToCloudinary(fileOrBlob, folderName = "nexchat_pro", customFileName = null) {
  const formData = new FormData();
  if (customFileName && !(fileOrBlob instanceof File)) {
    formData.append("file", fileOrBlob, customFileName);
  } else {
    formData.append("file", fileOrBlob);
  }
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", folderName);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, {
    method: "POST",
    body: formData
  });
  const data = await res.json();
  if (!res.ok || !data.secure_url) {
    throw new Error(data.error?.message || "Media upload failed");
  }
  return data.secure_url;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("login-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = document.getElementById("login-submit-btn");
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    if (btn) { btn.disabled = true; btn.textContent = "Signing In..."; }
    showAlert("Signing in to your account...", false);

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      showAlert("Login failed: " + (err.code || err.message));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Sign In to NexChat Pro"; }
    }
  });

  document.getElementById("register-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = document.getElementById("register-submit-btn");
    const displayName = document.getElementById("reg-name").value.trim();
    const rawUsername = document.getElementById("reg-username").value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    const username = rawUsername || "user_" + Math.floor(1000 + Math.random() * 9000);
    const phone = document.getElementById("reg-phone").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;
    const avatarFile = document.getElementById("reg-avatar").files[0];

    if (btn) { btn.disabled = true; btn.textContent = "Creating Account..."; }
    showAlert("Creating your NexChat Pro account...", false);

    try {
      const usernameRef = doc(db, "usernames", username);
      const uSnap = await getDoc(usernameRef);
      if (uSnap.exists()) {
        throw new Error(`Username @${username} is already taken. Please pick another.`);
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      let photoURL = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1e3a8a&color=fff`;

      if (avatarFile) {
        try {
          photoURL = await uploadToCloudinary(avatarFile, `nexchat_pro/avatars/${cred.user.uid}`);
        } catch (e) {}
      }

      await setDoc(usernameRef, { uid: cred.user.uid }).catch(() => {});
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
    } catch (err) {
      showAlert("Registration error: " + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Create New Account"; }
    }
  });

  document.getElementById("forgot-password-btn")?.addEventListener("click", async () => {
    const email = document.getElementById("login-email")?.value.trim();
    if (!email) {
      return showAlert("Please type your email address in the Email box first, then tap Forgot Password.");
    }
    try {
      await sendPasswordResetEmail(auth, email);
      showAlert("Password reset link sent to " + email + "! Check your inbox.", false);
    } catch (err) {
      showAlert("Reset failed: " + err.message);
    }
  });

  document.getElementById("google-login-btn")?.addEventListener("click", async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    showAlert("Opening Google Sign-In...", false);
    try {
      const cred = await signInWithPopup(auth, provider);
      await ensureUserDocument(cred.user);
    } catch (err) {
      if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(auth, provider);
      } else {
        showAlert("Google Sign-In error: " + err.message);
      }
    }
  });

  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    if (currentUser) {
      await rtdbSet(rtdbRef(rtdb, `status/${currentUser.uid}`), {
        state: "offline",
        lastChanged: rtdbTimestamp()
      }).catch(() => {});
    }
    await signOut(auth);
  });
});

getRedirectResult(auth)
  .then(async res => {
    if (res && res.user) await ensureUserDocument(res.user);
  })
  .catch(err => showAlert("Google Redirect error: " + err.message));

async function ensureUserDocument(user) {
  const uRef = doc(db, "users", user.uid);
  const snap = await getDoc(uRef);
  if (!snap.exists()) {
    const cleanBase = (user.email?.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9]/g, "");
    const username = `${cleanBase}_${Math.floor(100 + Math.random() * 900)}`;
    await setDoc(doc(db, "usernames", username), { uid: user.uid }).catch(() => {});
    await setDoc(uRef, {
      uid: user.uid,
      displayName: user.displayName || "NexChat User",
      displayNameLower: (user.displayName || "NexChat User").toLowerCase(),
      username,
      email: user.email || "",
      phone: user.phoneNumber || "",
      photoURL: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || "U")}&background=1e3a8a&color=fff`,
      bio: "Available on NexChat Pro",
      isBlocked: false,
      createdAt: serverTimestamp()
    });
  }
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    currentUser = null;
    document.getElementById("auth-view")?.classList.remove("hidden");
    document.getElementById("main-app")?.classList.add("hidden");
    return;
  }

  currentUser = user;
  await ensureUserDocument(user).catch(() => {});

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

    const prevAvatar = document.getElementById("profile-preview-avatar");
    const editName = document.getElementById("profile-edit-name");
    const editBio = document.getElementById("profile-edit-bio");
    const editPhone = document.getElementById("profile-edit-phone");

    if (prevAvatar) prevAvatar.src = currentUserProfile.photoURL;
    if (editName) editName.value = currentUserProfile.displayName || "";
    if (editBio) editBio.value = currentUserProfile.bio || "";
    if (editPhone) editPhone.value = currentUserProfile.phone || "";
  });

  setupRealtimePresence(user.uid);
  listenToConversations();
  listenToStatuses();
  loadAdminUsers();
  listenForIncomingCalls();
  setupChatAndMediaHandlers();
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

function setupChatAndMediaHandlers() {
  const searchInput = document.getElementById("user-search-input");
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", async e => {
      const term = e.target.value.trim().toLowerCase().replace(/^@/, "");
      const resultsBox = document.getElementById("search-results-list");
      if (!resultsBox) return;
      resultsBox.innerHTML = "";
      if (!term || !currentUser) return;

      const snap = await getDocs(collection(db, "users"));
      snap.forEach(d => {
        const u = d.data();
        if (u.uid !== currentUser.uid && (u.username?.includes(term) || u.displayNameLower?.includes(term))) {
          const item = document.createElement("div");
          item.className = "p-2.5 flex items-center gap-2.5 hover:bg-blue-50 cursor-pointer rounded-xl bg-white border-b";
          item.innerHTML = `
            <img src="${u.photoURL}" class="w-9 h-9 rounded-full object-cover border shrink-0" />
            <div class="min-w-0">
              <h4 class="text-xs font-bold text-slate-800 truncate">${u.displayName}</h4>
              <p class="text-[11px] text-blue-700 truncate">@${u.username}</p>
            </div>
          `;
          item.onclick = () => {
            resultsBox.innerHTML = "";
            e.target.value = "";
            startOrOpenDirectChat(u);
          };
          resultsBox.appendChild(item);
        }
      });
    });
  }

  const msgForm = document.getElementById("message-form");
  if (msgForm && !msgForm.dataset.bound) {
    msgForm.dataset.bound = "true";
    msgForm.addEventListener("submit", async e => {
      e.preventDefault();
      const input = document.getElementById("message-input");
      const text = input?.value.trim();
      if (!text || !activeChat) return;
      input.value = "";
      await sendChatMessage({ text, type: "text" });
    });
  }

  const backBtn = document.getElementById("back-to-list-btn");
  if (backBtn && !backBtn.dataset.bound) {
    backBtn.dataset.bound = "true";
    backBtn.addEventListener("click", () => {
      document.getElementById("chat-panel")?.classList.add("hidden");
      document.getElementById("left-list-panel")?.classList.remove("hidden");
    });
  }

  const attachBtn = document.getElementById("attach-file-btn");
  if (attachBtn && !attachBtn.dataset.bound) {
    attachBtn.dataset.bound = "true";
    attachBtn.addEventListener("click", () => document.getElementById("chat-file-input")?.click());
  }

  const chatFileInput = document.getElementById("chat-file-input");
  if (chatFileInput && !chatFileInput.dataset.bound) {
    chatFileInput.dataset.bound = "true";
    chatFileInput.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (!file || !activeChat) return;
      try {
        const url = await uploadToCloudinary(file, `nexchat_pro/chat/${activeChat.id}`);
        const type = file.type.startsWith("video") ? "video" : file.type.startsWith("audio") ? "audio" : "image";
        await sendChatMessage({ text: file.name, type, mediaUrl: url });
      } catch (err) {
        alert("Upload failed: " + err.message);
      }
    });
  }

  const recordBtn = document.getElementById("record-voice-btn");
  if (recordBtn && !recordBtn.dataset.bound) {
    recordBtn.dataset.bound = "true";
    recordBtn.addEventListener("click", async e => {
      const btn = e.currentTarget;
      try {
        if (!mediaRecorder || mediaRecorder.state === "inactive") {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream);
          audioChunks = [];
          mediaRecorder.ondataavailable = ev => audioChunks.push(ev.data);
          mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: "audio/webm" });
            const url = await uploadToCloudinary(blob, "nexchat_pro/voice_notes", `voice_${Date.now()}.webm`);
            await sendChatMessage({ text: "Voice Note", type: "audio", mediaUrl: url });
            stream.getTracks().forEach(t => t.stop());
          };
          mediaRecorder.start();
          btn.classList.add("bg-red-600", "text-white");
        } else {
          mediaRecorder.stop();
          btn.classList.remove("bg-red-600", "text-white");
        }
      } catch (err) {
        alert("Microphone access denied: " + err.message);
      }
    });
  }

  const createGroupBtn = document.getElementById("create-group-btn");
  if (createGroupBtn && !createGroupBtn.dataset.bound) {
    createGroupBtn.dataset.bound = "true";
    createGroupBtn.addEventListener("click", async () => {
      const groupName = prompt("Enter a name for the new Group:");
      if (!groupName || !currentUser) return;
      const gRef = await addDoc(collection(db, "conversations"), {
        type: "group",
        groupName: groupName.trim(),
        groupPhoto: `https://ui-avatars.com/api/?name=${encodeURIComponent(groupName)}&background=172554&color=fff`,
        admins: [currentUser.uid],
        participants: [currentUser.uid],
        lastMessage: "Group created",
        updatedAt: serverTimestamp()
      });
      await updateDoc(gRef, { id: gRef.id });
      openConversation({
        id: gRef.id,
        type: "group",
        title: groupName.trim(),
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(groupName)}&background=172554&color=fff`
      });
    });
  }

  const addTextStatusBtn = document.getElementById("add-text-status-btn");
  if (addTextStatusBtn && !addTextStatusBtn.dataset.bound) {
    addTextStatusBtn.dataset.bound = "true";
    addTextStatusBtn.addEventListener("click", async () => {
      const text = prompt("What's on your mind? (24h Status):");
      if (!text || !currentUser) return;
      await addDoc(collection(db, "statuses"), {
        uid: currentUser.uid,
        displayName: currentUserProfile?.displayName || "User",
        text: text.trim(),
        mediaUrl: "",
        viewers: [],
        createdAt: serverTimestamp()
      });
    });
  }

  const addStatusBtn = document.getElementById("add-status-btn");
  if (addStatusBtn && !addStatusBtn.dataset.bound) {
    addStatusBtn.dataset.bound = "true";
    addStatusBtn.addEventListener("click", () => document.getElementById("status-file-input")?.click());
  }

  const statusFileInput = document.getElementById("status-file-input");
  if (statusFileInput && !statusFileInput.dataset.bound) {
    statusFileInput.dataset.bound = "true";
    statusFileInput.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (!file || !currentUser) return;
      const caption = prompt("Status caption (optional):") || "";
      try {
        const mediaUrl = await uploadToCloudinary(file, "nexchat_pro/statuses");
        await addDoc(collection(db, "statuses"), {
          uid: currentUser.uid,
          displayName: currentUserProfile?.displayName || "User",
          text: caption,
          mediaUrl,
          viewers: [],
          createdAt: serverTimestamp()
        });
      } catch (err) {
        alert("Status upload failed: " + err.message);
      }
    });
  }

  const profileAvatarInput = document.getElementById("profile-avatar-input");
  if (profileAvatarInput && !profileAvatarInput.dataset.bound) {
    profileAvatarInput.dataset.bound = "true";
    profileAvatarInput.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (!file || !currentUser) return;
      try {
        const photoURL = await uploadToCloudinary(file, `nexchat_pro/avatars/${currentUser.uid}`);
        await updateDoc(doc(db, "users", currentUser.uid), { photoURL });
      } catch (err) {
        alert("Avatar upload failed: " + err.message);
      }
    });
  }

  const saveProfileBtn = document.getElementById("save-profile-btn");
  if (saveProfileBtn && !saveProfileBtn.dataset.bound) {
    saveProfileBtn.dataset.bound = "true";
    saveProfileBtn.addEventListener("click", async () => {
      if (!currentUser) return;
      const displayName = document.getElementById("profile-edit-name")?.value.trim();
      const bio = document.getElementById("profile-edit-bio")?.value.trim();
      const phone = document.getElementById("profile-edit-phone")?.value.trim();
      await updateDoc(doc(db, "users", currentUser.uid), {
        displayName,
        displayNameLower: displayName?.toLowerCase(),
        bio,
        phone
      });
      const msg = document.getElementById("profile-save-msg");
      if (msg) {
        msg.textContent = "Profile updated successfully!";
        msg.classList.remove("hidden");
        setTimeout(() => msg.classList.add("hidden"), 2500);
      }
    });
  }

  const settingsResetPwBtn = document.getElementById("settings-reset-pw-btn");
  if (settingsResetPwBtn && !settingsResetPwBtn.dataset.bound) {
    settingsResetPwBtn.dataset.bound = "true";
    settingsResetPwBtn.addEventListener("click", async () => {
      if (!currentUser?.email) return alert("No email linked to this account.");
      await sendPasswordResetEmail(auth, currentUser.email);
      alert("Password reset email sent to " + currentUser.email);
    });
  }

  const voiceCallBtn = document.getElementById("voice-call-btn");
  if (voiceCallBtn && !voiceCallBtn.dataset.bound) {
    voiceCallBtn.dataset.bound = "true";
    voiceCallBtn.addEventListener("click", () => startCall(false));
  }
  const videoCallBtn = document.getElementById("video-call-btn");
  if (videoCallBtn && !videoCallBtn.dataset.bound) {
    videoCallBtn.dataset.bound = "true";
    videoCallBtn.addEventListener("click", () => startCall(true));
  }
  const acceptCallBtn = document.getElementById("accept-call-btn");
  if (acceptCallBtn && !acceptCallBtn.dataset.bound) {
    acceptCallBtn.dataset.bound = "true";
    acceptCallBtn.addEventListener("click", acceptIncomingCall);
  }
  const rejectCallBtn = document.getElementById("reject-call-btn");
  if (rejectCallBtn && !rejectCallBtn.dataset.bound) {
    rejectCallBtn.dataset.bound = "true";
    rejectCallBtn.addEventListener("click", endActiveCall);
  }
  const endCallBtn = document.getElementById("end-call-btn");
  if (endCallBtn && !endCallBtn.dataset.bound) {
    endCallBtn.dataset.bound = "true";
    endCallBtn.addEventListener("click", endActiveCall);
  }
}

async function startOrOpenDirectChat(otherUser) {
  const sortedIds = [currentUser.uid, otherUser.uid].sort();
  const convId = `${sortedIds[0]}_${sortedIds[1]}`;
  const convRef = doc(db, "conversations", convId);
  const convSnap = await getDoc(convRef);

  if (!convSnap.exists()) {
    await setDoc(convRef, {
      id: convId,
      type: "direct",
      participants: sortedIds,
      participantInfo: {
        [currentUser.uid]: {
          displayName: currentUserProfile?.displayName || "Me",
          photoURL: currentUserProfile?.photoURL || ""
        },
        [otherUser.uid]: {
          displayName: otherUser.displayName,
          photoURL: otherUser.photoURL
        }
      },
      lastMessage: "Conversation started",
      updatedAt: serverTimestamp()
    });
  }

  openConversation({
    id: convId,
    type: "direct",
    otherUid: otherUser.uid,
    title: otherUser.displayName,
    avatar: otherUser.photoURL
  });
}

function listenToConversations() {
  const q = query(collection(db, "conversations"), where("participants", "array-contains", currentUser.uid));
  onSnapshot(q, snap => {
    const chatListEl = document.getElementById("conversation-list");
    const groupListEl = document.getElementById("group-list");
    if (chatListEl) chatListEl.innerHTML = "";
    if (groupListEl) groupListEl.innerHTML = "";

    snap.forEach(docSnap => {
      const c = docSnap.data();
      const convId = c.id || docSnap.id;
      let title = c.groupName || "Group Chat";
      let avatar = c.groupPhoto || "https://ui-avatars.com/api/?name=Group&background=0f172a&color=fff";
      let otherUid = null;

      if (c.type === "direct") {
        otherUid = (c.participants || []).find(id => id !== currentUser.uid);
        const info = c.participantInfo?.[otherUid] || {};
        title = info.displayName || "User";
        avatar = info.photoURL || "https://ui-avatars.com/api/?name=U";
      }

      const row = document.createElement("div");
      row.className = "p-3 flex items-center gap-3 hover:bg-blue-50/70 cursor-pointer transition bg-white";
      row.innerHTML = `
        <img src="${avatar}" class="w-11 h-11 rounded-full object-cover shrink-0 border border-slate-200" />
        <div class="min-w-0 flex-1">
          <h4 class="text-xs font-bold text-slate-800 truncate">${title}</h4>
          <p class="text-[11px] text-slate-500 truncate">${c.lastMessage || "Tap to chat"}</p>
        </div>
      `;
      row.onclick = () => openConversation({ id: convId, type: c.type, otherUid, title, avatar });

      if (c.type === "group") {
        groupListEl?.appendChild(row);
      } else {
        chatListEl?.appendChild(row);
      }
    });
  });
}

function openConversation(chatObj) {
  activeChat = chatObj;
  document.getElementById("empty-chat-placeholder")?.classList.add("hidden");
  document.getElementById("active-chat-container")?.classList.remove("hidden");
  document.getElementById("chat-panel")?.classList.remove("hidden");
  document.getElementById("chat-panel")?.classList.add("flex");

  if (window.innerWidth < 768) {
    document.getElementById("left-list-panel")?.classList.add("hidden");
  }

  const titleEl = document.getElementById("chat-header-title");
  const avatarEl = document.getElementById("chat-header-avatar");
  if (titleEl) titleEl.textContent = chatObj.title;
  if (avatarEl) avatarEl.src = chatObj.avatar;

  if (messagesUnsubscribe) messagesUnsubscribe();
  const msgQuery = query(collection(db, "conversations", chatObj.id, "messages"), orderBy("createdAt", "asc"));

  messagesUnsubscribe = onSnapshot(msgQuery, snap => {
    const box = document.getElementById("messages-container");
    if (!box) return;
    box.innerHTML = "";
    snap.forEach(mSnap => {
      const m = mSnap.data();
      const msgId = mSnap.id;
      if ((m.deletedFor || []).includes(currentUser.uid)) return;

      if (m.senderId !== currentUser.uid && !(m.seenBy || []).includes(currentUser.uid)) {
        updateDoc(doc(db, "conversations", chatObj.id, "messages", msgId), {
          seenBy: arrayUnion(currentUser.uid)
        }).catch(() => {});
      }

      const isMe = m.senderId === currentUser.uid;
      const isSeen = (m.seenBy || []).length > 1;
      const bubble = document.createElement("div");
      bubble.className = `flex flex-col my-1 ${isMe ? "items-end" : "items-start"}`;

      let contentHtml = `<p class="text-xs sm:text-sm break-words">${m.text || ""}</p>`;
      if (m.isDeletedEveryone) {
        contentHtml = `<p class="text-xs italic opacity-70">🚫 This message was deleted</p>`;
      } else if (m.type === "image") {
        contentHtml = `<img src="${m.mediaUrl}" class="max-w-[220px] rounded-lg mb-1 border" /><p class="text-xs">${m.text || ""}</p>`;
      } else if (m.type === "audio") {
        contentHtml = `<audio controls src="${m.mediaUrl}" class="max-w-[210px] h-9"></audio>`;
      } else if (m.type === "video") {
        contentHtml = `<video controls src="${m.mediaUrl}" class="max-w-[220px] rounded-lg"></video>`;
      }

      bubble.innerHTML = `
        <div class="max-w-[80%] px-3.5 py-2 rounded-2xl shadow-sm ${
          isMe ? "bg-[#172554] text-white rounded-br-none" : "bg-white text-slate-800 border rounded-bl-none"
        }">
          ${m.replyTo ? `<div class="text-[10px] opacity-80 border-l-2 pl-2 mb-1">${m.replyTo.text}</div>` : ""}
          ${contentHtml}
          <div class="flex items-center justify-end gap-1 mt-1 text-[10px] opacity-75">
            ${isMe ? `<span>${isSeen ? "✓✓" : "✓"}</span>` : ""}
          </div>
        </div>
      `;
      box.appendChild(bubble);
    });
    box.scrollTop = box.scrollHeight;
  });
}

async function sendChatMessage({ text = "", type = "text", mediaUrl = "" }) {
  if (!activeChat || !currentUser) return;
  const msgData = {
    senderId: currentUser.uid,
    senderName: currentUserProfile?.displayName || "User",
    text,
    type,
    mediaUrl,
    replyTo: replyToMessage,
    seenBy: [currentUser.uid],
    deletedFor: [],
    isDeletedEveryone: false,
    createdAt: serverTimestamp()
  };

  replyToMessage = null;
  document.getElementById("reply-preview-bar")?.classList.add("hidden");

  await addDoc(collection(db, "conversations", activeChat.id, "messages"), msgData);
  await updateDoc(doc(db, "conversations", activeChat.id), {
    lastMessage: type === "text" ? text : `📎 ${type.toUpperCase()}`,
    updatedAt: serverTimestamp()
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
      card.className = "p-3 bg-white border rounded-xl space-y-2 shadow-sm cursor-pointer";
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-800">${s.displayName}</span>
          <span class="text-[11px] text-slate-500">👁 ${(s.viewers || []).length}</span>
        </div>
        ${s.mediaUrl ? `<img src="${s.mediaUrl}" class="w-full h-36 object-cover rounded-lg" />` : ""}
        <p class="text-xs text-slate-700">${s.text || ""}</p>
      `;
      feedEl.onclick = () => {
        if (!(s.viewers || []).includes(currentUser.uid)) {
          updateDoc(doc(db, "statuses", docSnap.id), { viewers: arrayUnion(currentUser.uid) }).catch(() => {});
        }
      };
      feedEl.appendChild(card);
    });
  });
}

function loadAdminUsers() {
  onSnapshot(collection(db, "users"), snap => {
    const list = document.getElementById("admin-users-list");
    const countEl = document.getElementById("admin-user-count");
    if (!list || !countEl) return;
    list.innerHTML = "";
    countEl.textContent = `${snap.size} Users`;
    snap.forEach(d => {
      const u = d.data();
      const row = document.createElement("div");
      row.className = "p-2.5 bg-white border rounded-xl flex items-center justify-between";
      row.innerHTML = `
        <div class="min-w-0">
          <p class="text-xs font-bold truncate">${u.displayName} (@${u.username})</p>
          <p class="text-[10px] text-slate-400 truncate">${u.email}</p>
        </div>
        <button type="button" class="px-2.5 py-1 rounded-lg text-[10px] font-bold ${
          u.isBlocked ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
        }">
          ${u.isBlocked ? "Unblock" : "Block"}
        </button>
      `;
      row.querySelector("button").onclick = () => {
        updateDoc(doc(db, "users", u.uid), { isBlocked: !u.isBlocked });
      };
      list.appendChild(row);
    });
  });
}

async function startCall(isVideo = true) {
  if (!activeChat || activeChat.type !== "direct") {
    return alert("Please open a 1-to-1 user chat first to start a call.");
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
    const localVid = document.getElementById("local-video");
    if (localVid) localVid.srcObject = localStream;
    document.getElementById("call-overlay")?.classList.remove("hidden");
    document.getElementById("incoming-call-controls")?.classList.add("hidden");
    document.getElementById("active-call-controls")?.classList.remove("hidden");
    const partnerName = document.getElementById("call-partner-name");
    if (partnerName) partnerName.textContent = activeChat.title;

    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    peerConnection.ontrack = e => {
      const remoteVid = document.getElementById("remote-video");
      if (remoteVid) remoteVid.srcObject = e.streams[0];
    };

    const callDocRef = doc(collection(db, "calls"));
    currentCallId = callDocRef.id;
    peerConnection.onicecandidate = e => {
      if (e.candidate) addDoc(collection(callDocRef, "callerCandidates"), e.candidate.toJSON());
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await setDoc(callDocRef, {
      callerId: currentUser.uid,
      callerName: currentUserProfile?.displayName || "User",
      calleeId: activeChat.otherUid,
      isVideo,
      status: "ringing",
      offer: { type: offer.type, sdp: offer.sdp },
      createdAt: serverTimestamp()
    });

    onSnapshot(callDocRef, snap => {
      const data = snap.data();
      if (!peerConnection?.currentRemoteDescription && data?.answer) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
      if (data?.status === "ended") cleanupCallUI();
    });

    onSnapshot(collection(callDocRef, "calleeCandidates"), snap => {
      snap.docChanges().forEach(c => {
        if (c.type === "added") peerConnection?.addIceCandidate(new RTCIceCandidate(c.doc.data()));
      });
    });
  } catch (err) {
    alert("Camera/Microphone permission error: " + err.message);
  }
}

function listenForIncomingCalls() {
  const q = query(collection(db, "calls"), where("calleeId", "==", currentUser.uid), where("status", "==", "ringing"));
  onSnapshot(q, snap => {
    snap.docChanges().forEach(c => {
      if (c.type === "added") {
        const callData = c.doc.data();
        currentCallId = c.doc.id;
        document.getElementById("call-overlay")?.classList.remove("hidden");
        document.getElementById("incoming-call-controls")?.classList.remove("hidden");
        document.getElementById("active-call-controls")?.classList.add("hidden");
        const partnerName = document.getElementById("call-partner-name");
        if (partnerName) partnerName.textContent = callData.callerName;
      }
    });
  });
}

async function acceptIncomingCall() {
  if (!currentCallId) return;
  const callDocRef = doc(db, "calls", currentCallId);
  const callSnap = await getDoc(callDocRef);
  const callData = callSnap.data();

  localStream = await navigator.mediaDevices.getUserMedia({ video: callData.isVideo, audio: true });
  const localVid = document.getElementById("local-video");
  if (localVid) localVid.srcObject = localStream;
  document.getElementById("incoming-call-controls")?.classList.add("hidden");
  document.getElementById("active-call-controls")?.classList.remove("hidden");

  peerConnection = new RTCPeerConnection(rtcConfig);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
  peerConnection.ontrack = e => {
    const remoteVid = document.getElementById("remote-video");
    if (remoteVid) remoteVid.srcObject = e.streams[0];
  };
  peerConnection.onicecandidate = e => {
    if (e.candidate) addDoc(collection(callDocRef, "calleeCandidates"), e.candidate.toJSON());
  };

  await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await updateDoc(callDocRef, { answer: { type: answer.type, sdp: answer.sdp }, status: "connected" });

  onSnapshot(collection(callDocRef, "callerCandidates"), snap => {
    snap.docChanges().forEach(c => {
      if (c.type === "added") peerConnection?.addIceCandidate(new RTCIceCandidate(c.doc.data()));
    });
  });
}

async function endActiveCall() {
  if (currentCallId) {
    await updateDoc(doc(db, "calls", currentCallId), { status: "ended" }).catch(() => {});
  }
  cleanupCallUI();
}

function cleanupCallUI() {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (peerConnection) peerConnection.close();
  localStream = null;
  peerConnection = null;
  currentCallId = null;
  document.getElementById("call-overlay")?.classList.add("hidden");
}
