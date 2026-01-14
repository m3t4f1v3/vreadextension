const textInput = document.getElementById('textInput');
const wordCount = document.getElementById('wordCount');
const readTime = document.getElementById('readTime');
const wpmInput = document.getElementById('wpmInput');
const chunkInput = document.getElementById('chunkInput');
const startBtn = document.getElementById('startBtn');
const clearBtn = document.getElementById('clearBtn');

// Load settings from storage
chrome.storage.sync.get(['wpm', 'chunk'], (data) => {
    if (data.wpm) {
    wpmInput.value = data.wpm;
    }
    if (data.chunk) {
    chunkInput.value = data.chunk;
    }
    updateReadTime();
});

// Save settings when changed
wpmInput.addEventListener('input', () => {
    const value = parseInt(wpmInput.value);
    if (value >= 50) {
    chrome.storage.sync.set({ wpm: value });
    updateReadTime();
    }
});

chunkInput.addEventListener('input', () => {
    const value = parseInt(chunkInput.value);
    if (value >= 1) {
    chrome.storage.sync.set({ chunk: value });
    }
});

// Update stats
function updateStats() {
    const text = textInput.value.trim();
    const words = text.split(/\s+/).filter(w => w).length;
    wordCount.textContent = words;
    updateReadTime();
}

function updateReadTime() {
    const text = textInput.value.trim();
    const words = text.split(/\s+/).filter(w => w).length;
    const wpm = parseInt(wpmInput.value) || 300;
    readTime.textContent = Math.max(1, Math.ceil(words / wpm));
}

textInput.addEventListener('input', updateStats);

// Clear button
clearBtn.addEventListener('click', () => {
    if (textInput.value.trim() && !confirm('Clear all text?')) {
    return;
    }
    textInput.value = '';
    chrome.storage.local.remove(['draftText']);
    updateStats();
    textInput.focus();
});

// Start reading
startBtn.addEventListener('click', async () => {
    const text = textInput.value.trim();
    if (!text) {
    alert('Please enter some text first!');
    return;
    }

    const wpm = parseInt(wpmInput.value) || 300;
    const chunk = parseInt(chunkInput.value) || 3;

    if (wpm < 50) {
    alert('Speed must be at least 50 WPM');
    return;
    }

    if (chunk < 1) {
    alert('Chunk size must be at least 1');
    return;
    }

    // Save settings
    chrome.storage.sync.set({ wpm, chunk });

    // Try to inject into the current active tab
    try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: false });
    
    if (tabs.length > 0) {
        const tab = tabs[0];
        
        // Send message to content script
        chrome.tabs.sendMessage(tab.id, {
        type: 'addCustomTextAndRead',
        text: text,
        wpm: wpm,
        chunk: chunk
        }, (response) => {
        if (chrome.runtime.lastError) {
            // If content script not loaded, try to inject it
            chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
            }).then(() => {
            chrome.scripting.insertCSS({
                target: { tabId: tab.id },
                files: ['styles.css']
            }).then(() => {
                // Try sending message again
                setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'addCustomTextAndRead',
                    text: text,
                    wpm: wpm,
                    chunk: chunk
                });
                }, 500);
            });
            }).catch((err) => {
            console.error('Could not inject script:', err);
            alert('Please navigate to a webpage first, then try again.');
            });
        } else {
            console.log('Reading started successfully');
        }
        });
        
        // Switch to that tab
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
    } else {
        alert('Please open a webpage first, then try again.');
    }
    } catch (error) {
    console.error('Error starting reading:', error);
    alert('Error starting reading. Please try again.');
    }
});

// Load saved text from storage
chrome.storage.local.get(['draftText'], (data) => {
    if (data.draftText) {
    textInput.value = data.draftText;
    updateStats();
    }
});

// Auto-save draft
let saveTimeout;
textInput.addEventListener('input', () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
    chrome.storage.local.set({ draftText: textInput.value });
    }, 1000);
});

updateStats();