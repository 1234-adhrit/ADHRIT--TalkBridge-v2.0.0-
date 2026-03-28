const state = {
  mode: 'login',
  token: localStorage.getItem('whatscall-token') || '',
  me: null,
  contacts: [],
  incomingRequests: [],
  outgoingRequests: [],
  chats: [],
  incomingChatRequests: [],
  outgoingChatRequests: [],
  searchQuery: '',
  searchResults: [],
  selectedUser: null,
  activeChatKey: null,
  chatThread: null,
  chatDraftText: '',
  chatDraftFiles: [],
  chatLoading: false,
  chatLoadRequestId: 0,
  chatSuppressedForKey: null,
  onlineUsers: new Set(),
  presenceByKey: new Map(),
  socket: null,
  chatTypingPeerKey: null,
  chatTypingPeerActive: false,
  chatTypingTimer: null,
  typingBroadcastTimer: null,
  incomingCall: null,
  activeCall: null,
  callController: null,
  searchRequestId: 0,
  toastTimer: null,
  callTimer: null,
};

const els = {
  authPanel: document.getElementById('auth-panel'),
  authForm: document.getElementById('auth-form'),
  authUsername: document.getElementById('auth-username'),
  authPassword: document.getElementById('auth-password'),
  authSubmit: document.getElementById('auth-submit'),
  authStatus: document.getElementById('auth-status'),
  authModeButtons: Array.from(document.querySelectorAll('[data-auth-mode]')),
  appPanel: document.getElementById('app-panel'),
  editProfileBtn: document.getElementById('edit-profile-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  deleteAccountBtn: document.getElementById('delete-account-btn'),
  meAvatar: document.getElementById('me-avatar'),
  meName: document.getElementById('me-name'),
  meStatus: document.getElementById('me-status'),
  meBio: document.getElementById('me-bio'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  searchCount: document.getElementById('search-count'),
  requestCount: document.getElementById('request-count'),
  requestsList: document.getElementById('requests-list'),
  chatCount: document.getElementById('chat-count'),
  chatsList: document.getElementById('chats-list'),
  contactsList: document.getElementById('contacts-list'),
  contactCount: document.getElementById('contact-count'),
  workspaceEmpty: document.getElementById('workspace-empty'),
  contactPanel: document.getElementById('contact-panel'),
  selectedAvatar: document.getElementById('selected-avatar'),
  selectedName: document.getElementById('selected-name'),
  selectedStatus: document.getElementById('selected-status'),
  selectedChatAction: document.getElementById('selected-chat-action'),
  selectedLeaveChat: document.getElementById('selected-leave-chat'),
  selectedAudioCall: document.getElementById('selected-audio-call'),
  selectedVideoCall: document.getElementById('selected-video-call'),
  selectedRemove: document.getElementById('selected-remove'),
  selectedNote: document.getElementById('selected-note'),
  chatPanel: document.getElementById('chat-panel'),
  chatPeerName: document.getElementById('chat-peer-name'),
  chatPeerStatus: document.getElementById('chat-peer-status'),
  closeChatBtn: document.getElementById('close-chat-btn'),
  chatMessages: document.getElementById('chat-messages'),
  chatEmpty: document.getElementById('chat-empty'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  chatFileInput: document.getElementById('chat-file-input'),
  clearChatFiles: document.getElementById('clear-chat-files'),
  sendChatMessage: document.getElementById('send-chat-message'),
  chatFilePreview: document.getElementById('chat-file-preview'),
  toast: document.getElementById('toast'),
  incomingModal: document.getElementById('incoming-modal'),
  incomingTitle: document.getElementById('incoming-title'),
  incomingSubtitle: document.getElementById('incoming-subtitle'),
  acceptCall: document.getElementById('accept-call'),
  rejectCall: document.getElementById('reject-call'),
  deleteAccountModal: document.getElementById('delete-account-modal'),
  deleteAccountForm: document.getElementById('delete-account-form'),
  deleteAccountPassword: document.getElementById('delete-account-password'),
  deleteAccountStatus: document.getElementById('delete-account-status'),
  confirmDeleteAccount: document.getElementById('confirm-delete-account'),
  cancelDeleteAccount: document.getElementById('cancel-delete-account'),
  profileModal: document.getElementById('profile-modal'),
  profileForm: document.getElementById('profile-form'),
  saveProfileBtn: document.getElementById('save-profile-btn'),
  profilePhotoInput: document.getElementById('profile-photo-input'),
  profileRemovePhotoFlag: document.getElementById('profile-remove-photo-flag'),
  profileRemovePhotoBtn: document.getElementById('profile-remove-photo-btn'),
  profileStatusInput: document.getElementById('profile-status-input'),
  profileBioInput: document.getElementById('profile-bio-input'),
  profileStatusMessage: document.getElementById('profile-status-message'),
  profilePreviewName: document.getElementById('profile-preview-name'),
  profilePreviewText: document.getElementById('profile-preview-text'),
  profilePhotoPreview: document.getElementById('profile-photo-preview'),
  cancelProfileBtn: document.getElementById('cancel-profile-btn'),
  activeCallModal: document.getElementById('active-call-modal'),
  callModeLabel: document.getElementById('call-mode-label'),
  callTitle: document.getElementById('call-title'),
  callTimer: document.getElementById('call-timer'),
  callAvatar: document.getElementById('call-avatar'),
  callStatusTitle: document.getElementById('call-status-title'),
  callStatusText: document.getElementById('call-status-text'),
  toggleAudio: document.getElementById('toggle-audio'),
  toggleVideo: document.getElementById('toggle-video'),
  endCall: document.getElementById('end-call'),
  remoteVideo: document.getElementById('remote-video'),
  localVideo: document.getElementById('local-video'),
  voiceOverlay: document.getElementById('voice-overlay'),
};

const debounceTimers = { search: null };

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function initials(value) {
  const clean = String(value || '').trim();
  if (!clean) return '?';
  const words = clean.split(/\s+/).filter(Boolean);
  const parts = words.length > 1 ? words.slice(0, 2).map((part) => part[0]) : clean.slice(0, 2).split('');
  return parts.join('').toUpperCase();
}

function profilePhotoUrl(profile) {
  return String(profile?.profilePhotoUrl || '').trim();
}

function applyAvatarElement(element, profile) {
  if (!element) return;
  const photoUrl = profilePhotoUrl(profile);
  element.classList.toggle('has-photo', Boolean(photoUrl));
  element.style.backgroundImage = photoUrl ? `url("${photoUrl.replaceAll('"', '%22')}")` : '';
  element.style.backgroundSize = photoUrl ? 'cover' : '';
  element.style.backgroundPosition = photoUrl ? 'center' : '';
  element.style.backgroundRepeat = photoUrl ? 'no-repeat' : '';
  element.textContent = photoUrl ? '' : initials(profile?.username || '?');
}

function avatarMarkup(profile, extraClass = '') {
  const photoUrl = profilePhotoUrl(profile);
  const classes = ['avatar'];
  if (extraClass) classes.push(extraClass);
  if (photoUrl) classes.push('has-photo');
  const style = photoUrl ? ` style="background-image:url(&quot;${escapeHtml(photoUrl)}&quot;)"` : '';
  return `<div class="${classes.join(' ')}"${style}>${photoUrl ? '' : escapeHtml(initials(profile?.username || '?'))}</div>`;
}

function formatRelativeTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'just now';
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}m ago`;
  if (diff < 86400000) return `${Math.max(1, Math.round(diff / 3600000))}h ago`;
  return `${Math.max(1, Math.round(diff / 86400000))}d ago`;
}

function formatLastSeen(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Last seen just now';
  return `Last seen ${formatRelativeTime(timestamp)}`;
}

function updatePresenceState(payload = {}) {
  state.onlineUsers = new Set(Array.isArray(payload.onlineUsers) ? payload.onlineUsers : []);
  state.presenceByKey = new Map(
    Object.entries(payload.presenceByUser || {}).map(([key, info]) => [
      key,
      {
        online: Boolean(info?.online),
        lastSeenAt: Number(info?.lastSeenAt) || 0,
      },
    ]),
  );
}

function usernameLabel(value) {
  return String(value || '').trim();
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `call-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatCallDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getCallDurationMs(controller, endedAt = Date.now()) {
  if (!controller || typeof controller.startedAt !== 'number' || controller.startedAt <= 0) {
    return 0;
  }

  return Math.max(0, endedAt - controller.startedAt);
}

function showCallEndedToast(durationMs, prefix = 'Call ended') {
  const duration = formatCallDuration(durationMs);
  showToast(`${prefix} after ${duration}.`, 'info');
}

function setAuthMode(mode) {
  state.mode = mode;
  els.authModeButtons.forEach((button) => button.classList.toggle('active', button.dataset.authMode === mode));
  els.authSubmit.textContent = mode === 'register' ? 'Create account' : 'Sign in';
  els.authStatus.textContent = '';
}

function showToast(message, tone = 'info') {
  els.toast.textContent = message;
  els.toast.className = `toast ${tone}`;
  els.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function setAuthStatus(message, tone = 'info') {
  els.authStatus.textContent = message;
  els.authStatus.style.color =
    tone === 'error' ? '#ffb4c0' : tone === 'success' ? '#7fe8a5' : 'var(--muted)';
}

function updateVisibility() {
  const signedIn = Boolean(state.me);
  els.authPanel.hidden = signedIn;
  els.appPanel.hidden = !signedIn;
}

function apiHeaders(bodyPresent = false) {
  const headers = {};
  if (bodyPresent) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return headers;
}

async function apiFetch(url, options = {}) {
  const hasFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...apiHeaders(Boolean(options.body) && !hasFormDataBody),
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  let data = {};
  const trimmed = raw.trim();
  const looksLikeJson = contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[');

  try {
    data = looksLikeJson && raw ? JSON.parse(raw) : {};
  } catch {
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<')) {
      throw new Error('The running server is out of date. Restart npm start so the chat endpoints are available.');
    }
    throw new Error('The server returned an unreadable response.');
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || 'Something went wrong.');
  }

  if (!looksLikeJson && trimmed.startsWith('<')) {
    throw new Error('The running server is out of date. Restart npm start so the chat endpoints are available.');
  }

  return data;
}

function relationshipPriority(relationship) {
  switch (relationship) {
    case 'contact':
      return 0;
    case 'incoming':
      return 1;
    case 'outgoing':
      return 2;
    default:
      return 3;
  }
}

function chatRelationshipPriority(relationship) {
  switch (relationship) {
    case 'chat':
      return 0;
    case 'incoming':
      return 1;
    case 'outgoing':
      return 2;
    default:
      return 3;
  }
}

function relationshipLabel(relationship) {
  switch (relationship) {
    case 'contact':
      return 'Contact';
    case 'incoming':
      return 'Request waiting for you';
    case 'outgoing':
      return 'Request sent';
    default:
      return 'Not added';
  }
}

function chatRelationshipLabel(relationship) {
  switch (relationship) {
    case 'chat':
      return 'Chat';
    case 'incoming':
      return 'Request waiting for you';
    case 'outgoing':
      return 'Request sent';
    default:
      return 'Chat not started';
  }
}

function findProfileByKey(list, key) {
  return (Array.isArray(list) ? list : []).find((item) => item?.key === key) || null;
}

function mergeUserProfiles(...profiles) {
  const merged = {};
  for (const profile of profiles) {
    if (!profile) continue;
    Object.assign(merged, profile);
  }

  if (!merged.key) {
    return null;
  }

  merged.relationship = merged.relationship || 'none';
  merged.chatRelationship = merged.chatRelationship || 'none';
  merged.isContact = merged.relationship === 'contact';
  merged.isChat = merged.chatRelationship === 'chat' || merged.isContact;
  const presence = state.presenceByKey.get(merged.key);
  merged.online = presence ? Boolean(presence.online) : state.onlineUsers.has(merged.key);
  if (presence && Number.isFinite(presence.lastSeenAt)) {
    merged.lastSeenAt = presence.lastSeenAt;
  }
  return merged;
}

function profileSnapshot(user) {
  if (!user) return null;
  const contactProfile =
    findProfileByKey(state.contacts, user.key) ||
    findProfileByKey(state.incomingRequests, user.key) ||
    findProfileByKey(state.outgoingRequests, user.key);
  const chatProfile =
    findProfileByKey(state.chats, user.key) ||
    findProfileByKey(state.incomingChatRequests, user.key) ||
    findProfileByKey(state.outgoingChatRequests, user.key);

  return mergeUserProfiles(user, contactProfile, chatProfile);
}

function currentRelationship(profile) {
  if (!profile) return 'none';
  return profile.relationship || (profile.isContact ? 'contact' : 'none');
}

function currentChatRelationship(profile) {
  if (!profile) return 'none';
  return profile.chatRelationship || (profile.isChat || profile.isContact ? 'chat' : 'none');
}

function sortedContacts() {
  return [...state.contacts]
    .map(profileSnapshot)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.online !== b.online) return Number(b.online) - Number(a.online);
      return a.username.localeCompare(b.username);
    });
}

