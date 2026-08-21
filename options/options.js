/**
 * TTD Smart Autofill — Options Page Logic
 * Handles profile/group CRUD, settings persistence, and UI rendering.
 */

import {
  getProfiles, saveProfile, deleteProfile, duplicateProfile,
  getGroups, saveGroup, deleteGroup,
  getSettings, saveSettings,
  getGeneralDetails, saveGeneralDetails,
} from '../shared/storage.js';

// ─── State ───────────────────────────────────────────────────────────────────

let allProfiles    = [];
let allGroups      = [];
let settings       = {};
let generalDetails = {};
let confirmCallback = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  [allProfiles, allGroups, settings, generalDetails] = await Promise.all([
    getProfiles(), getGroups(), getSettings(), getGeneralDetails(),
  ]);
  renderProfiles();
  renderGroups();
  renderSettings();
  renderGeneralDetails();
  populateGroupSelects();
  attachListeners();

  // Handle deep-link from popup "Add Profile" button
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'triggerAddProfile') {
      openProfileModal();
    }
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function attachListeners() {
  // Tab navigation
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Profile buttons
  document.getElementById('btn-add-profile').addEventListener('click', () => openProfileModal());
  document.getElementById('btn-add-profile-empty')?.addEventListener('click', () => openProfileModal());
  document.getElementById('modal-close').addEventListener('click', closeProfileModal);
  document.getElementById('btn-modal-cancel').addEventListener('click', closeProfileModal);
  document.getElementById('profile-form').addEventListener('submit', handleProfileSave);

  // Profile search/filter
  document.getElementById('profile-search').addEventListener('input', renderProfiles);
  document.getElementById('group-filter').addEventListener('change', renderProfiles);

  // Group buttons
  document.getElementById('btn-add-group').addEventListener('click', () => openGroupModal());
  document.getElementById('group-modal-close').addEventListener('click', closeGroupModal);
  document.getElementById('btn-group-modal-cancel').addEventListener('click', closeGroupModal);
  document.getElementById('btn-group-modal-save').addEventListener('click', handleGroupSave);

  // Settings
  document.getElementById('setting-skip-filled').addEventListener('change', saveCurrentSettings);
  document.getElementById('setting-show-confirmation').addEventListener('change', saveCurrentSettings);
  document.getElementById('setting-fill-delay').addEventListener('change', saveCurrentSettings);
  document.getElementById('btn-clear-all').addEventListener('click', handleClearAll);

  // Confirm dialog
  document.getElementById('btn-confirm-cancel').addEventListener('click', closeConfirm);
  document.getElementById('btn-confirm-ok').addEventListener('click', () => {
    closeConfirm();
    if (confirmCallback) confirmCallback();
  });

  // Close modals on overlay click
  document.getElementById('profile-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeProfileModal();
  });
  document.getElementById('group-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeGroupModal();
  });
  document.getElementById('confirm-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeConfirm();
  });

  // Keyboard close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeProfileModal();
      closeGroupModal();
      closeConfirm();
    }
  });

  // General Details form
  document.getElementById('form-general')?.addEventListener('submit', handleGeneralDetailsSave);
}

// ─── General Details ──────────────────────────────────────────────────────────

function renderGeneralDetails() {
  const gd = generalDetails;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('gd-gothram', gd.gothram);
  setVal('gd-email',   gd.email);
  setVal('gd-city',    gd.city);
  setVal('gd-state',   gd.state);
  setVal('gd-country', gd.country);
  setVal('gd-pincode', gd.pincode);
}

async function handleGeneralDetailsSave(e) {
  e.preventDefault();
  const getVal = (id) => document.getElementById(id)?.value.trim() || '';
  const updates = {
    gothram: getVal('gd-gothram'),
    email:   getVal('gd-email'),
    city:    getVal('gd-city'),
    state:   getVal('gd-state'),
    country: getVal('gd-country'),
    pincode: getVal('gd-pincode'),
  };
  await saveGeneralDetails(updates);
  generalDetails = { ...generalDetails, ...updates };
  const indicator = document.getElementById('gd-saved');
  if (indicator) {
    indicator.classList.remove('hidden');
    setTimeout(() => indicator.classList.add('hidden'), 2500);
  }
}

