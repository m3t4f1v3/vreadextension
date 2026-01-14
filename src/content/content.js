// State management
let isEnabled = true; // Default true for immediate functionality
let fragments = [];
let customTextFragments = [];
let isReading = false;
let isPaused = false;
let floatingButtons = null;
let textInputModal = null;
let lastSelection = null;
let selectionTimer = null;
let buttonsVisible = false;
// Undo/Redo state
let undoStack = [];
let redoStack = [];
const MAX_UNDO_STACK = 50;

// ADD THESE LINES HERE:
let totalWordsRead = 0;
let isAuthenticated = false;

console.log("🚀 V-Read content script loaded!");

async function checkWordLimit() {
  const { wordsRead, authenticated } = await chrome.storage.local.get(['wordsRead', 'authenticated']);
  totalWordsRead = wordsRead || 0;
  isAuthenticated = authenticated || false;
  
  console.log('🔍 Word limit check:', { totalWordsRead, isAuthenticated, limit: 10 });
  
  if (!isAuthenticated && totalWordsRead >= 1000) {
    console.log('🚫 Word limit reached! Opening auth...');
    chrome.runtime.sendMessage({ type: 'openAuth' });
    return false;
  }
  console.log('✅ Can continue reading');
  return true;
}

(async function initialize() {
  try {
    const data = await chrome.storage.sync.get(["enabled"]);
    isEnabled = data.enabled !== undefined ? data.enabled : true;
    
    console.log(`🔄 Initial state: ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
    
    if (isEnabled) {
      if (document.readyState === 'loading') {
        await new Promise(resolve => {
          document.addEventListener('DOMContentLoaded', resolve);
        });
      }
      
      initializeFloatingButtons();
      initializePersistentControls();
      showWelcomeHint();
    }
    
    // CRITICAL: Listen for storage changes from other tabs
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.enabled) {
        const newEnabled = changes.enabled.newValue;
        console.log(`🔄 Storage sync: ${newEnabled ? 'ENABLED' : 'DISABLED'}`);
        
        if (newEnabled !== isEnabled) {
          isEnabled = newEnabled;
          
          if (!isEnabled) {
            // Extension was disabled - clean up immediately
            stopReading();
            
            if (floatingButtons && floatingButtons.parentNode) {
              floatingButtons.parentNode.removeChild(floatingButtons);
              floatingButtons = null;
            }
            
            document.querySelectorAll('.vread-floating-buttons, #vread-end-button-separate, #vread-persistent-controls, .vread-welcome-hint, #vread-reading-controls, .vread-custom-reading-display').forEach(el => {
              if (el.parentNode) el.parentNode.removeChild(el);
            });
            
            buttonsVisible = false;
            lastSelection = null;
            clearTimeout(selectionTimer);
            
            const sel = window.getSelection();
            if (sel) sel.removeAllRanges();
          } else {
            // Extension was enabled
            setTimeout(() => {
              initializeFloatingButtons();
              initializePersistentControls();
              showWelcomeHint();
            }, 100);
          }
        }
      }
    });
  } catch (error) {
    console.error("❌ Initialization error:", error);
  }
})();

// Initialize - MUST complete before anything else
document.addEventListener("keydown", (e) => {
  console.log("🎹 Key pressed:", e.key, "Ctrl:", e.ctrlKey, "Meta:", e.metaKey, "Shift:", e.shiftKey);
  
  if (!isEnabled) {
    console.log("❌ Extension disabled");
    return;
  }
  
  // Ctrl+Z for undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    console.log("🔄 Undo triggered!");
    e.preventDefault();
    undo();
    return;
  }
  
  // Ctrl+Y or Cmd+Shift+Z for redo
  if (((e.ctrlKey || e.metaKey) && e.key === 'y') || 
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
    console.log("🔄 Redo triggered!");
    e.preventDefault();
    redo();
    return;
  }
  
  if (e.key === "Escape") {
    if (isReading) {
      stopReading();
      e.preventDefault();
    } else if (textInputModal) {
      textInputModal.querySelector(".vread-modal-close").click();
    }
  }
});

function showWelcomeHint() {
  if (!isEnabled) return;
  
  chrome.storage.local.get(["vreadWelcomeShown"], (data) => {
    if (!data.vreadWelcomeShown) {
      setTimeout(() => {
        const hint = document.createElement("div");
        hint.className = "vread-welcome-hint";
        hint.innerHTML = `
          <div class="vread-hint-content">
            <div class="vread-hint-icon">👋</div>
            <div class="vread-hint-text">
              <strong>V-Read is active!</strong>
              <p>Select text to mark Start/End points</p>
            </div>
            <button class="vread-hint-close">Got it</button>
          </div>
        `;
        document.body.appendChild(hint);
        setTimeout(() => hint.classList.add("vread-hint-visible"), 100);

        hint.querySelector(".vread-hint-close").addEventListener("click", () => {
          hint.classList.remove("vread-hint-visible");
          setTimeout(() => hint.remove(), 300);
          chrome.storage.local.set({ vreadWelcomeShown: true });
        });

        setTimeout(() => {
          if (hint.parentNode) {
            hint.classList.remove("vread-hint-visible");
            setTimeout(() => hint.remove(), 300);
            chrome.storage.local.set({ vreadWelcomeShown: true });
          }
        }, 8000);
      }, 1000);
    }
  });
}

function saveStateForUndo() {
  const state = {
    fragments: fragments.map(f => ({
      id: f.id,
      startText: f.startText,
      endText: f.endText,
      text: f.text,
      wordCount: f.wordCount
    })),
    customTextFragments: [...customTextFragments]
  };
  
  undoStack.push(state);
  if (undoStack.length > MAX_UNDO_STACK) {
    undoStack.shift();
  }
  redoStack = [];
}

function undo() {
  if (undoStack.length === 0) {
    console.log("⚠️ Nothing to undo");
    return;
  }
  
  // Save current state to redo
  const currentState = {
    fragments: fragments.map(f => ({
      id: f.id,
      startText: f.startText,
      endText: f.endText,
      text: f.text,
      wordCount: f.wordCount
    })),
    customTextFragments: [...customTextFragments]
  };
  redoStack.push(currentState);
  
  // Get previous state
  const previousState = undoStack.pop();
  
  // Remove all current markers from DOM
  document.querySelectorAll('.vread-fragment-start, .vread-fragment-end').forEach(marker => {
    const parent = marker.parentNode;
    if (parent) {
      while (marker.firstChild) {
        parent.insertBefore(marker.firstChild, marker);
      }
      marker.remove();
    }
  });
  
  // Clear arrays
  fragments = [];
  customTextFragments = [...previousState.customTextFragments];
  
  // Recreate DOM markers for each fragment
  previousState.fragments.forEach(savedFrag => {
    if (!savedFrag.startText || !savedFrag.endText) return;
    
    // Find and mark the text in the document
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let startMarker = null;
    let endMarker = null;
    
    // Find start text
    let node;
    walker.currentNode = document.body;
    while ((node = walker.nextNode())) {
      if (node.textContent.includes(savedFrag.startText)) {
        const parent = node.parentElement;
        if (!parent.classList.contains('vread-fragment-start') && 
            !parent.classList.contains('vread-fragment-end')) {
          
          const text = node.textContent;
          const index = text.indexOf(savedFrag.startText);
          
          if (index !== -1) {
            const before = text.substring(0, index);
            const after = text.substring(index + savedFrag.startText.length);
            
            startMarker = document.createElement("span");
            startMarker.className = "vread-fragment-start";
            startMarker.dataset.fragmentId = savedFrag.id;
            startMarker.dataset.type = "start";
            startMarker.textContent = savedFrag.startText;
            startMarker.style.cursor = "pointer";
            startMarker.title = "Drag to adjust • Shift+Click to delete";
            
            const fragment = document.createDocumentFragment();
            if (before) fragment.appendChild(document.createTextNode(before));
            fragment.appendChild(startMarker);
            if (after) fragment.appendChild(document.createTextNode(after));
            
            parent.replaceChild(fragment, node);
            break;
          }
        }
      }
    }
    
    // Find end text
    walker.currentNode = document.body;
    while ((node = walker.nextNode())) {
      if (node.textContent.includes(savedFrag.endText)) {
        const parent = node.parentElement;
        if (parent !== startMarker && 
            !parent.classList.contains('vread-fragment-start') && 
            !parent.classList.contains('vread-fragment-end')) {
          
          const text = node.textContent;
          const index = text.indexOf(savedFrag.endText);
          
          if (index !== -1) {
            const before = text.substring(0, index);
            const after = text.substring(index + savedFrag.endText.length);
            
            endMarker = document.createElement("span");
            endMarker.className = "vread-fragment-end";
            endMarker.dataset.fragmentId = savedFrag.id;
            endMarker.dataset.type = "end";
            endMarker.textContent = savedFrag.endText;
            endMarker.style.cursor = "pointer";
            endMarker.title = "Drag to adjust • Shift+Click to delete";
            
            const fragment = document.createDocumentFragment();
            if (before) fragment.appendChild(document.createTextNode(before));
            fragment.appendChild(endMarker);
            if (after) fragment.appendChild(document.createTextNode(after));
            
            parent.replaceChild(fragment, node);
            break;
          }
        }
      }
    }
    
    // Add fragment to array
    if (startMarker || endMarker) {
      fragments.push({
        id: savedFrag.id,
        startElement: startMarker,
        startText: savedFrag.startText,
        endElement: endMarker,
        endText: savedFrag.endText,
        text: savedFrag.text,
        wordCount: savedFrag.wordCount
      });
    }
  });
  
  console.log(`↶ Undo (stack: ${undoStack.length}, redo: ${redoStack.length})`);
}

function redo() {
  if (redoStack.length === 0) {
    console.log("⚠️ Nothing to redo");
    return;
  }
  
  // Save current state to undo
  const currentState = {
    fragments: fragments.map(f => ({
      id: f.id,
      startText: f.startText,
      endText: f.endText,
      text: f.text,
      wordCount: f.wordCount
    })),
    customTextFragments: [...customTextFragments]
  };
  undoStack.push(currentState);
  
  // Get next state
  const nextState = redoStack.pop();
  
  // Remove all current markers from DOM
  document.querySelectorAll('.vread-fragment-start, .vread-fragment-end').forEach(marker => {
    const parent = marker.parentNode;
    if (parent) {
      while (marker.firstChild) {
        parent.insertBefore(marker.firstChild, marker);
      }
      marker.remove();
    }
  });
  
  // Clear arrays
  fragments = [];
  customTextFragments = [...nextState.customTextFragments];
  
  // Recreate DOM markers for each fragment
  nextState.fragments.forEach(savedFrag => {
    if (!savedFrag.startText || !savedFrag.endText) return;
    
    // Find and mark the text in the document
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let startMarker = null;
    let endMarker = null;
    
    // Find start text
    let node;
    walker.currentNode = document.body;
    while ((node = walker.nextNode())) {
      if (node.textContent.includes(savedFrag.startText)) {
        const parent = node.parentElement;
        if (!parent.classList.contains('vread-fragment-start') && 
            !parent.classList.contains('vread-fragment-end')) {
          
          const text = node.textContent;
          const index = text.indexOf(savedFrag.startText);
          
          if (index !== -1) {
            const before = text.substring(0, index);
            const after = text.substring(index + savedFrag.startText.length);
            
            startMarker = document.createElement("span");
            startMarker.className = "vread-fragment-start";
            startMarker.dataset.fragmentId = savedFrag.id;
            startMarker.dataset.type = "start";
            startMarker.textContent = savedFrag.startText;
            startMarker.style.cursor = "pointer";
            startMarker.title = "Drag to adjust • Shift+Click to delete";
            
            const fragment = document.createDocumentFragment();
            if (before) fragment.appendChild(document.createTextNode(before));
            fragment.appendChild(startMarker);
            if (after) fragment.appendChild(document.createTextNode(after));
            
            parent.replaceChild(fragment, node);
            break;
          }
        }
      }
    }
    
    // Find end text
    walker.currentNode = document.body;
    while ((node = walker.nextNode())) {
      if (node.textContent.includes(savedFrag.endText)) {
        const parent = node.parentElement;
        if (parent !== startMarker && 
            !parent.classList.contains('vread-fragment-start') && 
            !parent.classList.contains('vread-fragment-end')) {
          
          const text = node.textContent;
          const index = text.indexOf(savedFrag.endText);
          
          if (index !== -1) {
            const before = text.substring(0, index);
            const after = text.substring(index + savedFrag.endText.length);
            
            endMarker = document.createElement("span");
            endMarker.className = "vread-fragment-end";
            endMarker.dataset.fragmentId = savedFrag.id;
            endMarker.dataset.type = "end";
            endMarker.textContent = savedFrag.endText;
            endMarker.style.cursor = "pointer";
            endMarker.title = "Drag to adjust • Shift+Click to delete";
            
            const fragment = document.createDocumentFragment();
            if (before) fragment.appendChild(document.createTextNode(before));
            fragment.appendChild(endMarker);
            if (after) fragment.appendChild(document.createTextNode(after));
            
            parent.replaceChild(fragment, node);
            break;
          }
        }
      }
    }
    
    // Add fragment to array
    if (startMarker || endMarker) {
      fragments.push({
        id: savedFrag.id,
        startElement: startMarker,
        startText: savedFrag.startText,
        endElement: endMarker,
        endText: savedFrag.endText,
        text: savedFrag.text,
        wordCount: savedFrag.wordCount
      });
    }
  });
  
  console.log(`↷ Redo (stack: ${undoStack.length}, redo: ${redoStack.length})`);
}

function initializeFloatingButtons() {
  if (floatingButtons || !isEnabled) return;

  console.log("🎯 Initializing floating buttons");
  
  // Ensure document.body exists
  if (!document.body) {
    console.log("⚠️ Body not ready, retrying...");
    setTimeout(initializeFloatingButtons, 100);
    return;
  }

  floatingButtons = document.createElement("div");
  floatingButtons.className = "vread-floating-buttons";
  
  floatingButtons.style.display = "none";
  floatingButtons.style.position = "fixed";
  floatingButtons.style.zIndex = "2147483647";
  
  document.body.appendChild(floatingButtons);
  
  console.log("✅ Floating buttons initialized");
}

function initializePersistentControls() {
  if (!isEnabled) return;
  
  // Don't create if already exists
  if (document.getElementById('vread-persistent-controls')) return;
  
  const controls = document.createElement('div');
  controls.id = 'vread-persistent-controls';
  controls.className = 'vread-persistent-controls';
  controls.innerHTML = `
    <button class="vread-persistent-btn" id="vread-play-btn" title="Start Reading">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
    </button>
    <button class="vread-persistent-btn" id="vread-clear-btn" title="Clear All Fragments">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
    </button>
  `;
  
  document.body.appendChild(controls);
  
  // Play button
  document.getElementById('vread-play-btn').addEventListener('click', () => {
    chrome.storage.sync.get(['wpm', 'chunk'], (data) => {
      const wpm = data.wpm || 300;
      const chunk = data.chunk || 3;
      startReadingFragments(wpm, chunk);
    });
  });
  
  // Clear button
  document.getElementById('vread-clear-btn').addEventListener('click', () => {
    if (confirm('Clear all fragments?')) {
      document.querySelectorAll('.vread-fragment-start, .vread-fragment-end').forEach(marker => {
        const parent = marker.parentNode;
        while (marker.firstChild) {
          parent.insertBefore(marker.firstChild, marker);
        }
        marker.remove();
      });
      fragments = [];
      customTextFragments = [];
      chrome.storage.local.remove(['savedFragments', 'savedCustomFragments']);
    }
  });
}


function removeFloatingButtons() {
  if (floatingButtons) {
    console.log("🗑️ Removing floating buttons");
    floatingButtons.remove();
    floatingButtons = null;
  }
  
  const endButton = document.getElementById('vread-end-button-separate');
  if (endButton) {
    endButton.remove();
  }
  
  lastSelection = null;
  buttonsVisible = false;
}

function cleanupAllExtensionElements() {
  console.log("🧹 Cleaning up all V-Read elements");
  
  // Remove floating buttons
  if (floatingButtons) {
    floatingButtons.remove();
    floatingButtons = null;
  }
  
  const endButton = document.getElementById('vread-end-button-separate');
  if (endButton) endButton.remove();
  
  // Remove persistent controls
  const persistentControls = document.getElementById('vread-persistent-controls');
  if (persistentControls) persistentControls.remove();
  
  // Reset state
  buttonsVisible = false;
  lastSelection = null;
  clearTimeout(selectionTimer);
  
  // Save fragments
  const fragmentsToStore = fragments.map(f => ({
    id: f.id,
    startText: f.startText,
    endText: f.endText,
    text: f.text,
    wordCount: f.wordCount
  }));
  
  chrome.storage.local.set({ 
    savedFragments: fragmentsToStore,
    savedCustomFragments: customTextFragments 
  });
  
  // Remove markers properly
  document.querySelectorAll('.vread-fragment-start, .vread-fragment-end').forEach(marker => {
    const parent = marker.parentNode;
    if (!parent) return;
    
    // Get text content and surrounding whitespace context
    const prevSibling = marker.previousSibling;
    const nextSibling = marker.nextSibling;
    const markerText = marker.textContent;
    
    // Check if we need to add spacing
    const needsSpaceBefore = prevSibling && prevSibling.nodeType === Node.TEXT_NODE && 
                             prevSibling.textContent && !prevSibling.textContent.endsWith(' ');
    const needsSpaceAfter = nextSibling && nextSibling.nodeType === Node.TEXT_NODE && 
                            nextSibling.textContent && !nextSibling.textContent.startsWith(' ');
    
    // Build the replacement text with proper spacing
    let replacementText = markerText;
    if (needsSpaceBefore && !markerText.startsWith(' ')) replacementText = ' ' + replacementText;
    if (needsSpaceAfter && !markerText.endsWith(' ')) replacementText = replacementText + ' ';
    
    const textNode = document.createTextNode(replacementText);
    parent.replaceChild(textNode, marker);
    parent.normalize();
  });
  
  removeAllHighlights();
  
  const controls = document.getElementById("vread-reading-controls");
  if (controls) controls.remove();
  
  document.querySelectorAll(".vread-custom-reading-display").forEach(el => el.remove());
  document.querySelectorAll(".vread-welcome-hint").forEach(el => el.remove());
  
  fragments = [];
  customTextFragments = [];
}

function showFloatingButtons(rect) {
  if (!floatingButtons || !isEnabled) return;

  const viewportWidth = window.innerWidth;
  const selectionHeight = rect.bottom - rect.top;
  
  const hasIncompleteFragment = fragments.some(f => f.startElement && !f.endElement);
  
  // Clear existing content first
  floatingButtons.innerHTML = '';
  
  // Remove any separate end buttons
  const endButton = document.getElementById('vread-end-button-separate');
  if (endButton) endButton.remove();
  
  // Check if selection is substantial (more than a few words)
  const selectedText = lastSelection ? lastSelection.text : '';
  const wordCount = selectedText.split(/\s+/).filter(w => w).length;
  
  if (hasIncompleteFragment) {
    // If there's an incomplete fragment, show ONLY the END button regardless of word count
    const endBtn = document.createElement('button');
    endBtn.className = 'vread-float-btn vread-end-btn';
    endBtn.title = 'Mark End';
    endBtn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
    `;
    endBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    endBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (lastSelection && lastSelection.range && lastSelection.text) {
        addFragmentBoundary("end");
      }
    }, true);
    floatingButtons.appendChild(endBtn);
  } else if (wordCount >= 3) {
    // Show ONLY the fragment button for multi-word selections
    const fragmentBtn = document.createElement('button');
    fragmentBtn.className = 'vread-float-btn vread-fragment-btn';
    fragmentBtn.title = 'Mark Complete Fragment';
    fragmentBtn.innerHTML = `
      <svg width="44" height="22" viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M5 12h14M12 5l7 7-7 7"/>
        <path d="M43 12H29M36 19l-7-7 7-7"/>
      </svg>
    `;
    fragmentBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    fragmentBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (lastSelection && lastSelection.range && lastSelection.text) {
        addCompleteFragment();
      }
    }, true);
    floatingButtons.appendChild(fragmentBtn);
  } else {
    // Show START button for short selections
    const startBtn = document.createElement('button');
    startBtn.className = 'vread-float-btn vread-start-btn';
    startBtn.title = 'Mark Start';
    startBtn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    `;
    startBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    startBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (lastSelection && lastSelection.range && lastSelection.text) {
        addFragmentBoundary("start");
      }
    }, true);
    floatingButtons.appendChild(startBtn);
  }
  
  // Position buttons
  const adjustedX = Math.max(10, Math.min(rect.left + rect.width / 2 - 60, viewportWidth - 140));
  const adjustedY = Math.max(10, rect.top - 70);
  floatingButtons.style.left = `${adjustedX}px`;
  floatingButtons.style.top = `${adjustedY}px`;

  floatingButtons.style.display = "flex";
  floatingButtons.style.opacity = "1";
  floatingButtons.style.visibility = "visible";
  floatingButtons.style.pointerEvents = "all";
  floatingButtons.classList.add("vread-float-visible");
}

function hideFloatingButtons() {
  if (!floatingButtons) return;
  
  floatingButtons.classList.remove("vread-float-visible");
  floatingButtons.style.display = "none";
  floatingButtons.style.opacity = "0";
  floatingButtons.style.visibility = "hidden";
  floatingButtons.style.pointerEvents = "none";
  
  const endButton = document.getElementById('vread-end-button-separate');
  if (endButton) {
    endButton.classList.remove("vread-float-visible");
    endButton.style.display = "none";
    endButton.style.opacity = "0";
    endButton.style.visibility = "hidden";
    endButton.style.pointerEvents = "none";
  }
}

// Selection handling
document.addEventListener("selectionchange", () => {
  if (!isEnabled) {
    hideFloatingButtons();
    buttonsVisible = false;
    lastSelection = null;
    return;
  }
  
  if (isReading) {
    if (buttonsVisible) {
      hideFloatingButtons();
      buttonsVisible = false;
      lastSelection = null;
    }
    return;
  }
  
  clearTimeout(selectionTimer);
  
  const selection = window.getSelection();
  const text = selection.toString().trim();

  if (text && text.length > 0) {
    selectionTimer = setTimeout(() => {
      if (!isEnabled || isReading) return;
      
      try {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        lastSelection = {
          text: text,
          range: range.cloneRange()
        };
        
        showFloatingButtons(rect);
        buttonsVisible = true;
      } catch (e) {
        console.error("Selection error:", e);
      }
    }, 200);
  }
  // Don't hide when selection cleared - buttons stay until user clicks away
});

document.addEventListener("mousedown", (e) => {
  if (!isEnabled) {
    hideFloatingButtons();
    buttonsVisible = false;
    lastSelection = null;
    return;
  }
  
  if (isReading) {
    if (buttonsVisible) {
      hideFloatingButtons();
      buttonsVisible = false;
      lastSelection = null;
    }
    return;
  }
  
  const clickedOnButtons = e.target.closest(".vread-floating-buttons") || 
                          e.target.closest("#vread-end-button-separate") ||
                          e.target.closest(".vread-float-btn");
  
  if (!clickedOnButtons) {
    hideFloatingButtons();
    buttonsVisible = false;
    lastSelection = null;
  }
});

function addFragmentBoundary(type) {
  let range = null;
  let selectedText = "";
  
  const sel = window.getSelection();
  if (sel.rangeCount > 0 && sel.toString().trim()) {
    range = sel.getRangeAt(0);
    selectedText = sel.toString().trim();
  } else if (lastSelection) {
    range = lastSelection.range;
    selectedText = lastSelection.text;
  }
  
  if (!range || !selectedText) return;

  try {
    const marker = document.createElement("span");
    marker.className = type === "start" ? "vread-fragment-start" : "vread-fragment-end";
    
    const uniqueId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    marker.dataset.fragmentId = uniqueId;
    marker.dataset.type = type;
    marker.textContent = selectedText;
    
    // Insert marker at start of range WITHOUT deleting anything
    const startRange = range.cloneRange();
    startRange.collapse(true);
    startRange.insertNode(marker);
    
    // Now delete the ORIGINAL selected content (which is now AFTER the marker)
    const deleteRange = document.createRange();
    deleteRange.setStart(marker.nextSibling || marker.parentNode, marker.nextSibling ? 0 : Array.from(marker.parentNode.childNodes).indexOf(marker) + 1);
    deleteRange.setEnd(range.endContainer, range.endOffset);
    
    // Walk through and delete only the text that was selected
    const nodesToDelete = [];
    const walker = document.createTreeWalker(
      deleteRange.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let node;
    let totalChars = 0;
    while ((node = walker.nextNode())) {
      if (deleteRange.intersectsNode(node) && totalChars < selectedText.length) {
        nodesToDelete.push(node);
        totalChars += node.textContent.length;
      }
    }
    
    // Delete the text nodes that were selected
    nodesToDelete.forEach(node => {
      const parent = node.parentNode;
      if (parent && node.textContent.trim() === selectedText.trim()) {
        parent.removeChild(node);
      }
    });
    
    marker.style.cursor = "pointer";
    marker.title = "Drag to adjust • Shift+Click to delete";
    
    let isDragging = false;
    let dragStartX = 0;
    
    marker.addEventListener("mousedown", (e) => {
      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        deleteMarker(marker);
        return;
      }
      isDragging = true;
      dragStartX = e.clientX;
      marker.classList.add("vread-dragging");
      e.preventDefault();
    });
    
    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragStartX;
      if (Math.abs(deltaX) > 5) {
        expandOrShrinkMarker(marker, type, deltaX > 0 ? "expand" : "shrink");
        dragStartX = e.clientX;
      }
    });
    
    document.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        marker.classList.remove("vread-dragging");
        updateFragmentText(marker);
      }
    });

    if (type === "start") {
      fragments.push({
        id: uniqueId,
        startElement: marker,
        startText: marker.textContent,
        endElement: null,
        endText: null,
        text: null,
        wordCount: 0
      });
    } else {
      const incompleteFragments = fragments.filter(f => f.startElement && !f.endElement);
      
      if (incompleteFragments.length > 0) {
        let closestFragment = null;
        let closestDistance = Infinity;
        
        for (const frag of incompleteFragments) {
          const comparison = frag.startElement.compareDocumentPosition(marker);
          if (comparison & Node.DOCUMENT_POSITION_FOLLOWING) {
            const distance = Math.abs(
              frag.startElement.getBoundingClientRect().top - 
              marker.getBoundingClientRect().top
            );
            if (distance < closestDistance) {
              closestDistance = distance;
              closestFragment = frag;
            }
          }
        }
        
        if (closestFragment) {
          closestFragment.endElement = marker;
          closestFragment.endText = marker.textContent;
          const fullText = getTextBetweenElements(closestFragment.startElement, closestFragment.endElement);
          closestFragment.text = fullText;
          closestFragment.wordCount = fullText.split(/\s+/).filter(w => w).length;
        } else {
          fragments.push({
            id: uniqueId,
            startElement: null,
            startText: null,
            endElement: marker,
            endText: marker.textContent,
            text: null,
            wordCount: 0
          });
        }
      } else {
        fragments.push({
          id: uniqueId,
          startElement: null,
          startText: null,
          endElement: marker,
          endText: marker.textContent,
          text: null,
          wordCount: 0
        });
      }
    }

    sel.removeAllRanges();
    lastSelection = null;
    hideFloatingButtons();
    buttonsVisible = false;
    marker.style.animation = "vread-pop 0.3s ease-out";

  } catch (error) {
    console.error("Error adding marker:", error);
  }
}

function addCompleteFragment() {
  if (!lastSelection || !lastSelection.range || !lastSelection.text) return;

  const selectedText = lastSelection.text;
  const range = lastSelection.range.cloneRange();

  try {
    const words = selectedText.split(/\s+/).filter(w => w);
    if (words.length < 1) return;
    
    const firstWord = words[0];
    const lastWord = words[words.length - 1];
    
    const uniqueId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    
    // Just replace the entire selection with: startMarker + middle + endMarker
    const startMarker = document.createElement("span");
    startMarker.className = "vread-fragment-start";
    startMarker.dataset.fragmentId = uniqueId;
    startMarker.dataset.type = "start";
    startMarker.textContent = firstWord;
    
    const endMarker = document.createElement("span");
    endMarker.className = "vread-fragment-end";
    endMarker.dataset.fragmentId = uniqueId;
    endMarker.dataset.type = "end";
    endMarker.textContent = lastWord;
    
    const middleText = words.length > 2 ? ' ' + words.slice(1, -1).join(' ') + ' ' : (words.length === 2 ? ' ' : '');
    
    const fragment = document.createDocumentFragment();
    fragment.appendChild(startMarker);
    if (middleText) fragment.appendChild(document.createTextNode(middleText));
    fragment.appendChild(endMarker);
    
    range.deleteContents();
    range.insertNode(fragment);
    
    [startMarker, endMarker].forEach((m, idx) => {
      const mType = idx === 0 ? "start" : "end";
      m.style.cursor = "pointer";
      m.title = "Drag to adjust • Shift+Click to delete";
      
      let isDragging = false;
      let dragStartX = 0;
      
      m.addEventListener("mousedown", (e) => {
        if (e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          deleteMarker(m);
          return;
        }
        isDragging = true;
        dragStartX = e.clientX;
        m.classList.add("vread-dragging");
        e.preventDefault();
      });
      
      document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        const deltaX = e.clientX - dragStartX;
        if (Math.abs(deltaX) > 5) {
          expandOrShrinkMarker(m, mType, deltaX > 0 ? "expand" : "shrink");
          dragStartX = e.clientX;
        }
      });
      
      document.addEventListener("mouseup", () => {
        if (isDragging) {
          isDragging = false;
          m.classList.remove("vread-dragging");
          updateFragmentText(m);
        }
      });
    });
    
    const fullTextBetween = getTextBetweenElements(startMarker, endMarker);
    const actualWordCount = fullTextBetween.split(/\s+/).filter(w => w).length;
    
    fragments.push({
      id: uniqueId,
      startElement: startMarker,
      startText: firstWord,
      endElement: endMarker,
      endText: lastWord,
      text: fullTextBetween,
      wordCount: actualWordCount
    });
    
    window.getSelection().removeAllRanges();
    lastSelection = null;
    hideFloatingButtons();
    buttonsVisible = false;
    
    startMarker.style.animation = "vread-pop 0.3s ease-out";
    endMarker.style.animation = "vread-pop 0.3s ease-out";

  } catch (error) {
    console.error("Error creating complete fragment:", error);
  }
}

function deleteMarker(marker) {
  const type = marker.dataset.type;
  const index = fragments.findIndex(f => 
    (f.startElement === marker || f.endElement === marker)
  );
  
  if (index !== -1) {
    const fragment = fragments[index];
    if (type === "start" && fragment.startElement === marker) {
      if (fragment.endElement) {
        fragment.startElement = null;
        fragment.startText = null;
      } else {
        fragments.splice(index, 1);
      }
    } else if (type === "end" && fragment.endElement === marker) {
      if (fragment.startElement) {
        fragment.endElement = null;
        fragment.endText = null;
      } else {
        fragments.splice(index, 1);
      }
    }
  }
  
  const parent = marker.parentNode;
  while (marker.firstChild) {
    parent.insertBefore(marker.firstChild, marker);
  }
  marker.remove();
}

function expandOrShrinkMarker(marker, type, direction) {
  const isStart = type === "start";
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null
  );
  
  let currentNode = marker;
  let textNode = null;
  
  // Find adjacent text node
  if (direction === "expand") {
    // Expand outward
    if (isStart) {
      // For start marker, expand left
      while (currentNode.previousSibling) {
        currentNode = currentNode.previousSibling;
        if (currentNode.nodeType === Node.TEXT_NODE && currentNode.textContent.trim()) {
          textNode = currentNode;
          break;
        }
      }
    } else {
      // For end marker, expand right
      while (currentNode.nextSibling) {
        currentNode = currentNode.nextSibling;
        if (currentNode.nodeType === Node.TEXT_NODE && currentNode.textContent.trim()) {
          textNode = currentNode;
          break;
        }
      }
    }
  } else {
    // Shrink inward - remove words from marker itself
    const words = marker.textContent.trim().split(/\s+/);
    if (words.length > 1) {
      if (isStart) {
        // Remove first word, add it before marker
        const firstWord = words.shift();
        marker.textContent = words.join(' ');
        const textBefore = document.createTextNode(firstWord + ' ');
        marker.parentNode.insertBefore(textBefore, marker);
      } else {
        // Remove last word, add it after marker
        const lastWord = words.pop();
        marker.textContent = words.join(' ');
        const textAfter = document.createTextNode(' ' + lastWord);
        marker.parentNode.insertBefore(textAfter, marker.nextSibling);
      }
    }
    return;
  }
  
  if (!textNode) return;
  
  // Take one word from adjacent text
  const text = textNode.textContent;
  const words = text.trim().split(/\s+/);
  
  if (words.length === 0) return;
  
  if (isStart) {
    // Take last word from text before marker
    const lastWord = words.pop();
    const remainingText = words.join(' ');
    
    textNode.textContent = remainingText ? remainingText + ' ' : '';
    marker.textContent = lastWord + ' ' + marker.textContent;
  } else {
    // Take first word from text after marker
    const firstWord = words.shift();
    const remainingText = words.join(' ');
    
    textNode.textContent = remainingText ? ' ' + remainingText : '';
    marker.textContent = marker.textContent + ' ' + firstWord;
  }
}

function updateFragmentText(marker) {
  const fragmentId = marker.dataset.fragmentId;
  const fragment = fragments.find(f => f.id === fragmentId);
  
  if (!fragment) return;
  
  if (fragment.startElement) {
    fragment.startText = fragment.startElement.textContent.trim();
  }
  if (fragment.endElement) {
    fragment.endText = fragment.endElement.textContent.trim();
  }
  
  if (fragment.startElement && fragment.endElement) {
    const fullText = getTextBetweenElements(fragment.startElement, fragment.endElement);
    fragment.text = fullText;
    fragment.wordCount = fullText.split(/\s+/).filter(w => w).length;
    console.log(`📝 Updated fragment: ${fragment.wordCount} words`);
  }
}

function getTextBetweenElements(startEl, endEl) {
  if (!startEl || !endEl) {
    console.log("❌ Missing elements");
    return "";
  }

  console.log("📍 Extracting text between markers");
  
  let allText = "";
  let started = false;
  
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null
  );

  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    
    // Check if we hit the start marker
    if (!started && parent && 
        (parent === startEl || parent.closest('.vread-fragment-start') === startEl)) {
      started = true;
      const text = node.textContent.trim();
      if (text) {
        allText = text;
      }
      console.log(`   ▶️ Started at: "${text.substring(0, 30)}"`);
      continue; // Skip to next node
    }
    
    // Check if we hit the end marker
    if (started && parent && 
        (parent === endEl || parent.closest('.vread-fragment-end') === endEl)) {
      const text = node.textContent.trim();
      if (text) {
        if (allText && !allText.endsWith(' ')) allText += ' ';
        allText += text;
      }
      console.log(`   ◀️ Ended at: "${text.substring(0, 30)}"`);
      break;
    }
    
    // Collect text between markers
    if (started) {
      const text = node.textContent.trim();
      if (text) {
        // CRITICAL: Always ensure space before adding new text
        if (allText && !allText.endsWith(' ')) {
          allText += ' ';
        }
        allText += text; // Fixed - no trailing space
      }
    }
  }

  // Clean up
  const final = allText.replace(/\s+/g, ' ').trim();
  const wordCount = final.split(/\s+/).filter(w => w && !/^[\[\]0-9\-]+$/.test(w)).length;
  console.log(`   ✅ Extracted ${wordCount} words`);
  console.log(`   📄 "${final.substring(0, 100)}..."`);
  
  return final;
}

async function startReadingFragments(wpm, chunkSize) {
  if (isReading) return;

  // CHECK AUTH BEFORE STARTING
  const canRead = await checkWordLimit();
  if (!canRead) {
    alert('❌ Word limit reached! Please sign in to continue reading.');
    return;
  }

  const completeFragments = fragments.filter(f => f.startElement && f.endElement && f.text);
  const allFragments = [...completeFragments, ...customTextFragments];
  
  if (allFragments.length === 0) {
    alert("❌ No complete fragments to read!");
    return;
  }

  isReading = true;
  isPaused = false;
  showReadingControls();
  
  const msPerWord = (60 / wpm) * 1000;
  console.log(`⏱️ ${msPerWord.toFixed(1)}ms per word at ${wpm} WPM, chunk size: ${chunkSize}`);

  for (let fragIndex = 0; fragIndex < allFragments.length; fragIndex++) {
    if (!isReading) break;
    
    const fragment = allFragments[fragIndex];
    const words = fragment.text.split(/\s+/).filter(w => w.length > 0);
    console.log(`\n📖 Fragment ${fragIndex + 1}/${allFragments.length}: ${words.length} words`);
    
    let customOverlay = null;
    
    if (fragment.isCustom) {
      customOverlay = document.createElement("div");
      customOverlay.className = "vread-custom-reading-display";
      customOverlay.textContent = fragment.text;
      document.body.appendChild(customOverlay);
    }

    if (fragment.startElement) {
      fragment.startElement.classList.add("vread-reading");
      fragment.startElement.scrollIntoView({ behavior: "smooth", block: "center" });
      await new Promise(r => setTimeout(r, 500));
    }
    if (fragment.endElement) {
      fragment.endElement.classList.add("vread-reading");
    }

    for (let i = 0; i < words.length; i += chunkSize) {
      while (isPaused && isReading) {
        await new Promise(r => setTimeout(r, 100));
      }
      
      if (!isReading) break;

      const actualChunkSize = Math.min(chunkSize, words.length - i);
      
      if (fragment.isCustom && customOverlay) {
        const wordsRead = words.slice(0, i + actualChunkSize).join(" ");
        highlightCustomText(customOverlay, wordsRead, fragment.text);
      } else if (fragment.startElement && fragment.endElement) {
        highlightCurrentChunk(fragment, i, actualChunkSize, words);
      }

      const delayMs = msPerWord * actualChunkSize;
      console.log(`   Chunk ${Math.floor(i/chunkSize)+1}: ${actualChunkSize} words × ${msPerWord.toFixed(1)}ms = ${delayMs.toFixed(0)}ms`);
      await new Promise(r => setTimeout(r, delayMs));
    }

    if (customOverlay) customOverlay.remove();
    removeAllHighlights();
    if (fragment.startElement) fragment.startElement.classList.remove("vread-reading");
    if (fragment.endElement) fragment.endElement.classList.remove("vread-reading");

    // UPDATE WORD COUNT AFTER EACH FRAGMENT
    const wordsInFragment = fragment.text.split(/\s+/).filter(w => w).length;
    totalWordsRead += wordsInFragment;
    console.log(`📊 Words read this fragment: ${wordsInFragment}, Total: ${totalWordsRead}`);
    
    // Save to storage
    await chrome.storage.local.set({ wordsRead: totalWordsRead });
    
    // Check if we hit the limit mid-reading (only if not authenticated)
    if (!isAuthenticated && totalWordsRead >= 10) {
      console.log('🚫 Word limit reached during reading!');
      stopReading();
      chrome.runtime.sendMessage({ type: 'openAuth' });
      return;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log("✅ Reading complete");
  isReading = false;
  isPaused = false;
  removeAllHighlights();
  hideReadingControls();
}

function highlightCurrentChunk(fragment, startWordIndex, chunkSize, allWords) {
  removeAllHighlights();
  
  const endWordIndex = Math.min(startWordIndex + chunkSize, allWords.length);
  
  if (!fragment.startElement || !fragment.endElement) return;
  if (!document.body.contains(fragment.startElement) || !document.body.contains(fragment.endElement)) return;
  
  console.log(`   🎯 Target: highlight words ${startWordIndex} to ${endWordIndex-1} (${endWordIndex - startWordIndex} words)`);
  
  // Create temporary wrapper spans for EXACT word highlighting
  const textNodes = [];
  let capturing = false;
  
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null
  );
  
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    
    if (!capturing && parent && (parent === fragment.startElement || parent.closest('.vread-fragment-start') === fragment.startElement)) {
      capturing = true;
      if (node.textContent.trim()) textNodes.push(node);
      continue;
    }
    
    if (capturing && parent && (parent === fragment.endElement || parent.closest('.vread-fragment-end') === fragment.endElement)) {
      if (node.textContent.trim()) textNodes.push(node);
      break;
    }
    
    if (capturing && node.textContent.trim()) {
      textNodes.push(node);
    }
  }
  
  let globalWordIndex = 0;
  
  for (const textNode of textNodes) {
    const text = textNode.textContent;
    const words = text.match(/\S+/g) || [];
    if (words.length === 0) continue;
    
    // Find which words in this node should be highlighted
    const nodeStartWord = globalWordIndex;
    const highlightStart = Math.max(0, startWordIndex - nodeStartWord);
    const highlightEnd = Math.min(words.length, endWordIndex - nodeStartWord);
    
    if (highlightStart < highlightEnd) {
      // This node contains words we need to highlight
      const parent = textNode.parentElement;
      if (parent && !parent.classList.contains('vread-fragment-start') && !parent.classList.contains('vread-fragment-end')) {
        
        // Wrap only the target words
        const beforeWords = words.slice(0, highlightStart).join(' ');
        const targetWords = words.slice(highlightStart, highlightEnd).join(' ');
        const afterWords = words.slice(highlightEnd).join(' ');
        
        const wrapper = document.createElement('span');
        wrapper.className = 'vread-chunk-highlight';
        wrapper.dataset.vreadChunk = 'true';
        wrapper.textContent = targetWords;
        
        // Replace text node with structured content
        const beforeText = beforeWords ? document.createTextNode(beforeWords + ' ') : null;
        const afterText = afterWords ? document.createTextNode(' ' + afterWords) : null;
        
        const frag = document.createDocumentFragment();
        if (beforeText) frag.appendChild(beforeText);
        frag.appendChild(wrapper);
        if (afterText) frag.appendChild(afterText);
        
        parent.replaceChild(frag, textNode);
        
        console.log(`   ✨ Highlighted "${targetWords}" (words ${nodeStartWord + highlightStart} to ${nodeStartWord + highlightEnd - 1})`);
      }
    }
    
    globalWordIndex += words.length;
    if (globalWordIndex >= endWordIndex) break;
  }
  
  const firstHighlight = document.querySelector('[data-vread-chunk="true"]');
  if (firstHighlight) {
    firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function highlightCustomText(overlay, readText, fullText) {
  overlay.innerHTML = `
    <span class="vread-text-read">${escapeHtml(readText)}</span><span class="vread-text-unread">${escapeHtml(fullText.substring(readText.length))}</span>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function removeAllHighlights() {
  document.querySelectorAll('[data-vread-highlight="true"]').forEach(el => {
    el.classList.remove("vread-highlight-active");
    delete el.dataset.vreadHighlight;
  });
  
  // Remove wrapper spans and restore original text
  document.querySelectorAll('[data-vread-chunk="true"]').forEach(el => {
    const parent = el.parentNode;
    if (parent) {
      // Create a text node with the content
      const textNode = document.createTextNode(el.textContent);
      // Replace the wrapper with the text node
      parent.replaceChild(textNode, el);
    }
  });
  
  // Normalize all text nodes to merge adjacent ones
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    null
  );
  
  let node;
  while ((node = walker.nextNode())) {
    if (node.childNodes.length > 0) {
      node.normalize();
    }
  }
}

