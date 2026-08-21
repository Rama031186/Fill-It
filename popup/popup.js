/**
 * TTD Smart Autofill — Popup Logic
 * Two-mode profile selection: By Group | Individual
 */

import { getProfiles, getGroups, getSettings } from '../shared/storage.js';

// ─── State ────────────────────────────────────────────────────────────────────

let allProfiles = [];
let allGroups   = [];
let settings    = {};
let selectedIds = new Set();
let activeGroup = '';          // individual mode: current group tab filter
let currentMode = 'group';     // 'group' | 'individual'
let isOnTTDPage = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  [allProfiles, allGroups, settings] = await Promise.all([
    getProfiles(), getGroups(), getSettings(),
  ]);

  await checkCurrentPage();

  document.getElementById('loading-state').style.display = 'none';

  if (allProfiles.length === 0) {
    document.getElementById('empty-state').classList.remove('hidden');
  } else {
    document.getElementById('profiles-section').classList.remove('hidden');
    // Default to Group mode when groups exist; fallback to Individual
    switchMode(allGroups.length > 0 ? 'group' : 'individual');
  }

  attachListeners();
}

// ─── Page Check ───────────────────────────────────────────────────────────────

async function checkCurrentPage() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs?.[0]?.url || '';
      isOnTTDPage = url.includes('ttdevasthanams.ap.gov.in');
      if (!isOnTTDPage) {
        document.getElementById('status-strip-wrong-page').classList.remove('hidden');
      }
      resolve();
    });
  });
}

// ─── Mode Switching ───────────────────────────────────────────────────────────

function switchMode(mode) {
  currentMode = mode;

  document.getElementById('mode-btn-group').classList.toggle('active', mode === 'group');
  document.getElementById('mode-btn-individual').classList.toggle('active', mode === 'individual');

  document.getElementById('view-group').classList.toggle('hidden', mode !== 'group');
  document.getElementById('view-individual').classList.toggle('hidden', mode !== 'individual');

  if (mode === 'group') {
    renderGroupFillView();
  } else {
    renderGroupTabs();
    renderProfileList();
  }

  updateSelectionUI();
}

// ─── GROUP FILL MODE ──────────────────────────────────────────────────────────

function renderGroupFillView() {
  const list = document.getElementById('gf-list');

  const groupsWithProfiles = allGroups.filter((g) =>
    allProfiles.some((p) => p.groupId === g.id)
  );
  const ungrouped = allProfiles.filter((p) => !p.groupId);

  if (groupsWithProfiles.length === 0 && ungrouped.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:24px 16px;color:var(--text-muted);font-size:13px;">No profiles found</div>`;
    return;
  }

  let html = '';

  groupsWithProfiles.forEach((g, idx) => {
    const members = allProfiles.filter((p) => p.groupId === g.id);
    const selCount = members.filter((p) => selectedIds.has(p.id)).length;
    const isFull    = selCount === members.length && members.length > 0;
    const isPartial = selCount > 0 && selCount < members.length;

    let cardCls = 'gf-card';
    if (isFull)    cardCls += ' selected';
    else if (isPartial) cardCls += ' partial';

    const membersHTML = (selCount > 0) ? `
      <div class="gf-members">
        ${members.map((p) => {
          const initials = p.name.split(' ').slice(0, 2).map((n) => n[0]?.toUpperCase() || '').join('');
          const isIncluded = selectedIds.has(p.id);
          const gIcon = p.gender === 'Male' ? '♂' : p.gender === 'Female' ? '♀' : '⚧';
          return `
            <div class="gf-member${isIncluded ? '' : ' excluded'}" data-action="toggle-member" data-id="${p.id}">
              <div class="gf-member-av">${initials}</div>
              <div class="gf-member-info">
                <div class="gf-member-name">${escHtml(p.name)}</div>
                <div class="gf-member-detail">${gIcon} Age ${p.age} · ${escHtml(p.idType || 'No ID')}</div>
              </div>
              <div class="gf-member-check">
                ${isIncluded ? `<svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="#0d0f14" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>` : '';

    const countLabel = selCount > 0
      ? `${members.length} pilgrim${members.length !== 1 ? 's' : ''} &middot; <span class="gf-sel-count">${selCount} selected</span>`
      : `${members.length} pilgrim${members.length !== 1 ? 's' : ''}`;

    html += `
      <div class="${cardCls}" data-group-id="${g.id}" style="animation-delay:${idx * 0.04}s">
        <div class="gf-card-main" data-action="toggle-group" data-id="${g.id}">
          <div class="gf-icon">👨‍👩‍👧</div>
          <div class="gf-info">
            <div class="gf-name">${escHtml(g.name)}</div>
            <div class="gf-count">${countLabel}</div>
          </div>
          <div class="gf-check">
            <svg class="gf-check-icon" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5L4 7.5L8.5 2.5" stroke="#0d0f14" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div class="gf-check-partial"></div>
          </div>
        </div>
        ${membersHTML}
      </div>
    `;
  });

  // Ungrouped profiles section
  if (ungrouped.length > 0) {
    html += `
      <div class="ungrouped-section">
        <div class="ungrouped-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
          </svg>
          Ungrouped Profiles
        </div>
        <div class="profile-list" style="max-height:180px;">
          ${ungrouped.map((p) => profileItemHTML(p)).join('')}
        </div>
      </div>
    `;
  }

  list.innerHTML = html;

  // Group card toggle
  list.querySelectorAll('[data-action="toggle-group"]').forEach((el) => {
    el.addEventListener('click', () => toggleGroupSelection(el.dataset.id));
  });

  // Member row toggle (stop propagation so group card doesn't also fire)
  list.querySelectorAll('[data-action="toggle-member"]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMemberInGroupCard(el.dataset.id);
    });
  });

  // Ungrouped individual items
  list.querySelectorAll('.profile-item').forEach((item) => {
    item.addEventListener('click', () => {
      toggleSelect(item.dataset.id);
      renderGroupFillView();
    });
  });
}

