let fragments = [];
let draggedIndex = null;

// Load fragments from content script
async function loadFragments() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) return;

  chrome.tabs.sendMessage(tabs[0].id, { type: "getFragments" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error loading fragments:", chrome.runtime.lastError);
      return;
    }
    if (response && response.fragments) {
      fragments = response.fragments;
      renderFragments();
    }
  });
}

// Render fragments list
function renderFragments() {
  const container = document.getElementById("fragmentsList");
  
  if (fragments.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <p>No fragments yet</p>
        <small>Select text on the page and click the floating Start/End buttons to add fragments</small>
      </div>
    `;
    return;
  }

  container.innerHTML = fragments.map((frag, index) => {
    const wordCount = frag.wordCount || 0;
    const readTime = Math.ceil(wordCount / 300);
    const preview = frag.text ? frag.text.substring(0, 100) + (frag.text.length > 100 ? "..." : "") : "Empty fragment";
    const isCustom = frag.isCustom || false;
    
    return `
      <div class="fragment-card" draggable="true" data-index="${index}">
        <div class="fragment-header">
          <div class="fragment-number">${index + 1}</div>
          <div class="fragment-title">Fragment ${index + 1}</div>
          ${isCustom ? '<span class="fragment-type-badge custom">Custom</span>' : ''}
          <div class="fragment-actions">
            <button class="fragment-btn move-up" data-index="${index}" title="Move up" ${index === 0 ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 15l-6-6-6 6"/>
              </svg>
            </button>
            <button class="fragment-btn move-down" data-index="${index}" title="Move down" ${index === fragments.length - 1 ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
            <button class="fragment-btn delete" data-index="${index}" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="fragment-preview">${preview}</div>
        <div class="fragment-stats">
          <span>📝 ${wordCount} words</span>
          <span>⏱️ ~${readTime} min</span>
        </div>
      </div>
    `;
  }).join('');

  attachEventListeners();
}

// Attach event listeners to fragment cards
function attachEventListeners() {
  // Drag and drop
  document.querySelectorAll('.fragment-card').forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('drop', handleDrop);
    card.addEventListener('dragend', handleDragEnd);
  });

  // Move buttons
  document.querySelectorAll('.move-up').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(e.currentTarget.dataset.index);
      moveFragment(index, index - 1);
    });
  });

  document.querySelectorAll('.move-down').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(e.currentTarget.dataset.index);
      moveFragment(index, index + 1);
    });
  });

  // Delete buttons
  document.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(e.currentTarget.dataset.index);
      deleteFragment(index);
    });
  });
}

// Drag and drop handlers
function handleDragStart(e) {
  draggedIndex = parseInt(e.target.dataset.index);
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }
  
  const dropIndex = parseInt(e.currentTarget.dataset.index);
  
  if (draggedIndex !== null && draggedIndex !== dropIndex) {
    moveFragment(draggedIndex, dropIndex);
  }
  
  return false;
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedIndex = null;
}

// Move fragment
async function moveFragment(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= fragments.length) return;
  
  const [movedItem] = fragments.splice(fromIndex, 1);
  fragments.splice(toIndex, 0, movedItem);
  
  await updateFragments();
  renderFragments();
}

// Delete fragment
async function deleteFragment(index) {
  fragments.splice(index, 1);
  await updateFragments();
  renderFragments();
}

// Update fragments in content script
async function updateFragments() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) return;

  chrome.tabs.sendMessage(tabs[0].id, {
    type: "updateFragments",
    fragments: fragments
  });
}

// Event listeners
document.getElementById('closeBtn').addEventListener('click', () => {
  window.close();
});

document.getElementById('clearAllBtn').addEventListener('click', async () => {
  if (confirm('Clear all fragments?')) {
    fragments = [];
    await updateFragments();
    renderFragments();
  }
});

document.getElementById('startReadingBtn').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) return;

  const settings = await chrome.storage.sync.get(['wpm', 'chunk']);
  const wpm = settings.wpm || 300;
  const chunk = settings.chunk || 3;

  chrome.tabs.sendMessage(tabs[0].id, {
    type: "startReading",
    wpm,
    chunk
  });

  window.close();
});

// Initialize
loadFragments();

// Reload fragments periodically
setInterval(loadFragments, 1000);