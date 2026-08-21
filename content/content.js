/**
 * TTD Smart Autofill — Content Script (v5 — label-first, name-fallback)
 *
 * Field identification strategy (most-to-least stable):
 *
 *  1. `label` attribute on the input element  ← MOST STABLE
 *     TTD keeps input[label="Gender"] consistent even when input[name] changes.
 *     e.g. name changed: fname → name, photoIdType → idType, idProofNumber → idNumber
 *
 *  2. Known `name` attribute variants         ← FALLBACK
 *     We keep a list of every name= value we've ever observed for each field.
 *
 *  3. Adjacent visible <label> text           ← LAST RESORT
 *     Walk up to the wrapper div, find the <label> element and compare text.
 *
 * For N pilgrims, querySelectorAll returns N copies of each field in DOM order.
 * Pilgrim i always uses index i.
 */

'use strict';

// ─── Field Definitions ────────────────────────────────────────────────────────

const TTD_FIELDS = [
  {
    key:       'name',
    labelAttr: 'Name',                      // input[label="Name"]
    names:     ['fname', 'name'],            // all observed name= variants
    label:     'Full Name',
    type:      'text',
  },
  {
    key:       'age',
    labelAttr: 'Age',
    names:     ['age'],
    label:     'Age',
    type:      'number',
  },
  {
    key:        'gender',
    labelAttr:  'Gender',
    names:      ['gender'],
    label:      'Gender',
    type:       'custom-dropdown',
    valueMap:   { Male: 'Male', Female: 'Female', Other: 'Transgender' },
    // TTD always pre-selects 'Female'; always overwrite regardless of skipFilledFields.
    alwaysFill: true,
  },
  {
    key:      'idType',
    labelAttr: 'Photo ID Proof',
    names:    ['photoIdType', 'idType'],     // photoIdType (old) → idType (new)
    label:    'Photo ID Type',
    type:     'custom-dropdown',
    valueMap: {
      'Aadhaar':         'Aadhaar',
      'Voter ID':        'Voter ID',
      'Passport':        'Passport',
      'PAN':             'PAN',
      'Driving Licence': 'Driving',
    },
  },
  {
    key:           'idNumber',
    labelAttr:     'Photo ID Number',
    names:         ['idProofNumber', 'idNumber'],  // idProofNumber → idNumber
    label:         'Photo ID Number',
    type:          'text',
    startsDisabled: true,
  },
];

// ─── Message Listener ─────────────────────────────────────────────────────────

// ─── General Details Field Definitions ───────────────────────────────────────
// These are booking-level (single occurrence) fields — not per-pilgrim.

const GENERAL_FIELDS = [
  {
    key:       'gothram',
    labelAttr: 'Gothram',
    names:     ['pilgrimGothram'],
    label:     'Gothram',
    type:      'text',
  },
  {
    key:       'email',
    labelAttr: 'Email Address',
    names:     ['pilgrimEmail'],
    label:     'Email Address',
    type:      'text',
  },
  {
    key:       'city',
    labelAttr: 'City',
    names:     ['pilgrimCity'],
    label:     'City',
    type:      'text',
  },
  {
    key:       'state',
    labelAttr: 'State',
    names:     ['pilgrimState'],
    label:     'State',
    type:      'text',
  },
  {
    key:       'country',
    labelAttr: 'Country',
    names:     ['pilgrimCountry'],
    label:     'Country',
    type:      'text',
  },
  {
    key:       'pincode',
    labelAttr: 'Pincode',
    names:     ['pilgrimPincode'],
    label:     'Pincode',
    type:      'text',
  },
];

// ─── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'fillForm') {
    fillForm(message.profiles, message.settings)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: String(err?.message || err) }));
    return true;
  }

  if (message.action === 'fillGeneral') {
    fillGeneralForm(message.generalDetails, message.settings)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: String(err?.message || err) }));
    return true;
  }

  return false;
});

// ─── Fill General Details Form ────────────────────────────────────────────────

async function fillGeneralForm(generalDetails, settings = {}) {
  const { skipFilledFields = true, fillDelay = 200 } = settings;
  const filled = [], skipped = [], failed = [];

  for (const field of GENERAL_FIELDS) {
    const value = generalDetails[field.key];
    if (value === undefined || value === null || value === '') continue;

    await sleep(fillDelay);

    try {
      // General fields are single-occurrence — find the first matching input (no index)
      const el = getGeneralInput(field);
      if (!el) { failed.push(field.label); continue; }

      if (skipFilledFields && el.value.trim() !== '') {
        skipped.push(field.label + ' (already filled)');
        continue;
      }

      setReactValue(el, String(value));
      filled.push(field.label);
    } catch (err) {
      console.warn('[TTD Autofill] General field error:', field.label, err);
      failed.push(field.label);
    }
  }

  return { success: true, filled, skipped, failed };
}

