/**
 * SoraPlan Studio & Floor Plan Management Client
 * Direct Google Cloud Storage V4 Signed PUT upload and Scene Graph synchronization.
 */

const API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" 
  ? "http://localhost:8000/v1" 
  : "/v1";

// Global App State
let authMode = "login"; // "login" | "signup"
let currentUser = null;
let selectedFile = null;
let currentProjects = [];
let isUploading = false;

// DOM Elements - Auth & Navigation
const authView = document.getElementById("auth-view");
const studioView = document.getElementById("studio-view");
const authFormCard = document.getElementById("auth-form-card");
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

// DOM Elements - User Navigation & Quotas
const userNavChip = document.getElementById("user-nav-chip");
const navUserAvatar = document.getElementById("nav-user-avatar");
const navUserName = document.getElementById("nav-user-name");
const navUserPlan = document.getElementById("nav-user-plan");
const navLogoutBtn = document.getElementById("nav-logout-btn");
const studioWelcome = document.getElementById("studio-welcome");
const quotaProjectsVal = document.getElementById("quota-projects-val");
const quotaTierVal = document.getElementById("quota-tier-val");
const quotaRendersVal = document.getElementById("quota-renders-val");
const quotaAssetsVal = document.getElementById("quota-assets-val");

// DOM Elements - Project Creator & Upload
const createProjectForm = document.getElementById("create-project-form");
const projectNameInput = document.getElementById("project-name");
const projectDescInput = document.getElementById("project-description");
const planFileInput = document.getElementById("plan-file-input");
const planDropzone = document.getElementById("plan-dropzone");
const dropzoneIdleContent = document.getElementById("dropzone-idle-content");
const filePreviewCard = document.getElementById("file-preview-card");
const previewMediaContainer = document.getElementById("preview-media-container");
const previewFilename = document.getElementById("preview-filename");
const previewTypeBadge = document.getElementById("preview-type-badge");
const previewFilesize = document.getElementById("preview-filesize");
const btnRemoveFile = document.getElementById("btn-remove-file");
const btnLoadSample = document.getElementById("btn-load-sample");
const btnCreateProject = document.getElementById("btn-create-project");
const creatorBtnText = document.getElementById("creator-btn-text");
const creatorSpinner = document.getElementById("creator-spinner");

// DOM Elements - Upload Progress
const uploadProgressWrapper = document.getElementById("upload-progress-wrapper");
const stepCreate = document.getElementById("step-create");
const stepUrl = document.getElementById("step-url");
const stepPut = document.getElementById("step-put");
const stepConfirm = document.getElementById("step-confirm");
const progressBarFill = document.getElementById("progress-bar-fill");
const progressStatusMsg = document.getElementById("progress-status-msg");
const progressStatusPct = document.getElementById("progress-status-pct");

// DOM Elements - Projects Gallery
const projectsCount = document.getElementById("projects-count");
const btnRefreshProjects = document.getElementById("btn-refresh-projects");
const galleryEmptyState = document.getElementById("gallery-empty-state");
const projectsGrid = document.getElementById("projects-grid");

// DOM Elements - Plan Lightbox Modal
const planModal = document.getElementById("plan-modal");
const modalPlanTitle = document.getElementById("modal-plan-title");
const modalPlanMeta = document.getElementById("modal-plan-meta");
const modalPlanBody = document.getElementById("modal-plan-body");
const modalGcsUri = document.getElementById("modal-gcs-uri");
const modalOpenNewTab = document.getElementById("modal-open-new-tab");
const btnCloseModal = document.getElementById("btn-close-modal");

// Lifecycle Initialization
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  setupEventListeners();
  checkExistingSession();
});

