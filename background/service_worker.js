/**
 * TTD Smart Autofill — Background Service Worker
 * Relays messages between the popup and the content script.
 * Manages the extension badge to show fill status.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fillForm') {
    // Relay fill request from popup → active tab content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        sendResponse({ success: false, error: 'No active tab found.' });
        return;
      }

      const tabId = tabs[0].id;
      const url = tabs[0].url || '';

      if (!url.includes('ttdevasthanams.ap.gov.in')) {
        sendResponse({
          success: false,
          error: 'Please navigate to the TTD booking page first.',
        });
        return;
      }

      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error:
              'Could not connect to the page. Please refresh the TTD booking page and try again.',
          });
          return;
        }
        // Update badge based on result
        if (response && response.success) {
          chrome.action.setBadgeText({ text: '✓', tabId });
          chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId });
        } else {
          chrome.action.setBadgeText({ text: '!', tabId });
          chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
        }
        // Clear badge after 4 seconds
        setTimeout(() => {
          chrome.action.setBadgeText({ text: '', tabId });
        }, 4000);

        sendResponse(response);
      });
    });

    return true; // Keep message channel open for async response
  }

  if (message.action === 'openOptions') {
    const hash = message.hash || '';
    chrome.runtime.openOptionsPage(() => {
      if (hash === 'add-profile') {
        // Give the options page a moment to load, then trigger "Add Profile"
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'triggerAddProfile' });
        }, 400);
      }
    });
    sendResponse({ success: true });
    return false;
  }
});

// Clear badge when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId });
  }
});
