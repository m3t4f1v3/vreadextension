console.log('🔥 Auth.js loaded');

const API_KEY = "AIzaSyCBv8_c6mdMcxfFRv6ZEsCi-Qcvm6UuwTE";

// Remove all Firebase SDK references
// const auth = firebase.auth(); ❌ DELETE THIS

const statusDiv = document.getElementById('status');
const headerText = document.getElementById('headerText');
const googleButton = document.getElementById('googleSignIn');
const mainButtons = document.getElementById('mainButtons');
const signInForm = document.getElementById('signInForm');
const signUpForm = document.getElementById('signUpForm');
const closeBtn = document.getElementById('closeBtn');
const themeToggle = document.getElementById('themeToggle');

// Navigation (keep all your existing navigation code)
document.getElementById('showSignIn').addEventListener('click', () => {
  mainButtons.style.display = 'none';
  signInForm.style.display = 'flex';
  headerText.textContent = 'Welcome back';
});

document.getElementById('showSignUp').addEventListener('click', () => {
  mainButtons.style.display = 'none';
  signUpForm.style.display = 'flex';
  headerText.textContent = 'Create your account';
});

document.getElementById('backFromSignIn').addEventListener('click', () => {
  signInForm.style.display = 'none';
  mainButtons.style.display = 'flex';
  headerText.textContent = 'Sign in to unlock unlimited reading';
  clearInputs();
});

document.getElementById('backFromSignUp').addEventListener('click', () => {
  signUpForm.style.display = 'none';
  mainButtons.style.display = 'flex';
  headerText.textContent = 'Sign in to unlock unlimited reading';
  clearInputs();
});

function clearInputs() {
  document.getElementById('signInEmail').value = '';
  document.getElementById('signInPassword').value = '';
  document.getElementById('signUpEmail').value = '';
  document.getElementById('signUpPassword').value = '';
  document.getElementById('confirmPassword').value = '';
  document.getElementById('firstName').value = '';
  document.getElementById('lastName').value = '';
}

function showStatus(message, isError = false) {
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + (isError ? 'error' : 'success');
  statusDiv.style.display = 'block';
  setTimeout(() => {
    statusDiv.style.display = 'none';
  }, 5000);
}

closeBtn.addEventListener('click', () => {
  window.close();
});

// Password validation (keep as is)
const signUpPassword = document.getElementById('signUpPassword');
const confirmPassword = document.getElementById('confirmPassword');

function validatePassword() {
  const password = signUpPassword.value;
  const confirm = confirmPassword.value;
  
  const hasLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const passwordsMatch = password === confirm && confirm.length > 0;
  
  document.getElementById('req-length').classList.toggle('met', hasLength);
  document.getElementById('req-upper').classList.toggle('met', hasUpper);
  document.getElementById('req-number').classList.toggle('met', hasNumber);
  document.getElementById('req-match').classList.toggle('met', passwordsMatch);
  
  return hasLength && hasUpper && hasNumber && passwordsMatch;
}

signUpPassword.addEventListener('input', validatePassword);
confirmPassword.addEventListener('input', validatePassword);

// ✅ NEW: Sign In with REST API
document.getElementById('signInBtn').addEventListener('click', async () => {
  const email = document.getElementById('signInEmail').value.trim();
  const password = document.getElementById('signInPassword').value;
  
  if (!email || !password) {
    showStatus('Please enter email and password', true);
    return;
  }
  
  showStatus('Signing in...');
  document.getElementById('signInBtn').disabled = true;
  
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          password: password,
          returnSecureToken: true
        })
      }
    );
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Sign in failed');
    }
    
    console.log('✅ Signed in:', data.email);
    
    await chrome.storage.local.set({
      authenticated: true,
      userId: data.localId,
      userEmail: data.email,
      userName: data.displayName || '',
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      wordsRead: 0
    });
    
    showStatus('✓ Signed in successfully!');
    setTimeout(() => window.close(), 1500);
  } catch (error) {
    console.error('❌ Sign in error:', error);
    showStatus('Error: ' + error.message, true);
    document.getElementById('signInBtn').disabled = false;
  }
});