function sortedRequests() {
  return [...state.incomingRequests, ...state.outgoingRequests]
    .map(profileSnapshot)
    .filter(Boolean)
    .sort((a, b) => {
      const relationDiff = relationshipPriority(a.relationship) - relationshipPriority(b.relationship);
      if (relationDiff !== 0) return relationDiff;
      if (a.online !== b.online) return Number(b.online) - Number(a.online);
      return a.username.localeCompare(b.username);
    });
}

function sortedChats() {
  return [...state.chats, ...state.incomingChatRequests, ...state.outgoingChatRequests]
    .map(profileSnapshot)
    .filter(Boolean)
    .sort((a, b) => {
      const relationDiff = chatRelationshipPriority(a.chatRelationship) - chatRelationshipPriority(b.chatRelationship);
      if (relationDiff !== 0) return relationDiff;
      if (a.online !== b.online) return Number(b.online) - Number(a.online);
      return a.username.localeCompare(b.username);
    });
}

function sortedSearchResults() {
  return [...state.searchResults]
    .map(profileSnapshot)
    .filter(Boolean)
    .sort((a, b) => {
      const relationDiff = relationshipPriority(a.relationship) - relationshipPriority(b.relationship);
      if (relationDiff !== 0) return relationDiff;
      if (a.online !== b.online) return Number(b.online) - Number(a.online);
      return a.username.localeCompare(b.username);
    });
}

function lookupUser(key) {
  for (const list of [sortedChats(), sortedContacts(), sortedRequests(), sortedSearchResults()]) {
    const found = list.find((item) => item.key === key);
    if (found) {
      return profileSnapshot(found) || found;
    }
  }

  if (state.selectedUser && state.selectedUser.key === key) {
    return profileSnapshot(state.selectedUser);
  }

  return null;
}

function userCardTemplate(user) {
  const isSelected = state.selectedUser?.key === user.key;
  const relationship = currentRelationship(user);
  const chatRelationship = currentChatRelationship(user);
  const onlineLabel = user.online ? 'Online now' : formatLastSeen(user.lastSeenAt);
  const accentClass = user.online ? 'online' : 'offline';
  const statusBits = [onlineLabel];
  if (relationship !== 'none') {
    statusBits.push(relationshipLabel(relationship));
  }
  if (chatRelationship !== 'none') {
    statusBits.push(chatRelationshipLabel(chatRelationship));
  }
  if (user.statusText) {
    statusBits.push(user.statusText);
  }
  if (user.unreadCount) {
    statusBits.push(`${user.unreadCount} unread`);
  }

  const detailLine = chatRelationship === 'chat'
    ? user.lastMessagePreview
    : user.bio || '';

  let mainAction = 'Select profile';
  if (chatRelationship === 'chat') {
    mainAction = 'Open chat';
  } else if (chatRelationship === 'incoming' || chatRelationship === 'outgoing') {
    mainAction = 'View request';
  } else if (relationship === 'contact') {
    mainAction = 'Select contact';
  } else if (relationship === 'incoming' || relationship === 'outgoing') {
    mainAction = 'View request';
  } else {
    mainAction = 'Add as contact';
  }

  const actions = [];
  const unreadBadge = user.unreadCount
    ? `<span class="chat-badge" aria-label="${escapeHtml(`${user.unreadCount} unread messages`)}">${escapeHtml(String(user.unreadCount))}</span>`
    : '';

  if (chatRelationship === 'chat') {
    actions.push(`<button type="button" class="mini-action primary" data-action="open-chat" data-key="${escapeHtml(user.key)}">Open chat</button>`);
    actions.push(`<button type="button" class="mini-action danger" data-action="leave-chat" data-key="${escapeHtml(user.key)}">Leave chat</button>`);
  } else if (chatRelationship === 'incoming') {
    actions.push(`<button type="button" class="mini-action primary" data-action="accept-chat" data-key="${escapeHtml(user.key)}">Accept chat</button>`);
    actions.push(`<button type="button" class="mini-action danger" data-action="reject-chat" data-key="${escapeHtml(user.key)}">Reject chat</button>`);
  } else if (chatRelationship === 'outgoing') {
    actions.push(`<button type="button" class="mini-action danger" data-action="cancel-chat" data-key="${escapeHtml(user.key)}">Cancel chat</button>`);
  } else {
    actions.push(`<button type="button" class="mini-action primary" data-action="add-contact" data-key="${escapeHtml(user.key)}">Add as contact</button>`);
  }

  if (relationship === 'contact') {
    actions.push(`<button type="button" class="mini-action primary" data-action="audio-call" data-key="${escapeHtml(user.key)}">Call</button>`);
    actions.push(`<button type="button" class="mini-action" data-action="video-call" data-key="${escapeHtml(user.key)}">Video</button>`);
    actions.push(`<button type="button" class="mini-action danger" data-action="remove-contact" data-key="${escapeHtml(user.key)}">Remove</button>`);
  } else if (relationship === 'incoming') {
    actions.push(`<button type="button" class="mini-action primary" data-action="accept-request" data-key="${escapeHtml(user.key)}">Accept</button>`);
    actions.push(`<button type="button" class="mini-action danger" data-action="reject-request" data-key="${escapeHtml(user.key)}">Reject</button>`);
  } else if (relationship === 'outgoing') {
    actions.push(`<button type="button" class="mini-action danger" data-action="cancel-request" data-key="${escapeHtml(user.key)}">Cancel</button>`);
  }

  return `
    <article class="person-card ${isSelected ? 'selected' : ''}" data-key="${escapeHtml(user.key)}" data-relationship="${escapeHtml(relationship)}">
      <button type="button" class="person-main" data-action="select-user" data-key="${escapeHtml(user.key)}" aria-label="${escapeHtml(mainAction)}">
        ${avatarMarkup(user)}
        <div class="person-copy">
          <div class="person-head">
            <strong>${escapeHtml(user.username)}</strong>
            ${unreadBadge}
          </div>
          <span class="${accentClass}">${escapeHtml(statusBits.join(' | '))}</span>
          ${detailLine ? `<span class="person-preview">${escapeHtml(detailLine)}</span>` : ''}
        </div>
      </button>
      <div class="person-actions">${actions.join('')}</div>
    </article>
  `;
}

function renderContacts() {
  const contacts = sortedContacts();
  els.contactCount.textContent = `${contacts.length}`;

  if (!contacts.length) {
    els.contactsList.innerHTML = `
      <article class="person-card">
        <div class="person-main">
          <div class="avatar">+</div>
          <div class="person-copy">
            <strong>No contacts yet</strong>
            <span>Search for a username to add them as a contact.</span>
          </div>
        </div>
      </article>
    `;
    return;
  }

  els.contactsList.innerHTML = contacts.map(userCardTemplate).join('');
}

function renderRequests() {
  const requests = sortedRequests();
  els.requestCount.textContent = `${requests.length}`;

  if (!requests.length) {
    els.requestsList.innerHTML = `
      <article class="person-card">
        <div class="person-main">
          <div class="avatar">!</div>
          <div class="person-copy">
            <strong>No requests right now</strong>
            <span>Incoming requests will appear here and must be accepted before you can chat or call.</span>
          </div>
        </div>
      </article>
    `;
    return;
  }

  els.requestsList.innerHTML = requests.map(userCardTemplate).join('');
}

function renderChats() {
  const chats = sortedChats();
  els.chatCount.textContent = `${chats.length}`;

  if (!chats.length) {
    els.chatsList.innerHTML = `
      <article class="person-card">
        <div class="person-main">
          <div class="avatar">#</div>
          <div class="person-copy">
            <strong>No chats yet</strong>
            <span>Accepted contacts will appear here so you can open chats.</span>
          </div>
        </div>
      </article>
    `;
    return;
  }

  els.chatsList.innerHTML = chats.map(userCardTemplate).join('');
}

function renderSearchResults() {
  const query = state.searchQuery.trim();
  const results = query ? sortedSearchResults() : [];
  els.searchCount.textContent = `${results.length}`;

  if (!query) {
    els.searchResults.innerHTML = `
      <article class="person-card">
        <div class="person-main">
          <div class="avatar">?</div>
          <div class="person-copy">
            <strong>Search to discover users</strong>
            <span>Type a username to look for accounts.</span>
          </div>
        </div>
      </article>
    `;
    return;
  }

  if (!results.length) {
    els.searchResults.innerHTML = `
      <article class="person-card">
        <div class="person-main">
          <div class="avatar">!</div>
          <div class="person-copy">
            <strong>No matches</strong>
            <span>Try another username or check the spelling.</span>
          </div>
        </div>
      </article>
    `;
    return;
  }

  els.searchResults.innerHTML = results.map(userCardTemplate).join('');
}

function syncSelectedFromLists() {
  if (!state.selectedUser) return;
  const found = lookupUser(state.selectedUser.key);
  if (found) {
    state.selectedUser = mergeUserProfiles(state.selectedUser, found);
  } else {
    state.selectedUser = {
      ...state.selectedUser,
      online: state.onlineUsers.has(state.selectedUser.key),
      relationship: 'none',
      isContact: false,
      chatRelationship: 'none',
      isChat: false,
    };
  }
}