function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.getElementById(`nav-${tab}`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

function renderProfiles() {
  const query = document.getElementById('profile-search').value.toLowerCase();
  const groupFilter = document.getElementById('group-filter').value;

  const filtered = allProfiles.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(query) ||
      (p.idNumber || '').toLowerCase().includes(query);
    const matchesGroup = !groupFilter || p.groupId === groupFilter;
    return matchesSearch && matchesGroup;
  });

  const grid = document.getElementById('profile-grid');
  const empty = document.getElementById('profiles-empty');

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = filtered.map((p) => profileCardHTML(p)).join('');

  // Attach card action buttons
  grid.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      if (action === 'edit') openProfileModal(id);
      if (action === 'duplicate') handleDuplicate(id);
      if (action === 'delete') confirmDelete(id);
    });
  });
}

function profileCardHTML(p) {
  const initials = p.name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() || '')
    .join('');
  const group = allGroups.find((g) => g.id === p.groupId);
  const genderIcon = p.gender === 'Male' ? '♂' : p.gender === 'Female' ? '♀' : '⚧';

  return `
    <div class="profile-card" data-id="${p.id}">
      <div class="profile-card-header">
        <div class="profile-avatar">${initials}</div>
        <div class="profile-meta">
          <div class="profile-name">${escHtml(p.name)}</div>
          <div class="profile-tag">${genderIcon} ${p.gender} &middot; Age ${p.age}</div>
        </div>
        <div class="profile-card-actions">
          <button class="btn-icon" data-action="edit" data-id="${p.id}" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon" data-action="duplicate" data-id="${p.id}" title="Duplicate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button class="btn-icon btn-icon-danger" data-action="delete" data-id="${p.id}" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
      <div class="profile-card-details">
        <div class="detail-item">
          <span class="detail-label">ID Type</span>
          <span class="detail-value">${escHtml(p.idType || '—')}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">ID Number</span>
          <span class="detail-value">${escHtml(maskId(p.idNumber))}</span>
        </div>
        ${p.mobile ? `<div class="detail-item">
          <span class="detail-label">Mobile</span>
          <span class="detail-value">${escHtml(p.mobile)}</span>
        </div>` : ''}
        ${p.email ? `<div class="detail-item">
          <span class="detail-label">Email</span>
          <span class="detail-value">${escHtml(p.email)}</span>
        </div>` : ''}
      </div>
      ${group ? `<div class="group-chip">👨‍👩‍👧 ${escHtml(group.name)}</div>` : ''}
    </div>
  `;
}

function maskId(id = '') {
  if (id.length <= 4) return id;
  return '•'.repeat(id.length - 4) + id.slice(-4);
}

// ─── Profile Modal ─────────────────────────────────────────────────────────────

function openProfileModal(id = null) {
  const modal = document.getElementById('profile-modal-overlay');
  const form  = document.getElementById('profile-form');
  const title = document.getElementById('modal-title');

  form.reset();
  clearFormErrors();

  // Populate groups select
  const groupSel = document.getElementById('form-group');
  groupSel.innerHTML = '<option value="">— No Group —</option>' +
    allGroups.map((g) => `<option value="${g.id}">${escHtml(g.name)}</option>`).join('');

  if (id) {
    const p = allProfiles.find((x) => x.id === id);
    if (p) {
      title.textContent = 'Edit Pilgrim Profile';
      document.getElementById('form-id').value = p.id;
      document.getElementById('form-name').value = p.name;
      document.getElementById('form-age').value = p.age;
      document.getElementById('form-id-type').value = p.idType || '';
      document.getElementById('form-id-number').value = p.idNumber || '';
      document.getElementById('form-mobile').value = p.mobile || '';
      document.getElementById('form-email').value = p.email || '';
      document.getElementById('form-group').value = p.groupId || '';
      const genderRadio = document.querySelector(`input[name="gender"][value="${p.gender}"]`);
      if (genderRadio) genderRadio.checked = true;
    }
  } else {
    title.textContent = 'Add Pilgrim Profile';
    document.getElementById('form-id').value = '';
  }

  modal.classList.remove('hidden');
  document.getElementById('form-name').focus();
}

