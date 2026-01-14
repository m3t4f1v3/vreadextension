import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "firebase/auth/web-extension";

import { firebaseConfig } from "./firebase-config";

const statusEl = document.getElementById("status");

if (!statusEl) {
  throw new Error("Status element with id 'status' not found in the document.");
}

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

(async () => {
  const { email, password } = await chrome.storage.local.get([
    "email",
    "password"
  ]);

  if (!email || !password) {
    setStatus("Missing credentials", "error");
    return;
  }

  try {
    const { user } = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    await chrome.storage.local.set({
      authenticated: true,
      userId: user.uid,
      userEmail: user.email,
      userName: user.displayName || "",
      wordsRead: 0
    });

    setStatus("✓ Signed in successfully!", "success");
    setTimeout(() => window.close(), 1500);
  } catch (err) {
    console.error("Auth error", err);
    setStatus(err.message, "error");
  }
})();

onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("Auth state confirmed:", user.email);
  }
});
