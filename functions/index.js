
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();

exports.sendChatPushNotification = functions.firestore
  .document("conversations/{chatId}/messages/{messageId}")
  .onCreate(async (snap, context) => {
    const msg = snap.data();
    const chatId = context.params.chatId;
    if (!msg || !msg.senderId) return null;

    const chatSnap = await db.doc(`conversations/${chatId}`).get();
    if (!chatSnap.exists) return null;
    const chat = chatSnap.data();

    const senderName = msg.senderName || "NexChat User";
    const notificationTitle =
      chat.type === "group" && chat.groupName
        ? `${chat.groupName} • ${senderName}`
        : senderName;

    let snippet = msg.text || "Sent a message";
    if (msg.type === "image") snippet = "📷 Photo";
    else if (msg.type === "video") snippet = "🎬 Video";
    else if (msg.type === "video_note") snippet = "🎥 Instant Video Note";
    else if (msg.type === "audio") snippet = "🎤 Voice Message";
    else if (msg.type === "file") snippet = `📄 ${msg.fileName || "Document"}`;
    else if (snippet.length > 90) snippet = snippet.substring(0, 87) + "...";

    const recipients = (chat.participants || []).filter(uid => uid !== msg.senderId);

    const sendPromises = recipients.map(async recipientUid => {
      const userSnap = await db.doc(`users/${recipientUid}`).get();
      if (!userSnap.exists) return null;
      const userData = userSnap.data();

      const tokens = new Set();
      if (userData.fcmToken) tokens.add(userData.fcmToken);
      (userData.fcmTokens || []).forEach(t => tokens.add(t));
      if (tokens.size === 0) return null;

      const prefs = userData.notificationPrefs || { msgSound: true, msgVibrate: true };
      const channelId = prefs.msgSound ? "nexchat_messages" : "nexchat_messages_silent";

      const payload = {
        notification: {
          title: notificationTitle,
          body: snippet
        },
        data: {
          type: "chat_message",
          chatId: String(chatId),
          messageId: String(context.params.messageId),
          senderId: String(msg.senderId),
          senderName: String(senderName),
          snippet: String(snippet)
        },
        android: {
          priority: "high",
          ttl: 86400 * 1000,
          notification: {
            channelId: channelId,
            sound: prefs.msgSound ? "msg_tone" : undefined,
            defaultVibrateTimings: false,
            vibrateTimingsMillis: prefs.msgVibrate ? [0, 250, 150, 250] : [0],
            clickAction: "FCM_PLUGIN_ACTIVITY",
            tag: `chat_${chatId}`
          }
        }
      };

      for (const token of tokens) {
        try {
          await admin.messaging().send({ ...payload, token });
        } catch (err) {}
      }
      return null;
    });

    return Promise.all(sendPromises);
  });

exports.sendIncomingCallNotification = functions.firestore
  .document("calls/{callId}")
  .onCreate(async (snap, context) => {
    const callData = snap.data();
    const callId = context.params.callId;
    if (!callData || callData.status !== "ringing" || !callData.calleeId) return null;

    const calleeSnap = await db.doc(`users/${callData.calleeId}`).get();
    if (!calleeSnap.exists) return null;
    const calleeData = calleeSnap.data();

    const tokens = new Set();
    if (calleeData.fcmToken) tokens.add(calleeData.fcmToken);
    (calleeData.fcmTokens || []).forEach(t => tokens.add(t));
    if (tokens.size === 0) return null;

    const isVideo = callData.callType === "video";
    const callerName = callData.callerName || "NexChat Caller";

    const payload = {
      notification: {
        title: `Incoming ${isVideo ? "Video" : "Voice"} Call`,
        body: `${callerName} is calling you on NexChat Pro. Tap to answer.`
      },
      data: {
        type: "incoming_call",
        callId: String(callId),
        callerId: String(callData.callerId || ""),
        callerName: String(callerName),
        callType: String(callData.callType || "voice")
      },
      android: {
        priority: "high",
        ttl: 45 * 1000,
        notification: {
          channelId: "nexchat_calls",
          sound: "call_ringtone",
          defaultVibrateTimings: false,
          vibrateTimingsMillis: [0, 800, 400, 800, 400, 800, 400, 800],
          clickAction: "FCM_PLUGIN_ACTIVITY",
          tag: `call_${callId}`,
          visibility: "public"
        }
      }
    };

    for (const token of tokens) {
      try {
        await admin.messaging().send({ ...payload, token });
      } catch (err) {}
    }
    return null;
  });
    