function closeProfileModal() {
  document.getElementById('profile-modal-overlay').classList.add('hidden');
}

async function handleProfileSave(e) {
  e.preventDefault();
  if (!validateProfileForm()) return;

  const gender = document.querySelector('input[name="gender"]:checked')?.value || '';

  const profile = {
    id: document.getElementById('form-id').value || undefined,
    name: document.getElementById('form-name').value.trim(),
    age: parseInt(document.getElementById('form-age').value, 10),
    gender,
    idType: document.getElementById('form-id-type').value,
    idNumber: document.getElementById('form-id-number').value.trim(),
    mobile: document.getElementById('form-mobile').value.trim(),
    email: document.getElementById('form-email').value.trim(),
    groupId: document.getElementById('form-group').value || null,
  };

  const saved = await saveProfile(profile);

  // Update local state
  const idx = allProfiles.findIndex((p) => p.id === saved.id);
  if (idx !== -1) allProfiles[idx] = saved;
  else allProfiles.push(saved);

  closeProfileModal();
  renderProfiles();
  showToast('Profile saved successfully!', 'success');
}

function validateProfileForm() {
  clearFormErrors();
  let valid = true;

  const name = document.getElementById('form-name').value.trim();
  if (!name) {
    showFieldError('err-name', 'Name is required');
    document.getElementById('form-name').classList.add('error');
    valid = false;
  }

  const age = parseInt(document.getElementById('form-age').value, 10);
  if (!age || age < 1 || age > 120) {
    showFieldError('err-age', 'Enter a valid age (1–120)');
    document.getElementById('form-age').classList.add('error');
    valid = false;
  }

  const gender = document.querySelector('input[name="gender"]:checked');
  if (!gender) {
    showFieldError('err-gender', 'Please select a gender');
    valid = false;
  }

  const idType = document.getElementById('form-id-type').value;
  if (!idType) {
    showFieldError('err-id-type', 'Please select an ID type');
    document.getElementById('form-id-type').classList.add('error');
    valid = false;
  }

  const idNumber = document.getElementById('form-id-number').value.trim();
  if (!idNumber) {
    showFieldError('err-id-number', 'ID number is required');
    document.getElementById('form-id-number').classList.add('error');
    valid = false;
  }

  return valid;
}

function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function clearFormErrors() {
  document.querySelectorAll('.form-error').forEach((el) => { el.textContent = ''; });
  document.querySelectorAll('.form-input.error').forEach((el) => el.classList.remove('error'));
}

// ─── Duplicate & Delete ────────────────────────────────────────────────────────

async function handleDuplicate(id) {
  const copy = await duplicateProfile(id);
  allProfiles.push(copy);
  renderProfiles();
  showToast('Profile duplicated!', 'success');
}

function confirmDelete(id) {
  const p = allProfiles.find((x) => x.id === id);
  openConfirm(
    `Delete "${p?.name}"?`,
    `This will permanently remove this pilgrim profile. This action cannot be undone.`,
    async () => {
      await deleteProfile(id);
      allProfiles = allProfiles.filter((x) => x.id !== id);
      renderProfiles();
      showToast('Profile deleted.', '');
    }
  );
}

// ─── Groups ───────────────────────────────────────────────────────────────────

