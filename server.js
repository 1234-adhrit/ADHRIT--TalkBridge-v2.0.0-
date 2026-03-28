const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const https = require('https');
const path = require('path');

const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const HTTPS_OPTIONS = loadHttpsOptions();
const server = HTTPS_OPTIONS ? https.createServer(HTTPS_OPTIONS, app) : http.createServer(app);
const io = new Server(server);

const START_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT = Number(process.env.PORT_MAX) || START_PORT + 20;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CHAT_UPLOAD_DIR = path.join(DATA_DIR, 'chat-files');
const PROFILE_PHOTO_DIR = path.join(DATA_DIR, 'profile-photos');
const DB_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'auth-secret.txt');

let db = { users: {}, chatThreads: {} };
let tokenSecret = '';
const socketsByUser = new Map();
const activeCalls = new Map();

function ensureEnvironment() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CHAT_UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_PHOTO_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, chatThreads: {} }, null, 2));
  }
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'));
  }
}

function loadHttpsOptions() {
  const keyFile = process.env.SSL_KEY_FILE;
  const certFile = process.env.SSL_CERT_FILE;
  if (!keyFile || !certFile) {
    return null;
  }

  const options = {
    key: fs.readFileSync(keyFile),
    cert: fs.readFileSync(certFile),
  };

  if (process.env.SSL_CA_FILE) {
    options.ca = fs.readFileSync(process.env.SSL_CA_FILE);
  }

  return options;
}

function loadDb() {
  ensureEnvironment();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    db = parsed && typeof parsed === 'object' && parsed.users ? parsed : { users: {}, chatThreads: {} };
    if (!db.chatThreads || typeof db.chatThreads !== 'object') {
      db.chatThreads = {};
    }
    normalizeDatabaseUsers();
    saveDb();
  } catch {
    db = { users: {}, chatThreads: {} };
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }
}

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function loadSecret() {
  ensureEnvironment();
  tokenSecret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
}

function uniqueValues(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim())));
}

function ensureUserShape(user) {
  if (!user || typeof user !== 'object') {
    return user;
  }

  user.contacts = uniqueValues(user.contacts);
  user.incomingRequests = uniqueValues(user.incomingRequests);
  user.outgoingRequests = uniqueValues(user.outgoingRequests);
  user.chatContacts = uniqueValues([...user.chatContacts, ...user.contacts]);
  user.incomingChatRequests = uniqueValues(user.incomingChatRequests);
  user.outgoingChatRequests = uniqueValues(user.outgoingChatRequests);
  user.profilePhotoUrl = typeof user.profilePhotoUrl === 'string' ? user.profilePhotoUrl.trim() : '';
  user.bio = normalizeProfileText(user.bio, 240, true);
  user.statusText = normalizeProfileText(user.statusText, 80, false);
  user.lastSeenAt = parseTimestamp(user.lastSeenAt || user.createdAt || Date.now());
  return user;
}

function normalizeDatabaseUsers() {
  if (!db || typeof db !== 'object' || !db.users) {
    db = { users: {}, chatThreads: {} };
    return;
  }

  for (const user of Object.values(db.users)) {
    ensureUserShape(user);
  }

  if (!db.chatThreads || typeof db.chatThreads !== 'object') {
    db.chatThreads = {};
    return;
  }

  for (const thread of Object.values(db.chatThreads)) {
    ensureChatThreadShape(thread);
  }
}

function addUnique(list, value) {
  if (!Array.isArray(list) || typeof value !== 'string' || !value) {
    return;
  }

  if (!list.includes(value)) {
    list.push(value);
  }
}

function removeValue(list, value) {
  if (!Array.isArray(list)) {
    return;
  }

  const index = list.indexOf(value);
  if (index >= 0) {
    list.splice(index, 1);
  }
}

