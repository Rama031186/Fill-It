/**
 * TTD Smart Autofill — Storage Module
 * All data lives exclusively in chrome.storage.local.
 * No network calls. No third-party access.
 */

const STORAGE_KEYS = {
  PROFILES:        'ttd_profiles',
  GROUPS:          'ttd_groups',
  SETTINGS:        'ttd_settings',
  GENERAL_DETAILS: 'ttd_general_details',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function get(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function set(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

// ─── Profiles ────────────────────────────────────────────────────────────────

/**
 * Returns all saved pilgrim profiles.
 * @returns {Promise<Array>}
 */
export async function getProfiles() {
  const result = await get(STORAGE_KEYS.PROFILES);
  return result[STORAGE_KEYS.PROFILES] || [];
}

/**
 * Saves (upsert) a pilgrim profile.
 * If profile.id exists, it updates; otherwise it creates a new one.
 * @param {Object} profile
 * @returns {Promise<Object>} saved profile
 */
export async function saveProfile(profile) {
  const profiles = await getProfiles();
  const now = Date.now();

  if (profile.id) {
    // Update existing
    const idx = profiles.findIndex((p) => p.id === profile.id);
    if (idx !== -1) {
      profiles[idx] = { ...profiles[idx], ...profile, updatedAt: now };
    } else {
      profiles.push({ ...profile, updatedAt: now, createdAt: now });
    }
  } else {
    // Create new
    const newProfile = {
      ...profile,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    profiles.push(newProfile);
    profile = newProfile;
  }

  await set({ [STORAGE_KEYS.PROFILES]: profiles });
  return profile;
}

/**
 * Deletes a profile by id.
 * @param {string} id
 */
export async function deleteProfile(id) {
  const profiles = await getProfiles();
  const updated = profiles.filter((p) => p.id !== id);
  await set({ [STORAGE_KEYS.PROFILES]: updated });
}

/**
 * Duplicates a profile (gives it a new id and name suffix).
 * @param {string} id
 * @returns {Promise<Object>} the new profile
 */
export async function duplicateProfile(id) {
  const profiles = await getProfiles();
  const source = profiles.find((p) => p.id === id);
  if (!source) throw new Error(`Profile ${id} not found`);

  const copy = {
    ...source,
    id: generateId(),
    name: source.name + ' (Copy)',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  profiles.push(copy);
  await set({ [STORAGE_KEYS.PROFILES]: profiles });
  return copy;
}

// ─── Groups ──────────────────────────────────────────────────────────────────

/**
 * Returns all family groups.
 * @returns {Promise<Array>}
 */
export async function getGroups() {
  const result = await get(STORAGE_KEYS.GROUPS);
  return result[STORAGE_KEYS.GROUPS] || [];
}

/**
 * Saves (upsert) a family group.
 * @param {Object} group - { id?, name }
 * @returns {Promise<Object>}
 */
export async function saveGroup(group) {
  const groups = await getGroups();

  if (group.id) {
    const idx = groups.findIndex((g) => g.id === group.id);
    if (idx !== -1) {
      groups[idx] = { ...groups[idx], ...group };
    } else {
      groups.push(group);
    }
  } else {
    group = { ...group, id: generateId() };
    groups.push(group);
  }

  await set({ [STORAGE_KEYS.GROUPS]: groups });
  return group;
}

/**
 * Deletes a group by id. Profiles in that group become ungrouped.
 * @param {string} id
 */
export async function deleteGroup(id) {
  const [groups, profiles] = await Promise.all([getGroups(), getProfiles()]);
  const updatedGroups = groups.filter((g) => g.id !== id);
  const updatedProfiles = profiles.map((p) =>
    p.groupId === id ? { ...p, groupId: null } : p
  );
  await set({
    [STORAGE_KEYS.GROUPS]: updatedGroups,
    [STORAGE_KEYS.PROFILES]: updatedProfiles,
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  skipFilledFields: true,
  showConfirmation: true,
  fillDelay: 150, // ms between filling each field (give TTD's JS time to react)
};

/**
 * Returns current settings (merged with defaults).
 * @returns {Promise<Object>}
 */
export async function getSettings() {
  const result = await get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
}

/**
 * Updates settings (partial update supported).
 * @param {Object} updates
 */
export async function saveSettings(updates) {
  const current = await getSettings();
  await set({ [STORAGE_KEYS.SETTINGS]: { ...current, ...updates } });
}

// ─── General Details ─────────────────────────────────────────────────────────

const DEFAULT_GENERAL_DETAILS = {
  gothram: '',
  email:   '',
  city:    '',
  state:   '',
  country: 'India',
  pincode: '',
};

/**
 * Returns the saved general details (merged with defaults).
 * These are booking-level fields (Gothram, Email, City, State, Country, Pincode).
 * @returns {Promise<Object>}
 */
export async function getGeneralDetails() {
  const result = await get(STORAGE_KEYS.GENERAL_DETAILS);
  return { ...DEFAULT_GENERAL_DETAILS, ...(result[STORAGE_KEYS.GENERAL_DETAILS] || {}) };
}

/**
 * Saves (partial update) general details.
 * @param {Object} updates
 */
export async function saveGeneralDetails(updates) {
  const current = await getGeneralDetails();
  await set({ [STORAGE_KEYS.GENERAL_DETAILS]: { ...current, ...updates } });
}

// ─── Export all data (for debugging / future backup) ────────────────────────

export async function exportAllData() {
  const [profiles, groups, settings, generalDetails] = await Promise.all([
    getProfiles(),
    getGroups(),
    getSettings(),
    getGeneralDetails(),
  ]);
  return { profiles, groups, settings, generalDetails, exportedAt: new Date().toISOString() };
}