function renderGroups() {
  const list = document.getElementById('group-list');
  const empty = document.getElementById('groups-empty');

  if (allGroups.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  list.innerHTML = allGroups.map((g) => {
    const count = allProfiles.filter((p) => p.groupId === g.id).length;
    return `
      <div class="group-item" data-id="${g.id}">
        <div class="group-icon">👨‍👩‍👧</div>
        <div class="group-info">
          <div class="group-name">${escHtml(g.name)}</div>
          <div class="group-count">${count} pilgrim${count !== 1 ? 's' : ''}</div>
        </div>
        <div class="group-actions">
          <button class="btn-icon" data-action="edit-group" data-id="${g.id}" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon btn-icon-danger" data-action="delete-group" data-id="${g.id}" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      if (action === 'edit-group') openGroupModal(id);
      if (action === 'delete-group') confirmDeleteGroup(id);
    });
  });
}

function populateGroupSelects() {
  const filter = document.getElementById('group-filter');
  filter.innerHTML = '<option value="">All Groups</option>' +
    allGroups.map((g) => `<option value="${g.id}">${escHtml(g.name)}</option>`).join('');
}

function openGroupModal(id = null) {
  const overlay = document.getElementById('group-modal-overlay');
  const title   = document.getElementById('group-modal-title');
  document.getElementById('group-form-id').value = '';
  document.getElementById('group-form-name').value = '';

  if (id) {
    const g = allGroups.find((x) => x.id === id);
    if (g) {
      title.textContent = 'Edit Group';
      document.getElementById('group-form-id').value = g.id;
      document.getElementById('group-form-name').value = g.name;
    }
  } else {
    title.textContent = 'New Family Group';
  }

  overlay.classList.remove('hidden');
  document.getElementById('group-form-name').focus();
}

function closeGroupModal() {
  document.getElementById('group-modal-overlay').classList.add('hidden');
}

async function handleGroupSave() {
  const name = document.getElementById('group-form-name').value.trim();
  if (!name) {
    showToast('Group name cannot be empty.', 'error');
    return;
  }

  const group = {
    id: document.getElementById('group-form-id').value || undefined,
    name,
  };

  const saved = await saveGroup(group);
  const idx = allGroups.findIndex((g) => g.id === saved.id);
  if (idx !== -1) allGroups[idx] = saved;
  else allGroups.push(saved);

  closeGroupModal();
  renderGroups();
  populateGroupSelects();
  showToast('Group saved!', 'success');
}

function confirmDeleteGroup(id) {
  const g = allGroups.find((x) => x.id === id);
  openConfirm(
    `Delete group "${g?.name}"?`,
    'Profiles in this group will become ungrouped. This cannot be undone.',
    async () => {
      await deleteGroup(id);
      allGroups = allGroups.filter((x) => x.id !== id);
      allProfiles = allProfiles.map((p) => p.groupId === id ? { ...p, groupId: null } : p);
      renderGroups();
      renderProfiles();
      populateGroupSelects();
      showToast('Group deleted.', '');
    }
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function renderSettings() {
  document.getElementById('setting-skip-filled').checked = settings.skipFilledFields;
  document.getElementById('setting-show-confirmation').checked = settings.showConfirmation;
  document.getElementById('setting-fill-delay').value = settings.fillDelay;
}

async function saveCurrentSettings() {
  settings.skipFilledFields = document.getElementById('setting-skip-filled').checked;
  settings.showConfirmation = document.getElementById('setting-show-confirmation').checked;
  settings.fillDelay = parseInt(document.getElementById('setting-fill-delay').value, 10) || 0;
  await saveSettings(settings);
  showToast('Settings saved.', 'success');
}

async function handleClearAll() {
  openConfirm(
    'Clear All Data?',
    'This will permanently delete all pilgrim profiles, groups, and settings. This cannot be undone.',
    async () => {
      await chrome.storage.local.clear();
      allProfiles = [];
      allGroups   = [];
      settings    = { skipFilledFields: true, showConfirmation: true, fillDelay: 100 };
      renderProfiles();
      renderGroups();
      renderSettings();
      populateGroupSelects();
      showToast('All data cleared.', '');
    }
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function openConfirm(title, message, callback) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  confirmCallback = callback;
  document.getElementById('confirm-overlay').classList.remove('hidden');
}

function closeConfirm() {
  document.getElementById('confirm-overlay').classList.add('hidden');
  confirmCallback = null;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast${type ? ' ' + type : ''}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function escHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

init();