/**
 * Finds a single (non-index) general input using the same label-first strategy
 * as getInputAt(), but returns just the first matching element.
 */
function getGeneralInput(field) {
  // Strategy 1: label attribute
  if (field.labelAttr) {
    const el = document.querySelector(`input.floating-input[label="${field.labelAttr}"]`);
    if (el && el.type !== 'hidden') return el;
  }
  // Strategy 2: name attribute variants
  for (const name of (field.names || [])) {
    const el = document.querySelector(`input.floating-input[name="${name}"]`);
    if (el && el.type !== 'hidden') return el;
  }
  // Strategy 3: adjacent label text
  if (field.labelAttr) {
    const target = field.labelAttr.toLowerCase();
    for (const el of document.querySelectorAll('input.floating-input')) {
      if (el.type === 'hidden') continue;
      const lbl = el.parentElement?.querySelector('label');
      if (lbl && lbl.textContent.trim().toLowerCase().includes(target)) return el;
    }
  }
  return null;
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

async function fillForm(profiles, settings = {}) {
  const { skipFilledFields = true, fillDelay = 200 } = settings;
  const filled = [], skipped = [], failed = [];

  // Wait up to 6 s for the form to appear (handles slow / dynamic page loads)
  const ready = await waitForForm(6000);
  if (!ready) {
    return {
      success: false,
      error: 'Pilgrim details form not found. Navigate to the pilgrim entry step and try again.',
      filled, skipped, failed,
    };
  }

  // How many pilgrim slots does the page currently show?
  const slotsOnPage = countPilgrimSlots();

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];

    // Don't try to fill more pilgrims than the page has slots for
    if (i >= slotsOnPage) {
      failed.push(`Pilgrim ${i + 1}: No slot available on page (page shows ${slotsOnPage})`);
      continue;
    }

    for (const field of TTD_FIELDS) {
      const value = profile[field.key];
      if (value === undefined || value === null || value === '') continue;

      await sleep(fillDelay);

      let result;
      try {
        if (field.type === 'custom-dropdown') {
          result = await fillDropdown(i, field, String(value), skipFilledFields);
        } else {
          result = await fillText(i, field, String(value), skipFilledFields);
        }
      } catch (err) {
        console.warn(`[TTD Autofill] Error on Pilgrim ${i + 1} – ${field.label}:`, err);
        result = 'failed';
      }

      const tag = `Pilgrim ${i + 1}: ${field.label}`;
      if      (result === 'filled')  filled.push(tag);
      else if (result === 'skipped') skipped.push(tag + ' (already filled)');
      else                           failed.push(tag);
    }
  }

  return { success: true, filled, skipped, failed };
}

// ─── Slot Count ───────────────────────────────────────────────────────────────

/**
 * How many pilgrim entry slots are currently visible on the page?
 * Counts the number of fname inputs as a proxy.
 */
function countPilgrimSlots() {
  // Strategy 1: label attribute (stable across TTD field renames)
  const byLabel = document.querySelectorAll('input.floating-input[label="Name"]');
  if (byLabel.length > 0) return byLabel.length;
  // Strategy 2: known name= variants for the Name field
  for (const n of ['fname', 'name']) {
    const els = document.querySelectorAll(`input.floating-input[name="${n}"]`);
    if (els.length > 0) return els.length;
  }
  return 0;
}

// ─── Wait for Form ────────────────────────────────────────────────────────────

