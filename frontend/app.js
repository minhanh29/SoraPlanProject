/**
 * SoraPlan Studio Authentication Client
 * Connects directly to backend API (api_user) with Firebase Authentication & Firestore.
 */

const API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" 
  ? "http://localhost:8000/v1" 
  : "/v1";

// State
let authMode = "login"; // "login" | "signup"

// Elements
const authFormCard = document.getElementById("auth-form-card");
const profileCard = document.getElementById("profile-card");
const authForm = document.getElementById("auth-form");
const tabLogin = document.getElementById("tab-login");
const tabSignup = document.getElementById("tab-signup");
const nameGroup = document.getElementById("name-group");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("current-password");
const displayNameInput = document.getElementById("display-name");
const submitBtn = document.getElementById("submit-btn");
const btnText = document.getElementById("btn-text");
const cardTitle = document.getElementById("auth-card-title");
const cardSubtitle = document.getElementById("auth-card-subtitle");
const togglePasswordBtn = document.getElementById("toggle-password");
const eyeIcon = document.getElementById("eye-icon");
const themeToggleBtn = document.getElementById("theme-toggle");
const toast = document.getElementById("toast");
const toastMessage = document.getElementById("toast-message");
const logoutBtn = document.getElementById("logout-btn");

// Profile elements
const userAvatar = document.getElementById("user-avatar");
const userDisplayName = document.getElementById("user-display-name");
const userEmail = document.getElementById("user-email");
const quotaPlan = document.getElementById("quota-plan");
const quotaProjects = document.getElementById("quota-projects");
const quotaAssets = document.getElementById("quota-assets");
const quotaRenders = document.getElementById("quota-renders");

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  checkExistingSession();
  setupEventListeners();
});

function setupEventListeners() {
  tabLogin.addEventListener("click", () => setMode("login"));
  tabSignup.addEventListener("click", () => setMode("signup"));
  authForm.addEventListener("submit", handleFormSubmit);
  togglePasswordBtn.addEventListener("click", togglePasswordVisibility);
  themeToggleBtn.addEventListener("click", toggleTheme);
  logoutBtn.addEventListener("click", handleLogout);
}

// Mode Switcher
function setMode(mode) {
  authMode = mode;
  if (mode === "login") {
    tabLogin.classList.add("active");
    tabLogin.setAttribute("aria-selected", "true");
    tabSignup.classList.remove("active");
    tabSignup.setAttribute("aria-selected", "false");
    nameGroup.style.display = "none";
    displayNameInput.removeAttribute("required");
    btnText.textContent = "Sign In";
    cardTitle.textContent = "Welcome to SoraPlan";
    cardSubtitle.textContent = "Sign in to build, walk through, and edit real-scale 3D spaces.";
  } else {
    tabSignup.classList.add("active");
    tabSignup.setAttribute("aria-selected", "true");
    tabLogin.classList.remove("active");
    tabLogin.setAttribute("aria-selected", "false");
    nameGroup.style.display = "block";
    displayNameInput.setAttribute("required", "true");
    btnText.textContent = "Create Account";
    cardTitle.textContent = "Create Your Studio Account";
    cardSubtitle.textContent = "Join SoraPlan to convert floor plan sketches into 3D homes.";
  }
}

// Form Submission (Login / Sign Up)
async function handleFormSubmit(e) {
  e.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const displayName = displayNameInput.value.trim();

  if (!email) {
    showToast("Please enter your email address", "error");
    emailInput.focus();
    return;
  }

  if (!password || password.length < 6) {
    showToast("Password must be at least 6 characters", "error");
    passwordInput.focus();
    return;
  }

  setLoading(true);

  try {
    const endpoint = authMode === "login" ? `${API_BASE_URL}/auth/login` : `${API_BASE_URL}/auth/signup`;
    const payload = authMode === "login" 
      ? { email, password }
      : { email, password, displayName: displayName || undefined };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      const errorMsg = data.detail || data.title || "Authentication failed. Please check your credentials.";
      showToast(errorMsg, "error");
      return;
    }

    // Save tokens and user in localStorage
    localStorage.setItem("soraplan_token", data.idToken);
    if (data.refreshToken) {
      localStorage.setItem("soraplan_refresh_token", data.refreshToken);
    }
    localStorage.setItem("soraplan_user", JSON.stringify(data.user));

    showToast(authMode === "login" ? "Successfully signed in!" : "Account created successfully!", "success");
    renderProfileView(data.user);

  } catch (err) {
    console.error("Network or API Error:", err);
    showToast("Could not connect to SoraPlan API server. Is it running on port 8000?", "error");
  } finally {
    setLoading(false);
  }
}

// Check session on load
async function checkExistingSession() {
  const token = localStorage.getItem("soraplan_token");
  const storedUser = localStorage.getItem("soraplan_user");

  if (!token) return;

  if (storedUser) {
    try {
      renderProfileView(JSON.parse(storedUser));
    } catch (_) {}
  }

  // Verify token with backend
  try {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    if (res.ok) {
      const user = await res.json();
      localStorage.setItem("soraplan_user", JSON.stringify(user));
      renderProfileView(user);
    } else {
      // Expired or invalid token
      handleLogout(false);
    }
  } catch (e) {
    console.warn("Could not verify session with backend:", e);
  }
}

// Render active logged-in profile
function renderProfileView(user) {
  authFormCard.style.display = "none";
  profileCard.classList.add("active");

  userDisplayName.textContent = user.displayName || "Architect";
  userEmail.textContent = user.email || "";
  
  if (user.photoUrl) {
    userAvatar.src = user.photoUrl;
  }

  quotaPlan.textContent = (user.plan || "Free").toUpperCase();
  
  if (user.quota) {
    quotaProjects.textContent = `${user.quota.projects || 5} active`;
    quotaAssets.textContent = `${user.quota.assets3d || 10} / mo`;
    quotaRenders.textContent = `${user.quota.rendersFinal || 20} / day`;
  }
}

// Logout
async function handleLogout(notify = true) {
  const token = localStorage.getItem("soraplan_token");
  if (token) {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
    } catch (_) {}
  }

  localStorage.removeItem("soraplan_token");
  localStorage.removeItem("soraplan_refresh_token");
  localStorage.removeItem("soraplan_user");

  profileCard.classList.remove("active");
  authFormCard.style.display = "block";
  passwordInput.value = "";

  if (notify) {
    showToast("Signed out successfully", "info");
  }
}

// Password toggle
function togglePasswordVisibility() {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  togglePasswordBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password as plain text");
  
  eyeIcon.innerHTML = isPassword 
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
}

// Theme Switcher
function initTheme() {
  const saved = localStorage.getItem("soraplan_theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("soraplan_theme", next);
}

// Loading state
function setLoading(loading) {
  submitBtn.disabled = loading;
  if (loading) {
    submitBtn.classList.add("loading");
  } else {
    submitBtn.classList.remove("loading");
  }
}

// Toast
let toastTimeout = null;
function showToast(message, type = "info") {
  clearTimeout(toastTimeout);
  toastMessage.textContent = message;
  toast.className = `toast visible ${type}`;

  toastTimeout = setTimeout(() => {
    toast.className = "toast";
  }, 4000);
}