// Event Listeners Setup
function setupEventListeners() {
  // Auth Controls
  tabLogin.addEventListener("click", () => setMode("login"));
  tabSignup.addEventListener("click", () => setMode("signup"));
  authForm.addEventListener("submit", handleAuthSubmit);
  togglePasswordBtn.addEventListener("click", togglePasswordVisibility);
  themeToggleBtn.addEventListener("click", toggleTheme);
  navLogoutBtn.addEventListener("click", () => handleLogout(true));

  // Project Creation & Dropzone
  createProjectForm.addEventListener("submit", handleCreateAndUploadProject);
  btnLoadSample.addEventListener("click", handleLoadSampleBlueprint);
  btnRefreshProjects.addEventListener("click", loadProjects);

  // Drag & Drop
  setupDropzone();

  // Modal Controls
  btnCloseModal.addEventListener("click", closePlanModal);
  planModal.addEventListener("click", (e) => {
    if (e.target === planModal) closePlanModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && planModal.style.display !== "none") {
      closePlanModal();
    }
  });
}

// -------------------------------------------------------------
// 1. AUTHENTICATION & SESSION MANAGEMENT
// -------------------------------------------------------------

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

async function handleAuthSubmit(e) {
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

  setAuthLoading(true);

  try {
    const endpoint = authMode === "login" ? `${API_BASE_URL}/auth/login` : `${API_BASE_URL}/auth/signup`;
    const payload = authMode === "login" 
      ? { email, password }
      : { email, password, displayName: displayName || undefined };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      const errorMsg = data.detail || data.title || "Authentication failed. Please verify credentials.";
      showToast(errorMsg, "error");
      return;
    }

    // Persist session
    localStorage.setItem("soraplan_token", data.idToken);
    if (data.refreshToken) {
      localStorage.setItem("soraplan_refresh_token", data.refreshToken);
    }
    localStorage.setItem("soraplan_user", JSON.stringify(data.user));

    currentUser = data.user;
    showToast(authMode === "login" ? "Successfully signed in!" : "Account created successfully!", "success");
    
    enterStudioView(data.user);
    loadProjects();

  } catch (err) {
    console.error("Auth Error:", err);
    showToast("Could not connect to SoraPlan API server. Is it running on port 8000?", "error");
  } finally {
    setAuthLoading(false);
  }
}

async function checkExistingSession() {
  const token = localStorage.getItem("soraplan_token");
  const storedUser = localStorage.getItem("soraplan_user");

  if (!token) {
    showAuthView();
    return;
  }

  if (storedUser) {
    try {
      currentUser = JSON.parse(storedUser);
      enterStudioView(currentUser);
    } catch (_) {}
  }

  // Validate session with backend
  try {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (res.ok) {
      const user = await res.json();
      currentUser = user;
      localStorage.setItem("soraplan_user", JSON.stringify(user));
      enterStudioView(user);
      loadProjects();
    } else {
      handleLogout(false);
    }
  } catch (e) {
    console.warn("Could not verify session with backend:", e);
  }
}

function enterStudioView(user) {
  authView.style.display = "none";
  studioView.style.display = "flex";
  userNavChip.style.display = "flex";

  // Populate user data
  navUserName.textContent = user.displayName || user.email.split("@")[0] || "Architect";
  navUserPlan.textContent = (user.plan || "Free").toUpperCase();
  if (user.photoUrl) {
    navUserAvatar.src = user.photoUrl;
  }

  studioWelcome.textContent = `Welcome back, ${user.displayName || "Architect"}`;
  quotaTierVal.textContent = (user.plan || "Free").toUpperCase();

  if (user.quota) {
    quotaProjectsVal.textContent = `0 / ${user.quota.projects || 5}`;
    quotaRendersVal.textContent = `${user.quota.rendersFinal || 20} / day`;
    quotaAssetsVal.textContent = `${user.quota.assets3d || 10} / mo`;
  }
}

function showAuthView() {
  authView.style.display = "block";
  studioView.style.display = "none";
  userNavChip.style.display = "none";
  passwordInput.value = "";
}

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
  currentUser = null;
  currentProjects = [];
  selectedFile = null;

  showAuthView();
  if (notify) {
    showToast("Signed out of SoraPlan Studio", "info");
  }
}