// ✅ NEW: Sign Up with REST API
document.getElementById('signUpBtn').addEventListener('click', async () => {
  const email = document.getElementById('signUpEmail').value.trim();
  const password = document.getElementById('signUpPassword').value;
  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  
  if (!firstName || !lastName) {
    showStatus('Please enter your name', true);
    return;
  }
  
  if (!email || !password) {
    showStatus('Please enter email and password', true);
    return;
  }
  
  if (!validatePassword()) {
    showStatus('Please meet all password requirements', true);
    return;
  }
  
  showStatus('Creating account...');
  document.getElementById('signUpBtn').disabled = true;
  
  try {
    // Create account
    const signUpResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          password: password,
          returnSecureToken: true
        })
      }
    );
    
    const signUpData = await signUpResponse.json();
    
    if (!signUpResponse.ok) {
      throw new Error(signUpData.error?.message || 'Sign up failed');
    }
    
    // Update profile with name
    const updateResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken: signUpData.idToken,
          displayName: `${firstName} ${lastName}`,
          returnSecureToken: true
        })
      }
    );
    
    const updateData = await updateResponse.json();
    
    console.log('✅ Account created:', signUpData.email);
    
    await chrome.storage.local.set({
      authenticated: true,
      userId: signUpData.localId,
      userEmail: signUpData.email,
      userName: `${firstName} ${lastName}`,
      idToken: updateData.idToken,
      refreshToken: updateData.refreshToken,
      wordsRead: 0
    });
    
    showStatus('✓ Account created successfully!');
    setTimeout(() => window.close(), 1500);
  } catch (error) {
    console.error('❌ Sign up error:', error);
    showStatus('Error: ' + error.message, true);
    document.getElementById('signUpBtn').disabled = false;
  }
});

// ✅ Google Sign In - Use chrome.identity instead
googleButton.addEventListener('click', async () => {
  console.log('🔵 Google button clicked');
  googleButton.disabled = true;
  showStatus('Opening Google Sign In...');
  
  try {
    // Use Chrome's identity API for OAuth
    const redirectUrl = chrome.identity.getRedirectURL();
    const clientId = '703809613490-YOUR_CLIENT_ID.apps.googleusercontent.com'; // Get from Firebase Console
    const authUrl = `https://accounts.google.com/o/oauth2/auth?` +
      `client_id=${clientId}` +
      `&response_type=token` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&scope=${encodeURIComponent('email profile')}`;
    
    chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    }, async (responseUrl) => {
      if (chrome.runtime.lastError) {
        showStatus('Error: ' + chrome.runtime.lastError.message, true);
        googleButton.disabled = false;
        return;
      }
      
      // Extract access token from URL
      const token = responseUrl.split('access_token=')[1]?.split('&')[0];
      
      if (token) {
        // Exchange Google token for Firebase token
        const firebaseResponse = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postBody: `access_token=${token}&providerId=google.com`,
              requestUri: redirectUrl,
              returnSecureToken: true
            })
          }
        );
        
        const data = await firebaseResponse.json();
        
        await chrome.storage.local.set({
          authenticated: true,
          userId: data.localId,
          userEmail: data.email,
          userName: data.displayName || '',
          idToken: data.idToken,
          refreshToken: data.refreshToken,
          wordsRead: 0
        });
        
        showStatus('✓ Signed in with Google!');
        setTimeout(() => window.close(), 1500);
      }
    });
  } catch (error) {
    console.error('❌ Google sign in error:', error);
    showStatus('Error: ' + error.message, true);
    googleButton.disabled = false;
  }
});

// Theme (keep as is)
chrome.storage.sync.get(['theme'], (data) => {
  const theme = data.theme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.checked = theme === 'light';
});

themeToggle.addEventListener('change', (e) => {
  const theme = e.target.checked ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  chrome.storage.sync.set({ theme });
});