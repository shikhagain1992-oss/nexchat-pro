
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAb6XQuA5QqqoglYSvtQ-cjpOuuV3s_vwo",
  authDomain: "nexchat-pro-8e480.firebaseapp.com",
  databaseURL: "https://nexchat-pro-8e480-default-rtdb.firebaseio.com",
  projectId: "nexchat-pro-8e480",
  storageBucket: "nexchat-pro-8e480.firebasestorage.app",
  messagingSenderId: "418090114272",
  appId: "1:418090114272:web:1391225432d0f9eb44c485"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || payload.data?.senderName || "NexChat Pro";
  const options = {
    body: payload.notification?.body || payload.data?.snippet || "You have a new message or call",
    icon: "https://ui-avatars.com/api/?name=NC&background=1e3a8a&color=fff",
    vibrate: [200, 100, 200],
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});
    