function toggleGroupSelection(groupId) {
  const members = allProfiles.filter((p) => p.groupId === groupId);
  const allSelected = members.length > 0 && members.every((p) => selectedIds.has(p.id));

  if (allSelected) {
    // Deselect all → collapse member list
    members.forEach((p) => selectedIds.delete(p.id));
  } else {
    // Select all
    members.forEach((p) => selectedIds.add(p.id));
  }

  renderGroupFillView();
  updateSelectionUI();
}

function toggleMemberInGroupCard(profileId) {
  if (selectedIds.has(profileId)) {
    selectedIds.delete(profileId);
  } else {
    selectedIds.add(profileId);
  }
  renderGroupFillView();
  updateSelectionUI();
}

// ─── INDIVIDUAL MODE ──────────────────────────────────────────────────────────

function renderGroupTabs() {
  const container = document.getElementById('group-tabs');
  if (allGroups.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';

  container.innerHTML =
    `<button class="group-tab${activeGroup === '' ? ' active' : ''}" data-group="">All</button>` +
    allGroups
      .filter((g) => allProfiles.some((p) => p.groupId === g.id))
      .map((g) => `<button class="group-tab${activeGroup === g.id ? ' active' : ''}" data-group="${g.id}">${escHtml(g.name)}</button>`)
      .join('');

  container.querySelectorAll('.group-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.group-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeGroup = btn.dataset.group;
      renderProfileList();
      updateSelectionUI();
    });
  });
}

function renderProfileList() {
  const list = document.getElementById('profile-list');
  const filtered = activeGroup
    ? allProfiles.filter((p) => p.groupId === activeGroup)
    : allProfiles;

  list.innerHTML = filtered.map((p) => profileItemHTML(p)).join('');

  list.querySelectorAll('.profile-item').forEach((item) => {
    item.addEventListener('click', () => {
      toggleSelect(item.dataset.id);
      renderProfileList();
    });
  });

  updateSelectionUI();
}

function profileItemHTML(p) {
  const initials = p.name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() || '')
    .join('');
  const isSelected = selectedIds.has(p.id);
  const genderShort = p.gender === 'Male' ? '♂' : p.gender === 'Female' ? '♀' : '⚧';

  return `
    <div class="profile-item${isSelected ? ' selected' : ''}" data-id="${p.id}">
      <div class="profile-checkbox">
        <svg class="profile-checkbox-tick" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 5L4 7.5L8.5 2.5" stroke="#0d0f14" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="profile-avatar">${initials}</div>
      <div class="profile-info">
        <div class="profile-name">${escHtml(p.name)}</div>
        <div class="profile-detail">${genderShort} ${p.gender} · Age ${p.age} · ${escHtml(p.idType || 'No ID')}</div>
      </div>
    </div>
  `;
}

function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
}

function getVisibleProfileIds() {
  return (activeGroup
    ? allProfiles.filter((p) => p.groupId === activeGroup)
    : allProfiles
  ).map((p) => p.id);
}