function parseTimestamp(value) {
  if (Number.isFinite(value)) {
    return value;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeProfileText(value, maxLength = 0, allowNewlines = false) {
  let text = String(value || '');
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (!allowNewlines) {
    text = text.replace(/\s+/g, ' ');
  }
  text = text.trim();
  if (maxLength > 0 && text.length > maxLength) {
    text = text.slice(0, maxLength).trim();
  }
  return text;
}

function profilePhotoFilePathFromUrl(photoUrl) {
  const cleanUrl = String(photoUrl || '').trim();
  if (!cleanUrl.startsWith('/profile-photos/')) {
    return null;
  }

  return path.join(PROFILE_PHOTO_DIR, path.basename(cleanUrl));
}

function removeProfilePhotoUrl(photoUrl) {
  const filePath = profilePhotoFilePathFromUrl(photoUrl);
  if (!filePath) return;

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors.
  }
}

function mimeTypeToProfileExtension(mimeType, originalName = '') {
  const cleanMime = String(mimeType || '').toLowerCase();
  if (cleanMime === 'image/jpeg') return '.jpg';
  if (cleanMime === 'image/png') return '.png';
  if (cleanMime === 'image/webp') return '.webp';
  if (cleanMime === 'image/gif') return '.gif';
  if (cleanMime === 'image/avif') return '.avif';

  const ext = path.extname(originalName || '').toLowerCase();
  if (ext && ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }

  return '.jpg';
}

function removeRelationship(userAKey, userBKey) {
  const userA = getUser(userAKey);
  const userB = getUser(userBKey);

  if (!userA || !userB) {
    return false;
  }

  ensureUserShape(userA);
  ensureUserShape(userB);

  removeValue(userA.contacts, userBKey);
  removeValue(userB.contacts, userAKey);

  removeValue(userA.incomingRequests, userBKey);
  removeValue(userA.outgoingRequests, userBKey);
  removeValue(userB.incomingRequests, userAKey);
  removeValue(userB.outgoingRequests, userAKey);

  removeValue(userA.chatContacts, userBKey);
  removeValue(userB.chatContacts, userAKey);
  removeValue(userA.incomingChatRequests, userBKey);
  removeValue(userA.outgoingChatRequests, userBKey);
  removeValue(userB.incomingChatRequests, userAKey);
  removeValue(userB.outgoingChatRequests, userAKey);

  return true;
}

function sendContactRequest(senderKey, targetKey) {
  const sender = getUser(senderKey);
  const target = getUser(targetKey);

  if (!sender || !target) {
    return { ok: false, error: 'No account exists with that username.' };
  }

  if (senderKey === targetKey) {
    return { ok: false, error: 'You cannot add yourself.' };
  }

  ensureUserShape(sender);
  ensureUserShape(target);

  if (sender.contacts.includes(targetKey)) {
    return {
      ok: true,
      status: 'contact',
      user: getMeProfile(senderKey),
      target: toPublicProfile(targetKey, senderKey, 'contact'),
    };
  }

  if (sender.incomingRequests.includes(targetKey)) {
    return acceptContactRequest(senderKey, targetKey, { initiatedBySend: true });
  }

  if (sender.outgoingRequests.includes(targetKey)) {
    return {
      ok: true,
      status: 'pending',
      user: getMeProfile(senderKey),
      target: toPublicProfile(targetKey, senderKey, 'outgoing'),
    };
  }

  addUnique(sender.outgoingRequests, targetKey);
  addUnique(target.incomingRequests, senderKey);
  saveDb();

  if (isOnline(targetKey)) {
    sendToUser(targetKey, 'contact:request', {
      fromKey: senderKey,
      fromName: sender.username,
      toKey: targetKey,
      toName: target.username,
      requestedAt: Date.now(),
    });
  }

  return {
    ok: true,
    status: 'requested',
    user: getMeProfile(senderKey),
    target: toPublicProfile(targetKey, senderKey, 'outgoing'),
  };
}

function acceptContactRequest(recipientKey, requesterKey, options = {}) {
  const recipient = getUser(recipientKey);
  const requester = getUser(requesterKey);

  if (!recipient || !requester) {
    return { ok: false, error: 'No account exists with that username.' };
  }

  if (recipientKey === requesterKey) {
    return { ok: false, error: 'You cannot add yourself.' };
  }

  ensureUserShape(recipient);
  ensureUserShape(requester);

  if (recipient.contacts.includes(requesterKey)) {
    return {
      ok: true,
      status: 'contact',
      user: getMeProfile(recipientKey),
      target: toPublicProfile(requesterKey, recipientKey, 'contact'),
    };
  }

  if (!recipient.incomingRequests.includes(requesterKey) && !requester.outgoingRequests.includes(recipientKey)) {
    return { ok: false, error: 'That request is no longer available.' };
  }

  removeRelationship(recipientKey, requesterKey);
  addUnique(recipient.contacts, requesterKey);
  addUnique(requester.contacts, recipientKey);
  addUnique(recipient.chatContacts, requesterKey);
  addUnique(requester.chatContacts, recipientKey);
  const thread = getOrCreateChatThread(recipientKey, requesterKey);
  thread.updatedAt = Date.now();
  saveDb();

  if (isOnline(requesterKey)) {
    sendToUser(requesterKey, 'contact:accepted', {
      byKey: recipientKey,
      byName: recipient.username,
      requesterKey,
      requesterName: requester.username,
      acceptedAt: Date.now(),
      autoAccepted: Boolean(options.initiatedBySend),
    });
  }

  return {
    ok: true,
    status: 'accepted',
    user: getMeProfile(recipientKey),
    target: toPublicProfile(requesterKey, recipientKey, 'contact'),
    thread: serializeChatThread(thread, recipientKey),
  };
}

function rejectContactRequest(recipientKey, requesterKey) {
  const recipient = getUser(recipientKey);
  const requester = getUser(requesterKey);

  if (!recipient || !requester) {
    return { ok: false, error: 'No account exists with that username.' };
  }

  ensureUserShape(recipient);
  ensureUserShape(requester);

  if (!recipient.incomingRequests.includes(requesterKey) && !requester.outgoingRequests.includes(recipientKey)) {
    return { ok: false, error: 'That request is no longer available.' };
  }

  removeRelationship(recipientKey, requesterKey);
  saveDb();

  if (isOnline(requesterKey)) {
    sendToUser(requesterKey, 'contact:rejected', {
      byKey: recipientKey,
      byName: recipient.username,
      requesterKey,
      requesterName: requester.username,
      rejectedAt: Date.now(),
    });
  }

  return {
    ok: true,
    status: 'rejected',
    user: getMeProfile(recipientKey),
    target: toPublicProfile(requesterKey, recipientKey, 'none'),
  };
}

function removeContactOrRequest(userKey, targetKey) {
  const user = getUser(userKey);
  const target = getUser(targetKey);

  if (!user || !target) {
    return { ok: false, error: 'No account exists with that username.' };
  }

  const relationship = getRelationship(userKey, targetKey);
  const chatRelationship = getChatRelationship(userKey, targetKey);
  ensureUserShape(user);
  ensureUserShape(target);

  if (relationship === 'none') {
    return {
      ok: true,
      status: 'none',
      user: getMeProfile(userKey),
      target: toPublicProfile(targetKey, userKey, 'none'),
    };
  }

  const chatDeleted = relationship === 'contact' || chatRelationship === 'chat'
    ? Boolean(deleteChatThreadByParticipants(userKey, targetKey))
    : false;
  removeRelationship(userKey, targetKey);
  saveDb();

  if (isOnline(targetKey)) {
    sendToUser(targetKey, 'contact:removed', {
      byKey: userKey,
      byName: user.username,
      targetKey,
      targetName: target.username,
      relationship,
      chatDeleted,
      peer: toPublicProfile(userKey, targetKey, 'none'),
      removedAt: Date.now(),
    });
  }

  return {
    ok: true,
    status: relationship === 'contact' ? 'removed' : 'cancelled',
    user: getMeProfile(userKey),
    target: toPublicProfile(targetKey, userKey, 'none'),
    chatDeleted,
  };
}

function chatThreadId(userAKey, userBKey) {
  return crypto.createHash('sha1').update([userAKey, userBKey].sort().join('|')).digest('hex');
}

function chatThreadDir(threadId) {
  return path.join(CHAT_UPLOAD_DIR, threadId);
}

function classifyAttachmentKind(mimeType) {
  const clean = String(mimeType || '').toLowerCase();
  if (clean.startsWith('image/')) return 'image';
  if (clean.startsWith('video/')) return 'video';
  if (clean === 'application/pdf') return 'pdf';
  return 'file';
}

function sanitizeAttachmentName(name) {
  return String(name || 'file')
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'file';
}

function ensureChatThreadShape(thread) {
  if (!thread || typeof thread !== 'object') {
    return thread;
  }

  thread.participants = uniqueValues(thread.participants).sort();
  thread.messages = Array.isArray(thread.messages)
    ? thread.messages.map((message) => normalizeChatMessage(message)).filter(Boolean)
    : [];
  thread.readState = thread.readState && typeof thread.readState === 'object'
    ? Object.fromEntries(
        Object.entries(thread.readState)
          .filter(([key]) => typeof key === 'string' && key)
          .map(([key, value]) => [key, parseTimestamp(value)]),
      )
    : {};
  thread.createdAt = Number.isFinite(thread.createdAt) ? thread.createdAt : Date.now();
  thread.updatedAt = Number.isFinite(thread.updatedAt) ? thread.updatedAt : thread.createdAt;
  return thread;
}

function normalizeChatAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return null;
  }

  const name = typeof attachment.name === 'string' && attachment.name.trim() ? attachment.name.trim() : 'file';
  const mimeType = typeof attachment.mimeType === 'string' && attachment.mimeType.trim()
    ? attachment.mimeType.trim()
    : 'application/octet-stream';
  const url = typeof attachment.url === 'string' ? attachment.url : '';

  return {
    id: typeof attachment.id === 'string' && attachment.id ? attachment.id : crypto.randomUUID(),
    name,
    mimeType,
    size: Number.isFinite(attachment.size) ? attachment.size : 0,
    url,
    kind: attachment.kind || classifyAttachmentKind(mimeType),
  };
}

function normalizeChatMessage(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  return {
    id: typeof message.id === 'string' && message.id ? message.id : crypto.randomUUID(),
    senderKey: typeof message.senderKey === 'string' ? message.senderKey : '',
    senderName: typeof message.senderName === 'string' ? message.senderName : '',
    text: typeof message.text === 'string' ? message.text : '',
    attachments: Array.isArray(message.attachments) ? message.attachments.map(normalizeChatAttachment).filter(Boolean) : [],
    createdAt: Number.isFinite(message.createdAt) ? message.createdAt : Date.now(),
  };
}

function serializeChatAttachment(attachment) {
  const clean = normalizeChatAttachment(attachment);
  if (!clean) {
    return null;
  }

  return { ...clean };
}

function serializeChatMessage(message, viewerKey, context = {}) {
  const clean = normalizeChatMessage(message);
  if (!clean) {
    return null;
  }

  const viewerReadAt = Number.isFinite(context.viewerReadAt) ? context.viewerReadAt : Number(context.viewerReadAt) || 0;
  const peerReadAt = Number.isFinite(context.peerReadAt) ? context.peerReadAt : Number(context.peerReadAt) || 0;

  return {
    ...clean,
    isMine: clean.senderKey === viewerKey,
    attachments: clean.attachments.map((attachment) => serializeChatAttachment(attachment)).filter(Boolean),
    receipt:
      clean.senderKey === viewerKey
        ? (peerReadAt >= clean.createdAt ? 'read' : 'sent')
        : (viewerReadAt >= clean.createdAt ? 'read' : 'sent'),
  };
}

function serializeChatThread(thread, viewerKey) {
  const clean = ensureChatThreadShape(thread);
  if (!clean) {
    return null;
  }

  const peerKey = clean.participants.find((participantKey) => participantKey !== viewerKey) || clean.participants[0] || null;
  const viewerReadAt = Number(clean.readState?.[viewerKey]) || 0;
  const peerReadAt = Number(clean.readState?.[peerKey]) || 0;
  const context = { viewerReadAt, peerReadAt };

  return {
    threadId: chatThreadId(clean.participants[0], clean.participants[1]),
    participants: clean.participants
      .filter((participantKey) => Boolean(getUser(participantKey)))
      .map((participantKey) => toPublicProfile(participantKey, viewerKey)),
    messages: clean.messages.map((message) => serializeChatMessage(message, viewerKey, context)).filter(Boolean),
    createdAt: clean.createdAt,
    updatedAt: clean.updatedAt,
    readState: clean.readState,
  };
}

function getThreadLatestMessage(thread) {
  const clean = ensureChatThreadShape(thread);
  if (!clean || !Array.isArray(clean.messages) || !clean.messages.length) {
    return null;
  }

  return clean.messages[clean.messages.length - 1] || null;
}