function waitForForm(timeout = 6000) {
  if (formPresent()) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timer = setTimeout(() => { obs.disconnect(); resolve(formPresent()); }, timeout);
    const obs = new MutationObserver(() => {
      if (formPresent()) { obs.disconnect(); clearTimeout(timer); resolve(true); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
}

function formPresent() {
  // Strategy 1: label attribute
  if (document.querySelector('input.floating-input[label="Name"]')) return true;
  // Strategy 2: any known name= variant for the Name field
  return ['fname', 'name'].some(
    (n) => document.querySelector(`input.floating-input[name="${n}"]`) !== null
  );
}

// ─── Index-based Input Getter ─────────────────────────────────────────────────

/**
 * Returns the i-th matching input on the page (0-indexed), using a ranked
 * three-strategy search so the extension survives TTD's field renames.
 *
 * Strategy 1 — label attribute (MOST STABLE):
 *   input.floating-input[label="Gender"]  stays constant across TTD updates.
 *
 * Strategy 2 — name attribute variants:
 *   We keep a list of every name= value we've ever seen for each field,
 *   e.g. ['photoIdType', 'idType'] for the Photo ID dropdown.
 *
 * Strategy 3 — adjacent <label> text (LAST RESORT):
 *   Walk up from the input to its wrapper div, find a visible <label>, compare.
 *
 * @param {object}  field         - full field definition from TTD_FIELDS
 * @param {number}  pilgrimIndex  - 0-based
 * @param {boolean} allowDisabled - pass true for the idNumber field
 */
function getInputAt(field, pilgrimIndex, allowDisabled = false) {
  const keep = (el) =>
    el && el.type !== 'hidden' && (allowDisabled || !el.disabled);

  const pick = (els) => {
    const valid = [...els].filter(keep);
    return valid[pilgrimIndex] ?? null;
  };

  // ── Strategy 1: label attribute ─────────────────────────────────────────
  if (field.labelAttr) {
    const found = pick(
      document.querySelectorAll(`input.floating-input[label="${field.labelAttr}"]`)
    );
    if (found) return found;
  }

  // ── Strategy 2: name attribute variants ──────────────────────────────────
  for (const name of (field.names || [])) {
    const found = pick(
      document.querySelectorAll(`input.floating-input[name="${name}"]`)
    );
    if (found) return found;
  }

  // ── Strategy 3: adjacent <label> text ────────────────────────────────────
  // Walk every floating-input on the page; for each, check if the nearby
  // <label> element contains the field's label text.
  if (field.labelAttr) {
    const target = field.labelAttr.toLowerCase();
    const allInputs = [...document.querySelectorAll('input.floating-input')].filter(keep);
    const matched   = allInputs.filter((el) => {
      // The adjacent label is usually a sibling inside the same parent div.
      const wrapper = el.parentElement;
      if (!wrapper) return false;
      const lbl = wrapper.querySelector('label');
      return lbl && lbl.textContent.trim().toLowerCase().includes(target);
    });
    if (matched[pilgrimIndex]) return matched[pilgrimIndex];
  }

  return null;
}

// ─── Fill Text / Number Field ─────────────────────────────────────────────────

async function fillText(pilgrimIndex, field, value, skipFilledFields) {
  // Pass the full field object so getInputAt can use label-first strategy
  const el = getInputAt(field, pilgrimIndex, /* allowDisabled */ true);
  if (!el) return 'failed';

  if (skipFilledFields && el.value.trim() !== '') return 'skipped';

  // If still disabled, wait up to 3 s for TTD's JS to enable it
  if (el.disabled) {
    const enabled = await waitForEnabled(el, 3000);
    if (!enabled) {
      // Force-enable as last resort
      el.removeAttribute('disabled');
      el.disabled = false;
    }
  }

  setReactValue(el, value);
  return 'filled';
}

// ─── Fill Custom Dropdown ─────────────────────────────────────────────────────

async function fillDropdown(pilgrimIndex, field, value, skipFilledFields) {
  // Pass the full field object so getInputAt can use label-first strategy
  const el = getInputAt(field, pilgrimIndex, false);
  if (!el) return 'failed';

  const currentVal = el.value.trim();
  const targetText  = (field.valueMap || {})[value] ?? value;

  // Skip logic: bypass entirely for alwaysFill fields (e.g. gender — TTD always
  // pre-shows "Female" so we must overwrite it for every Male/Transgender profile).
  if (!field.alwaysFill && skipFilledFields) {
    if (currentVal !== '' && currentVal.toLowerCase() !== targetText.toLowerCase()) {
      // Field already has a user-chosen value that differs from our target — skip.
      return 'skipped';
    }
    if (currentVal.toLowerCase() === targetText.toLowerCase()) {
      // Already has the exact value we'd set — nothing to do.
      return 'skipped';
    }
  }

  // ── Find the wrapper that will contain the dropdown <ul> ──────────────────
  // CRITICAL: The <input> itself has `position: relative` in its own inline
  // style, so el.closest('[style*="position: relative"]') returns the INPUT
  // itself — not its container. The dropdown <ul> is rendered as a SIBLING of
  // the input inside its parent. We must therefore start from parentElement.
  let wrapper = el.parentElement;

  // Walk up until we find a node that already has, or could host, a <ul>.
  // Stop at a reasonable depth to avoid going all the way to <body>.
  for (let depth = 0; depth < 5 && wrapper && wrapper !== document.body; depth++) {
    // If this ancestor already has floating dropdown list items, we found it.
    if (wrapper.querySelector('[class*="floatingDropdown_listItem"]') ||
        wrapper.querySelector('ul')) {
      break;
    }
    // Also stop if this ancestor is wide enough to be the field container
    // (has more than one child element — i.e. input + label/overlay + dropdown).
    if (wrapper.children.length >= 2) break;
    wrapper = wrapper.parentElement;
  }

  if (!wrapper || wrapper === document.body) {
    console.warn('[TTD Autofill] Cannot find wrapper for', field.name, 'pilgrim', pilgrimIndex);
    return 'failed';
  }

  // Open the dropdown
  simulateClick(el);

  // Small pause so the dropdown animation/render completes before we search
  await sleep(150);

  // Wait for the matching <li> to appear
  const listItem = await waitForListItem(wrapper, targetText, 3000);

  if (!listItem) {
    simulateClick(el); // close
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    console.warn('[TTD Autofill] No list item found for:', targetText, '(pilgrim', pilgrimIndex, ')');
    return 'failed';
  }

  // Select the matching option — use clickListItem (not simulateClick) so we
  // don't focus() the <li>, which would blur the input and close the dropdown.
  clickListItem(listItem);

  // Allow React state to settle after selection
  await sleep(300);

  return el.value.trim() !== '' ? 'filled' : 'failed';
}

// ─── Wait for <li> Matching Text ──────────────────────────────────────────────

function waitForListItem(wrapper, targetText, timeout = 3000) {
  // Check immediately in the wrapper and document (portal fallback)
  const immediate = findListItem(wrapper, targetText);
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let resolved = false;
    const done = (item) => {
      if (resolved) return;
      resolved = true;
      obsWrapper.disconnect();
      obsBody.disconnect();
      clearTimeout(timer);
      resolve(item);
    };

    const timer = setTimeout(() => done(findListItem(wrapper, targetText)), timeout);

    // Watch the wrapper (most likely location)
    const obsWrapper = new MutationObserver(() => {
      const item = findListItem(wrapper, targetText);
      if (item) done(item);
    });
    obsWrapper.observe(wrapper, { childList: true, subtree: true });

    // Also watch document.body — TTD may render the dropdown as a React portal
    // appended directly to body rather than inside the field's DOM tree.
    const obsBody = new MutationObserver(() => {
      const item = findListItem(wrapper, targetText);
      if (item) done(item);
    });
    obsBody.observe(document.body, { childList: true, subtree: true });
  });
}

function findListItem(wrapper, targetText) {
  const lower = targetText.toLowerCase().trim();

  // THREE-PASS PRIORITY: exact → starts-with → contains.
  //
  // Using plain .includes() caused 'male' to match 'Fe\u001Amale\u001A' (Female)
  // because 'female'.includes('male') === true, and Female appears first in the
  // TTD dropdown list. Exact match is tried first so 'Male' always wins over
  // 'Female'. startsWith handles 'Aadhaar' → 'Aadhaar Card' etc.
  //
  // Searches wrapper first, then document.body as a portal fallback.
  for (const pass of ['exact', 'startsWith', 'includes']) {
    for (const scope of [wrapper, document.body]) {
      for (const sel of ['[class*="floatingDropdown_listItem"]', 'li']) {
        for (const li of scope.querySelectorAll(sel)) {
          const text = li.textContent.trim().toLowerCase();
          if (pass === 'exact'      && text === lower)           return li;
          if (pass === 'startsWith' && text.startsWith(lower))   return li;
          if (pass === 'includes'   && text.includes(lower))     return li;
        }
      }
    }
  }

  return null;
}

// ─── Wait for Input to Become Enabled ────────────────────────────────────────

function waitForEnabled(el, timeout = 3000) {
  if (!el.disabled) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timer = setTimeout(() => { obs.disconnect(); resolve(!el.disabled); }, timeout);
    const obs = new MutationObserver(() => {
      if (!el.disabled) { obs.disconnect(); clearTimeout(timer); resolve(true); }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['disabled'] });
  });
}