function stopReading() {
  isReading = false;
  isPaused = false;
  removeAllHighlights();
  document.querySelectorAll(".vread-reading").forEach(el => {
    el.classList.remove("vread-reading");
  });
  document.querySelectorAll(".vread-custom-reading-display").forEach(el => {
    el.remove();
  });
  hideReadingControls();
}

function showReadingControls() {
  let controls = document.getElementById("vread-reading-controls");
  
  if (!controls) {
    controls = document.createElement("div");
    controls.id = "vread-reading-controls";
    controls.className = "vread-reading-controls";
    controls.innerHTML = `
      <button class="vread-control-btn" id="vread-pause-btn" title="Pause/Resume">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <rect x="6" y="4" width="4" height="16"/>
          <rect x="14" y="4" width="4" height="16"/>
        </svg>
      </button>
      <button class="vread-control-btn" id="vread-restart-btn" title="Restart">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
      </button>
      <button class="vread-control-btn" id="vread-stop-btn" title="Stop">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M3 3h18v18H3z"/>
        </svg>
      </button>
    `;
    document.body.appendChild(controls);
    
    document.getElementById("vread-pause-btn").addEventListener("click", () => {
      isPaused = !isPaused;
      const pauseBtn = document.getElementById("vread-pause-btn");
      console.log(isPaused ? "⏸️ Paused" : "▶️ Resumed");
      
      if (isPaused) {
        pauseBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        `;
      } else {
        pauseBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
          </svg>
        `;
      }
    });
    
    document.getElementById("vread-restart-btn").addEventListener("click", () => {
      console.log("🔄 Restart clicked");
      isPaused = false;
      isReading = false;
      removeAllHighlights();
      
      chrome.storage.sync.get(["wpm", "chunk"], (data) => {
        const wpm = data.wpm || 300;
        const chunk = data.chunk || 3;
        setTimeout(() => startReadingFragments(wpm, chunk), 100);
      });
    });
    
    document.getElementById("vread-stop-btn").addEventListener("click", () => {
      stopReading();
    });
  }
  
  setTimeout(() => {
    controls.classList.add("vread-controls-visible");
  }, 100);
}