function getThreadUnreadCount(thread, viewerKey) {
  const clean = ensureChatThreadShape(thread);
  if (!clean || !viewerKey) {
    return 0;
  }

  const viewerReadAt = Number(clean.readState?.[viewerKey]) || 0;
  return clean.messages.filter((message) => message.senderKey !== viewerKey && message.createdAt > viewerReadAt).length;
}

function markChatThreadRead(thread, viewerKey, readAt = Date.now()) {
  const clean = ensureChatThreadShape(thread);
  if (!clean || !viewerKey) {
    return clean;
  }

  const normalizedReadAt = parseTimestamp(readAt);
  const existingReadAt = Number(clean.readState?.[viewerKey]) || 0;
  clean.readState[viewerKey] = Math.max(existingReadAt, normalizedReadAt);
  clean.updatedAt = Math.max(clean.updatedAt, clean.readState[viewerKey]);
  return clean;
}

function getThreadPreview(thread) {
  const latest = getThreadLatestMessage(thread);
  if (!latest) {
    return 'No messages yet';
  }

  const attachments = Array.isArray(latest.attachments) ? latest.attachments : [];
  if (latest.text && attachments.length) {
    return `${latest.text} · ${attachments.length} file${attachments.length === 1 ? '' : 's'}`;
  }

  if (latest.text) {
    return latest.text;
  }

  if (!attachments.length) {
    return 'No messages yet';
  }

  if (attachments.length === 1) {
    const attachment = attachments[0];
    if (attachment.kind === 'image') return 'Photo';
    if (attachment.kind === 'video') return 'Video';
    if (attachment.kind === 'pdf') return 'PDF';
    return 'File';
  }

  return `${attachments.length} files`;
}

function getChatThreadByParticipants(userAKey, userBKey) {
  const thread = db.chatThreads[chatThreadId(userAKey, userBKey)];
  return thread ? ensureChatThreadShape(thread) : null;
}