function renderSelectedUser() {
  const user = state.selectedUser;
  if (!user) {
    els.workspaceEmpty.hidden = false;
    els.contactPanel.hidden = true;
    closeChatPanel();
    return;
  }

  els.workspaceEmpty.hidden = true;
  els.contactPanel.hidden = false;
  const relationship = currentRelationship(user);
  const chatRelationship = currentChatRelationship(user);
  const hasContact = relationship === 'contact';
  const hasIncomingContact = relationship === 'incoming';
  const hasOutgoingContact = relationship === 'outgoing';
  const hasChat = chatRelationship === 'chat';
  const hasIncomingChat = chatRelationship === 'incoming';
  const hasOutgoingChat = chatRelationship === 'outgoing';
  const statusBits = [user.online ? 'Online now' : 'Offline'];
  if (relationship !== 'none') {
    statusBits.push(relationshipLabel(relationship));
  }
  if (chatRelationship !== 'none') {
    statusBits.push(chatRelationshipLabel(chatRelationship));
  }
  if (user.statusText) {
    statusBits.push(user.statusText);
  }
  if (!user.online && user.lastSeenAt) {
    statusBits.push(formatLastSeen(user.lastSeenAt));
  }

  applyAvatarElement(els.selectedAvatar, user);
  els.selectedName.textContent = usernameLabel(user.username);
  els.selectedStatus.textContent = statusBits.join(' | ');
  els.selectedStatus.className = `status-line ${user.online ? 'online' : 'offline'}`;

  configureButton(els.selectedChatAction, { hidden: false, disabled: false });
  configureButton(els.selectedLeaveChat, { hidden: true, disabled: false });
  configureButton(els.selectedAudioCall, { hidden: true, disabled: false });
  configureButton(els.selectedVideoCall, { hidden: true, disabled: false });
  configureButton(els.selectedRemove, { hidden: true, disabled: false });

  if (hasContact) {
    configureButton(els.selectedChatAction, { text: 'Open chat', className: 'primary-btn' });
    configureButton(els.selectedLeaveChat, { hidden: false, text: 'Leave chat', className: 'danger-btn' });
  } else if (hasIncomingContact) {
    configureButton(els.selectedChatAction, { text: 'Accept contact', className: 'primary-btn' });
    configureButton(els.selectedLeaveChat, { hidden: false, text: 'Reject request', className: 'danger-btn' });
  } else if (hasOutgoingContact) {
    configureButton(els.selectedChatAction, { text: 'Cancel request', className: 'danger-btn' });
  } else if (hasChat) {
    configureButton(els.selectedChatAction, { text: 'Open chat', className: 'primary-btn' });
    configureButton(els.selectedLeaveChat, { hidden: false, text: 'Leave chat', className: 'danger-btn' });
  } else if (hasIncomingChat) {
    configureButton(els.selectedChatAction, { text: 'Accept chat', className: 'primary-btn' });
    if (!hasContact && !hasIncomingContact && !hasOutgoingContact) {
      configureButton(els.selectedAudioCall, { hidden: false, text: 'Reject chat', className: 'danger-btn' });
    }
  } else if (hasOutgoingChat) {
    configureButton(els.selectedChatAction, { text: 'Cancel chat', className: 'danger-btn' });
  } else {
    configureButton(els.selectedChatAction, { text: 'Add as contact', className: 'primary-btn' });
  }

  if (hasContact) {
    configureButton(els.selectedAudioCall, { hidden: false, text: 'Audio call', className: 'primary-btn' });
    configureButton(els.selectedVideoCall, { hidden: false, text: 'Video call', className: 'secondary-btn' });
    configureButton(els.selectedRemove, { hidden: false, text: 'Remove contact', className: 'danger-btn' });
  } else if (hasIncomingContact) {
    configureButton(els.selectedAudioCall, { hidden: true });
    configureButton(els.selectedVideoCall, { hidden: true });
    configureButton(els.selectedRemove, { hidden: true });
  } else if (hasOutgoingContact) {
    configureButton(els.selectedAudioCall, { hidden: true });
    configureButton(els.selectedVideoCall, { hidden: true });
    configureButton(els.selectedRemove, { hidden: true });
  }

  let noteHtml;
  if (hasContact) {
    noteHtml = '<p>This profile is in your contacts. Use the panel below for chat, voice calls, or video calls. You can leave the chat view whenever you want.</p>';
  } else if (hasChat) {
    noteHtml = '<p>Chat is ready. Open the panel below to send text, PDFs, photos, and videos, or leave the chat to exit it.</p>';
  } else if (hasIncomingContact) {
    noteHtml = '<p>This user wants to add you as a contact. Accept or reject the request to decide whether chat, voice calls, and video calls become available.</p>';
  } else if (hasOutgoingContact) {
    noteHtml = '<p>Your contact request is waiting for the other person to accept. Once they do, chat, voice calls, and video calls will be available.</p>';
  } else if (hasIncomingChat) {
    noteHtml = '<p>This user wants to chat. Accept it to open the conversation and start sending messages.</p>';
  } else if (hasOutgoingChat) {
    noteHtml = '<p>Your request is waiting for the other person to accept.</p>';
  } else {
    noteHtml = '<p>Send a contact request first. Once the other user accepts, chat, voice calls, and video calls become available.</p>';
  }

  const profileNoteParts = [];
  if (user.statusText) {
    profileNoteParts.push(`<p class="profile-status">${escapeHtml(user.statusText)}</p>`);
  }
  if (user.bio) {
    profileNoteParts.push(`<p class="profile-bio">${escapeHtml(user.bio)}</p>`);
  }
  profileNoteParts.push(noteHtml);
  els.selectedNote.innerHTML = profileNoteParts.join('');

  renderChatPanel();
}

function renderApp() {
  if (!state.me) return;
  renderSelfSummary();
  syncSelectedFromLists();
  renderContacts();
  renderRequests();
  renderChats();
  renderSearchResults();
  renderSelectedUser();
  void ensureChatOpenForSelectedUser();
}

function renderSelfSummary() {
  if (!state.me) return;

  const meProfile = mergeUserProfiles(state.me);
  applyAvatarElement(els.meAvatar, meProfile);
  els.meName.textContent = meProfile.username;
  if (els.meStatus) {
    const statusBits = [meProfile.statusText || 'Available on WhatsCall'];
    if (!meProfile.online) {
      statusBits.push(formatLastSeen(meProfile.lastSeenAt));
    }
    els.meStatus.textContent = statusBits.join(' | ');
    els.meStatus.className = `status-line ${meProfile.online ? 'online' : 'offline'}`;
  }
  if (els.meBio) {
    els.meBio.textContent = meProfile.bio || 'Add a bio and status from Edit profile.';
  }
}

function updateProfileModalPreview() {
  if (!els.profileModal || els.profileModal.hidden) return;

  const previewProfile = {
    username: state.me?.username || 'Profile',
    profilePhotoUrl: els.profileRemovePhotoFlag?.value === '1' ? '' : profilePhotoUrl(state.me),
  };

  if (els.profilePhotoInput?.files?.[0]) {
    const file = els.profilePhotoInput.files[0];
    try {
      previewProfile.profilePhotoUrl = URL.createObjectURL(file);
    } catch {
      previewProfile.profilePhotoUrl = '';
    }
  }

  applyAvatarElement(els.profilePhotoPreview, previewProfile);
  if (els.profilePreviewName) {
    els.profilePreviewName.textContent = state.me?.username || 'Profile';
  }

  if (els.profilePreviewText) {
    const statusText = String(els.profileStatusInput?.value || '').trim() || 'Available on WhatsCall';
    const bioText = String(els.profileBioInput?.value || '').trim();
    els.profilePreviewText.textContent = bioText ? `${statusText} | ${bioText}` : statusText;
  }
}

function openProfileModal() {
  if (!els.profileModal || !state.me) return;
  if (els.profileStatusInput) {
    els.profileStatusInput.value = state.me.statusText || 'Available on WhatsCall';
  }
  if (els.profileBioInput) {
    els.profileBioInput.value = state.me.bio || '';
  }
  if (els.profilePhotoInput) {
    els.profilePhotoInput.value = '';
  }
  if (els.profileRemovePhotoFlag) {
    els.profileRemovePhotoFlag.value = '0';
  }
  if (els.profileStatusMessage) {
    els.profileStatusMessage.textContent = '';
  }
  updateProfileModalPreview();
  els.profileModal.hidden = false;
}

function closeProfileModal() {
  if (!els.profileModal) return;
  els.profileModal.hidden = true;
  if (els.profilePhotoInput) {
    els.profilePhotoInput.value = '';
  }
  if (els.profileRemovePhotoFlag) {
    els.profileRemovePhotoFlag.value = '0';
  }
  if (els.profileStatusMessage) {
    els.profileStatusMessage.textContent = '';
  }
}

async function submitProfileSettings(event) {
  event.preventDefault();
  if (!state.me) return;

  try {
    if (els.saveProfileBtn) {
      els.saveProfileBtn.disabled = true;
    }
    if (els.profileStatusMessage) {
      els.profileStatusMessage.textContent = 'Saving profile...';
      els.profileStatusMessage.style.color = 'var(--muted)';
    }

    const formData = new FormData();
    formData.append('statusText', String(els.profileStatusInput?.value || ''));
    formData.append('bio', String(els.profileBioInput?.value || ''));
    formData.append('removePhoto', String(els.profileRemovePhotoFlag?.value || '0'));
    const file = els.profilePhotoInput?.files?.[0];
    if (file) {
      formData.append('photo', file, file.name);
    }

    const data = await apiFetch('/api/me/profile', {
      method: 'POST',
      body: formData,
    });

    if (data.user) {
      setProfile(data.user);
    }
    closeProfileModal();
    renderApp();
    showToast('Profile updated.', 'success');
  } catch (error) {
    if (els.profileStatusMessage) {
      els.profileStatusMessage.textContent = error.message || 'Could not update your profile.';
      els.profileStatusMessage.style.color = '#ffb4c0';
    }
  } finally {
    if (els.saveProfileBtn) {
      els.saveProfileBtn.disabled = false;
    }
  }
}

function configureButton(button, options = {}) {
  if (!button) return;
  if (Object.prototype.hasOwnProperty.call(options, 'hidden')) {
    button.hidden = Boolean(options.hidden);
  }
  if (Object.prototype.hasOwnProperty.call(options, 'text')) {
    button.textContent = options.text;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'className')) {
    button.className = options.className;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'disabled')) {
    button.disabled = Boolean(options.disabled);
  }
}

function setProfile(profile) {
  state.me = profile;
  state.contacts = Array.isArray(profile.contacts) ? profile.contacts : [];
  state.incomingRequests = Array.isArray(profile.requests?.incoming) ? profile.requests.incoming : [];
  state.outgoingRequests = Array.isArray(profile.requests?.outgoing) ? profile.requests.outgoing : [];
  state.chats = Array.isArray(profile.chats) ? profile.chats : [];
  state.incomingChatRequests = Array.isArray(profile.chatRequests?.incoming) ? profile.chatRequests.incoming : [];
  state.outgoingChatRequests = Array.isArray(profile.chatRequests?.outgoing) ? profile.chatRequests.outgoing : [];
  if (!state.selectedUser) {
    const firstSelection =
      state.chats[0] || state.contacts[0] || state.incomingRequests[0] || state.outgoingRequests[0] || state.incomingChatRequests[0] || state.outgoingChatRequests[0] || null;
    if (firstSelection) {
      state.selectedUser = { ...firstSelection };
    }
  }
  if (state.selectedUser) {
    syncSelectedFromLists();
  }
  updateVisibility();
  renderApp();
}