// ─── DOM Helpers ──────────────────────────────────────────────────────────────

/**
 * Sets an input's value using React's native property descriptor setter,
 * then fires the full suite of events React/Angular listen to.
 */
function setReactValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;

  if (setter) setter.call(el, value);
  else         el.value = value;

  el.dispatchEvent(new InputEvent('input',  { bubbles: true, cancelable: true, data: value }));
  el.dispatchEvent(new Event   ('change',   { bubbles: true, cancelable: true }));
  el.dispatchEvent(new FocusEvent('blur',   { bubbles: true, cancelable: true }));
}

/**
 * Simulates a full click on an interactive element (e.g. to open a dropdown).
 * Includes focus() so the element receives keyboard/blur events correctly.
 */
function simulateClick(el) {
  el.focus();
  // Include pointer events — React 17+ uses a global pointer-event listener
  // for its synthetic event system; without these, clicks on custom dropdowns
  // may open but not commit the selection.
  const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
    el.dispatchEvent(new MouseEvent(type, opts));
  });
}

/**
 * Clicks a dropdown list item WITHOUT calling focus().
 * Calling focus() on an <li> blurs the backing <input>, which causes React's
 * onBlur handler to close the dropdown before the click event fires, so the
 * selection is never committed. This function skips focus entirely.
 */
function clickListItem(el) {
  const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
    el.dispatchEvent(new MouseEvent(type, opts));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