function getOrCreateChatThread(userAKey, userBKey) {
  const threadKey = chatThreadId(userAKey, userBKey);
  if (!db.chatThreads[threadKey]) {
    db.chatThreads[threadKey] = {
      participants: [userAKey, userBKey].sort(),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  return ensureChatThreadShape(db.chatThreads[threadKey]);
}

function deleteChatThreadByParticipants(userAKey, userBKey) {
  const threadKey = chatThreadId(userAKey, userBKey);
  const thread = db.chatThreads[threadKey];
  if (!thread) {
    return null;
  }

  delete db.chatThreads[threadKey];
  fs.rmSync(chatThreadDir(threadKey), { recursive: true, force: true });
  return thread;
}

function removeChatRelationship(userKey, targetKey) {
  const user = getUser(userKey);
  const target = getUser(targetKey);

  if (!user || !target) {
    return false;
  }

  ensureUserShape(user);
  ensureUserShape(target);

  removeValue(user.chatContacts, targetKey);
  removeValue(user.incomingChatRequests, targetKey);
  removeValue(user.outgoingChatRequests, targetKey);
  removeValue(target.chatContacts, userKey);
  removeValue(target.incomingChatRequests, userKey);
  removeValue(target.outgoingChatRequests, userKey);
  return true;
}

function sendChatRequest(senderKey, targetKey) {
  const sender = getUser(senderKey);
  const target = getUser(targetKey);

  if (!sender || !target) {
    return { ok: false, error: 'No account exists with that username.' };
  }

  if (senderKey === targetKey) {
    return { ok: false, error: 'You cannot chat with yourself.' };
  }

  ensureUserShape(sender);
  ensureUserShape(target);

  if (sender.chatContacts.includes(targetKey)) {
    return {
      ok: true,
      status: 'chat',
      user: getMeProfile(senderKey),
      target: toPublicProfile(targetKey, senderKey, null, 'chat'),
    };
  }

  if (sender.incomingChatRequests.includes(targetKey)) {
    return acceptChatRequest(senderKey, targetKey, { initiatedBySend: true });
  }

  if (sender.outgoingChatRequests.includes(targetKey)) {
    return {
      ok: true,
      status: 'pending',
      user: getMeProfile(senderKey),
      target: toPublicProfile(targetKey, senderKey, null, 'outgoing'),
    };
  }

  addUnique(sender.outgoingChatRequests, targetKey);
  addUnique(target.incomingChatRequests, senderKey);
  saveDb();

  if (isOnline(targetKey)) {
    sendToUser(targetKey, 'chat:request', {
      fromKey: senderKey,
      fromName: sender.username,
      toKey: targetKey,
      toName: target.username,
      requestedAt: Date.now(),
    });
  }

  return {
    ok: true,
    status: 'requested',
    user: getMeProfile(senderKey),
    target: toPublicProfile(targetKey, senderKey, null, 'outgoing'),
  };
}

function acceptChatRequest(recipientKey, requesterKey, options = {}) {
  const recipient = getUser(recipientKey);
  const requester = getUser(requesterKey);

  if (!recipient || !requester) {
    return { ok: false, error: 'No account exists with that username.' };
  }

  if (recipientKey === requesterKey) {
    return { ok: false, error: 'You cannot chat with yourself.' };
  }

  ensureUserShape(recipient);
  ensureUserShape(requester);

  if (recipient.chatContacts.includes(requesterKey)) {
    return {
      ok: true,
      status: 'chat',
      user: getMeProfile(recipientKey),
      target: toPublicProfile(requesterKey, recipientKey, null, 'chat'),
    };
  }

  if (!recipient.incomingChatRequests.includes(requesterKey) && !requester.outgoingChatRequests.includes(recipientKey)) {
    return { ok: false, error: 'That chat request is no longer available.' };
  }

  removeValue(recipient.incomingChatRequests, requesterKey);
  removeValue(recipient.outgoingChatRequests, requesterKey);
  removeValue(requester.incomingChatRequests, recipientKey);
  removeValue(requester.outgoingChatRequests, recipientKey);
  addUnique(recipient.chatContacts, requesterKey);
  addUnique(requester.chatContacts, recipientKey);
  const thread = getOrCreateChatThread(recipientKey, requesterKey);
  thread.updatedAt = Date.now();
  saveDb();

  if (isOnline(requesterKey)) {
    sendToUser(requesterKey, 'chat:accepted', {
      byKey: recipientKey,
      byName: recipient.username,
      requesterKey,
      requesterName: requester.username,
      acceptedAt: Date.now(),
      autoAccepted: Boolean(options.initiatedBySend),
      threadId: chatThreadId(recipientKey, requesterKey),
    });
  }

  return {
    ok: true,
    status: 'accepted',
    user: getMeProfile(recipientKey),
    target: toPublicProfile(requesterKey, recipientKey, null, 'chat'),
    thread: serializeChatThread(thread, recipientKey),
  };
}

function rejectChatRequest(recipientKey, requesterKey) {
  const recipient = getUser(recipientKey);
  const requester = getUser(requesterKey);

  if (!recipient || !requester) {
    return { ok: false, error: 'No account exists with that username.' };
  }

  ensureUserShape(recipient);
  ensureUserShape(requester);

  if (!recipient.incomingChatRequests.includes(requesterKey) && !requester.outgoingChatRequests.includes(recipientKey)) {
    return { ok: false, error: 'That chat request is no longer available.' };
  }

  removeValue(recipient.incomingChatRequests, requesterKey);
  removeValue(recipient.outgoingChatRequests, requesterKey);
  removeValue(requester.incomingChatRequests, recipientKey);
  removeValue(requester.outgoingChatRequests, recipientKey);
  saveDb();

  if (isOnline(requesterKey)) {
    sendToUser(requesterKey, 'chat:rejected', {
      byKey: recipientKey,
      byName: recipient.username,
      requesterKey,
      requesterName: requester.username,
      rejectedAt: Date.now(),
    });
  }

  return {
    ok: true,
    status: 'rejected',
    user: getMeProfile(recipientKey),
    target: toPublicProfile(requesterKey, recipientKey, null, 'none'),
  };
}

function removeChatOrRequest(userKey, targetKey) {
  const user = getUser(userKey);
  const target = getUser(targetKey);

  if (!user || !target) {
    return { ok: false, error: 'No account exists with that username.' };
  }

  ensureUserShape(user);
  ensureUserShape(target);

  const relationship = getChatRelationship(userKey, targetKey);
  if (relationship === 'none') {
    return {
      ok: true,
      status: 'none',
      user: getMeProfile(userKey),
      target: toPublicProfile(targetKey, userKey, null, 'none'),
    };
  }

  if (relationship === 'chat') {
    removeValue(user.chatContacts, targetKey);
    removeValue(target.chatContacts, userKey);
  } else {
    removeValue(user.incomingChatRequests, targetKey);
    removeValue(user.outgoingChatRequests, targetKey);
    removeValue(target.incomingChatRequests, userKey);
    removeValue(target.outgoingChatRequests, userKey);
  }

  saveDb();

  if (isOnline(targetKey)) {
    sendToUser(targetKey, 'chat:removed', {
      byKey: userKey,
      byName: user.username,
      targetKey,
      targetName: target.username,
      relationship,
      removedAt: Date.now(),
    });
  }

  return {
    ok: true,
    status: relationship === 'chat' ? 'removed' : 'cancelled',
    user: getMeProfile(userKey),
    target: toPublicProfile(targetKey, userKey, null, 'none'),
  };
}

function appendChatMessage(senderKey, targetKey, text, attachments = []) {
  const sender = getUser(senderKey);
  const target = getUser(targetKey);

  if (!sender || !target) {
    return { ok: false, error: 'No account exists with that username.' };
  }

  ensureUserShape(sender);
  ensureUserShape(target);

  if (getChatRelationship(senderKey, targetKey) !== 'chat') {
    return { ok: false, error: 'Accept the chat before sending messages.' };
  }

  const thread = getOrCreateChatThread(senderKey, targetKey);
  const message = normalizeChatMessage({
    id: crypto.randomUUID(),
    senderKey,
    senderName: sender.username,
    text,
    attachments,
    createdAt: Date.now(),
  });

  thread.messages.push(message);
  thread.updatedAt = message.createdAt;
  saveDb();

  return {
    ok: true,
    thread,
    message,
  };
}

function getChatAttachmentFilePath(threadId, attachment) {
  const rawUrl = typeof attachment?.url === 'string' ? attachment.url.trim() : '';
  if (!rawUrl) {
    return null;
  }

  const fileName = path.basename(rawUrl.split('?')[0]);
  if (!fileName) {
    return null;
  }

  return path.join(chatThreadDir(threadId), fileName);
}

function removeChatAttachmentFiles(threadId, message) {
  const threadDir = chatThreadDir(threadId);
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];

  for (const attachment of attachments) {
    const filePath = getChatAttachmentFilePath(threadId, attachment);
    if (!filePath) continue;
    try {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    } catch {
      // Best effort cleanup.
    }
  }

  try {
    if (fs.existsSync(threadDir) && fs.readdirSync(threadDir).length === 0) {
      fs.rmSync(threadDir, { recursive: true, force: true });
    }
  } catch {
    // Best effort cleanup.
  }
}

function deleteChatMessage(senderKey, targetKey, messageId) {
  const sender = getUser(senderKey);
  const target = getUser(targetKey);

  if (!sender || !target) {
    return { ok: false, error: 'No account exists with that username.' };
  }

  ensureUserShape(sender);
  ensureUserShape(target);

  if (getChatRelationship(senderKey, targetKey) !== 'chat') {
    return { ok: false, error: 'Accept the chat before deleting messages.' };
  }

  const thread = getChatThreadByParticipants(senderKey, targetKey);
  if (!thread) {
    return { ok: false, error: 'No chat found with that username.' };
  }

  const cleanMessageId = String(messageId || '').trim();
  if (!cleanMessageId) {
    return { ok: false, error: 'Choose a message first.' };
  }

  const index = thread.messages.findIndex((message) => message.id === cleanMessageId);
  if (index < 0) {
    return { ok: false, error: 'That message no longer exists.' };
  }

  const message = thread.messages[index];
  if (message.senderKey !== senderKey) {
    return { ok: false, error: 'You can only delete your own messages.' };
  }

  const threadId = chatThreadId(senderKey, targetKey);
  removeChatAttachmentFiles(threadId, message);
  thread.messages.splice(index, 1);
  thread.updatedAt = Date.now();
  saveDb();

  return {
    ok: true,
    messageId: cleanMessageId,
    deletedAt: thread.updatedAt,
    thread,
  };
}

function deleteChatThreadsForUser(userKey) {
  const deleted = [];

  for (const [threadId, thread] of Object.entries(db.chatThreads)) {
    if (!thread || !Array.isArray(thread.participants) || !thread.participants.includes(userKey)) {
      continue;
    }

    const participants = uniqueValues(thread.participants).filter(Boolean);
    delete db.chatThreads[threadId];
    fs.rmSync(chatThreadDir(threadId), { recursive: true, force: true });
    deleted.push(participants);
  }

  return deleted;
}

function deleteAccountForever(userKey) {
  const user = getUser(userKey);
  if (!user) {
    return { ok: false, error: 'No account exists with that username.' };
  }

  ensureUserShape(user);
  removeProfilePhotoUrl(user.profilePhotoUrl);
  const affectedUsers = [];
  const chatAffectedUsers = [];

  for (const [otherKey, otherUser] of Object.entries(db.users)) {
    if (otherKey === userKey) continue;
    ensureUserShape(otherUser);

    const relationship = getRelationship(otherKey, userKey);
    const chatRelationship = getChatRelationship(otherKey, userKey);
    if (relationship !== 'none') {
      removeValue(otherUser.contacts, userKey);
      removeValue(otherUser.incomingRequests, userKey);
      removeValue(otherUser.outgoingRequests, userKey);
      affectedUsers.push({ otherKey, relationship });
    }

    if (chatRelationship !== 'none') {
      removeValue(otherUser.chatContacts, userKey);
      removeValue(otherUser.incomingChatRequests, userKey);
      removeValue(otherUser.outgoingChatRequests, userKey);
      chatAffectedUsers.push({ otherKey, chatRelationship });
    }
  }

  endCallsForUser(userKey, 'account-deleted');
  const deletedChatThreads = deleteChatThreadsForUser(userKey);

  delete db.users[userKey];
  saveDb();

  const deletedAt = Date.now();
  for (const { otherKey, relationship } of affectedUsers) {
    if (!isOnline(otherKey)) continue;
    sendToUser(otherKey, 'account:deleted', {
      byKey: userKey,
      byName: user.username,
      relationship,
      deletedAt,
    });
  }

  for (const { otherKey, chatRelationship } of chatAffectedUsers) {
    if (!isOnline(otherKey)) continue;
    sendToUser(otherKey, 'chat:deleted', {
      byKey: userKey,
      byName: user.username,
      chatRelationship,
      deletedAt,
    });
  }

  disconnectUserSockets(userKey);
  emitPresence();

  return {
    ok: true,
    user: { username: user.username, key: userKey },
    affectedCount: affectedUsers.length,
    chatAffectedCount: chatAffectedUsers.length,
    deletedChatThreadCount: deletedChatThreads.length,
  };
}

function normalizeUsername(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function displayUsername(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isValidUsername(value) {
  const clean = displayUsername(value);
  return clean.length >= 3 && clean.length <= 32 && !/[\u0000-\u001f\u007f]/.test(clean);
}

function isValidPassword(value) {
  return /^\d{8}$/.test(String(value || ''));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {
    salt,
    hash: crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex'),
  };
}

function verifyPassword(password, salt, expectedHash) {
  const attempt = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(attempt, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signToken(payload) {
  return crypto.createHmac('sha256', tokenSecret).update(payload).digest('base64url');
}

function issueToken(userKey) {
  const payload = encodeBase64Url(JSON.stringify({ u: userKey, iat: Date.now() }));
  return `${payload}.${signToken(payload)}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (signToken(payload) !== signature) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(payload));
    return typeof parsed.u === 'string' ? parsed.u : null;
  } catch {
    return null;
  }
}

function getUser(userKey) {
  return db.users[userKey] || null;
}

function isOnline(userKey) {
  const sockets = socketsByUser.get(userKey);
  return Boolean(sockets && sockets.size > 0);
}

function addSocket(userKey, socketId) {
  if (!socketsByUser.has(userKey)) {
    socketsByUser.set(userKey, new Set());
  }
  socketsByUser.get(userKey).add(socketId);
}

function removeSocket(userKey, socketId) {
  const sockets = socketsByUser.get(userKey);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) socketsByUser.delete(userKey);
}

function disconnectUserSockets(userKey) {
  const sockets = socketsByUser.get(userKey);
  if (!sockets || sockets.size === 0) return;

  for (const socketId of Array.from(sockets)) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    try {
      socket.disconnect(true);
    } catch {
      // Ignore disconnect errors.
    }
  }
}

function emitPresence() {
  const onlineUsers = Array.from(socketsByUser.keys()).sort();
  const presenceByUser = {};

  for (const [userKey, user] of Object.entries(db.users)) {
    ensureUserShape(user);
    presenceByUser[userKey] = {
      online: onlineUsers.includes(userKey),
      lastSeenAt: Number.isFinite(user.lastSeenAt) ? user.lastSeenAt : parseTimestamp(user.createdAt),
    };
  }

  io.emit('presence:update', {
    onlineUsers,
    presenceByUser,
  });
}

function getRelationship(viewerKey, otherKey) {
  if (!viewerKey || !otherKey) {
    return 'none';
  }

  if (viewerKey === otherKey) {
    return 'self';
  }

  const viewer = getUser(viewerKey);
  if (!viewer) {
    return 'none';
  }

  ensureUserShape(viewer);

  if (viewer.contacts.includes(otherKey)) {
    return 'contact';
  }
  if (viewer.incomingRequests.includes(otherKey)) {
    return 'incoming';
  }
  if (viewer.outgoingRequests.includes(otherKey)) {
    return 'outgoing';
  }
  return 'none';
}

function getChatRelationship(viewerKey, otherKey) {
  if (!viewerKey || !otherKey) {
    return 'none';
  }

  if (viewerKey === otherKey) {
    return 'self';
  }

  const viewer = getUser(viewerKey);
  if (!viewer) {
    return 'none';
  }

  ensureUserShape(viewer);

  if (viewer.chatContacts.includes(otherKey) || viewer.contacts.includes(otherKey)) {
    return 'chat';
  }
  if (viewer.incomingChatRequests.includes(otherKey)) {
    return 'incoming';
  }
  if (viewer.outgoingChatRequests.includes(otherKey)) {
    return 'outgoing';
  }
  return 'none';
}

function toPublicProfile(userKey, viewerKey = null, relationship = null, chatRelationship = null) {
  const user = getUser(userKey);
  if (!user) return null;
  const viewerRelationship = relationship || (viewerKey ? getRelationship(viewerKey, userKey) : 'none');
  const viewerChatRelationship = chatRelationship || (viewerKey ? getChatRelationship(viewerKey, userKey) : 'none');
  const thread = viewerKey && viewerChatRelationship === 'chat' ? getChatThreadByParticipants(viewerKey, userKey) : null;
  const latestMessage = getThreadLatestMessage(thread);
  return {
    username: user.username,
    key: userKey,
    createdAt: user.createdAt,
    online: isOnline(userKey),
    lastSeenAt: Number.isFinite(user.lastSeenAt) ? user.lastSeenAt : parseTimestamp(user.createdAt),
    profilePhotoUrl: typeof user.profilePhotoUrl === 'string' ? user.profilePhotoUrl : '',
    bio: typeof user.bio === 'string' ? user.bio : '',
    statusText: typeof user.statusText === 'string' ? user.statusText : '',
    relationship: viewerRelationship,
    chatRelationship: viewerChatRelationship,
    isContact: viewerRelationship === 'contact',
    isChat: viewerChatRelationship === 'chat',
    contactsCount: Array.isArray(user.contacts) ? user.contacts.length : 0,
    chatCount: uniqueValues([...(Array.isArray(user.chatContacts) ? user.chatContacts : []), ...(Array.isArray(user.contacts) ? user.contacts : [])]).length,
    unreadCount: thread ? getThreadUnreadCount(thread, viewerKey) : 0,
    lastMessageAt: latestMessage?.createdAt || thread?.updatedAt || 0,
    lastMessagePreview: thread ? getThreadPreview(thread) : '',
    lastReadAt: thread ? Number(thread?.readState?.[viewerKey]) || 0 : 0,
  };
}

function getContactProfiles(userKey) {
  const user = getUser(userKey);
  if (!user) return [];
  ensureUserShape(user);
  return user.contacts
    .filter((contactKey) => Boolean(getUser(contactKey)))
    .sort((a, b) => {
      const aOnline = isOnline(a) ? 1 : 0;
      const bOnline = isOnline(b) ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return getUser(a).username.localeCompare(getUser(b).username);
    })
    .map((contactKey) => toPublicProfile(contactKey, userKey, 'contact'));
}

function getChatProfiles(userKey) {
  const user = getUser(userKey);
  if (!user) return [];
  ensureUserShape(user);
  return uniqueValues([...(Array.isArray(user.chatContacts) ? user.chatContacts : []), ...(Array.isArray(user.contacts) ? user.contacts : [])])
    .filter((chatKey) => Boolean(getUser(chatKey)))
    .map((chatKey) => {
      const thread = getChatThreadByParticipants(userKey, chatKey);
      const latestMessage = getThreadLatestMessage(thread);
      const summary = toPublicProfile(chatKey, userKey, null, 'chat');
      return {
        ...summary,
        unreadCount: getThreadUnreadCount(thread, userKey),
        lastReadAt: Number(thread?.readState?.[userKey]) || 0,
        lastMessageAt: latestMessage?.createdAt || thread?.updatedAt || 0,
        lastMessagePreview: getThreadPreview(thread),
      };
    })
    .sort((a, b) => {
      if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
      if (a.lastMessageAt !== b.lastMessageAt) return b.lastMessageAt - a.lastMessageAt;
      const aOnline = isOnline(a.key) ? 1 : 0;
      const bOnline = isOnline(b.key) ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return a.username.localeCompare(b.username);
    });
}

function getRequestProfiles(userKey, direction) {
  const user = getUser(userKey);
  if (!user) return [];
  ensureUserShape(user);

  const keys = direction === 'incoming' ? user.incomingRequests : user.outgoingRequests;
  return keys
    .filter((requestKey) => Boolean(getUser(requestKey)))
    .sort((a, b) => {
      const aOnline = isOnline(a) ? 1 : 0;
      const bOnline = isOnline(b) ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return getUser(a).username.localeCompare(getUser(b).username);
    })
    .map((requestKey) => toPublicProfile(requestKey, userKey, direction));
}

function getChatRequestProfiles(userKey, direction) {
  const user = getUser(userKey);
  if (!user) return [];
  ensureUserShape(user);

  const keys = direction === 'incoming' ? user.incomingChatRequests : user.outgoingChatRequests;
  return keys
    .filter((requestKey) => Boolean(getUser(requestKey)))
    .sort((a, b) => {
      const aOnline = isOnline(a) ? 1 : 0;
      const bOnline = isOnline(b) ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return getUser(a).username.localeCompare(getUser(b).username);
    })
    .map((requestKey) => toPublicProfile(requestKey, userKey, null, direction));
}

function getMeProfile(userKey) {
  const user = getUser(userKey);
  if (!user) return null;
  ensureUserShape(user);
  return {
    username: user.username,
    key: userKey,
    createdAt: user.createdAt,
    online: true,
    lastSeenAt: user.lastSeenAt,
    profilePhotoUrl: user.profilePhotoUrl || '',
    bio: user.bio || '',
    statusText: user.statusText || '',
    contacts: getContactProfiles(userKey),
    requests: {
      incoming: getRequestProfiles(userKey, 'incoming'),
      outgoing: getRequestProfiles(userKey, 'outgoing'),
    },
    chats: getChatProfiles(userKey),
    chatRequests: {
      incoming: getChatRequestProfiles(userKey, 'incoming'),
      outgoing: getChatRequestProfiles(userKey, 'outgoing'),
    },
  };
}

function normalizeSearch(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function searchUsers(query, viewerKey) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return [];

  return Object.entries(db.users)
    .filter(([userKey]) => userKey !== viewerKey)
    .map(([userKey, user]) => {
      const haystack = `${user.username} ${userKey}`.toLowerCase();
      if (!haystack.includes(normalizedQuery)) return null;
      const lowerName = user.username.toLowerCase();
      const exactScore =
        lowerName === normalizedQuery || userKey === normalizedQuery ? 0 : lowerName.startsWith(normalizedQuery) || userKey.startsWith(normalizedQuery) ? 1 : 2;
      return {
        ...toPublicProfile(userKey, viewerKey),
        exactScore,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.exactScore !== b.exactScore) return a.exactScore - b.exactScore;
      if (a.online !== b.online) return Number(b.online) - Number(a.online);
      return a.username.localeCompare(b.username);
    })
    .slice(0, 12)
    .map(({ exactScore, ...result }) => result);
}

function respondError(res, status, message) {
  res.status(status).json({ ok: false, error: message });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = bearer || req.headers['x-auth-token'] || req.body?.token || '';
  const userKey = verifyToken(token);

  if (!userKey || !getUser(userKey)) {
    return respondError(res, 401, 'Please sign in again.');
  }

  req.userKey = userKey;
  return next();
}

function sendToUser(userKey, event, payload) {
  const sockets = socketsByUser.get(userKey);
  if (!sockets) return;
  for (const socketId of sockets) {
    io.to(socketId).emit(event, payload);
  }
}

function activeCallForUser(userKey) {
  for (const call of activeCalls.values()) {
    if (call.from === userKey || call.to === userKey) {
      return call;
    }
  }
  return null;
}

function getCallDurationMs(call, endedAt = Date.now()) {
  if (!call) return 0;
  if (typeof call.startedAt !== 'number') return 0;
  const startedAt = call.startedAt;
  return Math.max(0, endedAt - startedAt);
}

function endCallsForUser(userKey, reason = 'disconnect') {
  const callIds = [];
  for (const [callId, call] of activeCalls.entries()) {
    if (call.from === userKey || call.to === userKey) {
      callIds.push(callId);
    }
  }

  for (const callId of callIds) {
    const call = activeCalls.get(callId);
    if (!call) continue;
    const otherUser = call.from === userKey ? call.to : call.from;
    const endedAt = Date.now();
    sendToUser(otherUser, 'call:ended', {
      callId,
      reason,
      by: userKey,
      endedAt,
      durationMs: getCallDurationMs(call, endedAt),
    });
    activeCalls.delete(callId);
  }
}

function finalizeAccountCreation(username, password) {
  const cleanUsername = displayUsername(username);
  const userKey = normalizeUsername(cleanUsername);
  const { salt, hash } = hashPassword(password);

  db.users[userKey] = {
    username: cleanUsername,
    password: {
      salt,
      hash,
    },
    contacts: [],
    incomingRequests: [],
    outgoingRequests: [],
    chatContacts: [],
    incomingChatRequests: [],
    outgoingChatRequests: [],
    profilePhotoUrl: '',
    bio: '',
    statusText: 'Available on WhatsCall',
    lastSeenAt: Date.now(),
    createdAt: new Date().toISOString(),
  };

  saveDb();
  return userKey;
}

function attachSocketHandlers(socket, userKey) {
  addSocket(userKey, socket.id);
  emitPresence();

  socket.on('call:invite', (payload = {}, ack) => {
    try {
      const caller = getUser(userKey);
      const calleeKey = normalizeUsername(payload.to);
      const isVideo = Boolean(payload.isVideo);
      const offer = payload.offer || null;

      if (!calleeKey || !getUser(calleeKey)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'That username was not found.' });
        return;
      }

      if (calleeKey === userKey) {
        if (typeof ack === 'function') ack({ ok: false, error: 'You cannot call yourself.' });
        return;
      }

      if (!caller.contacts.includes(calleeKey)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Add this user to your contacts before calling.' });
        return;
      }

      if (!isOnline(calleeKey)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'That user is offline.' });
        return;
      }

      if (activeCallForUser(userKey) || activeCallForUser(calleeKey)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'One of the users is already in a call.' });
        return;
      }

      const callId = typeof payload.callId === 'string' && payload.callId ? payload.callId : crypto.randomUUID();
      activeCalls.set(callId, {
        callId,
        from: userKey,
        to: calleeKey,
        isVideo,
        offer,
        status: 'ringing',
        createdAt: Date.now(),
        startedAt: null,
      });

      sendToUser(calleeKey, 'call:incoming', {
        callId,
        fromKey: userKey,
        fromName: caller.username,
        isVideo,
        offer,
      });

      if (typeof ack === 'function') ack({ ok: true, callId });
    } catch {
      if (typeof ack === 'function') ack({ ok: false, error: 'Could not start the call.' });
    }
  });

  socket.on('call:response', (payload = {}, ack) => {
    const callId = payload.callId;
    const accepted = Boolean(payload.accepted);
    const call = activeCalls.get(callId);

    if (!call || call.to !== userKey) {
      if (typeof ack === 'function') ack({ ok: false, error: 'That call is no longer available.' });
      return;
    }

    if (!accepted) {
      sendToUser(call.from, 'call:rejected', { callId, by: userKey });
      activeCalls.delete(callId);
      if (typeof ack === 'function') ack({ ok: true });
      return;
    }

    const startedAt = call.startedAt || Date.now();
    call.startedAt = startedAt;
    call.status = 'active';
    const caller = getUser(call.from);
    sendToUser(call.from, 'call:accepted', {
      callId,
      by: userKey,
      byName: getUser(userKey).username,
      answer: payload.answer || null,
      isVideo: call.isVideo,
      startedAt,
    });
    sendToUser(call.to, 'call:started', {
      callId,
      peerKey: call.from,
      peerName: caller?.username || 'The other person',
      isVideo: call.isVideo,
      startedAt,
    });

    if (typeof ack === 'function') ack({ ok: true, startedAt });
  });

  socket.on('webrtc:signal', (payload = {}) => {
    const callId = payload.callId;
    const call = activeCalls.get(callId);
    if (!call) return;
    if (call.from !== userKey && call.to !== userKey) return;

    const targetKey = call.from === userKey ? call.to : call.from;
    sendToUser(targetKey, 'webrtc:signal', {
      callId,
      candidate: payload.candidate || null,
      description: payload.description || null,
      fromKey: userKey,
    });
  });

  socket.on('call:end', (payload = {}) => {
    const callId = payload.callId;
    const call = activeCalls.get(callId);
    if (!call) return;
    if (call.from !== userKey && call.to !== userKey) return;

    const targetKey = call.from === userKey ? call.to : call.from;
    const endedAt = Date.now();
    sendToUser(targetKey, 'call:ended', {
      callId,
      reason: payload.reason || 'ended',
      by: userKey,
      endedAt,
      durationMs: getCallDurationMs(call, endedAt),
    });

    activeCalls.delete(callId);
  });

  socket.on('chat:typing', (payload = {}) => {
    const targetKey = normalizeUsername(payload.to);
    const isTyping = Boolean(payload.isTyping);

    if (!targetKey || !getUser(targetKey) || targetKey === userKey) {
      return;
    }

    if (getChatRelationship(userKey, targetKey) !== 'chat') {
      return;
    }

    sendToUser(targetKey, 'chat:typing', {
      threadId: chatThreadId(userKey, targetKey),
      fromKey: userKey,
      fromName: getUser(userKey)?.username || 'Someone',
      isTyping,
    });
  });

  socket.on('chat:read', (payload = {}, ack) => {
    const targetKey = normalizeUsername(payload.to);
    const readAt = parseTimestamp(payload.readAt || Date.now());
    if (!targetKey || !getUser(targetKey) || targetKey === userKey) {
      if (typeof ack === 'function') ack({ ok: false, error: 'That username was not found.' });
      return;
    }

    if (getChatRelationship(userKey, targetKey) !== 'chat') {
      if (typeof ack === 'function') ack({ ok: false, error: 'Accept the chat before marking messages as read.' });
      return;
    }

    const thread = getChatThreadByParticipants(userKey, targetKey);
    if (!thread) {
      if (typeof ack === 'function') ack({ ok: false, error: 'No chat found with that username.' });
      return;
    }

    markChatThreadRead(thread, userKey, readAt);
    saveDb();

    const serializedThreadForReader = serializeChatThread(thread, userKey);
    const serializedThreadForPeer = serializeChatThread(thread, targetKey);
    const readerProfile = getMeProfile(userKey);
    const peerProfile = getMeProfile(targetKey);

    sendToUser(targetKey, 'chat:read', {
      threadId: chatThreadId(userKey, targetKey),
      byKey: userKey,
      byName: getUser(userKey)?.username || 'Someone',
      readAt: Number(thread.readState?.[userKey]) || readAt,
      thread: serializedThreadForPeer,
      user: peerProfile,
    });

    if (typeof ack === 'function') {
      ack({
        ok: true,
        thread: serializedThreadForReader,
        user: readerProfile,
        readAt: Number(thread.readState?.[userKey]) || readAt,
      });
    }
  });

  socket.on('disconnect', () => {
    removeSocket(userKey, socket.id);
    if (!isOnline(userKey)) {
      const user = getUser(userKey);
      if (user) {
        user.lastSeenAt = Date.now();
        saveDb();
      }
    }
    endCallsForUser(userKey, 'disconnect');
    emitPresence();
  });
}

loadDb();
loadSecret();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/chat-files', express.static(CHAT_UPLOAD_DIR));
app.use('/profile-photos', express.static(PROFILE_PHOTO_DIR));

const chatAttachmentStorage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      const targetName = displayUsername(req.params.username);
      const targetKey = normalizeUsername(targetName);
      if (!targetKey || !getUser(targetKey)) {
        cb(new Error('That username was not found.'));
        return;
      }

      const threadDir = chatThreadDir(chatThreadId(req.userKey, targetKey));
      fs.mkdirSync(threadDir, { recursive: true });
      cb(null, threadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename(req, file, cb) {
    try {
      const ext = path.extname(file.originalname || '');
      cb(null, `${crypto.randomUUID()}${ext}`);
    } catch (error) {
      cb(error);
    }
  },
});

const uploadChatAttachments = multer({
  storage: chatAttachmentStorage,
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 10,
  },
});

function respondUploadError(res, error) {
  if (!error) {
    return respondError(res, 400, 'Could not upload files.');
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return respondError(res, 413, 'Each file must be 100 MB or smaller.');
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return respondError(res, 400, 'You can upload up to 10 files at once.');
    }
  }

  return respondError(res, 400, error.message || 'Could not upload files.');
}

const profilePhotoStorage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      fs.mkdirSync(PROFILE_PHOTO_DIR, { recursive: true });
      cb(null, PROFILE_PHOTO_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename(req, file, cb) {
    try {
      const userKey = normalizeUsername(displayUsername(req.userKey || req.body?.username || 'profile'));
      const ext = mimeTypeToProfileExtension(file.mimetype, file.originalname);
      cb(null, `${userKey}-${Date.now()}-${crypto.randomUUID()}${ext}`);
    } catch (error) {
      cb(error);
    }
  },
});

const uploadProfilePhoto = multer({
  storage: profilePhotoStorage,
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1,
  },
  fileFilter(req, file, cb) {
    if (!String(file.mimetype || '').startsWith('image/')) {
      cb(new Error('Profile photos must be images.'));
      return;
    }
    cb(null, true);
  },
});

function respondProfileUploadError(res, error) {
  if (!error) {
    return respondError(res, 400, 'Could not update your profile.');
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return respondError(res, 413, 'Profile photos must be 8 MB or smaller.');
    }
    if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
      return respondError(res, 400, 'Please choose only one profile photo.');
    }
  }

  return respondError(res, 400, error.message || 'Could not update your profile.');
}

app.post('/api/auth/register', (req, res) => {
  const username = displayUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const userKey = normalizeUsername(username);

  if (!isValidUsername(username)) {
    return respondError(res, 400, 'Usernames must be 3 to 32 characters long.');
  }

  if (!isValidPassword(password)) {
    return respondError(res, 400, 'Passwords must be exactly 8 digits.');
  }

  if (db.users[userKey]) {
    return respondError(res, 409, 'That username is already taken.');
  }

  finalizeAccountCreation(username, password);

  return res.json({
    ok: true,
    token: issueToken(userKey),
    user: getMeProfile(userKey),
  });
});

app.post('/api/auth/login', (req, res) => {
  const username = displayUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const userKey = normalizeUsername(username);
  const user = getUser(userKey);

  if (!user) {
    return respondError(res, 404, 'No account exists with that username.');
  }

  if (!isValidPassword(password)) {
    return respondError(res, 400, 'Passwords must be exactly 8 digits.');
  }

  if (!verifyPassword(password, user.password.salt, user.password.hash)) {
    return respondError(res, 401, 'The password is not correct.');
  }

  return res.json({
    ok: true,
    token: issueToken(userKey),
    user: getMeProfile(userKey),
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = getMeProfile(req.userKey);
  if (!user) {
    return respondError(res, 401, 'Please sign in again.');
  }

  return res.json({
    ok: true,
    user,
  });
});

app.post('/api/me/profile', requireAuth, (req, res) => {
  const parser = uploadProfilePhoto.single('photo');
  parser(req, res, (error) => {
    if (error) {
      return respondProfileUploadError(res, error);
    }

    const user = getUser(req.userKey);
    if (!user) {
      return respondError(res, 401, 'Please sign in again.');
    }

    ensureUserShape(user);
    const oldPhotoUrl = user.profilePhotoUrl || '';
    const removePhoto = String(req.body?.removePhoto || '').trim() === '1' || String(req.body?.removePhoto || '').trim().toLowerCase() === 'true';
    const nextBio = normalizeProfileText(req.body?.bio, 240, true);
    const nextStatusText = normalizeProfileText(req.body?.statusText, 80, false);
    const nextPhotoUrl = req.file
      ? `/profile-photos/${req.file.filename}`
      : (removePhoto ? '' : oldPhotoUrl);

    user.bio = nextBio;
    user.statusText = nextStatusText || 'Available on WhatsCall';
    user.profilePhotoUrl = nextPhotoUrl;
    user.lastSeenAt = Number.isFinite(user.lastSeenAt) ? user.lastSeenAt : Date.now();
    saveDb();

    if (oldPhotoUrl && oldPhotoUrl !== nextPhotoUrl) {
      removeProfilePhotoUrl(oldPhotoUrl);
    }

    io.emit('profile:update', {
      userKey: req.userKey,
      profile: toPublicProfile(req.userKey, null),
    });

    return res.json({
      ok: true,
      user: getMeProfile(req.userKey),
    });
  });
});

app.get('/api/search', requireAuth, (req, res) => {
  return res.json({
    ok: true,
    results: searchUsers(req.query.q, req.userKey),
  });
});

app.post('/api/contacts/add', requireAuth, (req, res) => {
  const targetName = displayUsername(req.body?.username);
  const targetKey = normalizeUsername(targetName);
  if (!targetKey) {
    return respondError(res, 400, 'Choose a username first.');
  }

  const result = sendContactRequest(req.userKey, targetKey);
  if (!result.ok) {
    return respondError(res, result.error === 'No account exists with that username.' ? 404 : 400, result.error);
  }

  return res.json(result);
});

app.post('/api/contacts/accept', requireAuth, (req, res) => {
  const targetName = displayUsername(req.body?.username);
  const targetKey = normalizeUsername(targetName);

  if (!targetKey) {
    return respondError(res, 400, 'Choose a username first.');
  }

  const result = acceptContactRequest(req.userKey, targetKey);
  if (!result.ok) {
    return respondError(res, result.error === 'No account exists with that username.' ? 404 : 400, result.error);
  }

  return res.json(result);
});

app.post('/api/contacts/reject', requireAuth, (req, res) => {
  const targetName = displayUsername(req.body?.username);
  const targetKey = normalizeUsername(targetName);

  if (!targetKey) {
    return respondError(res, 400, 'Choose a username first.');
  }

  const result = rejectContactRequest(req.userKey, targetKey);
  if (!result.ok) {
    return respondError(res, result.error === 'No account exists with that username.' ? 404 : 400, result.error);
  }

  return res.json(result);
});

app.post('/api/contacts/remove', requireAuth, (req, res) => {
  const targetName = displayUsername(req.body?.username);
  const targetKey = normalizeUsername(targetName);

  if (!targetKey) {
    return respondError(res, 400, 'Choose a username first.');
  }

  const result = removeContactOrRequest(req.userKey, targetKey);
  if (!result.ok) {
    return respondError(res, result.error === 'No account exists with that username.' ? 404 : 400, result.error);
  }

  return res.json(result);
});

app.get('/api/chats/:username', requireAuth, (req, res) => {
  const targetName = displayUsername(req.params.username);
  const targetKey = normalizeUsername(targetName);

  if (!targetKey) {
    return respondError(res, 400, 'Choose a username first.');
  }

  const target = getUser(targetKey);
  if (!target) {
    return respondError(res, 404, 'No account exists with that username.');
  }

  const relationship = getChatRelationship(req.userKey, targetKey);
  const thread = relationship === 'chat' ? markChatThreadRead(getOrCreateChatThread(req.userKey, targetKey), req.userKey) : null;
  if (thread) {
    saveDb();
  }

  return res.json({
    ok: true,
    peer: toPublicProfile(targetKey, req.userKey, null, relationship),
    chatRelationship: relationship,
    thread: thread ? serializeChatThread(thread, req.userKey) : null,
    user: getMeProfile(req.userKey),
  });
});

app.post('/api/chats/:username/request', requireAuth, (req, res) => {
  const targetName = displayUsername(req.params.username);
  const targetKey = normalizeUsername(targetName);

  if (!targetKey) {
    return respondError(res, 400, 'Choose a username first.');
  }

  const result = sendChatRequest(req.userKey, targetKey);
  if (!result.ok) {
    return respondError(res, result.error === 'No account exists with that username.' ? 404 : 400, result.error);
  }

  return res.json(result);
});

app.post('/api/chats/:username/accept', requireAuth, (req, res) => {
  const targetName = displayUsername(req.params.username);
  const targetKey = normalizeUsername(targetName);

  if (!targetKey) {
    return respondError(res, 400, 'Choose a username first.');
  }

  const result = acceptChatRequest(req.userKey, targetKey);
  if (!result.ok) {
    return respondError(res, result.error === 'No account exists with that username.' ? 404 : 400, result.error);
  }

  return res.json(result);
});

app.post('/api/chats/:username/reject', requireAuth, (req, res) => {
  const targetName = displayUsername(req.params.username);
  const targetKey = normalizeUsername(targetName);

  if (!targetKey) {
    return respondError(res, 400, 'Choose a username first.');
  }

  const result = rejectChatRequest(req.userKey, targetKey);
  if (!result.ok) {
    return respondError(res, result.error === 'No account exists with that username.' ? 404 : 400, result.error);
  }

  return res.json(result);
});

app.post('/api/chats/:username/remove', requireAuth, (req, res) => {
  const targetName = displayUsername(req.params.username);
  const targetKey = normalizeUsername(targetName);

  if (!targetKey) {
    return respondError(res, 400, 'Choose a username first.');
  }

  const result = removeChatOrRequest(req.userKey, targetKey);
  if (!result.ok) {
    return respondError(res, result.error === 'No account exists with that username.' ? 404 : 400, result.error);
  }

  return res.json(result);
});

app.post('/api/chats/:username/messages', requireAuth, (req, res) => {
  const targetName = displayUsername(req.params.username);
  const targetKey = normalizeUsername(targetName);

  if (!targetKey) {
    return respondError(res, 400, 'Choose a username first.');
  }

  const parser = uploadChatAttachments.array('files', 10);
  parser(req, res, (error) => {
    if (error) {
      return respondUploadError(res, error);
    }

    const target = getUser(targetKey);
    if (!target) {
      return respondError(res, 404, 'No account exists with that username.');
    }

    const text = String(req.body?.text || '').trim();
    const files = Array.isArray(req.files) ? req.files : [];
    if (!text && files.length === 0) {
      return respondError(res, 400, 'Type a message or attach a file.');
    }

    const attachments = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      url: `/chat-files/${chatThreadId(req.userKey, targetKey)}/${file.filename}`,
      kind: classifyAttachmentKind(file.mimetype),
    }));

    const result = appendChatMessage(req.userKey, targetKey, text, attachments);
    if (!result.ok) {
      return respondError(res, 400, result.error);
    }

    const threadId = chatThreadId(req.userKey, targetKey);
    const senderPayload = {
      threadId,
      peerKey: targetKey,
      peerName: target.username,
      message: serializeChatMessage(result.message, req.userKey),
    };
    const recipientPayload = {
      threadId,
      peerKey: req.userKey,
      peerName: getUser(req.userKey)?.username || 'The other person',
      message: serializeChatMessage(result.message, targetKey),
    };

    sendToUser(req.userKey, 'chat:message', senderPayload);
    if (isOnline(targetKey)) {
      sendToUser(targetKey, 'chat:message', recipientPayload);
    }

    return res.json({
      ok: true,
      message: serializeChatMessage(result.message, req.userKey),
      thread: serializeChatThread(result.thread, req.userKey),
    });
  });
});

app.delete('/api/chats/:username/messages/:messageId', requireAuth, (req, res) => {
  const targetName = displayUsername(req.params.username);
  const targetKey = normalizeUsername(targetName);
  const messageId = String(req.params.messageId || '').trim();

  if (!targetKey) {
    return respondError(res, 400, 'Choose a username first.');
  }

  if (!messageId) {
    return respondError(res, 400, 'Choose a message first.');
  }

  const result = deleteChatMessage(req.userKey, targetKey, messageId);
  if (!result.ok) {
    const status =
      result.error === 'No account exists with that username.' ? 404 :
      result.error === 'No chat found with that username.' ? 404 :
      result.error === 'That message no longer exists.' ? 404 :
      result.error === 'You can only delete your own messages.' ? 403 :
      400;
    return respondError(res, status, result.error);
  }

  const threadId = chatThreadId(req.userKey, targetKey);
  const senderPeer = getUser(targetKey);
  const requesterName = getUser(req.userKey)?.username || 'The other person';

  const senderPayload = {
    threadId,
    peerKey: targetKey,
    peerName: senderPeer?.username || 'The other person',
    messageId,
    deletedAt: result.deletedAt,
    thread: serializeChatThread(result.thread, req.userKey),
  };
  const recipientPayload = {
    threadId,
    peerKey: req.userKey,
    peerName: requesterName,
    messageId,
    deletedAt: result.deletedAt,
    thread: serializeChatThread(result.thread, targetKey),
  };

  sendToUser(req.userKey, 'chat:message-deleted', senderPayload);
  if (isOnline(targetKey)) {
    sendToUser(targetKey, 'chat:message-deleted', recipientPayload);
  }

  return res.json({
    ok: true,
    messageId,
    deletedAt: result.deletedAt,
    thread: serializeChatThread(result.thread, req.userKey),
  });
});

app.post('/api/account/delete', requireAuth, (req, res) => {
  const password = String(req.body?.password || '');

  if (!isValidPassword(password)) {
    return respondError(res, 400, 'Password must be exactly 8 digits.');
  }

  const user = getUser(req.userKey);
  if (!user) {
    return respondError(res, 401, 'Please sign in again.');
  }

  if (!verifyPassword(password, user.password.salt, user.password.hash)) {
    return respondError(res, 401, 'The password is not correct.');
  }

  const result = deleteAccountForever(req.userKey);
  if (!result.ok) {
    return respondError(res, 400, result.error);
  }

  return res.json({
    ok: true,
    deleted: result.user,
    affectedCount: result.affectedCount,
  });
});

app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers['x-auth-token'];
    const userKey = verifyToken(token);
    if (!userKey || !getUser(userKey)) {
      return next(new Error('unauthorized'));
    }

    socket.userKey = userKey;
    return next();
  } catch {
    return next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  attachSocketHandlers(socket, socket.userKey);
});

function findAvailablePort(startPort, maxPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const tester = net.createServer();
      tester.unref();

      tester.once('error', (error) => {
        tester.close();
        if (error.code === 'EADDRINUSE' && port < maxPort) {
          tryPort(port + 1);
          return;
        }
        reject(error);
      });

      tester.listen(port, () => {
        const chosenPort = tester.address().port;
        tester.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          resolve(chosenPort);
        });
      });
    };

    tryPort(startPort);
  });
}

async function startServer() {
  const port = await findAvailablePort(START_PORT, MAX_PORT);
  const protocol = HTTPS_OPTIONS ? 'https' : 'http';
  server.listen(port, () => {
    if (port === START_PORT) {
      console.log(`WhatsCall platform running on ${protocol}://localhost:${port}`);
      return;
    }

    console.log(`Port ${START_PORT} was busy, so WhatsCall started on ${protocol}://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start WhatsCall:', error);
  process.exit(1);
});
