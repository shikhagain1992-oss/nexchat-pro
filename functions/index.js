const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// 1. High-Priority Push Notification for New 1-to-1 Messages (Screen Off / Background)
exports.sendChatPushNotification = functions.firestore
  .document("chats/{chatId}/messages/{messageId}")
  .onCreate(async (snap, context) => {
    const msg = snap.data() || {};
    const senderId = String(msg.senderId || "").trim();
    const receiverId = String(msg.receiverId || "").trim();
    const chatId = context.params.chatId;

    if (!senderId || !receiverId || senderId === receiverId) return null;

    const recipientSnap = await db.collection("users").doc(receiverId).get();
    if (!recipientSnap.exists) return null;

    const recipientData = recipientSnap.data() || {};
    const tokens = Array.isArray(recipientData.fcmTokens)
      ? recipientData.fcmTokens
      : recipientData.fcmToken
      ? [recipientData.fcmToken]
      : [];

    if (tokens.length === 0) return null;

    const previewBody =
      msg.text ||
      (msg.messageType === "audio"
        ? "🎤 আপনাকে একটি ভয়েস মেসেজ পাঠিয়েছেন"
        : msg.messageType === "video"
        ? "🎥 আপনাকে একটি ভিডিও পাঠিয়েছেন"
        : "📷 আপনাকে একটি ছবি পাঠিয়েছেন");

    const payload = {
      tokens,
      notification: {
        title: msg.senderName || "NexChat Pro",
        body: previewBody
      },
      data: {
        type: "chat_message",
        chatId: String(chatId),
        senderId: String(senderId),
        messageId: String(context.params.messageId)
      },
      android: {
        priority: "high",
        notification: {
          channelId: "nexchat_messages_v2",
          sound: "default",
          priority: "high",
          visibility: "public",
          tag: String(chatId)
        }
      }
    };

    const res = await admin.messaging().sendEachForMulticast(payload);
    // Clean up invalid/expired FCM tokens
    const invalidTokens = [];
    res.responses.forEach((r, idx) => {
      if (!r.success && r.error) {
        const code = r.error.code || "";
        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-registration-token")
        ) {
          invalidTokens.push(tokens[idx]);
        }
      }
    });

    if (invalidTokens.length > 0) {
      await db
        .collection("users")
        .doc(receiverId)
        .update({
          fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens)
        })
        .catch(() => {});
    }
    return null;
  });

// 2. High-Priority Push Notification for Incoming Voice & Video Calls (Screen Off)
exports.sendIncomingCallNotification = functions.firestore
  .document("calls/{callId}")
  .onCreate(async (snap, context) => {
    const call = snap.data() || {};
    const callerId = String(call.callerId || "").trim();
    const calleeId = String(call.calleeId || "").trim();
    const callType = call.callType === "video" ? "video" : "voice";

    if (!callerId || !calleeId || call.status !== "offering") return null;

    const calleeSnap = await db.collection("users").doc(calleeId).get();
    if (!calleeSnap.exists) return null;

    const calleeData = calleeSnap.data() || {};
    const tokens = Array.isArray(calleeData.fcmTokens)
      ? calleeData.fcmTokens
      : calleeData.fcmToken
      ? [calleeData.fcmToken]
      : [];

    if (tokens.length === 0) return null;

    const channelId =
      callType === "video" ? "nexchat_video_calls_v2" : "nexchat_voice_calls_v2";

    await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: `Incoming ${callType === "video" ? "Video" : "Voice"} Call`,
        body: `${call.callerName || "NexChat User"} আপনাকে কল করছেন...`
      },
      data: {
        type: "incoming_call",
        callId: String(context.params.callId),
        callerId,
        callerName: String(call.callerName || "User"),
        callType
      },
      android: {
        priority: "high",
        ttl: 45000,
        notification: {
          channelId,
          sound: "default",
          priority: "max",
          visibility: "public",
          tag: `call_${context.params.callId}`
        }
      }
    });
    return null;
  });
        