function setAuthLoading(loading) {
  submitBtn.disabled = loading;
  if (loading) {
    submitBtn.classList.add("loading");
  } else {
    submitBtn.classList.remove("loading");
  }
}

// -------------------------------------------------------------
// 2. DROPZONE & FILE INGESTION LOGIC
// -------------------------------------------------------------

function setupDropzone() {
  // Trigger file dialog on dropzone click
  planDropzone.addEventListener("click", (e) => {
    if (e.target.closest("#btn-remove-file")) {
      e.stopPropagation();
      clearSelectedFile();
      return;
    }
    planFileInput.click();
  });

  // Dropzone keyboard accessibility
  planDropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      planFileInput.click();
    }
  });

  // Native input change
  planFileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  // Drag and drop events
  ["dragenter", "dragover"].forEach((eventName) => {
    planDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      planDropzone.classList.add("drag-active");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    planDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      planDropzone.classList.remove("drag-active");
    });
  });

  planDropzone.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      handleFileSelected(dt.files[0]);
    }
  });

  btnRemoveFile.addEventListener("click", (e) => {
    e.stopPropagation();
    clearSelectedFile();
  });
}

function handleFileSelected(file) {
  const allowedExtensions = [".png", ".jpg", ".jpeg", ".webp", ".pdf"];
  const fileExt = "." + file.name.split(".").pop().toLowerCase();
  const contentType = getNormalizedContentType(file);

  if (!allowedExtensions.includes(fileExt) && !contentType) {
    showToast("Unsupported format. Please upload a PNG, JPG, WebP, or PDF.", "error");
    return;
  }

  // 25 MB max limit
  const MAX_BYTES = 25 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    showToast("File size exceeds 25 MB limit.", "error");
    return;
  }

  selectedFile = file;

  // Render preview card
  previewFilename.textContent = file.name;
  previewFilesize.textContent = formatBytes(file.size);
  previewTypeBadge.textContent = fileExt.replace(".", "").toUpperCase();

  previewMediaContainer.innerHTML = "";
  if (file.type.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp"].includes(fileExt)) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.className = "preview-thumbnail-img";
    img.alt = "Plan Preview";
    previewMediaContainer.appendChild(img);
  } else {
    // PDF representation
    previewMediaContainer.innerHTML = `
      <div class="preview-pdf-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
        </svg>
        <span class="preview-pdf-label">PDF</span>
      </div>
    `;
  }

  dropzoneIdleContent.style.display = "none";
  filePreviewCard.style.display = "flex";

  // Auto-fill project title if currently blank
  if (!projectNameInput.value.trim()) {
    const rawName = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
    projectNameInput.value = rawName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function clearSelectedFile() {
  selectedFile = null;
  planFileInput.value = "";
  dropzoneIdleContent.style.display = "flex";
  filePreviewCard.style.display = "none";
  previewMediaContainer.innerHTML = "";
}

function getNormalizedContentType(file) {
  if (file.type && file.type !== "application/octet-stream") {
    return file.type.toLowerCase();
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".pdf")) return "application/pdf";
  return "image/jpeg";
}

// -------------------------------------------------------------
// 3. SAMPLE BLUEPRINT GENERATOR (1-Click Testing Helper)
// -------------------------------------------------------------

