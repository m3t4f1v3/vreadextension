// Background service worker for V-Read

let authWindowId = null;

chrome.runtime.onInstalled.addListener(() => {
  console.log("V-Read v2.0 installed!");
  
  // Set default values
  chrome.storage.sync.get(["wpm", "chunk", "enabled"], (data) => {
    if (!data.wpm) chrome.storage.sync.set({ wpm: 300 });
    if (!data.chunk) chrome.storage.sync.set({ chunk: 3 });
    if (data.enabled === undefined) chrome.storage.sync.set({ enabled: true });
  });
});

// Handle text input tab creation
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "openTextInputTab") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("src/text-input-tab/text-input-tab.html")
    });
    sendResponse({ success: true });
  }
  
  if (message.type === 'openAuth') {
    chrome.windows.create({
      url: chrome.runtime.getURL('src/auth/auth.html'),
      type: 'popup',
      width: 480,
      height: 720,
      focused: true
    }, (window) => {
      authWindowId = window.id;
      sendResponse({ success: true, windowId: window.id });
    });
    return true;
  }
  
  if (message.type === 'closeAuthWindow') {
    if (authWindowId) {
      chrome.windows.remove(authWindowId, () => {
        authWindowId = null;
        sendResponse({ success: true });
      });
    } else if (sender.tab && sender.tab.windowId) {
      chrome.windows.remove(sender.tab.windowId, () => {
        sendResponse({ success: true });
      });
    }
    return true;
  }
  
  return true;
});

// Inject content script into all tabs on install
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['styles.css']
        });
      } catch (error) {
        console.log('Could not inject into tab:', tab.url);
      }
    }
  }
});
