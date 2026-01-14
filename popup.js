// Replace entire popup.js file

document.addEventListener("DOMContentLoaded", async () => {
  const wpmSlider = document.getElementById("wpm");
  const chunkSlider = document.getElementById("chunk");
  const wpmInput = document.getElementById("wpmInput");
  const chunkInput = document.getElementById("chunkInput");
  const startBtn = document.getElementById("startRead");
  const themeToggle = document.getElementById("themeToggle");
  const themeToggleDisabled = document.getElementById("themeToggleDisabled");
  const enableToggle = document.getElementById("enableToggle");
  const manageFragmentsBtn = document.getElementById("manageFragments");
  const textInputBtn = document.getElementById("textInputBtn");
  const clearFragmentsBtn = document.getElementById("clearFragments");
  const settingsPanel = document.getElementById("settingsPanel");
  const disabledPanel = document.getElementById("disabledPanel");
  const userProfileBtn = document.getElementById("userProfileBtn");

  // Check authentication status
  const authData = await chrome.storage.local.get(['authenticated', 'userEmail', 'userName']);
  if (authData.authenticated) {
    userProfileBtn.classList.add('authenticated');
    userProfileBtn.title = authData.userEmail || 'Signed In';
  }

  // User dropdown
  let dropdownOpen = false;
  userProfileBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    
    let dropdown = document.getElementById('userDropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = 'userDropdown';
      dropdown.className = 'user-dropdown';
      
      const authData = await chrome.storage.local.get(['authenticated', 'userEmail', 'userName', 'wordsRead']);
      
      if (authData.authenticated) {
        dropdown.innerHTML = `
          <div class="user-info">
            <div class="user-email">${authData.userName || authData.userEmail || 'User'}</div>
            <div class="user-status authenticated">✓ Signed In</div>
            <div class="user-status">${authData.wordsRead || 0} words read</div>
          </div>
          <button class="user-menu-item" id="signOutBtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign Out
          </button>
        `;
      } else {
        dropdown.innerHTML = `
          <div class="user-info">
            <div class="user-email">Not signed in</div>
            <div class="user-status">${authData.wordsRead || 0} / 1000 free words</div>
          </div>
          <button class="user-menu-item" id="signInBtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
              <polyline points="10 17 15 12 10 7"/>
              <line x1="15" y1="12" x2="3" y2="12"/>
            </svg>
            Sign In
          </button>
        `;
      }
      
      document.body.appendChild(dropdown);
      
      setTimeout(() => {
        dropdown.classList.add('show');
      }, 10);
      
      // Event listeners
      const signOutBtn = document.getElementById('signOutBtn');
      const signInBtn = document.getElementById('signInBtn');
      
      if (signOutBtn) {
        signOutBtn.addEventListener('click', async () => {
          await chrome.storage.local.set({
            authenticated: false,
            userId: null,
            userEmail: null,
            userName: null,
            wordsRead: 0
          });
          userProfileBtn.classList.remove('authenticated');
          userProfileBtn.title = 'Account';
          dropdown.classList.remove('show');
          setTimeout(() => dropdown.remove(), 300);
        });
      }
      
      if (signInBtn) {
        signInBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'openAuth' });
          dropdown.classList.remove('show');
          setTimeout(() => dropdown.remove(), 300);
        });
      }
    } else {
      dropdown.classList.toggle('show');
    }
    
    dropdownOpen = !dropdownOpen;
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('userDropdown');
    if (dropdown && !dropdown.contains(e.target) && e.target !== userProfileBtn) {
      dropdown.classList.remove('show');
      setTimeout(() => dropdown.remove(), 300);
      dropdownOpen = false;
    }
  });

  // Rest of your existing popup.js code...
  chrome.storage.sync.get(["enabled"], (data) => {
    const enabled = data.enabled !== undefined ? data.enabled : true;
    enableToggle.checked = enabled;
    updatePanelVisibility(enabled);
  });

  enableToggle.onchange = async () => {
    const enabled = enableToggle.checked;
    chrome.storage.sync.set({ enabled });
    updatePanelVisibility(enabled);

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "toggleExtension",
        enabled
      });
    }
  };

  function updatePanelVisibility(enabled) {
    if (enabled) {
      settingsPanel.style.display = "flex";
      disabledPanel.style.display = "none";
    } else {
      settingsPanel.style.display = "none";
      disabledPanel.style.display = "flex";
    }
  }

  textInputBtn.onclick = async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "showTextInput",
        newTab: false
      });
    }
    window.close();
  };

  manageFragmentsBtn.onclick = () => {
    chrome.windows.create({
      url: "fragment-manager.html",
      type: "popup",
      width: 400,
      height: 600
    });
  };
  
  clearFragmentsBtn.onclick = async () => {
    if (!confirm('⚠️ Clear all fragments?\n\nThis will remove all START/END markers from the page and delete all saved fragments.')) {
      return;
    }
    
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "clearAllFragments"
      }, (response) => {
        if (response && response.success) {
          console.log("✅ All fragments cleared");
        }
      });
    }
  };

  const applyTheme = (theme) => {
    if (theme === "dark") {
      document.body.classList.add("dark");
      themeToggle.checked = true;
      themeToggleDisabled.checked = true;
    } else if (theme === "light") {
      document.body.classList.remove("dark");
      themeToggle.checked = false;
      themeToggleDisabled.checked = false;
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) {
        document.body.classList.add("dark");
        themeToggle.checked = true;
        themeToggleDisabled.checked = true;
      } else {
        document.body.classList.remove("dark");
        themeToggle.checked = false;
        themeToggleDisabled.checked = false;
      }
    }
  };

  chrome.storage.sync.get(["theme"], (data) => {
    applyTheme(data.theme || "auto");
  });

  themeToggle.onchange = () => {
    const newTheme = themeToggle.checked ? "dark" : "light";
    chrome.storage.sync.set({ theme: newTheme });
    applyTheme(newTheme);
  };

  themeToggleDisabled.onchange = () => {
    const newTheme = themeToggleDisabled.checked ? "dark" : "light";
    chrome.storage.sync.set({ theme: newTheme });
    applyTheme(newTheme);
  };

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    chrome.storage.sync.get(["theme"], (data) => {
      if (!data.theme || data.theme === "auto") {
        applyTheme("auto");
      }
    });
  });

  chrome.storage.sync.get(["wpm", "chunk"], (data) => {
    if (data.wpm) {
      wpmSlider.value = data.wpm;
      wpmInput.value = data.wpm;
    }
    if (data.chunk) {
      const sliderValue = chunkToSlider(data.chunk);
      chunkSlider.value = sliderValue;
      chunkInput.value = data.chunk;
    } else {
      chunkSlider.value = 50;
      chunkInput.value = 25;
      chrome.storage.sync.set({ chunk: 25 });
    }
  });

  function sliderToChunk(sliderValue) {
    const slider = parseFloat(sliderValue);
    if (slider <= 0) return 1;
    if (slider >= 100) return 100;
    if (slider <= 50) {
      return Math.round(1 + (slider / 50) * 24);
    } else {
      return Math.round(25 + ((slider - 50) / 50) * 75);
    }
  }

  function chunkToSlider(chunkValue) {
    if (chunkValue <= 1) return 0;
    if (chunkValue >= 100) return 100;
    if (chunkValue <= 25) {
      return Math.round(((chunkValue - 1) / 24) * 50);
    } else {
      return Math.round(50 + ((chunkValue - 25) / 75) * 50);
    }
  }

  wpmSlider.oninput = () => {
    const value = parseInt(wpmSlider.value);
    wpmInput.value = value;
    chrome.storage.sync.set({ wpm: value });
  };

  wpmInput.oninput = () => {
    let value = parseInt(wpmInput.value);
    if (isNaN(value) || value < 50) value = 50;
    if (value <= 3000) {
      wpmSlider.value = value;
    } else {
      wpmSlider.value = 3000;
    }
    chrome.storage.sync.set({ wpm: value });
  };

  wpmInput.onblur = () => {
    let value = parseInt(wpmInput.value);
    if (isNaN(value) || value < 50) {
      wpmInput.value = 50;
      wpmSlider.value = 50;
      chrome.storage.sync.set({ wpm: 50 });
    }
  };

  chunkSlider.oninput = () => {
    const sliderValue = parseInt(chunkSlider.value);
    const chunkSize = sliderToChunk(sliderValue);
    chunkInput.value = chunkSize;
    chrome.storage.sync.set({ chunk: chunkSize });
  };

  chunkInput.oninput = () => {
    let value = parseInt(chunkInput.value);
    if (isNaN(value) || value < 1) value = 1;
    if (value <= 100) {
      const sliderValue = chunkToSlider(value);
      chunkSlider.value = sliderValue;
    } else {
      chunkSlider.value = 100;
    }
    chrome.storage.sync.set({ chunk: value });
  };

  chunkInput.onblur = () => {
    let value = parseInt(chunkInput.value);
    if (isNaN(value) || value < 1) {
      chunkInput.value = 1;
      const sliderValue = chunkToSlider(1);
      chunkSlider.value = sliderValue;
      chrome.storage.sync.set({ chunk: 1 });
    }
  };

  startBtn.onclick = async () => {
    const wpm = parseInt(wpmInput.value);
    const chunk = parseInt(chunkInput.value);

    if (isNaN(wpm) || wpm < 50) {
      alert("⚠️ Invalid speed (minimum 50 WPM)");
      return;
    }

    if (isNaN(chunk) || chunk < 1) {
      alert("⚠️ Invalid chunk size (minimum 1)");
      return;
    }

    startBtn.style.transform = 'scale(0.95)';
    setTimeout(() => {
      startBtn.style.transform = '';
    }, 150);

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;

    chrome.tabs.sendMessage(tabs[0].id, {
      type: "startReading",
      wpm,
      chunk
    });

    setTimeout(() => window.close(), 200);
  };
});