function handleLoadSampleBlueprint() {
  // Generate a realistic architectural floor plan canvas
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const ctx = canvas.getContext("2d");

  // Blueprint background
  ctx.fillStyle = "#0c1824";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid lines
  ctx.strokeStyle = "rgba(79, 165, 216, 0.15)";
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x <= canvas.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Outer structural walls
  ctx.strokeStyle = "#4fa5d8";
  ctx.lineWidth = 8;
  ctx.strokeRect(100, 100, 1000, 600);

  // Interior walls
  ctx.lineWidth = 4;
  ctx.beginPath();
  // Vertical dividing wall
  ctx.moveTo(600, 100);
  ctx.lineTo(600, 480);
  // Horizontal dividing wall
  ctx.moveTo(100, 420);
  ctx.lineTo(600, 420);
  // Bathroom walls
  ctx.moveTo(850, 100);
  ctx.lineTo(850, 360);
  ctx.moveTo(600, 360);
  ctx.lineTo(850, 360);
  ctx.stroke();

  // Door openings and door swings (arcs)
  ctx.strokeStyle = "#8fc7eb";
  ctx.lineWidth = 2;
  // Living room door swing
  ctx.beginPath();
  ctx.arc(600, 420, 50, 0, Math.PI * 0.5, false);
  ctx.stroke();
  // Master bedroom door swing
  ctx.beginPath();
  ctx.arc(600, 480, 50, Math.PI * 1.5, Math.PI * 2, false);
  ctx.stroke();

  // Window cutouts (double thin white lines)
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  // North window
  ctx.beginPath();
  ctx.moveTo(250, 96);
  ctx.lineTo(450, 96);
  ctx.moveTo(250, 104);
  ctx.lineTo(450, 104);
  // East window
  ctx.moveTo(1096, 250);
  ctx.lineTo(1096, 450);
  ctx.moveTo(1104, 250);
  ctx.lineTo(1104, 450);
  // South window
  ctx.beginPath();
  ctx.moveTo(700, 696);
  ctx.lineTo(950, 696);
  ctx.moveTo(700, 704);
  ctx.lineTo(950, 704);
  ctx.stroke();

  // Room Typography
  ctx.font = "bold 22px 'Public Sans', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("LIVING & DINING ROOM", 180, 240);
  ctx.font = "15px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#8fa5b0";
  ctx.fillText("6.4 m × 4.2 m · Area: 26.8 m²", 180, 270);

  ctx.font = "bold 22px 'Public Sans', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("KITCHEN & PANTRY", 180, 520);
  ctx.font = "15px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#8fa5b0";
  ctx.fillText("5.2 m × 2.8 m · Area: 14.5 m²", 180, 550);

  ctx.font = "bold 22px 'Public Sans', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("MASTER BEDROOM", 660, 520);
  ctx.font = "15px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#8fa5b0";
  ctx.fillText("5.0 m × 4.4 m · Area: 22.0 m²", 660, 550);

  ctx.font = "bold 18px 'Public Sans', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("EN-SUITE BATH", 640, 220);
  ctx.font = "14px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#8fa5b0";
  ctx.fillText("3.1 m × 2.6 m", 640, 245);

  // Title Block
  ctx.strokeStyle = "#4fa5d8";
  ctx.strokeRect(700, 60, 400, 36);
  ctx.font = "bold 14px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#4fa5d8";
  ctx.fillText("SORAPLAN METRIC SCENE GRAPH · SCALE 1:100", 715, 84);

  // Export to Blob File
  canvas.toBlob((blob) => {
    const sampleFile = new File([blob], "scandinavian_loft_blueprint.png", { type: "image/png" });
    handleFileSelected(sampleFile);
    projectNameInput.value = "Scandinavian Loft 3D";
    projectDescInput.value = "Two-bedroom open plan loft with en-suite bath and panoramic living room.";
    showToast("⚡ Sample blueprint sketch loaded and ready to upload!", "info");
  }, "image/png");
}

// -------------------------------------------------------------
// 4. MULTI-STEP PROJECT CREATION & DIRECT STORAGE UPLOAD
// -------------------------------------------------------------