function disconnectSocket() {
  if (!state.socket) return;
  state.socket.removeAllListeners();
  state.socket.disconnect();
  state.socket = null;
}

function clearSession() {
  clearInterval(state.callTimer);
  state.callTimer = null;
  const previousChatKey = state.activeChatKey;
  state.token = '';
  localStorage.removeItem('whatscall-token');
  state.me = null;
  state.contacts = [];
  state.incomingRequests = [];
  state.outgoingRequests = [];
  state.chats = [];
  state.incomingChatRequests = [];
  state.outgoingChatRequests = [];
  state.searchQuery = '';
  state.searchResults = [];
  state.selectedUser = null;
  state.activeChatKey = null;
  state.chatThread = null;
  state.chatDraftText = '';
  state.chatDraftFiles = [];
  state.chatLoading = false;
  state.chatSuppressedForKey = null;
  state.onlineUsers = new Set();
  state.presenceByKey = new Map();
  state.chatTypingPeerKey = null;
  state.chatTypingPeerActive = false;
  clearTimeout(state.chatTypingTimer);
  state.chatTypingTimer = null;
  state.incomingCall = null;
  state.activeCall = null;
  state.callController = null;
  clearTypingBroadcast(previousChatKey);
  els.searchInput.value = '';
  els.incomingModal.hidden = true;
  if (els.deleteAccountModal) {
    els.deleteAccountModal.hidden = true;
  }
  if (els.profileModal) {
    els.profileModal.hidden = true;
  }
  if (els.deleteAccountStatus) {
    els.deleteAccountStatus.textContent = '';
  }
  if (els.profileStatusMessage) {
    els.profileStatusMessage.textContent = '';
  }
  if (els.deleteAccountPassword) {
    els.deleteAccountPassword.value = '';
  }
  if (els.profilePhotoInput) {
    els.profilePhotoInput.value = '';
  }
  if (els.profileRemovePhotoFlag) {
    els.profileRemovePhotoFlag.value = '0';
  }
  els.activeCallModal.hidden = true;
  els.remoteVideo.srcObject = null;
  els.localVideo.srcObject = null;
  els.voiceOverlay.hidden = false;
  if (els.chatPanel) {
    els.chatPanel.hidden = true;
  }
  if (els.chatInput) {
    els.chatInput.value = '';
  }
  if (els.chatFileInput) {
    els.chatFileInput.value = '';
  }
  if (els.chatFilePreview) {
    els.chatFilePreview.innerHTML = '';
  }
  if (els.chatMessages) {
    els.chatMessages.innerHTML = '';
  }
  if (els.chatEmpty) {
    els.chatEmpty.hidden = false;
  }
  disconnectSocket();
  updateVisibility();
  renderSearchResults();
  renderRequests();
  renderChats();
  renderContacts();
  renderSelectedUser();
}

function openDeleteAccountModal() {
  if (!els.deleteAccountModal) return;
  if (els.deleteAccountStatus) els.deleteAccountStatus.textContent = '';
  if (els.deleteAccountPassword) els.deleteAccountPassword.value = '';
  els.deleteAccountModal.hidden = false;
  els.deleteAccountPassword?.focus();
}