function hideReadingControls() {
  const controls = document.getElementById("vread-reading-controls");
  if (controls) {
    controls.classList.remove("vread-controls-visible");
    setTimeout(() => {
      controls.remove();
    }, 300);
  }
}

function showTextInputModal(newTab = false) {
  if (newTab) {
    chrome.runtime.sendMessage({ type: "openTextInputTab" });
    return;
  }

  if (textInputModal) {
    textInputModal.remove();
  }

  textInputModal = document.createElement("div");
  textInputModal.className = "vread-text-input-modal";
  textInputModal.innerHTML = `
    <div class="vread-modal-backdrop"></div>
    <div class="vread-modal-content">
      <div class="vread-modal-header">
        <h2>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Custom Text
        </h2>
        <button class="vread-modal-close" title="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <textarea class="vread-modal-textarea" placeholder="Paste or type text to speed read..." autofocus></textarea>
      <div class="vread-modal-actions">
        <button class="vread-modal-btn vread-modal-btn-secondary" data-action="new-tab">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          Open in New Tab
        </button>
        <button class="vread-modal-btn vread-modal-btn-primary" data-action="add">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Add & Read
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(textInputModal);

  const closeBtn = textInputModal.querySelector(".vread-modal-close");
  const backdrop = textInputModal.querySelector(".vread-modal-backdrop");
  const textarea = textInputModal.querySelector(".vread-modal-textarea");
  const newTabBtn = textInputModal.querySelector('[data-action="new-tab"]');
  const addBtn = textInputModal.querySelector('[data-action="add"]');

  const closeModal = () => {
    textInputModal.classList.add("vread-modal-closing");
    setTimeout(() => {
      if (textInputModal) {
        textInputModal.remove();
        textInputModal = null;
      }
    }, 300);
  };

  closeBtn.addEventListener("click", closeModal);
  backdrop.addEventListener("click", closeModal);

  newTabBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "openTextInputTab" });
    closeModal();
  });

  addBtn.addEventListener("click", () => {
    const text = textarea.value.trim();
    if (!text) return;

    customTextFragments.push({
      id: Date.now().toString(),
      text: text,
      wordCount: text.split(/\s+/).filter(w => w).length,
      isCustom: true
    });

    closeModal();
    
    chrome.storage.sync.get(["wpm", "chunk"], (data) => {
      const wpm = data.wpm || 300;
      const chunk = data.chunk || 3;
      setTimeout(() => startReadingFragments(wpm, chunk), 100);
    });
  });

  setTimeout(() => textarea.focus(), 100);
}

document.addEventListener("keydown", (e) => {
  console.log("🎹 Key pressed:", e.key, "Ctrl:", e.ctrlKey, "Meta:", e.metaKey, "Shift:", e.shiftKey);
  
  if (!isEnabled) {
    console.log("❌ Extension disabled");
    return;
  }
  
  // Ctrl+Z for undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    console.log("🔄 Undo triggered!");
    e.preventDefault();
    undo();
    return;
  }
  
  // Ctrl+Y or Cmd+Shift+Z for redo
  if (((e.ctrlKey || e.metaKey) && e.key === 'y') || 
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
    console.log("🔄 Redo triggered!");
    e.preventDefault();
    redo();
    return;
  }
  
  if (e.key === "Escape") {
    if (isReading) {
      stopReading();
      e.preventDefault();
    } else if (textInputModal) {
      textInputModal.querySelector(".vread-modal-close").click();
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "toggleExtension") {
    const wasEnabled = isEnabled;
    isEnabled = msg.enabled;
    console.log(`🔄 Extension ${isEnabled ? 'enabled' : 'disabled'}`);
    
    if (isEnabled) {
      setTimeout(() => {
        initializeFloatingButtons();
        initializePersistentControls();
        showWelcomeHint();
      }, 100);
    } else {
      stopReading();
      
      // Force remove ALL UI elements
      if (floatingButtons && floatingButtons.parentNode) {
        floatingButtons.parentNode.removeChild(floatingButtons);
        floatingButtons = null;
      }
      
      document.querySelectorAll('.vread-floating-buttons, #vread-end-button-separate, #vread-persistent-controls, .vread-welcome-hint, #vread-reading-controls, .vread-custom-reading-display').forEach(el => {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      
      // Reset all state
      buttonsVisible = false;
      lastSelection = null;
      clearTimeout(selectionTimer);
      
      // Clear selection
      const selection = window.getSelection();
      if (selection) selection.removeAllRanges();
    }
    sendResponse({ success: true });
    return true;
  }

  if (!isEnabled) {
    sendResponse({ success: false, error: "Extension is disabled" });
    return true;
  }

  if (msg.type === "startReading") {
      const wpm = msg.wpm || 300;
      const chunk = msg.chunk || 3;
      
      stopReading();
      setTimeout(() => startReadingFragments(wpm, chunk), 100);

      sendResponse({ success: true });
      return true;
  }

  if (msg.type === "stopReading") {
    stopReading();
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "showTextInput") {
    showTextInputModal(msg.newTab);
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "addCustomTextAndRead") {
    customTextFragments = [{
      id: Date.now().toString(),
      text: msg.text,
      wordCount: msg.text.split(/\s+/).filter(w => w).length,
      isCustom: true
    }];
    
    setTimeout(() => startReadingFragments(msg.wpm, msg.chunk), 500);
    
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "getFragments") {
    const allFragments = [
      ...fragments.filter(f => f.startElement && f.endElement),
      ...customTextFragments
    ];
    sendResponse({ fragments: allFragments });
    return true;
  }

  if (msg.type === "updateFragments") {
    fragments = msg.fragments.filter(f => !f.isCustom);
    customTextFragments = msg.fragments.filter(f => f.isCustom);
    sendResponse({ success: true });
    return true;
  }
  
  if (msg.type === "clearAllFragments") {
    console.log("🗑️ Clearing all fragments");
    
    document.querySelectorAll('.vread-fragment-start, .vread-fragment-end').forEach(marker => {
      const parent = marker.parentNode;
      if (!parent) return;
      
      // Store text and check spacing
      const text = marker.textContent;
      const prev = marker.previousSibling;
      const next = marker.nextSibling;
      
      // Preserve spacing
      let replacement = text;
      const needsBefore = prev && prev.nodeType === 3 && prev.textContent && !/\s$/.test(prev.textContent);
      const needsAfter = next && next.nodeType === 3 && next.textContent && !/^\s/.test(next.textContent);
      
      if (needsBefore) replacement = ' ' + replacement;
      if (needsAfter) replacement = replacement + ' ';
      
      parent.replaceChild(document.createTextNode(replacement), marker);
      parent.normalize();
    });
    
    fragments = [];
    customTextFragments = [];
    chrome.storage.local.remove(['savedFragments', 'savedCustomFragments']);
    
    sendResponse({ success: true });
    return true;
  }

  return true;
});