async function handleCreateAndUploadProject(e) {
  e.preventDefault();

  if (isUploading) return;

  const token = localStorage.getItem("soraplan_token");
  if (!token) {
    showToast("Authentication required. Please sign in.", "error");
    handleLogout(false);
    return;
  }

  const name = projectNameInput.value.trim();
  const description = projectDescInput.value.trim();

  if (!name) {
    showToast("Please enter a project name.", "error");
    projectNameInput.focus();
    return;
  }

  if (!selectedFile) {
    showToast("Please drop or select a floor plan sketch, PDF, or screenshot.", "error");
    planDropzone.focus();
    return;
  }

  const contentType = getNormalizedContentType(selectedFile);
  const sizeBytes = selectedFile.size;

  setUploadInProgress(true);
  resetProgressSteps();

  let createdProjectId = null;

  try {
    // -------------------------------------------------------------
    // STEP 1: Create Project Record in Backend
    // -------------------------------------------------------------
    setProgressStep(stepCreate, "active", 15, "Step 1/4: Creating project record in Firestore...");
    
    const createRes = await fetch(`${API_BASE_URL}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        description: description || undefined,
      }),
    });

    const projectData = await createRes.json();

    if (!createRes.ok) {
      throw new Error(projectData.detail || projectData.title || "Failed to create project");
    }

    createdProjectId = projectData.id;
    setProgressStep(stepCreate, "done", 25, `✓ Project created (ID: ${createdProjectId})`);

    // -------------------------------------------------------------
    // STEP 2: Request V4 Signed Upload URL
    // -------------------------------------------------------------
    setProgressStep(stepUrl, "active", 35, "Step 2/4: Requesting V4 signed upload URL from Google Cloud Storage...");

    const urlRes = await fetch(`${API_BASE_URL}/projects/${createdProjectId}/upload-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        fileName: selectedFile.name,
        contentType: contentType,
        sizeBytes: sizeBytes,
      }),
    });

    const uploadInfo = await urlRes.json();

    if (!urlRes.ok) {
      throw new Error(uploadInfo.detail || uploadInfo.title || "Failed to get signed upload URL");
    }

    const { signedUploadUrl, uploadId } = uploadInfo;
    if (!signedUploadUrl) {
      throw new Error("No signedUploadUrl returned by server");
    }

    setProgressStep(stepUrl, "done", 45, `✓ Signed URL obtained (Target: ${uploadInfo.bucket})`);

    // -------------------------------------------------------------
    // STEP 3: Direct PUT to Google Cloud Storage
    // -------------------------------------------------------------
    setProgressStep(stepPut, "active", 50, "Step 3/4: Uploading directly to Google Cloud Storage (0%)...");

    await uploadDirectToGCS(signedUploadUrl, selectedFile, contentType, (percent) => {
      // Scale 0-100% of PUT upload into progress range 50% - 85%
      const scaledPct = Math.round(50 + (percent * 0.35));
      progressStatusPct.textContent = `${percent}%`;
      progressBarFill.style.width = `${scaledPct}%`;
      progressStatusMsg.textContent = `Step 3/4: Uploading directly to Cloud Storage (${percent}% of ${formatBytes(sizeBytes)})...`;
    });

    setProgressStep(stepPut, "done", 85, "✓ File successfully stored in Google Cloud Storage!");

    // -------------------------------------------------------------
    // STEP 4: Confirm Upload with Backend & Sync Scene Graph
    // -------------------------------------------------------------
    setProgressStep(stepConfirm, "active", 90, "Step 4/4: Confirming upload & updating metric scene graph...");

    const confirmRes = await fetch(`${API_BASE_URL}/projects/${createdProjectId}/confirm-upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        uploadId: uploadId,
        fileName: selectedFile.name,
        contentType: contentType,
        sizeBytes: sizeBytes,
      }),
    });

    const confirmedProject = await confirmRes.json();

    if (!confirmRes.ok) {
      throw new Error(confirmedProject.detail || confirmedProject.title || "Failed to confirm upload");
    }

    setProgressStep(stepConfirm, "done", 100, "✓ Complete! Floor plan securely stored and linked to 3D world.");

    showToast("Project created and floor plan uploaded to Google Cloud Storage successfully!", "success");

    // Reset Form
    projectNameInput.value = "";
    projectDescInput.value = "";
    clearSelectedFile();

    // Reload Projects
    await loadProjects();

    // Fade out progress bar after delay
    setTimeout(() => {
      uploadProgressWrapper.style.display = "none";
    }, 3500);

  } catch (err) {
    console.error("Upload pipeline failed:", err);
    showToast(`Upload failed: ${err.message}`, "error");
    progressStatusMsg.textContent = `Error: ${err.message}`;
    progressStatusMsg.style.color = "var(--error)";
  } finally {
    setUploadInProgress(false);
  }
}

/**
 * Perform direct HTTP PUT to Google Cloud Storage using XMLHttpRequest for real-time progress.
 * The Content-Type header must exactly match the signed URL specification.
 */
function uploadDirectToGCS(signedUrl, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    
    // GCS V4 Signed PUT requires strict Content-Type matching
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          status: xhr.status,
          etag: xhr.getResponseHeader("ETag"),
        });
      } else {
        const errDetail = xhr.responseText ? `: ${xhr.responseText}` : "";
        reject(new Error(`GCS rejected upload (HTTP ${xhr.status})${errDetail}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during Cloud Storage upload"));
    xhr.ontimeout = () => reject(new Error("Cloud Storage upload timed out"));

    xhr.send(file);
  });
}