function closeDeleteAccountModal() {
  if (!els.deleteAccountModal) return;
  els.deleteAccountModal.hidden = true;
  if (els.deleteAccountStatus) els.deleteAccountStatus.textContent = '';
  if (els.deleteAccountPassword) els.deleteAccountPassword.value = '';
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatChatTime(value) {
  const date = new Date(value || Date.now());
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function closeChatPanel() {
  const previousChatKey = state.activeChatKey;
  state.chatSuppressedForKey = state.selectedUser?.key || previousChatKey || null;
  state.activeChatKey = null;
  state.chatThread = null;
  state.chatLoading = false;
  state.chatTypingPeerActive = false;
  state.chatTypingPeerKey = null;
  clearTimeout(state.chatTypingTimer);
  state.chatTypingTimer = null;
  if (els.chatPanel) {
    els.chatPanel.hidden = true;
  }
  if (els.chatMessages) {
    els.chatMessages.innerHTML = '';
  }
  if (els.chatEmpty) {
    els.chatEmpty.hidden = false;
  }
  if (els.chatPeerName) {
    els.chatPeerName.textContent = '---';
  }
  if (els.chatPeerStatus) {
    els.chatPeerStatus.textContent = 'Waiting for acceptance.';
  }
  clearTypingBroadcast(previousChatKey);
}

function applyRemovedConversationState(peerProfile) {
  const profile = peerProfile ? mergeUserProfiles(peerProfile) || peerProfile : null;
  const peerKey = profile?.key || null;
  if (!peerKey) return;

  const selectedKey = state.selectedUser?.key || null;
  const activeKey = state.activeChatKey || null;
  const isAffected = selectedKey === peerKey || activeKey === peerKey;

  if (activeKey === peerKey) {
    closeChatPanel();
  }

  if (isAffected) {
    state.selectedUser = {
      ...(profile || state.selectedUser || {}),
      key: peerKey,
      username: profile?.username || state.selectedUser?.username || peerKey,
      relationship: 'none',
      chatRelationship: 'none',
      isContact: false,
      isChat: false,
      unreadCount: 0,
      lastMessageAt: 0,
      lastMessagePreview: '',
      lastReadAt: 0,
    };
  }
}

function renderChatDraftFiles() {
  if (!els.chatFilePreview) return;
  if (!state.chatDraftFiles.length) {
    els.chatFilePreview.innerHTML = '';
    return;
  }

  els.chatFilePreview.innerHTML = state.chatDraftFiles
    .map(
      (file, index) => `
        <div class="chat-file-chip" data-file-index="${index}">
          <span>${escapeHtml(file.name)} &middot; ${escapeHtml(formatFileSize(file.size))}</span>
          <button type="button" data-action="remove-chat-file" data-file-index="${index}" aria-label="Remove file">&times;</button>
        </div>
      `,
    )
    .join('');
}

function removeChatDraftFile(index) {
  const fileIndex = Number(index);
  if (!Number.isFinite(fileIndex) || fileIndex < 0 || fileIndex >= state.chatDraftFiles.length) {
    return;
  }

  state.chatDraftFiles = state.chatDraftFiles.filter((_, currentIndex) => currentIndex !== fileIndex);
  renderChatDraftFiles();
}

function clearChatDraftFiles() {
  state.chatDraftFiles = [];
  if (els.chatFileInput) {
    els.chatFileInput.value = '';
  }
  renderChatDraftFiles();
}

function renderChatAttachment(attachment) {
  if (!attachment) return '';
  const url = escapeHtml(attachment.url || '');
  const name = escapeHtml(attachment.name || 'file');
  const kind = attachment.kind || 'file';
  const mimeType = escapeHtml(attachment.mimeType || 'application/octet-stream');

  if (kind === 'image') {
    return `
      <div class="chat-attachment">
        <a class="chat-attachment-preview" href="${url}" target="_blank" rel="noreferrer">
          <img src="${url}" alt="${name}" loading="lazy" />
        </a>
        <div class="chat-attachment-card">
          <div>
            <strong>${name}</strong>
            <small>${mimeType} · ${escapeHtml(formatFileSize(attachment.size))}</small>
          </div>
          <div class="chat-attachment-actions">
            <a href="${url}" download="${name}">Download</a>
          </div>
        </div>
      </div>
    `;
  }

  if (kind === 'video') {
    return `
      <div class="chat-attachment">
        <video controls playsinline preload="metadata" src="${url}"></video>
        <div class="chat-attachment-card">
          <div>
            <strong>${name}</strong>
            <small>${mimeType} · ${escapeHtml(formatFileSize(attachment.size))}</small>
          </div>
          <div class="chat-attachment-actions">
            <a href="${url}" download="${name}">Download</a>
          </div>
        </div>
      </div>
    `;
  }

  if (kind === 'pdf') {
    return `
      <div class="chat-attachment">
        <iframe src="${url}" title="${name}"></iframe>
        <div class="chat-attachment-card">
          <div>
            <strong>${name}</strong>
            <small>${mimeType} · ${escapeHtml(formatFileSize(attachment.size))}</small>
          </div>
          <div class="chat-attachment-actions">
            <a href="${url}" target="_blank" rel="noreferrer">Open PDF</a>
            <a href="${url}" download="${name}">Download</a>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="chat-attachment-card">
      <div>
        <strong>${name}</strong>
        <small>${mimeType} · ${escapeHtml(formatFileSize(attachment.size))}</small>
      </div>
      <div class="chat-attachment-actions">
        <a href="${url}" download="${name}">Download</a>
      </div>
    </div>
  `;
}

function renderChatMessage(message) {
  const time = formatChatTime(message.createdAt);
  const attachments = Array.isArray(message.attachments) ? message.attachments.map(renderChatAttachment).join('') : '';
  const senderLabel = message.isMine ? 'You' : escapeHtml(message.senderName || 'Them');
  const receiptLabel = message.isMine ? (message.receipt === 'read' ? 'Read' : 'Sent') : '';

  return `
    <article class="chat-message ${message.isMine ? 'mine' : ''}" data-message-id="${escapeHtml(message.id)}">
      <div class="chat-bubble">
        ${message.text ? `<div class="chat-text">${escapeHtml(message.text)}</div>` : ''}
        ${attachments ? `<div class="chat-attachments">${attachments}</div>` : ''}
        <div class="chat-meta">
          <span>${senderLabel}</span>
          <span>${time}</span>
          ${message.isMine ? `<span class="chat-receipt ${escapeHtml(message.receipt || 'sent')}">${receiptLabel}</span>` : ''}
          ${message.isMine ? `<button type="button" class="chat-delete-btn" data-action="delete-chat-message" data-message-id="${escapeHtml(message.id)}">Delete</button>` : ''}
        </div>
      </div>
    </article>
  `;
}

function syncChatDraftInputs() {
  if (els.chatInput && els.chatInput.value !== state.chatDraftText) {
    els.chatInput.value = state.chatDraftText;
  }
  renderChatDraftFiles();
}

function renderChatPanel() {
  const selected = state.selectedUser ? mergeUserProfiles(state.selectedUser) : null;
  const canChat = Boolean(selected && state.activeChatKey && selected.key === state.activeChatKey && currentChatRelationship(selected) === 'chat');

  if (!els.chatPanel) return;

  if (!canChat) {
    els.chatPanel.hidden = true;
    if (!state.chatLoading) {
      els.chatMessages.innerHTML = '';
      els.chatEmpty.hidden = false;
    }
    return;
  }

  els.chatPanel.hidden = false;
  els.chatPeerName.textContent = selected.username;
  const typingActive = state.chatTypingPeerActive && state.chatTypingPeerKey === selected.key;
  const presenceText = selected.online ? 'Online now' : formatLastSeen(selected.lastSeenAt);
  if (typingActive) {
    els.chatPeerStatus.textContent = '...';
    els.chatPeerStatus.className = 'status-line typing';
  } else {
    const statusParts = [presenceText];
    if (selected.statusText) {
      statusParts.push(selected.statusText);
    }
    statusParts.push(selected.isContact ? 'Contact' : 'Chat only');
    els.chatPeerStatus.textContent = statusParts.join(' | ');
    els.chatPeerStatus.className = `status-line ${selected.online ? 'online' : 'offline'}`;
  }
  els.chatEmpty.hidden = state.chatLoading || Boolean(state.chatThread?.messages?.length);
  els.chatEmpty.textContent = state.chatLoading
    ? 'Loading chat...'
    : 'Open a chat to start sending messages, PDFs, pictures, and videos.';
  syncChatDraftInputs();
  els.chatForm.hidden = state.chatLoading;
  if (els.chatInput) {
    els.chatInput.disabled = state.chatLoading;
  }
  if (els.chatFileInput) {
    els.chatFileInput.disabled = state.chatLoading;
  }
  if (els.sendChatMessage) {
    els.sendChatMessage.disabled = state.chatLoading;
  }
  if (els.clearChatFiles) {
    els.clearChatFiles.disabled = state.chatLoading;
  }

  if (!state.chatThread || !Array.isArray(state.chatThread.messages) || !state.chatThread.messages.length) {
    els.chatMessages.innerHTML = '';
    return;
  }

  els.chatMessages.innerHTML = state.chatThread.messages.map(renderChatMessage).join('');
  queueMicrotask(() => {
    if (els.chatMessages) {
      els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    }
  });
}

function upsertChatMessage(message) {
  const clean = message && typeof message === 'object' ? message : null;
  if (!clean) return;

  if (!state.chatThread) {
    state.chatThread = {
      threadId: clean.threadId || null,
      participants: [],
      messages: [],
      createdAt: clean.createdAt || Date.now(),
      updatedAt: clean.createdAt || Date.now(),
    };
  }

  if (!Array.isArray(state.chatThread.messages)) {
    state.chatThread.messages = [];
  }

  const index = state.chatThread.messages.findIndex((entry) => entry.id === clean.id);
  const normalized = {
    ...clean,
    attachments: Array.isArray(clean.attachments) ? clean.attachments : [],
  };

  if (index >= 0) {
    state.chatThread.messages[index] = normalized;
  } else {
    state.chatThread.messages.push(normalized);
  }

  state.chatThread.updatedAt = normalized.createdAt || Date.now();
  renderChatPanel();
}

function clearTypingBroadcast(targetKey = state.activeChatKey) {
  clearTimeout(state.typingBroadcastTimer);
  state.typingBroadcastTimer = null;
  if (state.socket && targetKey) {
    state.socket.emit('chat:typing', {
      to: targetKey,
      isTyping: false,
    });
  }
}

function broadcastTypingState() {
  clearTimeout(state.typingBroadcastTimer);
  if (!state.socket || !state.activeChatKey) {
    return;
  }

  state.socket.emit('chat:typing', {
    to: state.activeChatKey,
    isTyping: true,
  });

  state.typingBroadcastTimer = setTimeout(() => {
    clearTypingBroadcast();
  }, 1400);
}

async function markChatAsRead(targetKey, readAt = Date.now(), options = {}) {
  if (!state.socket || !targetKey) return;

  const selected = lookupUser(targetKey) || state.selectedUser;
  if (!selected || currentChatRelationship(selected) !== 'chat') {
    return;
  }

  try {
    const data = await emitWithAck('chat:read', {
      to: selected.key,
      readAt,
    });

    if (data.user) {
      setProfile(data.user);
      renderSelfSummary();
      renderChats();
    }

    if (data.thread && state.activeChatKey === selected.key) {
      state.chatThread = data.thread;
      renderChatPanel();
    }

    if (!options.silent) {
      renderApp();
    }
  } catch {
    // Ignore read-receipt errors; the chat can still function.
  }
}

function handleChatMessageClick(event) {
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) return;

  if (actionNode.dataset.action !== 'delete-chat-message') {
    return;
  }

  const messageId = actionNode.dataset.messageId || actionNode.closest('[data-message-id]')?.dataset.messageId;
  if (!messageId) return;
  void deleteChatMessage(messageId);
}

function asyncOpenChat(profile) {
  return openChat(profile);
}

async function openChat(profileOrKey, options = {}) {
  const profile =
    typeof profileOrKey === 'string'
      ? lookupUser(profileOrKey) || (state.selectedUser?.key === profileOrKey ? state.selectedUser : null)
      : profileOrKey;

  if (!profile) return;

  const relationship = currentChatRelationship(profile);
  if (relationship !== 'chat') {
    if (!options.silent) {
      showToast('Accept the request first.', 'error');
    }
    return;
  }

  state.activeChatKey = profile.key;
  state.chatLoading = true;
  renderChatPanel();

  const requestId = ++state.chatLoadRequestId;
  try {
    const data = await apiFetch(`/api/chats/${encodeURIComponent(profile.key)}`);
    if (requestId !== state.chatLoadRequestId || state.activeChatKey !== profile.key) {
      return;
    }

    state.chatThread = data.thread || {
      threadId: null,
      participants: [],
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.chatLoading = false;
    renderChatPanel();
    const latestMessage = state.chatThread?.messages?.[state.chatThread.messages.length - 1] || null;
    if (latestMessage) {
      void markChatAsRead(profile.key, latestMessage.createdAt || Date.now(), { silent: true });
    }
  } catch (error) {
    if (requestId !== state.chatLoadRequestId) {
      return;
    }

    state.chatLoading = false;
    closeChatPanel();
    if (!options.silent) {
      showToast(error.message || 'Could not open chat.', 'error');
    }
  }
}

async function ensureChatOpenForSelectedUser() {
  const selected = state.selectedUser ? mergeUserProfiles(state.selectedUser) : null;
  if (!selected || currentChatRelationship(selected) !== 'chat') {
    if (state.activeChatKey) {
      closeChatPanel();
    }
    return;
  }

  if (state.chatSuppressedForKey === selected.key) {
    renderChatPanel();
    return;
  }

  if (state.activeChatKey !== selected.key || !state.chatThread) {
    await openChat(selected, { silent: true });
    return;
  }

  renderChatPanel();
}

async function submitChatMessage(event) {
  event.preventDefault();
  const targetKey = state.activeChatKey || state.selectedUser?.key;
  const selected = targetKey ? lookupUser(targetKey) : null;

  if (!selected || currentChatRelationship(selected) !== 'chat') {
    showToast('Accept the chat first.', 'error');
    return;
  }

  const text = String(state.chatDraftText || els.chatInput?.value || '').trim();
  const files = Array.isArray(state.chatDraftFiles) ? state.chatDraftFiles : [];

  if (!text && !files.length) {
    showToast('Type a message or attach a file.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('text', text);
  for (const file of files) {
    formData.append('files', file, file.name);
  }

  try {
    if (els.sendChatMessage) {
      els.sendChatMessage.disabled = true;
    }

    const data = await apiFetch(`/api/chats/${encodeURIComponent(selected.key)}/messages`, {
      method: 'POST',
      body: formData,
    });

    if (data.thread) {
      state.chatThread = data.thread;
    }
    if (data.message) {
      upsertChatMessage(data.message);
    } else {
      renderChatPanel();
    }

    state.chatDraftText = '';
    state.chatDraftFiles = [];
    if (els.chatInput) {
      els.chatInput.value = '';
    }
    if (els.chatFileInput) {
      els.chatFileInput.value = '';
    }
    renderChatDraftFiles();
    renderChatPanel();
    clearTypingBroadcast();
  } catch (error) {
    showToast(error.message || 'Could not send your message.', 'error');
  } finally {
    if (els.sendChatMessage) {
      els.sendChatMessage.disabled = false;
    }
  }
}

async function deleteChatMessage(messageId) {
  const targetKey = state.activeChatKey || state.selectedUser?.key;
  const selected = targetKey ? lookupUser(targetKey) : null;
  const message = state.chatThread?.messages?.find((entry) => entry?.id === messageId) || null;

  if (!selected || currentChatRelationship(selected) !== 'chat') {
    showToast('Open a chat first.', 'error');
    return;
  }

  if (!message || !message.isMine) {
    showToast('You can only delete your own messages.', 'error');
    return;
  }

  if (typeof window.confirm === 'function' && !window.confirm('Delete this message?')) {
    return;
  }

  try {
    const data = await apiFetch(`/api/chats/${encodeURIComponent(selected.key)}/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
    });

    if (data.thread) {
      state.chatThread = data.thread;
    } else if (state.chatThread?.messages) {
      state.chatThread.messages = state.chatThread.messages.filter((entry) => entry.id !== messageId);
    }

    renderChatPanel();
    showToast('Message deleted.', 'success');
  } catch (error) {
    showToast(error.message || 'Could not delete the message.', 'error');
  }
}

async function submitDeleteAccount(event) {
  event.preventDefault();
  if (!state.me) return;

  const password = String(els.deleteAccountPassword?.value || '').trim();
  if (!/^\d{8}$/.test(password)) {
    if (els.deleteAccountStatus) {
      els.deleteAccountStatus.textContent = 'Enter the 8-digit password for this account.';
      els.deleteAccountStatus.style.color = '#ffb4c0';
    }
    return;
  }

  try {
    if (els.confirmDeleteAccount) {
      els.confirmDeleteAccount.disabled = true;
    }
    if (els.deleteAccountStatus) {
      els.deleteAccountStatus.textContent = 'Deleting account...';
      els.deleteAccountStatus.style.color = 'var(--muted)';
    }

    const data = await apiFetch('/api/account/delete', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });

    cleanupCall(false);
    closeDeleteAccountModal();
    clearSession();
    setAuthMode('login');
    setAuthStatus('Your account was deleted forever.', 'info');
    showToast(`${data.deleted?.username || 'Your account'} was deleted forever.`, 'success');
  } catch (error) {
    if (String(error.message || '').includes('Please sign in again')) {
      clearSession();
      return;
    }

    if (els.deleteAccountStatus) {
      els.deleteAccountStatus.textContent = error.message || 'Could not delete your account.';
      els.deleteAccountStatus.style.color = '#ffb4c0';
    }
  } finally {
    if (els.confirmDeleteAccount) {
      els.confirmDeleteAccount.disabled = false;
    }
  }
}

function emitWithAck(event, payload) {
  return new Promise((resolve, reject) => {
    if (!state.socket) {
      reject(new Error('You are offline.'));
      return;
    }
    state.socket.emit(event, payload, (response) => resolve(response || {}));
  });
}

function connectSocket() {
  disconnectSocket();
  if (!state.token) return;

  state.socket = io({
    auth: { token: state.token },
  });

  state.socket.on('presence:update', (payload) => {
    updatePresenceState(payload);
    renderContacts();
    renderRequests();
    renderSearchResults();
    syncSelectedFromLists();
    renderSelfSummary();
    renderSelectedUser();
  });

  state.socket.on('profile:update', async () => {
    await refreshProfileAndSearch();
  });

  state.socket.on('contact:request', async (payload) => {
    showToast(`${payload.fromName || 'Someone'} sent you a contact request.`, 'info');
    await refreshProfileAndSearch();
  });

  state.socket.on('contact:accepted', async (payload) => {
    showToast(`${payload.byName || 'Someone'} accepted your contact request.`, 'success');
    await refreshProfileAndSearch();
  });

  state.socket.on('contact:rejected', async (payload) => {
    showToast(`${payload.byName || 'Someone'} rejected your contact request.`, 'info');
    await refreshProfileAndSearch();
  });

  state.socket.on('contact:removed', async (payload) => {
    if (payload?.chatDeleted) {
      applyRemovedConversationState(payload.peer || { key: payload.byKey, username: payload.byName || 'Someone' });
    }
    const relationText =
      payload.relationship === 'contact'
        ? payload.chatDeleted
          ? 'removed you from contacts and deleted the chat'
          : 'removed you from contacts'
        : payload.relationship === 'incoming'
          ? 'rejected your contact request'
          : 'cancelled a contact request';
    showToast(`${payload.byName || 'Someone'} ${relationText}.`, 'info');
    await refreshProfileAndSearch();
  });

  state.socket.on('account:deleted', async (payload) => {
    showToast(`${payload.byName || 'Someone'} deleted their account.`, 'info');
    await refreshProfileAndSearch();
  });

  state.socket.on('chat:request', async (payload) => {
    showToast(`${payload.fromName || 'Someone'} sent you a request.`, 'info');
    await refreshProfileAndSearch();
  });

  state.socket.on('chat:accepted', async (payload) => {
    showToast(`${payload.byName || 'Someone'} accepted your request.`, 'success');
    await refreshProfileAndSearch();
  });

  state.socket.on('chat:rejected', async (payload) => {
    showToast(`${payload.byName || 'Someone'} rejected your request.`, 'info');
    await refreshProfileAndSearch();
  });

  state.socket.on('chat:removed', async (payload) => {
    const relationText =
      payload.relationship === 'chat'
        ? 'removed you from chats'
        : payload.relationship === 'incoming'
          ? 'rejected your request'
          : 'cancelled a request';
    showToast(`${payload.byName || 'Someone'} ${relationText}.`, 'info');
    await refreshProfileAndSearch();
  });

  state.socket.on('chat:deleted', async (payload) => {
    showToast(`${payload.byName || 'Someone'} deleted their account.`, 'info');
    await refreshProfileAndSearch();
  });

  state.socket.on('chat:message', async (payload) => {
    if (!payload || !payload.message) return;

    const peerKey = payload.peerKey || null;
    const isActiveChat = Boolean(peerKey && state.activeChatKey === peerKey);
    const activeProfile = isActiveChat ? lookupUser(peerKey) || state.selectedUser : null;

    if (isActiveChat && activeProfile && currentChatRelationship(activeProfile) === 'chat') {
      if (payload.threadId && state.chatThread && !state.chatThread.threadId) {
        state.chatThread.threadId = payload.threadId;
      }
      upsertChatMessage(payload.message);
      void markChatAsRead(peerKey, payload.message.createdAt || Date.now(), { silent: true });
      return;
    }

    showToast(`${payload.peerName || 'Someone'} sent you a new message.`, 'info');
    await refreshProfileAndSearch();
  });

  state.socket.on('chat:message-deleted', async (payload) => {
    if (!payload) return;

    const peerKey = payload.peerKey || null;
    const isActiveChat = Boolean(peerKey && state.activeChatKey === peerKey);

    if (isActiveChat && payload.thread) {
      state.chatThread = payload.thread;
      renderChatPanel();
    }

    if (payload.byKey !== state.me?.key) {
      showToast(`${payload.peerName || 'Someone'} deleted a message.`, 'info');
    }
  });

  state.socket.on('chat:typing', (payload) => {
    const peerKey = payload?.fromKey || null;
    const isActiveChat = Boolean(peerKey && state.activeChatKey === peerKey);
    if (!isActiveChat) return;

    clearTimeout(state.chatTypingTimer);
    state.chatTypingPeerKey = peerKey;
    state.chatTypingPeerActive = Boolean(payload.isTyping);
    if (payload.isTyping) {
      state.chatTypingTimer = setTimeout(() => {
        state.chatTypingPeerActive = false;
        renderChatPanel();
      }, 1600);
    }
    renderChatPanel();
  });

  state.socket.on('chat:read', async (payload) => {
    if (!payload) return;
    const peerKey = payload.byKey || null;
    const isActiveChat = Boolean(peerKey && state.activeChatKey === peerKey);
    if (isActiveChat && payload.thread) {
      state.chatThread = payload.thread;
      renderChatPanel();
    }
    if (payload.user && payload.user.key === state.me?.key) {
      setProfile(payload.user);
      renderSelfSummary();
      renderChats();
    } else {
      await refreshProfileAndSearch();
    }
  });

  state.socket.on('call:incoming', (payload) => {
    if (state.activeCall || state.incomingCall) {
      state.socket.emit('call:response', { callId: payload.callId, accepted: false });
      return;
    }
    state.incomingCall = payload;
    showIncomingCall();
  });

  state.socket.on('call:accepted', async (payload) => {
    if (!state.callController || state.callController.callId !== payload.callId) return;
    try {
      if (!payload.answer) throw new Error('Missing call answer.');
      await state.callController.peerConnection.setRemoteDescription(payload.answer);
      await flushPendingCandidates();
      setCallConnected(payload.startedAt || Date.now(), payload.byName);
    } catch {
      showToast('The call connected, but the session could not be finalized.', 'error');
    }
  });

  state.socket.on('call:started', (payload) => {
    if (!state.callController || state.callController.callId !== payload.callId) return;
    setCallConnected(payload.startedAt || Date.now(), payload.peerName || state.callController.targetName);
  });

  state.socket.on('call:rejected', (payload) => {
    if (!state.callController || state.callController.callId !== payload.callId) return;
    showToast('The call was declined.', 'error');
    cleanupCall(false);
  });

  state.socket.on('call:ended', (payload) => {
    if (!state.callController || state.callController.callId !== payload.callId) return;
    const durationMs = Number.isFinite(payload.durationMs) ? payload.durationMs : getCallDurationMs(state.callController);
    cleanupCall(false);
    showCallEndedToast(durationMs, 'Call ended');
  });

  state.socket.on('webrtc:signal', async (payload) => {
    if (!state.callController || state.callController.callId !== payload.callId) return;
    if (payload.description) {
      await state.callController.peerConnection.setRemoteDescription(payload.description);
      await flushPendingCandidates();
      state.callController.remoteReady = true;
      syncCallModal();
      return;
    }
    if (payload.candidate) {
      if (state.callController.peerConnection.remoteDescription) {
        await state.callController.peerConnection.addIceCandidate(payload.candidate);
      } else {
        state.callController.pendingCandidates.push(payload.candidate);
      }
    }
  });

  state.socket.on('connect_error', (error) => {
    if ((error && String(error.message || '').includes('unauthorized')) || String(error || '').includes('unauthorized')) {
      showToast('Your session expired. Please sign in again.', 'error');
      clearSession();
      return;
    }
    showToast('Connection problem. The call network will retry automatically.', 'error');
  });
}

async function submitAuth(event) {
  event.preventDefault();
  const username = usernameLabel(els.authUsername.value);
  const password = String(els.authPassword.value || '').trim();

  if (!username) {
    setAuthStatus('Enter a username.', 'error');
    return;
  }

  if (!/^\d{8}$/.test(password)) {
    setAuthStatus('The password must be exactly 8 digits.', 'error');
    return;
  }

  const endpoint = state.mode === 'register' ? '/api/auth/register' : '/api/auth/login';

  try {
    els.authSubmit.disabled = true;
    setAuthStatus(state.mode === 'register' ? 'Creating account...' : 'Signing in...', 'info');
    const data = await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    state.token = data.token;
    localStorage.setItem('whatscall-token', data.token);
    setProfile(data.user);
    connectSocket();
    setAuthStatus('');
    showToast(state.mode === 'register' ? 'Account created.' : 'Welcome back.', 'success');
    els.authForm.reset();
  } catch (error) {
    setAuthStatus(error.message, 'error');
  } finally {
    els.authSubmit.disabled = false;
  }
}

function selectUser(profile) {
  if (!profile) return;
  state.selectedUser = mergeUserProfiles(profile);
  state.chatSuppressedForKey = null;
  renderApp();
}

async function refreshProfile() {
  const data = await apiFetch('/api/me');
  setProfile(data.user);
  return data.user;
}

async function refreshSearchSilently() {
  const query = state.searchQuery.trim();
  if (!query) return;
  const requestId = ++state.searchRequestId;
  const data = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (requestId !== state.searchRequestId) return;
  state.searchResults = data.results || [];
}

async function refreshProfileAndSearch() {
  try {
    await refreshProfile();
    await refreshSearchSilently();
    renderApp();
  } catch (error) {
    if (String(error.message || '').includes('Please sign in again')) {
      clearSession();
      return;
    }

    showToast(error.message || 'Could not refresh your contacts.', 'error');
  }
}

async function addContact(targetKey) {
  const target = lookupUser(targetKey);
  if (!target) {
    showToast('That account was not found.', 'error');
    return;
  }

  try {
    const data = await apiFetch('/api/contacts/add', {
      method: 'POST',
      body: JSON.stringify({ username: target.username }),
    });
    if (data.user) {
      setProfile(data.user);
    }
    await refreshSearchSilently();
    renderApp();

    if (data.status === 'accepted') {
      showToast(`${target.username} is now in your contacts.`, 'success');
      return;
    }

    if (data.status === 'contact') {
      showToast(`${target.username} is already in your contacts.`, 'info');
      return;
    }

    if (data.status === 'pending') {
      showToast(`A request is already waiting for ${target.username}.`, 'info');
      return;
    }

    showToast(`Request sent to ${target.username}.`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function acceptRequest(targetKey) {
  const target = lookupUser(targetKey);
  if (!target) {
    showToast('That account was not found.', 'error');
    return;
  }

  try {
    const data = await apiFetch('/api/contacts/accept', {
      method: 'POST',
      body: JSON.stringify({ username: target.username }),
    });
    if (data.user) {
      setProfile(data.user);
    }
    await refreshSearchSilently();
    renderApp();
    showToast(`${target.username} is now in your contacts.`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function rejectRequest(targetKey) {
  const target = lookupUser(targetKey) || state.selectedUser;
  if (!target) return;

  try {
    const data = await apiFetch('/api/contacts/reject', {
      method: 'POST',
      body: JSON.stringify({ username: target.username }),
    });
    if (data.user) {
      setProfile(data.user);
    }
    await refreshSearchSilently();
    renderApp();
    showToast(`Request from ${target.username} rejected.`, 'info');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function removeContact(targetKey) {
  const target = lookupUser(targetKey) || state.selectedUser;
  if (!target) return;

  try {
    const data = await apiFetch('/api/contacts/remove', {
      method: 'POST',
      body: JSON.stringify({ username: target.username }),
    });
    if (data.user) {
      setProfile(data.user);
    }
    if (data.status === 'removed') {
      applyRemovedConversationState(data.target || target);
    }
    await refreshSearchSilently();
    renderApp();

    if (data.status === 'cancelled') {
      showToast(`Request to ${target.username} cancelled.`, 'info');
      return;
    }

    if (data.status === 'none') {
      showToast(`Nothing to remove for ${target.username}.`, 'info');
      return;
    }

    showToast(`${target.username} was removed from your contacts and the chat was deleted.`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function requestChat(targetKey) {
  const target = lookupUser(targetKey) || state.selectedUser;
  if (!target) return;

  try {
    const data = await apiFetch(`/api/chats/${encodeURIComponent(target.username)}/request`, {
      method: 'POST',
    });
    if (data.user) {
      setProfile(data.user);
    }
    if (data.target) {
      selectUser(data.target);
    }
    await refreshSearchSilently();

    if (data.status === 'accepted' || data.status === 'chat') {
      showToast(`${target.username} is ready to chat.`, 'success');
      return;
    }

    if (data.status === 'pending') {
      showToast(`A request is already waiting for ${target.username}.`, 'info');
      return;
    }

    showToast(`Request sent to ${target.username}.`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function acceptChat(targetKey) {
  const target = lookupUser(targetKey) || state.selectedUser;
  if (!target) return;

  try {
    const data = await apiFetch(`/api/chats/${encodeURIComponent(target.username)}/accept`, {
      method: 'POST',
    });
    if (data.user) {
      setProfile(data.user);
    }
    if (data.target) {
      selectUser(data.target);
    }
    await refreshSearchSilently();
    showToast(`${target.username} is now in your chats.`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function rejectChat(targetKey) {
  const target = lookupUser(targetKey) || state.selectedUser;
  if (!target) return;

  try {
    const data = await apiFetch(`/api/chats/${encodeURIComponent(target.username)}/reject`, {
      method: 'POST',
    });
    if (data.user) {
      setProfile(data.user);
    }
    await refreshSearchSilently();
    showToast(`Request from ${target.username} rejected.`, 'info');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function cancelChat(targetKey) {
  const target = lookupUser(targetKey) || state.selectedUser;
  if (!target) return;

  try {
    const data = await apiFetch(`/api/chats/${encodeURIComponent(target.username)}/remove`, {
      method: 'POST',
    });
    if (data.user) {
      setProfile(data.user);
    }
    await refreshSearchSilently();

    if (data.status === 'removed') {
      showToast(`${target.username} was removed from your chats.`, 'success');
      return;
    }

    if (data.status === 'cancelled') {
      showToast(`Request to ${target.username} cancelled.`, 'info');
      return;
    }

    showToast(`Nothing to remove for ${target.username}.`, 'info');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function runSearch(query) {
  state.searchQuery = query;
  if (!query.trim()) {
    state.searchResults = [];
    renderSearchResults();
    renderContacts();
    renderRequests();
    updateSelectedAfterLists();
    renderSelectedUser();
    return;
  }

  const requestId = ++state.searchRequestId;
  try {
    const data = await apiFetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
    if (requestId !== state.searchRequestId) return;
    state.searchResults = data.results || [];
    renderSearchResults();
    renderContacts();
    renderRequests();
    updateSelectedAfterLists();
    renderSelectedUser();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function updateSelectedAfterLists() {
  syncSelectedFromLists();
}

// Call flow helpers and event bindings continue below.

function createPeerConnection(callId) {
  const peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  peerConnection.onicecandidate = (event) => {
    if (!event.candidate || !state.socket || !state.callController) return;
    state.socket.emit('webrtc:signal', {
      callId,
      candidate: event.candidate,
    });
  };

  peerConnection.ontrack = (event) => {
    const [remoteStream] = event.streams;
    if (remoteStream) {
      els.remoteVideo.srcObject = remoteStream;
      els.remoteVideo.play().catch(() => {});
      if (state.callController) state.callController.remoteReady = true;
      syncCallModal();
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (!state.callController || state.callController.peerConnection !== peerConnection) return;
    if (['failed', 'disconnected', 'closed'].includes(peerConnection.connectionState)) {
      cleanupCall(false);
      showToast('The call connection stopped.', 'error');
    }
  };

  return peerConnection;
}

function getMediaConstraints(isVideo) {
  return {
    audio: true,
    video: isVideo
      ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        }
      : false,
  };
}

function getLocalAudioTrack() {
  return state.callController?.localStream?.getAudioTracks?.()[0] || null;
}

function getLocalVideoTrack() {
  return state.callController?.localStream?.getVideoTracks?.()[0] || null;
}

function updateCallToggleButtons() {
  const controller = state.callController;
  if (!controller) {
    els.toggleAudio.hidden = true;
    els.toggleVideo.hidden = true;
    return;
  }

  const audioTrack = getLocalAudioTrack();
  const videoTrack = getLocalVideoTrack();
  const audioMuted = !audioTrack || !audioTrack.enabled;
  const videoEnabled = controller.isVideo && Boolean(videoTrack && videoTrack.enabled);

  controller.audioMuted = audioMuted;
  controller.videoEnabled = videoEnabled;

  els.toggleAudio.hidden = false;
  els.toggleAudio.textContent = audioMuted ? 'Unmute' : 'Mute';
  els.toggleAudio.classList.toggle('on', !audioMuted);
  els.toggleAudio.classList.toggle('off', audioMuted);
  els.toggleAudio.setAttribute('aria-pressed', String(!audioMuted));

  els.toggleVideo.hidden = !controller.isVideo;
  if (controller.isVideo) {
    els.toggleVideo.textContent = videoEnabled ? 'Video off' : 'Video on';
    els.toggleVideo.classList.toggle('on', videoEnabled);
    els.toggleVideo.classList.toggle('off', !videoEnabled);
    els.toggleVideo.setAttribute('aria-pressed', String(videoEnabled));
  }
}

function syncCallModal() {
  const controller = state.callController;
  if (!controller) {
    els.activeCallModal.hidden = true;
    return;
  }

  const { isVideo, targetName, localStream, remoteReady } = controller;
  els.callModeLabel.textContent = isVideo ? 'Video call' : 'Voice call';
  els.callTitle.textContent = targetName || 'Call';
  const peerProfile = lookupUser(controller.targetKey) || state.selectedUser || { username: targetName || 'Call' };
  applyAvatarElement(els.callAvatar, peerProfile);
  els.callStatusTitle.textContent = controller.statusTitle || 'Connecting...';
  els.callStatusText.textContent = controller.statusText || 'Waiting for the other person to join.';
  els.callTimer.textContent = controller.timerText || '00:00';
  updateCallToggleButtons();
  els.localVideo.classList.toggle('hidden', !isVideo || !localStream || !controller.videoEnabled);
  els.remoteVideo.classList.toggle('hidden', !isVideo);
  els.voiceOverlay.hidden = Boolean(isVideo && remoteReady);
  const nextLocalStream = localStream || null;
  if (els.localVideo.srcObject !== nextLocalStream) {
    els.localVideo.srcObject = nextLocalStream;
    if (nextLocalStream) {
      els.localVideo.play().catch(() => {});
    }
  }
  els.activeCallModal.hidden = false;
}

function toggleCallAudio() {
  const track = getLocalAudioTrack();
  if (!track || !state.callController) {
    showToast('Microphone is not available for this call.', 'error');
    return;
  }

  track.enabled = !track.enabled;
  syncCallModal();
  showToast(track.enabled ? 'Microphone unmuted.' : 'Microphone muted.', 'info');
}

function toggleCallVideo() {
  const controller = state.callController;
  const track = getLocalVideoTrack();

  if (!controller?.isVideo) {
    return;
  }

  if (!track) {
    showToast('Camera is not available for this call.', 'error');
    return;
  }

  track.enabled = !track.enabled;
  syncCallModal();
  showToast(track.enabled ? 'Camera turned on.' : 'Camera turned off.', 'info');
}

function updateCallStatus(title, text) {
  if (!state.callController) return;
  state.callController.statusTitle = title;
  state.callController.statusText = text;
  syncCallModal();
}

function updateCallTimer() {
  if (!state.callController) return;

  const elapsed = Math.max(0, Date.now() - state.callController.startedAt);
  state.callController.timerText = formatCallDuration(elapsed);
  els.callTimer.textContent = state.callController.timerText;
}

function startCallTimer(startedAt = Date.now()) {
  clearInterval(state.callTimer);
  if (!state.callController) return;
  state.callController.startedAt = startedAt;
  updateCallTimer();

  state.callTimer = setInterval(() => {
    if (!state.callController) {
      clearInterval(state.callTimer);
      state.callTimer = null;
      return;
    }

    updateCallTimer();
  }, 1000);
}

function setCallConnected(startedAt, peerName) {
  if (!state.callController) return;

  state.callController.connected = true;
  state.callController.remoteReady = true;
  startCallTimer(startedAt || Date.now());
  updateCallStatus('Connected', `${peerName || 'The other person'} joined the call.`);
  syncCallModal();
}

async function flushPendingCandidates() {
  if (!state.callController?.pendingCandidates?.length) return;
  const pending = [...state.callController.pendingCandidates];
  state.callController.pendingCandidates = [];
  for (const candidate of pending) {
    await state.callController.peerConnection.addIceCandidate(candidate);
  }
}

function cleanupCall(notifyPeer = true) {
  clearInterval(state.callTimer);
  state.callTimer = null;

  const controller = state.callController;
  state.callController = null;
  state.activeCall = null;
  state.incomingCall = null;
  els.incomingModal.hidden = true;

  if (controller && notifyPeer && state.socket) {
    state.socket.emit('call:end', {
      callId: controller.callId,
      reason: 'ended',
    });
  }

  if (controller) {
    try {
      controller.peerConnection.onicecandidate = null;
      controller.peerConnection.ontrack = null;
      controller.peerConnection.close();
    } catch {
      // Ignore close errors.
    }

    if (controller.localStream) {
      controller.localStream.getTracks().forEach((track) => track.stop());
    }
  }

  els.activeCallModal.hidden = true;
  els.remoteVideo.srcObject = null;
  els.localVideo.srcObject = null;
  els.voiceOverlay.hidden = false;
}

async function beginOutgoingCall(profile, isVideo) {
  if (!profile?.isContact) {
    showToast('Add this user to your contacts first.', 'error');
    return;
  }

  if (!profile.online) {
    showToast('That user is offline right now.', 'error');
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Your browser does not support camera or microphone access.', 'error');
    return;
  }

  if (state.activeCall || state.incomingCall) {
    showToast('You are already handling a call.', 'error');
    return;
  }

  const callId = makeId();

  try {
    const localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints(isVideo));
    state.callController = {
      callId,
      peerConnection: null,
      localStream,
      pendingCandidates: [],
      isVideo,
      audioMuted: false,
      videoEnabled: isVideo,
      targetKey: profile.key,
      targetName: profile.username,
      connected: false,
      remoteReady: false,
      statusTitle: 'Calling...',
      statusText: 'Waiting for acceptance.',
      timerText: '00:00',
      startedAt: 0,
    };
    state.callController.peerConnection = createPeerConnection(callId);
    state.activeCall = {
      callId,
      key: profile.key,
      username: profile.username,
      isVideo,
    };

    localStream.getTracks().forEach((track) => {
      state.callController.peerConnection.addTrack(track, localStream);
    });

    syncCallModal();

    const offer = await state.callController.peerConnection.createOffer();
    await state.callController.peerConnection.setLocalDescription(offer);

    const ack = await emitWithAck('call:invite', {
      callId,
      to: profile.key,
      isVideo,
      offer: state.callController.peerConnection.localDescription,
    });

    if (!ack.ok) {
      throw new Error(ack.error || 'Could not start the call.');
    }

    showToast(`Calling ${profile.username}...`, 'success');
  } catch (error) {
    cleanupCall(false);
    showToast(error.message || 'Could not start the call.', 'error');
  }
}

async function acceptIncomingCall() {
  const incoming = state.incomingCall;
  if (!incoming) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Your browser does not support camera or microphone access.', 'error');
    return;
  }

  try {
    const localStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints(incoming.isVideo));
    state.callController = {
      callId: incoming.callId,
      peerConnection: null,
      localStream,
      pendingCandidates: [],
      isVideo: incoming.isVideo,
      audioMuted: false,
      videoEnabled: incoming.isVideo,
      targetKey: incoming.fromKey,
      targetName: incoming.fromName,
      connected: false,
      remoteReady: false,
      statusTitle: 'Connecting...',
      statusText: 'Answering the call.',
      timerText: '00:00',
      startedAt: 0,
    };
    state.callController.peerConnection = createPeerConnection(incoming.callId);
    state.activeCall = {
      callId: incoming.callId,
      key: incoming.fromKey,
      username: incoming.fromName,
      isVideo: incoming.isVideo,
    };

    localStream.getTracks().forEach((track) => {
      state.callController.peerConnection.addTrack(track, localStream);
    });

    state.incomingCall = null;
    els.incomingModal.hidden = true;
    syncCallModal();

    await state.callController.peerConnection.setRemoteDescription(incoming.offer);
    await flushPendingCandidates();
    const answer = await state.callController.peerConnection.createAnswer();
    await state.callController.peerConnection.setLocalDescription(answer);

    const ack = await emitWithAck('call:response', {
      callId: incoming.callId,
      accepted: true,
      answer: state.callController.peerConnection.localDescription,
    });

    if (!ack.ok) {
      throw new Error(ack.error || 'Could not accept the call.');
    }

    setCallConnected(ack.startedAt || Date.now(), incoming.fromName);
    showToast(`Answered ${incoming.fromName}.`, 'success');
  } catch (error) {
    if (state.callController && incoming) {
      state.socket?.emit('call:response', {
        callId: incoming.callId,
        accepted: false,
      });
      cleanupCall(false);
    }
    showToast(error.message || 'Could not accept the call.', 'error');
  }
}

function rejectIncomingCall() {
  if (!state.incomingCall) return;
  state.socket?.emit('call:response', {
    callId: state.incomingCall.callId,
    accepted: false,
  });
  state.incomingCall = null;
  els.incomingModal.hidden = true;
  showToast('Incoming call rejected.', 'info');
}

function showIncomingCall() {
  const incoming = state.incomingCall;
  if (!incoming) {
    els.incomingModal.hidden = true;
    return;
  }

  els.incomingTitle.textContent = incoming.fromName;
  els.incomingSubtitle.textContent = incoming.isVideo ? 'Video call request' : 'Voice call request';
  els.incomingModal.hidden = false;
}

function endCurrentCall() {
  if (!state.callController) return;
  const durationMs = getCallDurationMs(state.callController);
  cleanupCall(true);
  showToast(`You talked for ${formatCallDuration(durationMs)}.`, 'info');
}

function handleListClick(event) {
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) return;

  const action = actionNode.dataset.action;
  const key = actionNode.dataset.key || actionNode.closest('[data-key]')?.dataset.key;
  const profile = lookupUser(key);

  if (action === 'select-user') {
    if (profile) selectUser(profile);
    return;
  }

  if (action === 'audio-call') {
    if (profile) beginOutgoingCall(profile, false);
    return;
  }

  if (action === 'video-call') {
    if (profile) beginOutgoingCall(profile, true);
    return;
  }

  if (action === 'add-contact') {
    if (profile) addContact(profile.key);
    return;
  }

  if (action === 'chat-request') {
    if (profile) requestChat(profile.key);
    return;
  }

  if (action === 'open-chat') {
    if (profile) selectUser(profile);
    return;
  }

  if (action === 'accept-chat') {
    if (profile) acceptChat(profile.key);
    return;
  }

  if (action === 'reject-chat') {
    if (profile) rejectChat(profile.key);
    return;
  }

  if (action === 'cancel-chat') {
    if (profile) cancelChat(profile.key);
    return;
  }

  if (action === 'leave-chat') {
    if (profile) closeChatPanel();
    return;
  }

  if (action === 'accept-request') {
    if (profile) acceptRequest(profile.key);
    return;
  }

  if (action === 'reject-request') {
    if (profile) rejectRequest(profile.key);
    return;
  }

  if (action === 'cancel-request') {
    if (profile) removeContact(profile.key);
    return;
  }

  if (action === 'remove-contact') {
    if (profile) removeContact(profile.key);
  }
}

function bindEvents() {
  els.authModeButtons.forEach((button) => {
    button.addEventListener('click', () => setAuthMode(button.dataset.authMode));
  });

  els.authForm.addEventListener('submit', submitAuth);

  els.logoutBtn.addEventListener('click', () => {
    cleanupCall(false);
    clearSession();
    setAuthMode('login');
    setAuthStatus('Signed out.', 'info');
    showToast('You are signed out.', 'info');
  });

  els.deleteAccountBtn.addEventListener('click', openDeleteAccountModal);
  els.deleteAccountForm.addEventListener('submit', submitDeleteAccount);
  els.cancelDeleteAccount.addEventListener('click', closeDeleteAccountModal);

  els.searchInput.addEventListener('input', (event) => {
    clearTimeout(debounceTimers.search);
    const value = event.target.value;
    debounceTimers.search = setTimeout(() => {
      runSearch(value);
    }, 220);
  });

  els.contactsList.addEventListener('click', handleListClick);
  els.requestsList.addEventListener('click', handleListClick);
  els.chatsList.addEventListener('click', handleListClick);
  els.searchResults.addEventListener('click', handleListClick);

  if (els.editProfileBtn) {
    els.editProfileBtn.addEventListener('click', openProfileModal);
  }
  if (els.profileForm) {
    els.profileForm.addEventListener('submit', submitProfileSettings);
  }
  if (els.cancelProfileBtn) {
    els.cancelProfileBtn.addEventListener('click', closeProfileModal);
  }
  if (els.profilePhotoInput) {
    els.profilePhotoInput.addEventListener('change', () => {
      if (els.profileRemovePhotoFlag) {
        els.profileRemovePhotoFlag.value = '0';
      }
      updateProfileModalPreview();
    });
  }
  if (els.profileRemovePhotoBtn) {
    els.profileRemovePhotoBtn.addEventListener('click', () => {
      if (els.profileRemovePhotoFlag) {
        els.profileRemovePhotoFlag.value = '1';
      }
      if (els.profilePhotoInput) {
        els.profilePhotoInput.value = '';
      }
      updateProfileModalPreview();
      if (els.profileStatusMessage) {
        els.profileStatusMessage.textContent = 'The profile photo will be removed when you save.';
        els.profileStatusMessage.style.color = 'var(--muted)';
      }
    });
  }

  els.selectedChatAction.addEventListener('click', () => {
    if (!state.selectedUser) return;
    const relationship = currentRelationship(state.selectedUser);
    const chatRelationship = currentChatRelationship(state.selectedUser);

    if (chatRelationship === 'chat') {
      openChat(state.selectedUser);
      return;
    }

    if (relationship === 'incoming') {
      acceptRequest(state.selectedUser.key);
      return;
    }

    if (relationship === 'outgoing') {
      removeContact(state.selectedUser.key);
      return;
    }

    if (chatRelationship === 'incoming') {
      acceptChat(state.selectedUser.key);
      return;
    }

    if (chatRelationship === 'outgoing') {
      cancelChat(state.selectedUser.key);
      return;
    }

    addContact(state.selectedUser.key);
  });

  els.selectedLeaveChat.addEventListener('click', () => {
    if (!state.selectedUser) return;
    const relationship = currentRelationship(state.selectedUser);
    if (relationship === 'incoming' && currentChatRelationship(state.selectedUser) !== 'chat') {
      rejectRequest(state.selectedUser.key);
      return;
    }
    if (currentChatRelationship(state.selectedUser) === 'chat') {
      closeChatPanel();
    }
  });

  els.selectedAudioCall.addEventListener('click', () => {
    if (!state.selectedUser) return;
    const chatRelationship = currentChatRelationship(state.selectedUser);
    const relationship = currentRelationship(state.selectedUser);
    if (chatRelationship === 'incoming' && relationship !== 'contact') {
      rejectChat(state.selectedUser.key);
      return;
    }
    if (relationship === 'contact') {
      beginOutgoingCall(state.selectedUser, false);
      return;
    }
    if (relationship === 'incoming') {
      acceptRequest(state.selectedUser.key);
      return;
    }
    if (relationship === 'outgoing') {
      removeContact(state.selectedUser.key);
      return;
    }
    addContact(state.selectedUser.key);
  });

  els.selectedVideoCall.addEventListener('click', () => {
    if (!state.selectedUser) return;
    const chatRelationship = currentChatRelationship(state.selectedUser);
    const relationship = currentRelationship(state.selectedUser);
    if (chatRelationship === 'incoming' && relationship !== 'contact') {
      rejectChat(state.selectedUser.key);
      return;
    }
    if (relationship === 'contact') {
      beginOutgoingCall(state.selectedUser, true);
      return;
    }
    if (relationship === 'incoming') {
      rejectRequest(state.selectedUser.key);
    }
  });

  els.selectedRemove.addEventListener('click', () => {
    if (currentRelationship(state.selectedUser) === 'contact') {
      removeContact(state.selectedUser.key);
    }
  });

  els.chatForm.addEventListener('submit', submitChatMessage);
  els.chatInput.addEventListener('input', (event) => {
    state.chatDraftText = event.target.value;
    if (String(state.chatDraftText || '').trim()) {
      broadcastTypingState();
    } else {
      clearTypingBroadcast();
    }
  });
  els.chatInput.addEventListener('blur', () => {
    clearTypingBroadcast();
  });
  els.chatFileInput.addEventListener('change', (event) => {
    state.chatDraftFiles = Array.from(event.target.files || []);
    renderChatDraftFiles();
  });
  els.clearChatFiles.addEventListener('click', clearChatDraftFiles);
  els.closeChatBtn.addEventListener('click', () => {
    closeChatPanel();
    renderSelectedUser();
  });
  els.chatMessages.addEventListener('click', handleChatMessageClick);
  els.chatFilePreview.addEventListener('click', (event) => {
    const actionNode = event.target.closest('[data-action]');
    if (!actionNode) return;
    if (actionNode.dataset.action === 'remove-chat-file') {
      removeChatDraftFile(actionNode.dataset.fileIndex);
    }
  });

  els.acceptCall.addEventListener('click', acceptIncomingCall);
  els.rejectCall.addEventListener('click', rejectIncomingCall);
  els.toggleAudio.addEventListener('click', toggleCallAudio);
  els.toggleVideo.addEventListener('click', toggleCallVideo);
  els.endCall.addEventListener('click', endCurrentCall);
}

function setSearchDefaults() {
  renderSearchResults();
  renderRequests();
  renderContacts();
  renderSelectedUser();
}

function initialize() {
  clearSession();
  bindEvents();
  setAuthMode('login');
  updateVisibility();
  setSearchDefaults();
}

initialize();