// ─── Shared Selection UI ──────────────────────────────────────────────────────

function updateSelectionUI() {
  const count = selectedIds.size;
  document.getElementById('selection-count').textContent =
    count === 0 ? 'None selected' : `${count} selected`;

  const fillBtn = document.getElementById('btn-fill');
  fillBtn.disabled = count === 0 || !isOnTTDPage;

  // Live count on the Fill button
  if (!fillBtn.classList.contains('loading')) {
    fillBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      ${count > 0 ? `Fill ${count} Pilgrim${count !== 1 ? 's' : ''}` : 'Fill Details'}
    `;
  }

  // "Select All" label logic
  const selectAllBtn = document.getElementById('btn-select-all');
  if (currentMode === 'individual') {
    const visibleIds = getVisibleProfileIds();
    const allSel = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    selectAllBtn.textContent = allSel ? 'Deselect All' : 'Select All';
  } else {
    const allSel = allProfiles.length > 0 && allProfiles.every((p) => selectedIds.has(p.id));
    selectAllBtn.textContent = allSel ? 'Deselect All' : 'Select All';
  }
}

// ─── Listeners ────────────────────────────────────────────────────────────────

function attachListeners() {
  // Settings / manage profiles
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openOptions' });
  });

  // Add Profile buttons
  document.getElementById('btn-add-profile-header')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openOptions', hash: 'add-profile' });
  });
  document.getElementById('btn-add-profile-inline')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openOptions', hash: 'add-profile' });
  });
  document.getElementById('btn-add-first')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openOptions' });
  });

  // Mode toggle pills
  document.getElementById('mode-btn-group').addEventListener('click', () => switchMode('group'));
  document.getElementById('mode-btn-individual').addEventListener('click', () => switchMode('individual'));

  // Select All / Deselect All
  document.getElementById('btn-select-all')?.addEventListener('click', () => {
    if (currentMode === 'individual') {
      const visibleIds = getVisibleProfileIds();
      const allSel = visibleIds.every((id) => selectedIds.has(id));
      if (allSel) visibleIds.forEach((id) => selectedIds.delete(id));
      else        visibleIds.forEach((id) => selectedIds.add(id));
      renderProfileList();
    } else {
      const allSel = allProfiles.every((p) => selectedIds.has(p.id));
      if (allSel) allProfiles.forEach((p) => selectedIds.delete(p.id));
      else        allProfiles.forEach((p) => selectedIds.add(p.id));
      renderGroupFillView();
      updateSelectionUI();
    }
  });

  // Fill button
  document.getElementById('btn-fill').addEventListener('click', handleFill);
}

// ─── Fill ─────────────────────────────────────────────────────────────────────

async function handleFill() {
  const selected = allProfiles.filter((p) => selectedIds.has(p.id));
  if (selected.length === 0) return;

  const fillBtn = document.getElementById('btn-fill');
  fillBtn.classList.add('loading');
  fillBtn.innerHTML = `
    <div class="spinner" style="width:16px;height:16px;border-width:2px;border-color:rgba(0,0,0,0.2);border-top-color:#0d0f14;"></div>
    Filling…
  `;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'fillForm',
      profiles: selected,
      settings,
    });
    showResult(response);
  } catch (err) {
    showResult({ success: false, error: err.message || 'Unexpected error.' });
  }
}

function showResult(response) {
  const panel = document.getElementById('result-panel');
  const icon  = document.getElementById('result-icon');
  const text  = document.getElementById('result-text');
  const sub   = document.getElementById('result-sub');

  if (response?.success) {
    const { filled = [], skipped = [], failed = [] } = response;
    icon.textContent = '✅';
    text.textContent = 'Details Filled!';
    const parts = [];
    if (filled.length)  parts.push(`${filled.length} field${filled.length > 1 ? 's' : ''} filled`);
    if (skipped.length) parts.push(`${skipped.length} skipped`);
    if (failed.length)  parts.push(`${failed.length} could not be filled`);
    sub.textContent = parts.join(' · ') || 'Please review the form before proceeding.';
  } else {
    icon.textContent = '⚠️';
    text.textContent = 'Could Not Fill';
    sub.textContent = response?.error || 'An error occurred. Please try again.';
  }

  panel.classList.remove('hidden');

  setTimeout(() => {
    panel.classList.add('hidden');
    const fillBtn = document.getElementById('btn-fill');
    fillBtn.classList.remove('loading');
    fillBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      Fill Details
    `;
    updateSelectionUI();
  }, 4000);
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