function setUploadInProgress(loading) {
  isUploading = loading;
  btnCreateProject.disabled = loading;
  btnLoadSample.disabled = loading;

  if (loading) {
    btnCreateProject.classList.add("loading");
    creatorBtnText.textContent = "Ingesting Floor Plan to Cloud...";
    uploadProgressWrapper.style.display = "block";
    progressStatusMsg.style.color = "var(--ink)";
  } else {
    btnCreateProject.classList.remove("loading");
    creatorBtnText.textContent = "Create Project & Upload Floor Plan";
  }
}

function resetProgressSteps() {
  [stepCreate, stepUrl, stepPut, stepConfirm].forEach((el) => {
    el.className = "progress-step-item";
  });
  progressBarFill.style.width = "0%";
  progressStatusPct.textContent = "0%";
}

function setProgressStep(stepEl, status, percent, message) {
  stepEl.className = `progress-step-item ${status}`;
  progressBarFill.style.width = `${percent}%`;
  progressStatusPct.textContent = `${percent}%`;
  progressStatusMsg.textContent = message;
}

// -------------------------------------------------------------
// 5. PROJECTS GALLERY & REMOTE DATA SYNC
// -------------------------------------------------------------

async function loadProjects() {
  const token = localStorage.getItem("soraplan_token");
  if (!token) return;

  btnRefreshProjects.disabled = true;

  try {
    const res = await fetch(`${API_BASE_URL}/projects`, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (!res.ok) {
      if (res.status === 401) {
        handleLogout(false);
        return;
      }
      throw new Error("Could not retrieve projects list");
    }

    const projects = await res.json();
    currentProjects = projects;
    renderProjectsGrid(projects);

    // Update Quota Count
    const maxProjects = currentUser?.quota?.projects || 5;
    quotaProjectsVal.textContent = `${projects.length} / ${maxProjects}`;

  } catch (err) {
    console.error("Error loading projects:", err);
    showToast("Could not load projects from server", "error");
  } finally {
    btnRefreshProjects.disabled = false;
  }
}

function renderProjectsGrid(projects) {
  projectsCount.textContent = projects.length;

  if (projects.length === 0) {
    galleryEmptyState.style.display = "block";
    projectsGrid.style.display = "none";
    projectsGrid.innerHTML = "";
    return;
  }

  galleryEmptyState.style.display = "none";
  projectsGrid.style.display = "grid";
  projectsGrid.innerHTML = "";

  projects.forEach((proj) => {
    const card = document.createElement("div");
    card.className = "project-card";
    card.id = `project-card-${proj.id}`;

    const hasPlan = proj.hasPlan && proj.planImage;
    const plan = proj.planImage;
    const createdDate = proj.createdAt ? new Date(proj.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) : "Recently";

    // Media element
    let mediaHtml = "";
    if (hasPlan && plan.signedUrl) {
      const isPdf = plan.contentType === "application/pdf" || plan.fileName.endsWith(".pdf");
      if (isPdf) {
        mediaHtml = `
          <div class="card-media-pdf">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            <span>PDF FLOOR PLAN</span>
          </div>
        `;
      } else {
        mediaHtml = `<img src="${escapeHtml(plan.signedUrl)}" alt="${escapeHtml(proj.name)}" class="card-media-img" loading="lazy">`;
      }
    } else {
      mediaHtml = `
        <div class="card-media-pdf">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="21" x2="9" y2="9"></line>
          </svg>
          <span>Awaiting Plan Upload</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-media-wrapper" data-project-id="${escapeHtml(proj.id)}">
        ${mediaHtml}
        <span class="status-badge ${hasPlan ? 'uploaded' : 'awaiting'}">
          <span class="status-dot"></span>
          ${hasPlan ? '✓ Uploaded · Ready for 3D' : '⚠ Awaiting Plan'}
        </span>
        <div class="card-media-overlay">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          <span>View Full Plan</span>
        </div>
      </div>

      <div class="card-body">
        <h3 class="project-name">${escapeHtml(proj.name)}</h3>
        <p class="project-desc">${escapeHtml(proj.description || "No description provided.")}</p>

        <div class="card-meta-list">
          ${hasPlan ? `
            <div class="card-meta-item">
              <span class="meta-label">File:</span>
              <span class="meta-val" title="${escapeHtml(plan.fileName)}">${escapeHtml(plan.fileName)}</span>
            </div>
            <div class="card-meta-item">
              <span class="meta-label">Format / Size:</span>
              <span class="meta-val">${escapeHtml(plan.contentType)} (${formatBytes(plan.sizeBytes)})</span>
            </div>
            <div class="card-meta-item">
              <span class="meta-label">Storage:</span>
              <span class="storage-pill" title="${escapeHtml(plan.storagePath)}">${escapeHtml(plan.storagePath)}</span>
            </div>
          ` : `
            <div class="card-meta-item">
              <span class="meta-label">Status:</span>
              <span class="meta-val" style="color: var(--warning);">Upload plan to build 3D</span>
            </div>
          `}
          <div class="card-meta-item">
            <span class="meta-label">Created:</span>
            <span class="meta-val">${createdDate}</span>
          </div>
        </div>
      </div>

      <div class="card-footer">
        ${hasPlan ? `
          <button type="button" class="card-action-btn btn-view-plan" data-project-id="${escapeHtml(proj.id)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>View Plan</span>
          </button>
        ` : `
          <button type="button" class="card-action-btn btn-upload-single" data-project-id="${escapeHtml(proj.id)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <span>Upload Plan</span>
          </button>
        `}
        <button type="button" class="card-delete-btn" data-project-id="${escapeHtml(proj.id)}" title="Delete Project">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;

    // Click handlers for cards
    const mediaWrapper = card.querySelector(".card-media-wrapper");
    mediaWrapper.addEventListener("click", () => openPlanModal(proj));

    const viewPlanBtn = card.querySelector(".btn-view-plan");
    if (viewPlanBtn) {
      viewPlanBtn.addEventListener("click", () => openPlanModal(proj));
    }

    const uploadSingleBtn = card.querySelector(".btn-upload-single");
    if (uploadSingleBtn) {
      uploadSingleBtn.addEventListener("click", () => handleUploadToExistingProject(proj.id));
    }

    const deleteBtn = card.querySelector(".card-delete-btn");
    deleteBtn.addEventListener("click", () => handleDeleteProject(proj.id, proj.name));

    projectsGrid.appendChild(card);
  });
}

// -------------------------------------------------------------
// 6. UPLOAD TO EXISTING PROJECT WITHOUT PLAN
// -------------------------------------------------------------

function handleUploadToExistingProject(projectId) {
  // Create ephemeral file picker
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";

  picker.onchange = async () => {
    if (!picker.files || picker.files.length === 0) return;
    const file = picker.files[0];
    const token = localStorage.getItem("soraplan_token");
    const contentType = getNormalizedContentType(file);

    showToast(`Uploading ${file.name} to project...`, "info");

    try {
      // 1. Get signed upload URL
      const urlRes = await fetch(`${API_BASE_URL}/projects/${projectId}/upload-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileName: file.name,
          contentType: contentType,
          sizeBytes: file.size,
        }),
      });

      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.detail || "Failed to get upload URL");

      // 2. Direct PUT to GCS
      await uploadDirectToGCS(urlData.signedUploadUrl, file, contentType);

      // 3. Confirm
      const confirmRes = await fetch(`${API_BASE_URL}/projects/${projectId}/confirm-upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          uploadId: urlData.uploadId,
          fileName: file.name,
          contentType: contentType,
          sizeBytes: file.size,
        }),
      });

      if (!confirmRes.ok) throw new Error("Could not confirm upload in Firestore");

      showToast("Floor plan uploaded successfully!", "success");
      await loadProjects();

    } catch (e) {
      console.error(e);
      showToast(`Upload failed: ${e.message}`, "error");
    }
  };

  picker.click();
}

async function handleDeleteProject(projectId, projectName) {
  if (!confirm(`Are you sure you want to delete "${projectName}"? This will permanently remove the project and its stored floor plan.`)) {
    return;
  }

  const token = localStorage.getItem("soraplan_token");
  try {
    const res = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (res.ok || res.status === 204) {
      showToast(`Project "${projectName}" deleted.`, "info");
      await loadProjects();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || "Could not delete project.", "error");
    }
  } catch (err) {
    showToast("Network error while deleting project.", "error");
  }
}

// -------------------------------------------------------------
// 7. LIGHTBOX MODAL VIEWER
// -------------------------------------------------------------

function openPlanModal(proj) {
  if (!proj.hasPlan || !proj.planImage) {
    showToast("No floor plan uploaded for this project yet.", "info");
    return;
  }

  const plan = proj.planImage;
  const isPdf = plan.contentType === "application/pdf" || plan.fileName.endsWith(".pdf");

  modalPlanTitle.textContent = proj.name;
  modalPlanMeta.textContent = `${plan.fileName} · ${plan.contentType} · ${formatBytes(plan.sizeBytes)}`;
  modalGcsUri.textContent = plan.gcsUri || `gs://${plan.bucket}/${plan.storagePath}`;
  modalOpenNewTab.href = plan.signedUrl;

  modalPlanBody.innerHTML = "";
  if (isPdf) {
    const iframe = document.createElement("iframe");
    iframe.src = plan.signedUrl;
    iframe.className = "modal-pdf-frame";
    modalPlanBody.appendChild(iframe);
  } else {
    const img = document.createElement("img");
    img.src = plan.signedUrl;
    img.className = "modal-full-img";
    img.alt = proj.name;
    modalPlanBody.appendChild(img);
  }

  planModal.style.display = "flex";
}

function closePlanModal() {
  planModal.style.display = "none";
  modalPlanBody.innerHTML = "";
}

// -------------------------------------------------------------
// 8. UTILITIES & THEME
// -------------------------------------------------------------

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function togglePasswordVisibility() {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  togglePasswordBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
  
  eyeIcon.innerHTML = isPassword 
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
}

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

let toastTimeout = null;
function showToast(message, type = "info") {
  clearTimeout(toastTimeout);
  toastMessage.textContent = message;
  toast.className = `toast visible ${type}`;

  toastTimeout = setTimeout(() => {
    toast.className = "toast";
  }, 4500);
}
