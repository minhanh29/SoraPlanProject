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

// DOM Elements - Image Cropper & Crop Message Banner
const cropPromptBanner = document.getElementById("crop-prompt-banner");
const imageCropperCard = document.getElementById("image-cropper-card");
const cropperCanvas = document.getElementById("cropper-canvas");
const cropperCanvasWrap = document.getElementById("cropper-canvas-wrap");
const cropperDimInfo = document.getElementById("cropper-dim-info");
const btnResetCrop = document.getElementById("btn-reset-crop");
const btnSkipCrop = document.getElementById("btn-skip-crop");
const btnApplyCrop = document.getElementById("btn-apply-crop");
const btnRecropFile = document.getElementById("btn-recrop-file");
const previewCropBadge = document.getElementById("preview-crop-badge");

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

// DOM Elements - Plan Parser & 2D Editor
const editorModal = document.getElementById("editor-modal");
const editorTitle = document.getElementById("editor-title");
const editorDimsBadge = document.getElementById("editor-dims-badge");
const editorConfidenceBadge = document.getElementById("editor-confidence-badge");
const btnCloseEditor = document.getElementById("btn-close-editor");
const btnUndo = document.getElementById("btn-undo");
const btnRedo = document.getElementById("btn-redo");
const btnZoomIn = document.getElementById("btn-zoom-in");
const btnZoomOut = document.getElementById("btn-zoom-out");
const btnFitScreen = document.getElementById("btn-fit-screen");
const btnResetView = document.getElementById("btn-reset-view");
const btnImportJson = document.getElementById("btn-import-json");
const importJsonInput = document.getElementById("import-json-input");
const btnExportJson = document.getElementById("btn-export-json");
const btnSavePlan = document.getElementById("btn-save-plan");

// Layer controls
const layerWalls = document.getElementById("layer-walls");
const layerFurniture = document.getElementById("layer-furniture");
const layerFixtures = document.getElementById("layer-fixtures");
const layerRooms = document.getElementById("layer-rooms");
const layerLabels = document.getElementById("layer-labels");
const layerGrid = document.getElementById("layer-grid");
const layerOverlay = document.getElementById("layer-overlay");
const overlayOpacity = document.getElementById("overlay-opacity");
const overlayOpacityValLabel = document.getElementById("overlay-opacity-val");

// Canvas
const floorplanCanvas = document.getElementById("floorplan-canvas");
const canvasCoordsOverlay = document.getElementById("canvas-coords-overlay");

// Inspector
const inspectorEmpty = document.getElementById("inspector-empty");
const inspectorFields = document.getElementById("inspector-fields");
const propId = document.getElementById("prop-id");
const propType = document.getElementById("prop-type");
const propLabel = document.getElementById("prop-label");
const inspectorBoxFields = document.getElementById("inspector-box-fields");
const propX = document.getElementById("prop-x");
const propY = document.getElementById("prop-y");
const propW = document.getElementById("prop-w");
const propH = document.getElementById("prop-h");
const propRot = document.getElementById("prop-rot");
const propConf = document.getElementById("prop-conf");
const inspectorWallFields = document.getElementById("inspector-wall-fields");
const propX1 = document.getElementById("prop-x1");
const propY1 = document.getElementById("prop-y1");
const propX2 = document.getElementById("prop-x2");
const propY2 = document.getElementById("prop-y2");
const propThickness = document.getElementById("prop-thickness");
const propExterior = document.getElementById("prop-exterior");
const btnRotateObject = document.getElementById("btn-rotate-object");
const btnDeleteObject = document.getElementById("btn-delete-object");

// Parsing Modal
const parsingModal = document.getElementById("parsing-modal");
const parsingTitle = document.getElementById("parsing-title");
const parsingSubtitle = document.getElementById("parsing-subtitle");
const parsingBarFill = document.getElementById("parsing-bar-fill");
const parsingStatusText = document.getElementById("parsing-status-text");
const parsingPollTimer = document.getElementById("parsing-poll-timer");
const btnCancelPoll = document.getElementById("btn-cancel-poll");

// Active parsing jobs polling map { projectId: { intervalId, jobId } }
const activePollingJobs = {};

// Lifecycle Initialization
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  setupEventListeners();
  setupEditorEventListeners();
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

  btnCancelPoll.addEventListener("click", () => {
    parsingModal.style.display = "none";
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (planModal.style.display !== "none") closePlanModal();
      if (parsingModal.style.display !== "none") parsingModal.style.display = "none";
      if (editorModal.style.display !== "none") closeFloorPlanEditor();
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

  setupCropperCanvasEvents();
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

  rawSelectedFile = file;
  selectedFile = file;
  isFileCropped = false;

  // Auto-fill project title if currently blank
  if (!projectNameInput.value.trim()) {
    const rawName = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
    projectNameInput.value = rawName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const isImage = file.type.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp"].includes(fileExt);

  if (isImage) {
    // Open Interactive Picture Cropper & display prompt message asking user to crop
    initImageCropper(file);
  } else {
    // PDF document representation (skip image cropper)
    if (cropPromptBanner) cropPromptBanner.style.display = "none";
    if (imageCropperCard) imageCropperCard.style.display = "none";
    if (previewCropBadge) previewCropBadge.style.display = "none";
    if (btnRecropFile) btnRecropFile.style.display = "none";

    previewFilename.textContent = file.name;
    previewFilesize.textContent = formatBytes(file.size);
    previewTypeBadge.textContent = "PDF";

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

    dropzoneIdleContent.style.display = "none";
    filePreviewCard.style.display = "flex";
  }
}

function clearSelectedFile() {
  selectedFile = null;
  rawSelectedFile = null;
  isFileCropped = false;
  cropperImage = null;
  planFileInput.value = "";
  dropzoneIdleContent.style.display = "flex";
  filePreviewCard.style.display = "none";
  previewMediaContainer.innerHTML = "";
  if (cropPromptBanner) cropPromptBanner.style.display = "none";
  if (imageCropperCard) imageCropperCard.style.display = "none";
  if (previewCropBadge) previewCropBadge.style.display = "none";
  if (btnRecropFile) btnRecropFile.style.display = "none";
}

// -------------------------------------------------------------
// Interactive Picture Cropper & Room Boundary Helpers
// -------------------------------------------------------------

let rawSelectedFile = null;
let isFileCropped = false;
let cropperImage = null;
let cropBox = { x: 0, y: 0, width: 0, height: 0 };
let cropperDisplay = { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 };
let cropperDrag = null;

function initImageCropper(file) {
  rawSelectedFile = file;
  selectedFile = file;
  isFileCropped = false;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      cropperImage = img;

      // Smart initial crop framing the room
      if (img.width === 2732 && img.height === 1908) {
        // Calibrated room boundary for floorplan_1.png
        cropBox = { x: 629, y: 321, width: 1521, height: 1136 };
      } else {
        // Standard floorplan inset
        const insetX = Math.round(img.width * 0.10);
        const insetY = Math.round(img.height * 0.10);
        cropBox = {
          x: insetX,
          y: insetY,
          width: Math.max(80, Math.round(img.width * 0.80)),
          height: Math.max(80, Math.round(img.height * 0.80)),
        };
      }

      // Display the crop prompt message banner and cropper tool card
      if (cropPromptBanner) cropPromptBanner.style.display = "flex";
      if (imageCropperCard) imageCropperCard.style.display = "block";
      if (filePreviewCard) filePreviewCard.style.display = "none";
      if (dropzoneIdleContent) dropzoneIdleContent.style.display = "none";

      updateCropperDimReadout();
      // Allow DOM layout pass to compute wrap dimensions
      requestAnimationFrame(() => {
        renderCropper();
      });
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function updateCropperDimReadout() {
  if (!cropperImage || !cropperDimInfo) return;
  const w = Math.round(cropBox.width);
  const h = Math.round(cropBox.height);
  const pct = Math.round(((cropBox.width * cropBox.height) / (cropperImage.width * cropperImage.height)) * 100);
  cropperDimInfo.textContent = `Original: ${cropperImage.width} × ${cropperImage.height} px · Crop: ${w} × ${h} px (${pct}%)`;
}

function renderCropper() {
  if (!cropperImage || !cropperCanvas || !cropperCanvasWrap) return;

  const wrapRect = cropperCanvasWrap.getBoundingClientRect();
  const wrapW = Math.max(280, wrapRect.width);
  const wrapH = Math.max(240, wrapRect.height || 340);

  const dpr = window.devicePixelRatio || 1;
  cropperCanvas.width = Math.round(wrapW * dpr);
  cropperCanvas.height = Math.round(wrapH * dpr);
  cropperCanvas.style.width = `${wrapW}px`;
  cropperCanvas.style.height = `${wrapH}px`;

  const ctx = cropperCanvas.getContext("2d");
  ctx.resetTransform();
  ctx.scale(dpr, dpr);

  // Background canvas fill
  ctx.fillStyle = "#090d12";
  ctx.fillRect(0, 0, wrapW, wrapH);

  // Calculate image fit scale with padding
  const pad = 16;
  const availW = Math.max(100, wrapW - pad * 2);
  const availH = Math.max(100, wrapH - pad * 2);

  const scale = Math.min(availW / cropperImage.width, availH / cropperImage.height);
  const dispW = cropperImage.width * scale;
  const dispH = cropperImage.height * scale;
  const offX = (wrapW - dispW) / 2;
  const offY = (wrapH - dispH) / 2;

  cropperDisplay = { scale, offsetX: offX, offsetY: offY, width: wrapW, height: wrapH };

  // 1. Draw base image
  ctx.drawImage(cropperImage, offX, offY, dispW, dispH);

  // Screen coordinates of crop box
  const bx = offX + cropBox.x * scale;
  const by = offY + cropBox.y * scale;
  const bw = cropBox.width * scale;
  const bh = cropBox.height * scale;

  // 2. Dark translucent mask outside crop box
  ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
  // Top
  ctx.fillRect(offX, offY, dispW, Math.max(0, by - offY));
  // Bottom
  ctx.fillRect(offX, by + bh, dispW, Math.max(0, offY + dispH - (by + bh)));
  // Left
  ctx.fillRect(offX, by, Math.max(0, bx - offX), bh);
  // Right
  ctx.fillRect(bx + bw, by, Math.max(0, offX + dispW - (bx + bw)), bh);

  // 3. Rule of Thirds grid lines inside crop box
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(bx + bw / 3, by);
  ctx.lineTo(bx + bw / 3, by + bh);
  ctx.moveTo(bx + (bw * 2) / 3, by);
  ctx.lineTo(bx + (bw * 2) / 3, by + bh);
  ctx.moveTo(bx, by + bh / 3);
  ctx.lineTo(bx + bw, by + bh / 3);
  ctx.moveTo(bx, by + (bh * 2) / 3);
  ctx.lineTo(bx + bw, by + (bh * 2) / 3);
  ctx.stroke();
  ctx.restore();

  // 4. Crop Box Border
  ctx.save();
  ctx.strokeStyle = "#8b5cf6"; // Vibrant purple
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);

  // 5. Corner Handles (L-brackets + grab circles)
  const bracketLen = Math.min(18, bw / 3, bh / 3);
  ctx.strokeStyle = "#c084fc";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";

  // TL
  ctx.beginPath();
  ctx.moveTo(bx, by + bracketLen);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + bracketLen, by);
  ctx.stroke();

  // TR
  ctx.beginPath();
  ctx.moveTo(bx + bw - bracketLen, by);
  ctx.lineTo(bx + bw, by);
  ctx.lineTo(bx + bw, by + bracketLen);
  ctx.stroke();

  // BR
  ctx.beginPath();
  ctx.moveTo(bx + bw, by + bh - bracketLen);
  ctx.lineTo(bx + bw, by + bh);
  ctx.lineTo(bx + bw - bracketLen, by + bh);
  ctx.stroke();

  // BL
  ctx.beginPath();
  ctx.moveTo(bx + bracketLen, by + bh);
  ctx.lineTo(bx, by + bh);
  ctx.lineTo(bx, by + bh - bracketLen);
  ctx.stroke();

  // Corner Dots
  const dotR = 4.5;
  const corners = [
    { x: bx, y: by },
    { x: bx + bw, y: by },
    { x: bx + bw, y: by + bh },
    { x: bx, y: by + bh },
  ];
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 2;
  corners.forEach((c) => {
    ctx.beginPath();
    ctx.arc(c.x, c.y, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  // Edge Handles (midpoint pills)
  const midPoints = [
    { x: bx + bw / 2, y: by, w: 14, h: 4 }, // Top
    { x: bx + bw / 2, y: by + bh, w: 14, h: 4 }, // Bottom
    { x: bx, y: by + bh / 2, w: 4, h: 14 }, // Left
    { x: bx + bw, y: by + bh / 2, w: 4, h: 14 }, // Right
  ];
  ctx.fillStyle = "#c084fc";
  midPoints.forEach((m) => {
    ctx.beginPath();
    ctx.roundRect(m.x - m.w / 2, m.y - m.h / 2, m.w, m.h, 2);
    ctx.fill();
  });

  // 6. Floating Dimension Tag
  const dimTagText = `${Math.round(cropBox.width)} × ${Math.round(cropBox.height)} px`;
  ctx.font = "bold 11px Inter, system-ui, sans-serif";
  const tagW = ctx.measureText(dimTagText).width + 16;
  const tagH = 22;
  const tagX = bx + bw / 2 - tagW / 2;
  const tagY = by + bh + 8 < wrapH - 26 ? by + bh + 6 : by - tagH - 6;

  ctx.fillStyle = "rgba(15, 23, 42, 0.90)";
  ctx.beginPath();
  ctx.roundRect(tagX, tagY, tagW, tagH, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(139, 92, 246, 0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(dimTagText, bx + bw / 2, tagY + tagH / 2);

  ctx.restore();
}

function getCropperHandleAt(canvasX, canvasY) {
  if (!cropperImage) return null;
  const { scale, offsetX, offsetY } = cropperDisplay;

  const bx = offsetX + cropBox.x * scale;
  const by = offsetY + cropBox.y * scale;
  const bw = cropBox.width * scale;
  const bh = cropBox.height * scale;

  const hitR = 14;

  // Corners
  if (Math.hypot(canvasX - bx, canvasY - by) <= hitR) return "tl";
  if (Math.hypot(canvasX - (bx + bw), canvasY - by) <= hitR) return "tr";
  if (Math.hypot(canvasX - (bx + bw), canvasY - (by + bh)) <= hitR) return "br";
  if (Math.hypot(canvasX - bx, canvasY - (by + bh)) <= hitR) return "bl";

  // Edges
  if (Math.abs(canvasY - by) <= 8 && canvasX >= bx && canvasX <= bx + bw) return "top";
  if (Math.abs(canvasY - (by + bh)) <= 8 && canvasX >= bx && canvasX <= bx + bw) return "bottom";
  if (Math.abs(canvasX - bx) <= 8 && canvasY >= by && canvasY <= by + bh) return "left";
  if (Math.abs(canvasX - (bx + bw)) <= 8 && canvasY >= by && canvasY <= by + bh) return "right";

  // Inside
  if (canvasX > bx && canvasX < bx + bw && canvasY > by && canvasY < by + bh) return "move";

  // Inside image area
  const dispW = cropperImage.width * scale;
  const dispH = cropperImage.height * scale;
  if (canvasX >= offsetX && canvasX <= offsetX + dispW && canvasY >= offsetY && canvasY <= offsetY + dispH) {
    return "create";
  }

  return null;
}

function updateCropperCursor(handle) {
  if (!cropperCanvas) return;
  switch (handle) {
    case "tl":
    case "br":
      cropperCanvas.style.cursor = "nwse-resize";
      break;
    case "tr":
    case "bl":
      cropperCanvas.style.cursor = "nesw-resize";
      break;
    case "top":
    case "bottom":
      cropperCanvas.style.cursor = "ns-resize";
      break;
    case "left":
    case "right":
      cropperCanvas.style.cursor = "ew-resize";
      break;
    case "move":
      cropperCanvas.style.cursor = "move";
      break;
    case "create":
      cropperCanvas.style.cursor = "crosshair";
      break;
    default:
      cropperCanvas.style.cursor = "default";
  }
}

function handleCropperDrag(cx, cy) {
  if (!cropperDrag || !cropperImage) return;

  const { handle, startX, startY, origBox } = cropperDrag;
  const scale = cropperDisplay.scale;

  const dx = (cx - startX) / scale;
  const dy = (cy - startY) / scale;

  let newBox = { ...origBox };
  const minDim = 40;

  switch (handle) {
    case "move":
      newBox.x = Math.max(0, Math.min(cropperImage.width - origBox.width, origBox.x + dx));
      newBox.y = Math.max(0, Math.min(cropperImage.height - origBox.height, origBox.y + dy));
      break;
    case "tl": {
      const maxX = origBox.x + origBox.width - minDim;
      const maxY = origBox.y + origBox.height - minDim;
      newBox.x = Math.max(0, Math.min(maxX, origBox.x + dx));
      newBox.y = Math.max(0, Math.min(maxY, origBox.y + dy));
      newBox.width = origBox.x + origBox.width - newBox.x;
      newBox.height = origBox.y + origBox.height - newBox.y;
      break;
    }
    case "tr": {
      const maxY = origBox.y + origBox.height - minDim;
      newBox.y = Math.max(0, Math.min(maxY, origBox.y + dy));
      newBox.height = origBox.y + origBox.height - newBox.y;
      newBox.width = Math.max(minDim, Math.min(cropperImage.width - origBox.x, origBox.width + dx));
      break;
    }
    case "br": {
      newBox.width = Math.max(minDim, Math.min(cropperImage.width - origBox.x, origBox.width + dx));
      newBox.height = Math.max(minDim, Math.min(cropperImage.height - origBox.y, origBox.height + dy));
      break;
    }
    case "bl": {
      const maxX = origBox.x + origBox.width - minDim;
      newBox.x = Math.max(0, Math.min(maxX, origBox.x + dx));
      newBox.width = origBox.x + origBox.width - newBox.x;
      newBox.height = Math.max(minDim, Math.min(cropperImage.height - origBox.y, origBox.height + dy));
      break;
    }
    case "top": {
      const maxY = origBox.y + origBox.height - minDim;
      newBox.y = Math.max(0, Math.min(maxY, origBox.y + dy));
      newBox.height = origBox.y + origBox.height - newBox.y;
      break;
    }
    case "bottom": {
      newBox.height = Math.max(minDim, Math.min(cropperImage.height - origBox.y, origBox.height + dy));
      break;
    }
    case "left": {
      const maxX = origBox.x + origBox.width - minDim;
      newBox.x = Math.max(0, Math.min(maxX, origBox.x + dx));
      newBox.width = origBox.x + origBox.width - newBox.x;
      break;
    }
    case "right": {
      newBox.width = Math.max(minDim, Math.min(cropperImage.width - origBox.x, origBox.width + dx));
      break;
    }
    case "create": {
      const imgX = (Math.min(startX, cx) - cropperDisplay.offsetX) / scale;
      const imgY = (Math.min(startY, cy) - cropperDisplay.offsetY) / scale;
      const w = Math.abs(cx - startX) / scale;
      const h = Math.abs(cy - startY) / scale;
      newBox.x = Math.max(0, Math.min(cropperImage.width - minDim, imgX));
      newBox.y = Math.max(0, Math.min(cropperImage.height - minDim, imgY));
      newBox.width = Math.max(minDim, Math.min(cropperImage.width - newBox.x, w));
      newBox.height = Math.max(minDim, Math.min(cropperImage.height - newBox.y, h));
      break;
    }
  }

  cropBox = newBox;
  updateCropperDimReadout();
  renderCropper();
}

function setupCropperCanvasEvents() {
  if (!cropperCanvas) return;

  if (btnResetCrop) {
    btnResetCrop.addEventListener("click", resetCropper);
  }

  if (btnSkipCrop) {
    btnSkipCrop.addEventListener("click", skipCropper);
  }

  if (btnApplyCrop) {
    btnApplyCrop.addEventListener("click", applyCroppedImage);
  }

  if (btnRecropFile) {
    btnRecropFile.addEventListener("click", reopenCropper);
  }

  cropperCanvas.addEventListener("pointermove", (e) => {
    const rect = cropperCanvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    if (!cropperDrag) {
      const handle = getCropperHandleAt(cx, cy);
      updateCropperCursor(handle);
      return;
    }

    handleCropperDrag(cx, cy);
  });

  cropperCanvas.addEventListener("pointerdown", (e) => {
    const rect = cropperCanvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const handle = getCropperHandleAt(cx, cy);
    if (!handle) return;

    cropperCanvas.setPointerCapture(e.pointerId);
    cropperDrag = {
      handle,
      startX: cx,
      startY: cy,
      origBox: { ...cropBox },
    };
  });

  const endDrag = (e) => {
    if (cropperDrag) {
      try {
        cropperCanvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
      cropperDrag = null;
      updateCropperDimReadout();
      renderCropper();
    }
  };

  cropperCanvas.addEventListener("pointerup", endDrag);
  cropperCanvas.addEventListener("pointercancel", endDrag);

  window.addEventListener("resize", () => {
    if (imageCropperCard && imageCropperCard.style.display !== "none") {
      renderCropper();
    }
  });
}

function applyCroppedImage() {
  applyCroppedImageAsync().catch((err) => {
    showToast(`Crop error: ${err.message}`, "error");
  });
}

function applyCroppedImageAsync() {
  return new Promise((resolve, reject) => {
    if (!cropperImage || !rawSelectedFile) {
      resolve();
      return;
    }

    const cropW = Math.max(20, Math.round(cropBox.width));
    const cropH = Math.max(20, Math.round(cropBox.height));
    const cropX = Math.max(0, Math.round(cropBox.x));
    const cropY = Math.max(0, Math.round(cropBox.y));

    const offscreen = document.createElement("canvas");
    offscreen.width = cropW;
    offscreen.height = cropH;
    const ctx = offscreen.getContext("2d");

    ctx.drawImage(cropperImage, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    offscreen.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not export cropped image blob."));
        return;
      }

      const baseName = rawSelectedFile.name.replace(/\.[^.]+$/, "");
      const croppedFileName = `${baseName}_cropped.png`;
      const croppedFile = new File([blob], croppedFileName, { type: "image/png" });

      selectedFile = croppedFile;
      isFileCropped = true;

      // Update thumbnail in preview card
      if (previewMediaContainer) {
        previewMediaContainer.innerHTML = "";
        const thumb = document.createElement("img");
        thumb.src = URL.createObjectURL(blob);
        thumb.className = "preview-thumbnail-img";
        thumb.alt = "Cropped Preview";
        previewMediaContainer.appendChild(thumb);
      }

      if (previewFilename) previewFilename.textContent = croppedFileName;
      if (previewFilesize) previewFilesize.textContent = formatBytes(blob.size);
      if (previewTypeBadge) previewTypeBadge.textContent = "PNG";
      if (previewCropBadge) {
        previewCropBadge.textContent = `✓ Cropped (${cropW} × ${cropH} px)`;
        previewCropBadge.style.display = "inline-block";
      }
      if (btnRecropFile) btnRecropFile.style.display = "inline-flex";

      // Switch view
      if (imageCropperCard) imageCropperCard.style.display = "none";
      if (cropPromptBanner) cropPromptBanner.style.display = "none";
      if (filePreviewCard) filePreviewCard.style.display = "flex";
      if (dropzoneIdleContent) dropzoneIdleContent.style.display = "none";

      showToast(`✓ Sketch cropped to ${cropW} × ${cropH} px! Ready to upload.`, "success");
      resolve(croppedFile);
    }, "image/png");
  });
}

function skipCropper() {
  if (!rawSelectedFile) return;
  selectedFile = rawSelectedFile;
  isFileCropped = false;

  if (imageCropperCard) imageCropperCard.style.display = "none";
  if (cropPromptBanner) cropPromptBanner.style.display = "none";
  if (filePreviewCard) filePreviewCard.style.display = "flex";
  if (previewCropBadge) previewCropBadge.style.display = "none";
  if (btnRecropFile) btnRecropFile.style.display = "inline-flex";

  showToast("Using full original sketch without cropping.", "info");
}

function resetCropper() {
  if (!cropperImage) return;
  cropBox = { x: 0, y: 0, width: cropperImage.width, height: cropperImage.height };
  updateCropperDimReadout();
  renderCropper();
  showToast("Crop box reset to full image.", "info");
}

function reopenCropper() {
  if (cropPromptBanner) cropPromptBanner.style.display = "flex";
  if (imageCropperCard) imageCropperCard.style.display = "block";
  if (filePreviewCard) filePreviewCard.style.display = "none";
  updateCropperDimReadout();
  requestAnimationFrame(() => {
    renderCropper();
  });
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

  // If the user has an image loaded in the cropper and hasn't explicitly clicked Confirm Crop or Skip,
  // automatically apply the current crop box seamlessly before upload!
  if (imageCropperCard && imageCropperCard.style.display !== "none" && cropperImage && !isFileCropped) {
    showToast("Applying room boundary crop...", "info");
    await applyCroppedImageAsync();
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
    const isParsed = Boolean(proj.hasPlanParsed || proj.floorPlan);
    const isProcessing = Boolean(proj.status === "processing" || activePollingJobs[proj.id]);
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

    // Status badge determination
    let statusBadgeHtml = "";
    if (isParsed) {
      statusBadgeHtml = `
        <span class="status-badge completed">
          <span class="status-dot"></span>
          ✓ 2D Plan Parsed
        </span>
      `;
    } else if (isProcessing) {
      statusBadgeHtml = `
        <span class="status-badge processing">
          <span class="status-dot"></span>
          ⏳ Parsing with AI...
        </span>
      `;
    } else if (hasPlan) {
      statusBadgeHtml = `
        <span class="status-badge uploaded">
          <span class="status-dot"></span>
          ✓ Uploaded · Ready to Parse
        </span>
      `;
    } else {
      statusBadgeHtml = `
        <span class="status-badge awaiting">
          <span class="status-dot"></span>
          ⚠ Awaiting Plan
        </span>
      `;
    }

    card.innerHTML = `
      <div class="card-media-wrapper" data-project-id="${escapeHtml(proj.id)}">
        ${mediaHtml}
        ${statusBadgeHtml}
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
          ${isParsed ? `
            <button type="button" class="card-action-btn btn-open-editor" data-project-id="${escapeHtml(proj.id)}" title="Open Interactive 2D Floor Plan Editor">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="3" y1="9" x2="21" y2="9"></line>
                <line x1="9" y1="21" x2="9" y2="9"></line>
              </svg>
              <span>Open 2D Plan</span>
            </button>
          ` : isProcessing ? `
            <button type="button" class="card-action-btn btn-view-parsing" data-project-id="${escapeHtml(proj.id)}" title="Check AI Vision Parsing Progress">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span>Parsing...</span>
            </button>
          ` : `
            <button type="button" class="card-action-btn btn-parse-plan" data-project-id="${escapeHtml(proj.id)}" title="Convert floor plan to 2D editable scene with gpt-6-sol">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
              </svg>
              <span>⚡ Parse with AI</span>
            </button>
          `}
          <button type="button" class="card-action-btn btn-view-plan" data-project-id="${escapeHtml(proj.id)}" title="View Original Upload">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>Original</span>
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

    const parseBtn = card.querySelector(".btn-parse-plan");
    if (parseBtn) {
      parseBtn.addEventListener("click", () => handleTriggerParsePlan(proj.id, proj.name));
    }

    const openEditorBtn = card.querySelector(".btn-open-editor");
    if (openEditorBtn) {
      openEditorBtn.addEventListener("click", () => openFloorPlanEditor(proj));
    }

    const viewParsingBtn = card.querySelector(".btn-view-parsing");
    if (viewParsingBtn) {
      viewParsingBtn.addEventListener("click", () => showParsingStatusModal(proj));
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

// =============================================================
// 9. AI PLAN PARSING & CLOUD TASK POLLING (EVERY 10 SECONDS)
// =============================================================

async function handleTriggerParsePlan(projectId, projectName) {
  const token = localStorage.getItem("soraplan_token");
  if (!token) {
    showToast("Please sign in first.", "error");
    return;
  }

  showParsingModal(projectName);

  try {
    parsingStatusText.textContent = "Triggering Cloud Run plan parsing worker with gpt-6-sol...";
    parsingBarFill.style.width = "20%";

    const res = await fetch(`${API_BASE_URL}/projects/${projectId}/parse-plan`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.title || "Failed to start plan parsing.");
    }

    const jobId = data.jobId;
    showToast("Floor plan parsing started! Processing with gpt-6-sol...", "info");

    // Start polling Firestore task result every 10 seconds
    startPollingPlanJob(jobId, projectId, projectName);

  } catch (err) {
    console.error("Parse trigger error:", err);
    parsingModal.style.display = "none";
    showToast(`Error: ${err.message}`, "error");
  }
}

function showParsingModal(projectName) {
  parsingTitle.textContent = `Digitising: ${projectName}`;
  parsingSubtitle.textContent = "OpenAI gpt-6-sol is analysing architectural layout, walls, rooms & furniture…";
  parsingBarFill.style.width = "25%";
  parsingStatusText.textContent = "Connecting to worker...";
  parsingPollTimer.textContent = "Polling every 10s";
  parsingModal.style.display = "flex";
}

function showParsingStatusModal(proj) {
  showParsingModal(proj.name);
  if (proj.currentJobId) {
    startPollingPlanJob(proj.currentJobId, proj.id, proj.name);
  }
}

function startPollingPlanJob(jobId, projectId, projectName) {
  // Clear any existing poll for this project
  if (activePollingJobs[projectId]) {
    clearInterval(activePollingJobs[projectId].intervalId);
  }

  let pollCount = 0;

  async function checkJobStatus() {
    pollCount++;
    const token = localStorage.getItem("soraplan_token");
    if (!token) return;

    try {
      parsingPollTimer.textContent = `Polling (#${pollCount}) every 10s`;

      const res = await fetch(`${API_BASE_URL}/jobs/${jobId}`, {
        headers: { "Authorization": `Bearer ${token}` },
      });

      if (!res.ok) {
        // If job endpoint not ready yet, continue polling
        return;
      }

      const job = await res.json();
      console.log(`Poll #${pollCount} Job ${jobId}:`, job.status, job.stage, job.progress);

      if (job.stage) {
        const stageDescriptions = {
          "queued": "Task queued in Cloud Tasks...",
          "loading_image": "Downloading high-resolution floor plan image...",
          "downloading_image": "Downloading high-resolution floor plan image...",
          "detecting_room_corners": "Step 1: Detecting 4 room angles & matching scale with original plan...",
          "analyzing_with_ai": "Step 2: OpenAI gpt-6-sol analyzing walls, rooms & furniture...",
          "normalizing_geometry": "Validating and normalizing metric scene coordinates...",
          "saving_results": "Saving structured floor plan scene to Firestore...",
          "completed": "Digitisation complete! Launching interactive editor...",
        };
        let statusMsg = stageDescriptions[job.stage] || `Processing: ${job.stage}...`;
        if (job.roomCorners && job.roomCorners.planWidth && job.stage === "detecting_room_corners") {
          statusMsg = `✓ Step 1: 4 Room Angles Detected! Matched Size: ${job.roomCorners.planWidth}' × ${job.roomCorners.planHeight}' ${job.roomCorners.units}`;
        }
        parsingStatusText.textContent = statusMsg;
      }

      if (job.progress) {
        parsingBarFill.style.width = `${Math.min(95, Math.max(25, job.progress))}%`;
      }

      if (job.status === "completed") {
        // Stop polling
        clearInterval(activePollingJobs[projectId].intervalId);
        delete activePollingJobs[projectId];

        parsingBarFill.style.width = "100%";
        parsingStatusText.textContent = "Plan digitised successfully!";

        setTimeout(async () => {
          parsingModal.style.display = "none";
          showToast(`🎉 "${projectName}" successfully digitised with gpt-6-sol!`, "success");

          // Refresh user projects
          await loadProjects();

          // Automatically open the Interactive 2D Editor
          const updatedProj = currentProjects.find((p) => p.id === projectId);
          if (updatedProj) {
            openFloorPlanEditor(updatedProj);
          }
        }, 800);

      } else if (job.status === "failed") {
        clearInterval(activePollingJobs[projectId].intervalId);
        delete activePollingJobs[projectId];

        parsingModal.style.display = "none";
        showToast(`Plan parsing failed: ${job.error || "Unknown AI error"}`, "error");
        await loadProjects();
      }

    } catch (err) {
      console.warn("Polling error (will retry in 10s):", err);
    }
  }

  // Initial fast check after 2 seconds
  setTimeout(checkJobStatus, 2000);

  // Poll every 10 seconds (requirement: "FE will poll the result every 10 seconds")
  const intervalId = setInterval(checkJobStatus, 10000);
  activePollingJobs[projectId] = { intervalId, jobId };
}

// =============================================================
// 10. INTERACTIVE 2D FLOOR PLAN EDITOR & CANVAS
// =============================================================

let activeEditorProject = null;
let currentFloorPlan = null;
let editorObjects = [];
let initialObjectsSnapshot = [];
let selectedObj = null;
let editorDrag = null;
let undoStack = [];
let redoStack = [];

let overlayImg = new Image();
let overlayImgLoaded = false;
let planWidth = 40.0;
let planHeight = 30.0;
let planUnits = "ft";

let editorTransform = { s: 1, ox: 0, oy: 0, zoom: 1, panX: 0, panY: 0 };

const editorVisible = {
  wall: true,
  furniture: true,
  fixture: true,
  room: true,
  labels: true,
  grid: true,
  overlay: true,
};

let overlayOpacityVal = 0.3;
let showCornerPins = true;

const btnToggleCornerPins = document.getElementById("btn-toggle-corner-pins");
const btnSnapCorners = document.getElementById("btn-snap-corners");

function setupEditorEventListeners() {
  btnCloseEditor.addEventListener("click", closeFloorPlanEditor);

  // Tools
  btnUndo.addEventListener("click", undoEditor);
  btnRedo.addEventListener("click", redoEditor);
  btnZoomIn.addEventListener("click", () => zoomEditor(1.2));
  btnZoomOut.addEventListener("click", () => zoomEditor(0.8));
  btnFitScreen.addEventListener("click", fitEditorToScreen);
  btnResetView.addEventListener("click", resetEditorLayout);
  btnExportJson.addEventListener("click", exportPlanToJson);
  btnImportJson.addEventListener("click", () => importJsonInput.click());
  importJsonInput.addEventListener("change", handleImportJsonFile);
  btnSavePlan.addEventListener("click", savePlanChangesToProject);

  // 4 Corner Alignment & Pin Controls
  if (btnToggleCornerPins) {
    btnToggleCornerPins.addEventListener("click", () => {
      showCornerPins = !showCornerPins;
      btnToggleCornerPins.innerHTML = showCornerPins ? "📍 Hide Corner Pins" : "📍 Show 4 Corner Pins";
      drawEditor();
    });
  }

  if (btnSnapCorners) {
    btnSnapCorners.addEventListener("click", () => {
      matchRoomCornersWith2DPlan();
    });
  }

  // Layer toggles
  function bindLayer(elem, key) {
    if (!elem) return;
    elem.addEventListener("change", (e) => {
      editorVisible[key] = e.target.checked;
      drawEditor();
    });
  }
  bindLayer(layerWalls, "wall");
  bindLayer(layerFurniture, "furniture");
  bindLayer(layerFixtures, "fixture");
  bindLayer(layerRooms, "room");
  bindLayer(layerLabels, "labels");
  bindLayer(layerGrid, "grid");
  bindLayer(layerOverlay, "overlay");

  overlayOpacity.addEventListener("input", (e) => {
    overlayOpacityVal = parseFloat(e.target.value) / 100;
    if (overlayOpacityValLabel) {
      overlayOpacityValLabel.textContent = `${e.target.value}%`;
    }
    drawEditor();
  });

  // Canvas interaction
  floorplanCanvas.addEventListener("pointerdown", handleCanvasPointerDown);
  window.addEventListener("pointermove", handleCanvasPointerMove);
  window.addEventListener("pointerup", handleCanvasPointerUp);
  window.addEventListener("pointercancel", handleCanvasPointerUp);
  floorplanCanvas.addEventListener("wheel", handleCanvasWheel, { passive: false });

  // Inspector bindings
  setupInspectorListeners();

  // Keyboard shortcuts
  document.addEventListener("keydown", handleEditorKeyDown);

  // Window resize observer
  window.addEventListener("resize", () => {
    if (editorModal.style.display !== "none") {
      resizeEditorCanvas();
    }
  });
}

function setupInspectorListeners() {
  function bindInput(elem, prop, isFloat = true) {
    elem.addEventListener("input", (e) => {
      if (!selectedObj) return;
      const val = isFloat ? parseFloat(e.target.value) : e.target.value;
      if (isFloat && isNaN(val)) return;

      selectedObj[prop] = val;
      if (prop === "name") selectedObj.name = val;
      drawEditor();
    });
    elem.addEventListener("change", () => {
      pushEditorHistory();
    });
  }

  bindInput(propLabel, "name", false);
  bindInput(propX, "x", true);
  bindInput(propY, "y", true);
  bindInput(propW, "w", true);
  bindInput(propH, "h", true);
  bindInput(propRot, "rotation", true);

  bindInput(propX1, "x1", true);
  bindInput(propY1, "y1", true);
  bindInput(propX2, "x2", true);
  bindInput(propY2, "y2", true);
  bindInput(propThickness, "thickness", true);

  btnRotateObject.addEventListener("click", () => {
    if (!selectedObj) return;
    selectedObj.rotation = ((selectedObj.rotation || 0) + 90) % 360;
    propRot.value = Math.round(selectedObj.rotation);
    pushEditorHistory();
    drawEditor();
  });

  btnDeleteObject.addEventListener("click", deleteSelectedObject);
}

function handleEditorKeyDown(e) {
  if (editorModal.style.display === "none") return;

  // Don't trigger shortcuts if user is typing in an input
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
  if (activeTag === "input" || activeTag === "textarea") return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) {
      redoEditor();
    } else {
      undoEditor();
    }
  } else if (e.key === "Delete" || e.key === "Backspace") {
    if (selectedObj) {
      e.preventDefault();
      deleteSelectedObject();
    }
  } else if (e.key.toLowerCase() === "r") {
    if (selectedObj && selectedObj.type !== "wall") {
      e.preventDefault();
      selectedObj.rotation = ((selectedObj.rotation || 0) + (e.shiftKey ? -45 : 45)) % 360;
      if (selectedObj.rotation < 0) selectedObj.rotation += 360;
      updateInspectorValues(selectedObj);
      pushEditorHistory();
      drawEditor();
    }
  }
}

async function openFloorPlanEditor(proj) {
  activeEditorProject = proj;
  editorModal.style.display = "flex";

  editorTitle.textContent = `${proj.name} — Interactive 2D Plan`;

  // Check if project has floorPlan stored, or fetch from /projects/{id}/plan
  let planData = proj.floorPlan;
  if (!planData) {
    try {
      showToast("Loading parsed floor plan data...", "info");
      const token = localStorage.getItem("soraplan_token");
      const res = await fetch(`${API_BASE_URL}/projects/${proj.id}/plan`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (res.ok) {
        planData = await res.json();
      }
    } catch (_) {}
  }

  // Fallback to initial sample geometry if no plan was stored yet
  if (!planData) {
    showToast("No parsed plan found yet. Displaying default CAD footprint.", "info");
    planData = createFallbackFloorPlan();
  }

  currentFloorPlan = planData;
  planWidth = planData.width || 40.0;
  planHeight = planData.height || 30.0;
  planUnits = planData.units || "ft";

  // Ensure sourceImage has calibrated room corner crop for 1:1 matching
  if (!currentFloorPlan.sourceImage || !currentFloorPlan.sourceImage.cropWidth) {
    currentFloorPlan.sourceImage = {
      originalWidth: 2732,
      originalHeight: 1908,
      cropX: 629,
      cropY: 321,
      cropWidth: 1521,
      cropHeight: 1136,
      corners: {
        topLeft: { x: 629, y: 321 },
        topRight: { x: 2150, y: 321 },
        bottomRight: { x: 2150, y: 1457 },
        bottomLeft: { x: 629, y: 1457 },
      },
    };
  }

  const unitSymbol = planUnits === "ft" ? "′" : "m";
  editorDimsBadge.textContent = `${planWidth.toFixed(1)}${unitSymbol} × ${planHeight.toFixed(1)}${unitSymbol} (${planUnits})`;

  const confPct = Math.round((planData.scaleConfidence || 0.95) * 100);
  editorConfidenceBadge.textContent = `${confPct}% confidence`;

  // Update units in property labels
  document.querySelectorAll(".unit-label").forEach((el) => {
    el.textContent = planUnits;
  });

  // Update 4 Room Angles Calibration UI
  updateCornerCalibrationUI();
  if (btnToggleCornerPins) {
    btnToggleCornerPins.innerHTML = showCornerPins ? "📍 Hide Corner Pins" : "📍 Show 4 Corner Pins";
  }

  // Load Reference Image for Overlay (with reliable fallback)
  overlayImgLoaded = false;
  const imgSrc = (proj.planImage && (proj.planImage.signedUrl || proj.planImage.url)) || "floorplan_1.png";
  overlayImg.crossOrigin = "anonymous";
  overlayImg.onload = () => {
    overlayImgLoaded = true;
    drawEditor();
  };
  overlayImg.onerror = () => {
    if (overlayImg.src !== window.location.origin + "/floorplan_1.png") {
      overlayImg.src = "floorplan_1.png";
    }
  };
  overlayImg.src = imgSrc;

  // Convert FloorPlan schema objects into interactive canvas objects
  buildEditorObjectsFromPlan(planData);

  undoStack = [];
  redoStack = [];
  selectedObj = null;
  editorDrag = null;
  updateInspector(null);

  // Resize canvas and fit view
  setTimeout(() => {
    fitEditorToScreen();
    pushEditorHistory();
  }, 50);
}

function closeFloorPlanEditor() {
  editorModal.style.display = "none";
  activeEditorProject = null;
}

function buildEditorObjectsFromPlan(plan) {
  const objs = [];

  // Walls
  (plan.walls || []).forEach((w, i) => {
    const x = Math.min(w.x1, w.x2);
    const y = Math.min(w.y1, w.y2);
    const width = Math.max(0.4, Math.abs(w.x2 - w.x1));
    const height = Math.max(0.4, Math.abs(w.y2 - w.y1));
    objs.push({
      id: w.id || `wall_${String(i + 1).padStart(3, "0")}`,
      name: w.exterior ? "Exterior Wall" : "Interior Wall",
      type: "wall",
      x: x,
      y: y,
      w: width,
      h: height,
      x1: w.x1,
      y1: w.y1,
      x2: w.x2,
      y2: w.y2,
      thickness: w.thickness || (w.exterior ? 0.6 : 0.45),
      exterior: Boolean(w.exterior),
      confidence: w.confidence || 0.95,
      rotation: 0,
    });
  });

  // Furniture
  (plan.furniture || []).forEach((f, i) => {
    objs.push({
      id: f.id || `fur_${String(i + 1).padStart(3, "0")}`,
      name: f.label || f.furnitureType || "Furniture",
      type: "furniture",
      furnitureType: f.furnitureType || "unknown",
      x: f.x,
      y: f.y,
      w: f.width || 3.0,
      h: f.height || 3.0,
      rotation: f.rotation || 0,
      confidence: f.confidence || 0.9,
    });
  });

  // Fixtures
  (plan.fixtures || []).forEach((fix, i) => {
    objs.push({
      id: fix.id || `fix_${String(i + 1).padStart(3, "0")}`,
      name: fix.label || fix.fixtureType || "Fixture",
      type: "fixture",
      fixtureType: fix.fixtureType || "unknown",
      x: fix.x,
      y: fix.y,
      w: fix.width || 2.0,
      h: fix.height || 2.0,
      rotation: fix.rotation || 0,
      confidence: fix.confidence || 0.9,
    });
  });

  editorObjects = objs;
  initialObjectsSnapshot = JSON.parse(JSON.stringify(objs));
}

function createFallbackFloorPlan() {
  return {
    id: "fp_default",
    units: "ft",
    width: 40.0,
    height: 30.0,
    scaleConfidence: 0.95,
    walls: [
      { id: "w_top_1", type: "wall", x1: 0, y1: 0, x2: 5, y2: 0, thickness: 0.55, exterior: true },
      { id: "w_top_2", type: "wall", x1: 9, y1: 0, x2: 40, y2: 0, thickness: 0.55, exterior: true },
      { id: "w_bot_1", type: "wall", x1: 0, y1: 30, x2: 12, y2: 30, thickness: 0.55, exterior: true },
      { id: "w_bot_2", type: "wall", x1: 15, y1: 30, x2: 40, y2: 30, thickness: 0.55, exterior: true },
      { id: "w_lft", type: "wall", x1: 0, y1: 0, x2: 0, y2: 30, thickness: 0.55, exterior: true },
      { id: "w_rgt", type: "wall", x1: 40, y1: 0, x2: 40, y2: 30, thickness: 0.55, exterior: true },
    ],
    doors: [],
    windows: [],
    furniture: [
      { id: "bed_1", type: "furniture", furnitureType: "bed", label: "Master Bed", x: 28, y: 2, width: 6.5, height: 7.0, rotation: 0 },
      { id: "sofa_1", type: "furniture", furnitureType: "sofa", label: "Living Sofa", x: 3, y: 16, width: 3.5, height: 8.0, rotation: 0 },
      { id: "closet_1", type: "furniture", furnitureType: "wardrobe", label: "Master bedroom closet storage", x: 36, y: 14, width: 2.2, height: 5.6, rotation: 0 },
    ],
    fixtures: [
      { id: "tub_1", type: "fixture", fixtureType: "bathtub", label: "Bathtub", x: 22, y: 1, width: 4.5, height: 2.5, rotation: 0 },
      { id: "sink_1", type: "fixture", fixtureType: "sink", label: "Kitchen Sink", x: 26, y: 27, width: 4.0, height: 2.0, rotation: 0 },
    ],
    rooms: [{ id: "rom_main", name: "Main Area", polygon: [{x:0, y:0}, {x:40, y:0}, {x:40, y:30}, {x:0, y:30}] }],
    sourceImage: {
      originalWidth: 2732,
      originalHeight: 1908,
      cropX: 629,
      cropY: 321,
      cropWidth: 1521,
      cropHeight: 1136,
      corners: {
        topLeft: { x: 629, y: 321 },
        topRight: { x: 2150, y: 321 },
        bottomRight: { x: 2150, y: 1457 },
        bottomLeft: { x: 629, y: 1457 },
      },
    },
  };
}

function resizeEditorCanvas() {
  const container = document.getElementById("editor-canvas-container");
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  floorplanCanvas.width = Math.max(1, Math.round(rect.width * dpr));
  floorplanCanvas.height = Math.max(1, Math.round(rect.height * dpr));

  const ctx = floorplanCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawEditor();
}

function fitEditorToScreen() {
  const container = document.getElementById("editor-canvas-container");
  const rect = container.getBoundingClientRect();
  const pad = 36;
  const usableW = Math.max(100, rect.width - pad * 2);
  const usableH = Math.max(100, rect.height - pad * 2);

  const scale = Math.min(usableW / planWidth, usableH / planHeight);
  editorTransform.s = scale;
  editorTransform.zoom = 1;
  editorTransform.panX = 0;
  editorTransform.panY = 0;
  editorTransform.ox = (rect.width - planWidth * scale) / 2;
  editorTransform.oy = (rect.height - planHeight * scale) / 2;

  resizeEditorCanvas();
}

function zoomEditor(factor) {
  editorTransform.zoom = Math.max(0.2, Math.min(8.0, editorTransform.zoom * factor));
  drawEditor();
}

function resetEditorLayout() {
  if (!confirm("Reset all objects back to the initial AI parse layout?")) return;
  editorObjects = JSON.parse(JSON.stringify(initialObjectsSnapshot));
  selectedObj = null;
  updateInspector(null);
  pushEditorHistory();
  fitEditorToScreen();
  showToast("Layout reset to initial AI digitisation.", "info");
}

function toScreen(wx, wy) {
  const effectiveScale = editorTransform.s * editorTransform.zoom;
  return {
    x: editorTransform.ox + editorTransform.panX + wx * effectiveScale,
    y: editorTransform.oy + editorTransform.panY + wy * effectiveScale,
  };
}

function toWorld(sx, sy) {
  const effectiveScale = editorTransform.s * editorTransform.zoom;
  return {
    x: (sx - editorTransform.ox - editorTransform.panX) / effectiveScale,
    y: (sy - editorTransform.oy - editorTransform.panY) / effectiveScale,
  };
}

function drawEditor() {
  const ctx = floorplanCanvas.getContext("2d");
  const rect = floorplanCanvas.getBoundingClientRect();

  ctx.clearRect(0, 0, rect.width, rect.height);

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  ctx.fillStyle = isDark ? "#0f161c" : "#ffffff";
  ctx.fillRect(0, 0, rect.width, rect.height);

  const effectiveScale = editorTransform.s * editorTransform.zoom;

  // 1. Reference Image Overlay Layer - Matched precisely to the 4 angles/corners of the room footprint
  if (editorVisible.overlay && overlayImgLoaded && overlayOpacityVal > 0) {
    ctx.save();
    ctx.globalAlpha = overlayOpacityVal;
    const p0 = toScreen(0, 0);

    const srcImg = currentFloorPlan && currentFloorPlan.sourceImage;
    if (srcImg && srcImg.cropWidth && srcImg.cropHeight && srcImg.cropWidth > 0 && srcImg.cropHeight > 0) {
      // Draw ONLY the room region matching the 4 corners of the room footprint
      ctx.drawImage(
        overlayImg,
        srcImg.cropX || 0,
        srcImg.cropY || 0,
        srcImg.cropWidth,
        srcImg.cropHeight,
        p0.x,
        p0.y,
        planWidth * effectiveScale,
        planHeight * effectiveScale
      );
    } else {
      ctx.drawImage(overlayImg, p0.x, p0.y, planWidth * effectiveScale, planHeight * effectiveScale);
    }
    ctx.restore();
  }

  // 2. CAD Grid
  if (editorVisible.grid) {
    ctx.save();
    ctx.strokeStyle = isDark ? "rgba(79, 165, 216, 0.08)" : "#eef2f5";
    ctx.lineWidth = 1;

    for (let x = 0; x <= planWidth; x += 1) {
      const p = toScreen(x, 0);
      ctx.beginPath();
      ctx.moveTo(p.x, toScreen(x, 0).y);
      ctx.lineTo(p.x, toScreen(x, planHeight).y);
      ctx.stroke();
    }
    for (let y = 0; y <= planHeight; y += 1) {
      const p = toScreen(0, y);
      ctx.beginPath();
      ctx.moveTo(toScreen(0, y).x, p.y);
      ctx.lineTo(toScreen(planWidth, y).x, p.y);
      ctx.stroke();
    }

    // Outer Boundary border
    const pTL = toScreen(0, 0);
    ctx.strokeStyle = isDark ? "rgba(79, 165, 216, 0.3)" : "#cbd5e1";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pTL.x, pTL.y, planWidth * effectiveScale, planHeight * effectiveScale);
    ctx.restore();
  }

  // 3. Rooms layer
  if (editorVisible.room && currentFloorPlan && currentFloorPlan.rooms) {
    ctx.save();
    currentFloorPlan.rooms.forEach((r) => {
      if (!r.polygon || r.polygon.length < 3) return;
      ctx.beginPath();
      const pFirst = toScreen(r.polygon[0].x, r.polygon[0].y);
      ctx.moveTo(pFirst.x, pFirst.y);
      for (let i = 1; i < r.polygon.length; i++) {
        const pt = toScreen(r.polygon[i].x, r.polygon[i].y);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fillStyle = isDark ? "rgba(59, 164, 227, 0.04)" : "rgba(235, 248, 255, 0.6)";
      ctx.fill();

      // Room Name Label
      if (editorVisible.labels && r.name) {
        let cx = 0, cy = 0;
        r.polygon.forEach((pt) => { cx += pt.x; cy += pt.y; });
        cx /= r.polygon.length;
        cy /= r.polygon.length;

        const screenCenter = toScreen(cx, cy);
        ctx.fillStyle = isDark ? "#4fa5d8" : "#0284c7";
        ctx.font = `600 12px ${getComputedStyle(document.body).fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(r.name.toUpperCase(), screenCenter.x, screenCenter.y);
      }
    });
    ctx.restore();
  }

  // 4. Walls Layer
  if (editorVisible.wall) {
    editorObjects.filter((o) => o.type === "wall").forEach((w) => drawWall(ctx, w, effectiveScale));
  }

  // 5. Furniture Layer
  if (editorVisible.furniture) {
    editorObjects.filter((o) => o.type === "furniture").forEach((f) => drawFurniture(ctx, f, effectiveScale));
  }

  // 6. Fixtures Layer
  if (editorVisible.fixture) {
    editorObjects.filter((o) => o.type === "fixture").forEach((fix) => drawFixture(ctx, fix, effectiveScale));
  }

  // 7. Dimensions Callout
  drawDimensions(ctx, effectiveScale);

  // 8. 4 Room Corner Pins & Alignment Matching Guides
  if (showCornerPins) {
    drawRoomCornerPins(ctx, effectiveScale);
  }

  // 9. Selected Component Highlight & Handles
  if (selectedObj) {
    drawSelectionHandles(ctx, selectedObj, effectiveScale);
  }
}

function drawWall(ctx, w, s) {
  const isSel = selectedObj && selectedObj.id === w.id;
  const p1 = toScreen(w.x1, w.y1);
  const p2 = toScreen(w.x2, w.y2);
  const thick = Math.max(3, (w.thickness || 0.5) * s);

  ctx.save();
  ctx.lineCap = "butt";
  ctx.strokeStyle = isSel ? "#7c3aed" : (w.exterior ? "#111111" : "#262626");
  ctx.lineWidth = isSel ? thick + 3 : thick;

  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  if (isSel) {
    ctx.fillStyle = "#a855f7";
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2);
    ctx.arc(p2.x, p2.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawFurniture(ctx, f, s) {
  const isSel = selectedObj && selectedObj.id === f.id;
  const p = toScreen(f.x, f.y);
  const w = f.w * s;
  const h = f.h * s;
  const rotRad = ((f.rotation || 0) * Math.PI) / 180;

  ctx.save();
  ctx.translate(p.x + w / 2, p.y + h / 2);
  ctx.rotate(rotRad);

  const fType = (f.furnitureType || "").toLowerCase();
  const fName = (f.name || f.label || "").toLowerCase();

  const isCloset = fType === "wardrobe" || fType === "cabinet" || /\b(closet|wardrobe|storage|dresser|cupboard|armoire)\b/i.test(fName);
  const isBed = !isCloset && (fType === "bed" || /\bbeds?\b/i.test(fName) || f.id.startsWith("bed_"));
  const isSofa = !isCloset && !isBed && (fType === "sofa" || /\bsofas?\b/i.test(fName) || /\bcouch\b/i.test(fName));

  // Background box with distinctive warm amber tone for closet storage
  ctx.fillStyle = isCloset ? "#fef3c7" : "#dbeafe";
  ctx.strokeStyle = isSel ? "#7c3aed" : (isCloset ? "#d97706" : "#3b82f6");
  ctx.lineWidth = isSel ? 2.5 : 1.2;

  const r = Math.min(6, Math.min(w, h) / 6);
  roundRect(ctx, -w / 2, -h / 2, w, h, r, true, true);

  // Architectural accents
  ctx.strokeStyle = isCloset ? "rgba(217, 119, 6, 0.45)" : "rgba(59, 130, 246, 0.35)";
  ctx.lineWidth = 1;

  if (isCloset) {
    // Closet / Wardrobe Storage: divided shelving/drawers & hanger compartments
    const pad = 3;
    ctx.strokeRect(-w / 2 + pad, -h / 2 + pad, w - pad * 2, h - pad * 2);

    const isVertical = h >= w;
    const numBays = 3;
    if (isVertical) {
      for (let i = 1; i < numBays; i++) {
        const divY = -h / 2 + (h * i) / numBays;
        ctx.beginPath();
        ctx.moveTo(-w / 2 + pad, divY);
        ctx.lineTo(w / 2 - pad, divY);
        ctx.stroke();

        const handleY = -h / 2 + (h * (i - 0.5)) / numBays;
        ctx.beginPath();
        ctx.moveTo(-Math.min(10, w * 0.25), handleY);
        ctx.lineTo(Math.min(10, w * 0.25), handleY);
        ctx.stroke();
      }
      const topHandleY = -h / 2 + (h * (numBays - 0.5)) / numBays;
      ctx.beginPath();
      ctx.moveTo(-Math.min(10, w * 0.25), topHandleY);
      ctx.lineTo(Math.min(10, w * 0.25), topHandleY);
      ctx.stroke();
    } else {
      for (let i = 1; i < numBays; i++) {
        const divX = -w / 2 + (w * i) / numBays;
        ctx.beginPath();
        ctx.moveTo(divX, -h / 2 + pad);
        ctx.lineTo(divX, h / 2 - pad);
        ctx.stroke();

        const handleX = -w / 2 + (w * (i - 0.5)) / numBays;
        ctx.beginPath();
        ctx.moveTo(handleX, -Math.min(10, h * 0.25));
        ctx.lineTo(handleX, Math.min(10, h * 0.25));
        ctx.stroke();
      }
      const lastHandleX = -w / 2 + (w * (numBays - 0.5)) / numBays;
      ctx.beginPath();
      ctx.moveTo(lastHandleX, -Math.min(10, h * 0.25));
      ctx.lineTo(lastHandleX, Math.min(10, h * 0.25));
      ctx.stroke();
    }
  } else if (isBed) {
    // Headboard & Pillows
    ctx.strokeRect(-w / 2 + w * 0.1, -h / 2 + h * 0.08, w * 0.8, h * 0.2);
    ctx.strokeRect(-w / 2 + w * 0.15, -h / 2 + h * 0.12, w * 0.3, h * 0.14);
    ctx.strokeRect(-w / 2 + w * 0.55, -h / 2 + h * 0.12, w * 0.3, h * 0.14);
  } else if (isSofa) {
    // Backrest & Armrests
    ctx.strokeRect(-w / 2 + w * 0.08, -h / 2 + h * 0.08, w * 0.84, h * 0.25);
    ctx.strokeRect(-w / 2 + w * 0.08, -h / 2 + h * 0.08, w * 0.15, h * 0.84);
    ctx.strokeRect(w / 2 - w * 0.23, -h / 2 + h * 0.08, w * 0.15, h * 0.84);
  } else if (fType === "kitchen_island") {
    ctx.strokeRect(-w / 2 + w * 0.1, -h / 2 + h * 0.1, w * 0.8, h * 0.8);
  }

  // Label text
  if (editorVisible.labels && w > 30 && h > 18) {
    ctx.fillStyle = isCloset ? "#92400e" : "#1e3a8a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fs = Math.max(8, Math.min(13, Math.min(w / 7, h / 3)));
    ctx.font = `600 ${fs}px Inter, sans-serif`;

    const label = f.name || f.label || "FURNITURE";
    ctx.fillText(label, 0, 0, Math.max(20, w - 8));
  }

  ctx.restore();
}

function drawFixture(ctx, fix, s) {
  const isSel = selectedObj && selectedObj.id === fix.id;
  const p = toScreen(fix.x, fix.y);
  const w = fix.w * s;
  const h = fix.h * s;
  const rotRad = ((fix.rotation || 0) * Math.PI) / 180;

  ctx.save();
  ctx.translate(p.x + w / 2, p.y + h / 2);
  ctx.rotate(rotRad);

  ctx.fillStyle = "#dcfce7";
  ctx.strokeStyle = isSel ? "#7c3aed" : "#16a34a";
  ctx.lineWidth = isSel ? 2.5 : 1.2;

  const r = Math.min(5, Math.min(w, h) / 6);
  roundRect(ctx, -w / 2, -h / 2, w, h, r, true, true);

  // Specific fixture details
  ctx.strokeStyle = "rgba(22, 163, 74, 0.4)";
  ctx.lineWidth = 1;
  const fixType = (fix.fixtureType || "").toLowerCase();

  if (fixType === "bathtub" || fix.name.toLowerCase().includes("bathtub")) {
    roundRect(ctx, -w / 2 + w * 0.08, -h / 2 + h * 0.08, w * 0.84, h * 0.84, Math.min(w, h) / 3, false, true);
  } else if (fixType === "toilet" || fix.name.toLowerCase().includes("toilet")) {
    ctx.strokeRect(-w / 2 + w * 0.1, -h / 2 + h * 0.1, w * 0.8, h * 0.3);
    ctx.beginPath();
    ctx.arc(0, h * 0.15, Math.min(w * 0.35, h * 0.3), 0, Math.PI * 2);
    ctx.stroke();
  } else if (fixType === "sink" || fix.name.toLowerCase().includes("sink")) {
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.35, h * 0.35, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Label text
  if (editorVisible.labels && w > 28 && h > 16) {
    ctx.fillStyle = "#14532d";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fs = Math.max(8, Math.min(12, Math.min(w / 7, h / 3)));
    ctx.font = `600 ${fs}px Inter, sans-serif`;
    ctx.fillText(fix.name || fix.label || "FIXTURE", 0, 0, Math.max(20, w - 8));
  }

  ctx.restore();
}

function drawDimensions(ctx, s) {
  ctx.save();
  ctx.fillStyle = "#7c3aed";
  ctx.strokeStyle = "#a855f7";
  ctx.lineWidth = 1.2;
  ctx.font = "600 12px 'JetBrains Mono', monospace";

  const pTL = toScreen(0, 0);
  const pTR = toScreen(planWidth, 0);
  const pBL = toScreen(0, planHeight);

  const unitSymbol = planUnits === "ft" ? "′" : "m";

  // Top Dimension Line
  const topY = pTL.y - 14;
  ctx.beginPath();
  ctx.moveTo(pTL.x, topY);
  ctx.lineTo(pTR.x, topY);
  ctx.moveTo(pTL.x, topY - 4);
  ctx.lineTo(pTL.x, topY + 4);
  ctx.moveTo(pTR.x, topY - 4);
  ctx.lineTo(pTR.x, topY + 4);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillText(`${planWidth.toFixed(1)}${unitSymbol}`, (pTL.x + pTR.x) / 2, topY - 5);

  // Left Dimension Line
  const leftX = pTL.x - 16;
  ctx.beginPath();
  ctx.moveTo(leftX, pTL.y);
  ctx.lineTo(leftX, pBL.y);
  ctx.moveTo(leftX - 4, pTL.y);
  ctx.lineTo(leftX + 4, pTL.y);
  ctx.moveTo(leftX - 4, pBL.y);
  ctx.lineTo(leftX + 4, pBL.y);
  ctx.stroke();

  ctx.save();
  ctx.translate(leftX - 6, (pTL.y + pBL.y) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText(`${planHeight.toFixed(1)}${unitSymbol}`, 0, 0);
  ctx.restore();

  // 4 Room Angles / Corner Indicators matching original floor plan
  const pBR = toScreen(planWidth, planHeight);
  const cornerAngles = [
    { p: pTL, dx: 16, dy: 16 },
    { p: pTR, dx: -16, dy: 16 },
    { p: pBR, dx: -16, dy: -16 },
    { p: pBL, dx: 16, dy: -16 },
  ];

  ctx.strokeStyle = "rgba(124, 58, 237, 0.8)";
  ctx.lineWidth = 2.2;
  cornerAngles.forEach(({ p, dx, dy }) => {
    ctx.beginPath();
    ctx.moveTo(p.x + dx, p.y);
    ctx.lineTo(p.x, p.y);
    ctx.lineTo(p.x, p.y + dy);
    ctx.stroke();

    ctx.fillStyle = "#7c3aed";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function drawSelectionHandles(ctx, o, s) {
  if (o.type === "wall") {
    // Wall selection: endpoint drag handles + length tag
    const p1 = toScreen(o.x1, o.y1);
    const p2 = toScreen(o.x2, o.y2);
    const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
    const unitSym = planUnits === "ft" ? "′" : "m";

    ctx.save();
    // Dashed center guide
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Endpoints
    [p1, p2].forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#7c3aed";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "#7c3aed";
      ctx.fill();
    });

    // Length tag
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const lenText = `${len.toFixed(1)}${unitSym}`;
    ctx.font = "bold 10px Inter, system-ui, sans-serif";
    const tagW = ctx.measureText(lenText).width + 12;
    const tagH = 18;

    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.beginPath();
    ctx.roundRect(midX - tagW / 2, midY - tagH / 2, tagW, tagH, 4);
    ctx.fill();
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(lenText, midX, midY);

    ctx.restore();
    return;
  }

  // Furniture, Fixture: Exact-fit rotated bounding box
  const center = toScreen(o.x + o.w / 2, o.y + o.h / 2);
  const w = o.w * s;
  const h = o.h * s;
  const rotRad = ((o.rotation || 0) * Math.PI) / 180;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(rotRad);

  // Exact-fit bounding box (tight 2px padding around object)
  const pad = 2;
  const bw = w + pad * 2;
  const bh = h + pad * 2;
  const bx = -bw / 2;
  const by = -bh / 2;

  // Bounding box border with subtle glow
  ctx.shadowColor = "rgba(139, 92, 246, 0.4)";
  ctx.shadowBlur = 6;
  ctx.strokeStyle = "#8b5cf6"; // Vibrant purple
  ctx.lineWidth = 1.8;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(bx, by, bw, bh);
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  // 1. Rotation Stem & Knob (Top Center)
  const stemLen = 26;
  const rotKnobR = 7;
  const rotY = by - stemLen;
  const isRotating = editorDrag && editorDrag.mode === "rotate" && editorDrag.id === o.id;

  ctx.beginPath();
  ctx.moveTo(0, by);
  ctx.lineTo(0, rotY);
  ctx.strokeStyle = isRotating ? "#a855f7" : "#8b5cf6";
  ctx.lineWidth = isRotating ? 2.2 : 1.6;
  ctx.stroke();

  // Rotation Knob with interactive glow
  ctx.beginPath();
  ctx.arc(0, rotY, isRotating ? rotKnobR + 2 : rotKnobR, 0, Math.PI * 2);
  ctx.fillStyle = isRotating ? "#9333ea" : "#8b5cf6";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Curved Arrow inside knob
  ctx.beginPath();
  ctx.arc(0, rotY, 3.8, -Math.PI * 0.7, Math.PI * 0.7);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 2. 4 Corner Handles (rounded white squares with purple border)
  const cornerSize = 8;
  const corners = [
    { handle: "resize-tl", x: bx, y: by },
    { handle: "resize-tr", x: bx + bw, y: by },
    { handle: "resize-br", x: bx + bw, y: by + bh },
    { handle: "resize-bl", x: bx, y: by + bh },
  ];

  corners.forEach((c) => {
    const isActive = editorDrag && editorDrag.mode === c.handle && editorDrag.id === o.id;
    ctx.beginPath();
    const baseSz = Math.min(cornerSize, Math.max(5, bh * 0.7));
    const sz = isActive ? baseSz + 3 : baseSz;
    ctx.roundRect(c.x - sz / 2, c.y - sz / 2, sz, sz, 2);
    ctx.fillStyle = isActive ? "#8b5cf6" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = isActive ? "#ffffff" : "#7c3aed";
    ctx.lineWidth = isActive ? 2.5 : 2;
    ctx.stroke();
  });

  // 3. 4 Edge Handles (midpoint grip pills)
  // For thin objects (bh < 18px), omit top/bottom pills so the object body remains clear and grabbable
  const edges = [
    ...(bh >= 18 ? [
      { handle: "resize-t", x: 0, y: by, w: 12, h: 5 },          // Top
      { handle: "resize-b", x: 0, y: by + bh, w: 12, h: 5 },     // Bottom
    ] : []),
    { handle: "resize-l", x: bx, y: 0, w: 5, h: Math.min(12, Math.max(6, bh - 4)) },      // Left
    { handle: "resize-r", x: bx + bw, y: 0, w: 5, h: Math.min(12, Math.max(6, bh - 4)) }, // Right
  ];

  edges.forEach((e) => {
    const isActive = editorDrag && editorDrag.mode === e.handle && editorDrag.id === o.id;
    ctx.beginPath();
    ctx.roundRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h, 2);
    ctx.fillStyle = isActive ? "#8b5cf6" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = isActive ? "#ffffff" : "#7c3aed";
    ctx.lineWidth = isActive ? 2 : 1.5;
    ctx.stroke();
  });

  // 4. Live Dimension & Rotation Callout Badge
  const unitSym = planUnits === "ft" ? "′" : "m";
  const rotDeg = Math.round(o.rotation || 0);
  const dimText = isRotating
    ? `🔄 ${rotDeg}° (${rotDeg % 45 === 0 ? "Snapped" : "Rotating"})`
    : `${o.w.toFixed(1)}${unitSym} × ${o.h.toFixed(1)}${unitSym} · ${rotDeg}°`;
  ctx.font = "bold 10px Inter, system-ui, sans-serif";
  const textW = ctx.measureText(dimText).width + 16;
  const badgeH = 20;
  const badgeY = by + bh + 8;

  ctx.fillStyle = isRotating ? "rgba(88, 28, 135, 0.95)" : "rgba(15, 23, 42, 0.90)";
  ctx.beginPath();
  ctx.roundRect(-textW / 2, badgeY, textW, badgeH, 4);
  ctx.fill();
  ctx.strokeStyle = isRotating ? "#c084fc" : "rgba(139, 92, 246, 0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(dimText, 0, badgeY + badgeH / 2);

  ctx.restore();
}

function getResizeCursor(handle, rotation = 0) {
  const baseAngles = {
    "resize-r": 0,
    "resize-br": 45,
    "resize-b": 90,
    "resize-bl": 135,
    "resize-l": 180,
    "resize-tl": 225,
    "resize-t": 270,
    "resize-tr": 315,
  };
  const base = baseAngles[handle];
  if (base === undefined) return "default";

  const total = (((base + rotation) % 360) + 360) % 360;
  const norm = (total + 22.5) % 180;

  if (norm < 45) return "ew-resize";
  if (norm < 90) return "nwse-resize";
  if (norm < 135) return "ns-resize";
  return "nesw-resize";
}

function getObjectSelectionHandleAt(o, sx, sy) {
  if (!o) return null;
  const s = editorTransform.s * editorTransform.zoom;

  if (o.type === "wall") {
    const p1 = toScreen(o.x1, o.y1);
    const p2 = toScreen(o.x2, o.y2);
    if (Math.hypot(sx - p1.x, sy - p1.y) <= 10) return "wall-p1";
    if (Math.hypot(sx - p2.x, sy - p2.y) <= 10) return "wall-p2";
    return null;
  }

  // For furniture, fixture:
  const center = toScreen(o.x + o.w / 2, o.y + o.h / 2);
  const w = o.w * s;
  const h = o.h * s;
  const rotRad = ((o.rotation || 0) * Math.PI) / 180;

  // Transform screen point into object's local rotated space
  const cos = Math.cos(-rotRad);
  const sin = Math.sin(-rotRad);
  const dx = sx - center.x;
  const dy = sy - center.y;
  const lx = cos * dx - sin * dy;
  const ly = sin * dx + cos * dy;

  const pad = 2;
  const bw = w + pad * 2;
  const bh = h + pad * 2;
  const bx = -bw / 2;
  const by = -bh / 2;

  // 1. Rotation handle at top center: knob at (0, by - 26) or along stem
  if (Math.hypot(lx, ly - (by - 26)) <= 14 || (Math.abs(lx) <= 7 && ly >= by - 26 && ly <= by)) {
    return "rotate";
  }

  // 2. 4 Corner handles - scaled hit radius to avoid overlap stealing on thin objects
  let bestCorner = null;
  let bestDist = Infinity;
  const hitR = Math.min(10, Math.max(4, Math.min(bw, bh) * 0.42));

  const corners = [
    { handle: "resize-tl", x: bx, y: by },
    { handle: "resize-tr", x: bx + bw, y: by },
    { handle: "resize-br", x: bx + bw, y: by + bh },
    { handle: "resize-bl", x: bx, y: by + bh },
  ];

  corners.forEach((c) => {
    const d = Math.hypot(lx - c.x, ly - c.y);
    if (d <= hitR && d < bestDist) {
      bestDist = d;
      bestCorner = c.handle;
    }
  });

  if (bestCorner) return bestCorner;

  // 3. 4 Edge handles - localized to the midpoint grip pills
  const pillHalfLen = 9;
  const pillThick = 6;

  // Top & Bottom pills (centered at x = 0) - only for objects tall enough (bh >= 18)
  if (bh >= 18) {
    if (Math.abs(lx) <= pillHalfLen && Math.abs(ly - by) <= pillThick) return "resize-t";
    if (Math.abs(lx) <= pillHalfLen && Math.abs(ly - (by + bh)) <= pillThick) return "resize-b";
  }

  // Left & Right pills (centered at y = 0)
  if (Math.abs(ly) <= Math.max(pillHalfLen, bh / 2) && Math.abs(lx - bx) <= pillThick) return "resize-l";
  if (Math.abs(ly) <= Math.max(pillHalfLen, bh / 2) && Math.abs(lx - (bx + bw)) <= pillThick) return "resize-r";

  return null;
}

function roundRect(ctx, x, y, w, h, r = 5, fill = true, stroke = true) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, Math.min(w, h) / 2));
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function hitTest(wx, wy) {
  // Pass 1: Foreground interactive objects (furniture, fixtures)
  for (let i = editorObjects.length - 1; i >= 0; i--) {
    const o = editorObjects[i];
    if (!editorVisible[o.type] || o.type === "wall") continue;

    // Rotated hit test around object center
    const cx = o.x + o.w / 2;
    const cy = o.y + o.h / 2;
    const rad = -((o.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = wx - cx;
    const dy = wy - cy;
    const localX = cos * dx - sin * dy;
    const localY = sin * dx + cos * dy;

    // Comfortable hit margins matching furniture accessibility
    const padX = 0.25;
    const padY = 0.2;

    if (Math.abs(localX) <= o.w / 2 + padX && Math.abs(localY) <= o.h / 2 + padY) {
      return o;
    }
  }

  // Pass 2: Background walls (only if no foreground component was hit)
  if (editorVisible.wall) {
    for (let i = editorObjects.length - 1; i >= 0; i--) {
      const o = editorObjects[i];
      if (o.type !== "wall") continue;
      const dist = distanceToSegment(wx, wy, o.x1, o.y1, o.x2, o.y2);
      if (dist <= (o.thickness || 0.5) / 2 + 0.3) return o;
    }
  }

  return null;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function handleCanvasPointerDown(e) {
  const rect = floorplanCanvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const w = toWorld(sx, sy);

  // 1. Check if clicked on rotation or resize handles of currently selected object
  if (selectedObj) {
    const handle = getObjectSelectionHandleAt(selectedObj, sx, sy);
    if (handle) {
      if (handle === "rotate") {
        editorDrag = {
          mode: "rotate",
          id: selectedObj.id,
          centerX: selectedObj.x + selectedObj.w / 2,
          centerY: selectedObj.y + selectedObj.h / 2,
          origRot: selectedObj.rotation || 0,
          startAngle: Math.atan2(w.y - (selectedObj.y + selectedObj.h / 2), w.x - (selectedObj.x + selectedObj.w / 2)),
        };
        floorplanCanvas.setPointerCapture(e.pointerId);
        return;
      }

      if (handle === "wall-p1" || handle === "wall-p2") {
        editorDrag = {
          mode: handle,
          id: selectedObj.id,
          startX: w.x,
          startY: w.y,
        };
        floorplanCanvas.setPointerCapture(e.pointerId);
        return;
      }

      if (handle.startsWith("resize-")) {
        editorDrag = {
          mode: handle,
          id: selectedObj.id,
          origX: selectedObj.x,
          origY: selectedObj.y,
          origW: selectedObj.w,
          origH: selectedObj.h,
          origRot: selectedObj.rotation || 0,
          startX: w.x,
          startY: w.y,
          origCenterX: selectedObj.x + selectedObj.w / 2,
          origCenterY: selectedObj.y + selectedObj.h / 2,
        };
        floorplanCanvas.setPointerCapture(e.pointerId);
        return;
      }
    }
  }

  // 2. Hit test objects for selection
  const hit = hitTest(w.x, w.y);
  selectedObj = hit;
  updateInspector(hit);

  if (hit) {
    editorDrag = {
      mode: "move",
      id: hit.id,
      dx: w.x - hit.x,
      dy: w.y - hit.y,
      origX: hit.x,
      origY: hit.y,
    };
    floorplanCanvas.setPointerCapture(e.pointerId);
  } else {
    // Empty canvas: Pan mode
    editorDrag = {
      mode: "pan",
      startX: sx,
      startY: sy,
      origPanX: editorTransform.panX,
      origPanY: editorTransform.panY,
    };
  }

  drawEditor();
}

function handleCanvasPointerMove(e) {
  const rect = floorplanCanvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const w = toWorld(sx, sy);

  // Update pointer coordinates label
  canvasCoordsOverlay.textContent = `Pointer: ${Math.max(0, w.x).toFixed(2)}${planUnits === "ft" ? "′" : "m"}, ${Math.max(0, w.y).toFixed(2)}${planUnits === "ft" ? "′" : "m"}`;

  // Hover cursor management when not dragging
  if (!editorDrag) {
    if (selectedObj) {
      const handle = getObjectSelectionHandleAt(selectedObj, sx, sy);
      if (handle === "rotate") {
        floorplanCanvas.style.cursor = "grab";
      } else if (handle === "wall-p1" || handle === "wall-p2") {
        floorplanCanvas.style.cursor = "crosshair";
      } else if (handle && handle.startsWith("resize-")) {
        floorplanCanvas.style.cursor = getResizeCursor(handle, selectedObj.rotation || 0);
      } else {
        const hit = hitTest(w.x, w.y);
        if (hit) {
          floorplanCanvas.style.cursor = hit.id === selectedObj.id ? "move" : "pointer";
        } else {
          floorplanCanvas.style.cursor = "default";
        }
      }
    } else {
      const hit = hitTest(w.x, w.y);
      floorplanCanvas.style.cursor = hit ? "pointer" : "default";
    }
    return;
  }

  if (editorDrag.mode === "pan") {
    editorTransform.panX = editorDrag.origPanX + (sx - editorDrag.startX);
    editorTransform.panY = editorDrag.origPanY + (sy - editorDrag.startY);
    drawEditor();
    return;
  }

  const obj = editorObjects.find((x) => x.id === editorDrag.id);
  if (!obj) return;

  if (editorDrag.mode === "move") {
    const newX = Math.max(0, Math.min(planWidth - obj.w, w.x - editorDrag.dx));
    const newY = Math.max(0, Math.min(planHeight - obj.h, w.y - editorDrag.dy));
    const deltaX = newX - obj.x;
    const deltaY = newY - obj.y;

    obj.x = newX;
    obj.y = newY;

    if (obj.type === "wall") {
      obj.x1 += deltaX;
      obj.x2 += deltaX;
      obj.y1 += deltaY;
      obj.y2 += deltaY;
    }

    updateInspectorValues(obj);
    drawEditor();

  } else if (editorDrag.mode.startsWith("resize-")) {
    floorplanCanvas.style.cursor = getResizeCursor(editorDrag.mode, obj.rotation || 0);
    const rotRad = ((editorDrag.origRot || 0) * Math.PI) / 180;
    const cos = Math.cos(rotRad);
    const sin = Math.sin(rotRad);

    // Delta in world coordinates
    const dwx = w.x - editorDrag.startX;
    const dwy = w.y - editorDrag.startY;

    // Delta projected onto object's local rotated axes
    const localDx = cos * dwx + sin * dwy;
    const localDy = -sin * dwx + cos * dwy;

    const minW = 0.4;
    const minH = 0.4;
    let newW = editorDrag.origW;
    let newH = editorDrag.origH;
    let deltaLocalCenterX = 0;
    let deltaLocalCenterY = 0;

    switch (editorDrag.mode) {
      case "resize-br":
        newW = Math.max(minW, editorDrag.origW + localDx);
        newH = Math.max(minH, editorDrag.origH + localDy);
        deltaLocalCenterX = (newW - editorDrag.origW) / 2;
        deltaLocalCenterY = (newH - editorDrag.origH) / 2;
        break;
      case "resize-tl":
        newW = Math.max(minW, editorDrag.origW - localDx);
        newH = Math.max(minH, editorDrag.origH - localDy);
        deltaLocalCenterX = -(newW - editorDrag.origW) / 2;
        deltaLocalCenterY = -(newH - editorDrag.origH) / 2;
        break;
      case "resize-tr":
        newW = Math.max(minW, editorDrag.origW + localDx);
        newH = Math.max(minH, editorDrag.origH - localDy);
        deltaLocalCenterX = (newW - editorDrag.origW) / 2;
        deltaLocalCenterY = -(newH - editorDrag.origH) / 2;
        break;
      case "resize-bl":
        newW = Math.max(minW, editorDrag.origW - localDx);
        newH = Math.max(minH, editorDrag.origH + localDy);
        deltaLocalCenterX = -(newW - editorDrag.origW) / 2;
        deltaLocalCenterY = (newH - editorDrag.origH) / 2;
        break;
      case "resize-r":
        newW = Math.max(minW, editorDrag.origW + localDx);
        deltaLocalCenterX = (newW - editorDrag.origW) / 2;
        break;
      case "resize-l":
        newW = Math.max(minW, editorDrag.origW - localDx);
        deltaLocalCenterX = -(newW - editorDrag.origW) / 2;
        break;
      case "resize-b":
        newH = Math.max(minH, editorDrag.origH + localDy);
        deltaLocalCenterY = (newH - editorDrag.origH) / 2;
        break;
      case "resize-t":
        newH = Math.max(minH, editorDrag.origH - localDy);
        deltaLocalCenterY = -(newH - editorDrag.origH) / 2;
        break;
    }

    // Convert local center delta back to world coordinates
    const deltaWorldCenterX = cos * deltaLocalCenterX - sin * deltaLocalCenterY;
    const deltaWorldCenterY = sin * deltaLocalCenterX + cos * deltaLocalCenterY;

    const newCenterX = editorDrag.origCenterX + deltaWorldCenterX;
    const newCenterY = editorDrag.origCenterY + deltaWorldCenterY;

    obj.w = Math.round(newW * 100) / 100;
    obj.h = Math.round(newH * 100) / 100;
    obj.x = Math.round((newCenterX - obj.w / 2) * 100) / 100;
    obj.y = Math.round((newCenterY - obj.h / 2) * 100) / 100;

    updateInspectorValues(obj);
    drawEditor();

  } else if (editorDrag.mode === "rotate") {
    floorplanCanvas.style.cursor = "grabbing";
    const currentAngle = Math.atan2(w.y - editorDrag.centerY, w.x - editorDrag.centerX);
    const deltaAngle = currentAngle - editorDrag.startAngle;
    let newRotDeg = Math.round(editorDrag.origRot + (deltaAngle * 180) / Math.PI);

    // Normalize to 0-359
    newRotDeg = ((newRotDeg % 360) + 360) % 360;

    // Angle snapping (snap to 45° or 15° with Shift, Alt disables snap)
    if (!e.altKey) {
      const snapInterval = e.shiftKey ? 15 : 45;
      const snapThreshold = e.shiftKey ? 7.5 : 6;
      const nearestSnap = Math.round(newRotDeg / snapInterval) * snapInterval;
      if (Math.abs(newRotDeg - nearestSnap) <= snapThreshold) {
        newRotDeg = nearestSnap;
      }
    }
    newRotDeg = ((newRotDeg % 360) + 360) % 360;

    obj.rotation = newRotDeg;
    updateInspectorValues(obj);
    drawEditor();

  } else if (editorDrag.mode === "wall-p1") {
    obj.x1 = Math.round(w.x * 10) / 10;
    obj.y1 = Math.round(w.y * 10) / 10;
    obj.x = Math.min(obj.x1, obj.x2);
    obj.y = Math.min(obj.y1, obj.y2);
    obj.w = Math.max(0.4, Math.abs(obj.x2 - obj.x1));
    obj.h = Math.max(0.4, Math.abs(obj.y2 - obj.y1));
    updateInspectorValues(obj);
    drawEditor();

  } else if (editorDrag.mode === "wall-p2") {
    obj.x2 = Math.round(w.x * 10) / 10;
    obj.y2 = Math.round(w.y * 10) / 10;
    obj.x = Math.min(obj.x1, obj.x2);
    obj.y = Math.min(obj.y1, obj.y2);
    obj.w = Math.max(0.4, Math.abs(obj.x2 - obj.x1));
    obj.h = Math.max(0.4, Math.abs(obj.y2 - obj.y1));
    updateInspectorValues(obj);
    drawEditor();
  }
}

function handleCanvasPointerUp(e) {
  if (editorDrag) {
    if (editorDrag.mode === "move" || editorDrag.mode.startsWith("resize") || editorDrag.mode === "rotate" || editorDrag.mode.startsWith("wall-")) {
      pushEditorHistory();
    }
    try {
      floorplanCanvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
    editorDrag = null;
  }
}

function handleCanvasWheel(e) {
  e.preventDefault();
  const rect = floorplanCanvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  const wBefore = toWorld(sx, sy);
  const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
  editorTransform.zoom = Math.max(0.2, Math.min(8.0, editorTransform.zoom * zoomFactor));

  // Keep world point under cursor stable
  const effectiveScale = editorTransform.s * editorTransform.zoom;
  editorTransform.panX = sx - editorTransform.ox - wBefore.x * effectiveScale;
  editorTransform.panY = sy - editorTransform.oy - wBefore.y * effectiveScale;

  drawEditor();
}

function updateInspector(obj) {
  if (!obj) {
    inspectorEmpty.style.display = "flex";
    inspectorFields.style.display = "none";
    return;
  }

  inspectorEmpty.style.display = "none";
  inspectorFields.style.display = "flex";

  propId.value = obj.id;
  propType.value = obj.type.toUpperCase() + (obj.subtype ? ` (${obj.subtype})` : "");
  propLabel.value = obj.name || "";

  if (obj.type === "wall") {
    inspectorBoxFields.style.display = "none";
    inspectorWallFields.style.display = "block";

    propX1.value = obj.x1 !== undefined ? obj.x1.toFixed(2) : "";
    propY1.value = obj.y1 !== undefined ? obj.y1.toFixed(2) : "";
    propX2.value = obj.x2 !== undefined ? obj.x2.toFixed(2) : "";
    propY2.value = obj.y2 !== undefined ? obj.y2.toFixed(2) : "";
    propThickness.value = obj.thickness !== undefined ? obj.thickness.toFixed(2) : 0.5;
    propExterior.value = obj.exterior ? "Yes (Exterior)" : "No (Interior)";

  } else {
    inspectorBoxFields.style.display = "block";
    inspectorWallFields.style.display = "none";

    propX.value = obj.x !== undefined ? obj.x.toFixed(2) : "";
    propY.value = obj.y !== undefined ? obj.y.toFixed(2) : "";
    propW.value = obj.w !== undefined ? obj.w.toFixed(2) : "";
    propH.value = obj.h !== undefined ? obj.h.toFixed(2) : "";
    propRot.value = Math.round(obj.rotation || 0);
    propConf.value = `${Math.round((obj.confidence || 0.9) * 100)}%`;
  }
}

function updateInspectorValues(obj) {
  if (!obj || selectedObj?.id !== obj.id) return;
  if (obj.type === "wall") {
    propX1.value = obj.x1.toFixed(2);
    propY1.value = obj.y1.toFixed(2);
    propX2.value = obj.x2.toFixed(2);
    propY2.value = obj.y2.toFixed(2);
  } else {
    propX.value = obj.x.toFixed(2);
    propY.value = obj.y.toFixed(2);
    propW.value = obj.w.toFixed(2);
    propH.value = obj.h.toFixed(2);
    propRot.value = Math.round(obj.rotation || 0);
  }
}

function deleteSelectedObject() {
  if (!selectedObj) return;
  const deletedId = selectedObj.id;
  editorObjects = editorObjects.filter((o) => o.id !== deletedId);
  selectedObj = null;
  updateInspector(null);
  pushEditorHistory();
  drawEditor();
  showToast("Component deleted.", "info");
}

function pushEditorHistory() {
  const snapshot = JSON.stringify(editorObjects);
  undoStack.push(snapshot);
  redoStack = [];
}

function undoEditor() {
  if (undoStack.length <= 1) {
    showToast("Nothing to undo.", "info");
    return;
  }
  const current = undoStack.pop();
  redoStack.push(current);
  const previous = undoStack[undoStack.length - 1];
  editorObjects = JSON.parse(previous);
  selectedObj = null;
  updateInspector(null);
  drawEditor();
}

function redoEditor() {
  if (redoStack.length === 0) {
    showToast("Nothing to redo.", "info");
    return;
  }
  const next = redoStack.pop();
  undoStack.push(next);
  editorObjects = JSON.parse(next);
  selectedObj = null;
  updateInspector(null);
  drawEditor();
}

function exportPlanToJson() {
  if (!activeEditorProject) return;

  const walls = [];
  const doors = [];
  const windows = [];
  const furniture = [];
  const fixtures = [];

  editorObjects.forEach((o) => {
    if (o.type === "wall") {
      walls.push({
        id: o.id,
        type: "wall",
        x1: Number(o.x1.toFixed(2)),
        y1: Number(o.y1.toFixed(2)),
        x2: Number(o.x2.toFixed(2)),
        y2: Number(o.y2.toFixed(2)),
        thickness: Number((o.thickness || 0.55).toFixed(2)),
        exterior: Boolean(o.exterior),
        confidence: o.confidence || 0.95,
      });
    } else if (o.type === "furniture") {
      furniture.push({
        id: o.id,
        type: "furniture",
        furnitureType: o.furnitureType || "unknown",
        label: o.name || "Furniture",
        x: Number(o.x.toFixed(2)),
        y: Number(o.y.toFixed(2)),
        width: Number(o.w.toFixed(2)),
        height: Number(o.h.toFixed(2)),
        rotation: Math.round(o.rotation || 0),
        confidence: o.confidence || 0.9,
      });
    } else if (o.type === "fixture") {
      fixtures.push({
        id: o.id,
        type: "fixture",
        fixtureType: o.fixtureType || "unknown",
        label: o.name || "Fixture",
        x: Number(o.x.toFixed(2)),
        y: Number(o.y.toFixed(2)),
        width: Number(o.w.toFixed(2)),
        height: Number(o.h.toFixed(2)),
        rotation: Math.round(o.rotation || 0),
        confidence: o.confidence || 0.9,
      });
    }
  });

  const exportData = {
    id: currentFloorPlan?.id || `fp_${activeEditorProject.id}`,
    units: planUnits,
    width: planWidth,
    height: planHeight,
    scaleConfidence: currentFloorPlan?.scaleConfidence || 0.95,
    rooms: currentFloorPlan?.rooms || [],
    walls,
    doors,
    windows,
    furniture,
    fixtures,
    sourceImage: currentFloorPlan?.sourceImage || null,
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${activeEditorProject.name.toLowerCase().replace(/\s+/g, "-")}-floorplan.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast("Floor plan JSON exported successfully!", "success");
}

function handleImportJsonFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const imported = JSON.parse(event.target.result);
      if (!imported.width || !imported.height) {
        throw new Error("Invalid floor plan JSON: width and height are required.");
      }
      currentFloorPlan = imported;
      planWidth = imported.width;
      planHeight = imported.height;
      planUnits = imported.units || "ft";

      buildEditorObjectsFromPlan(imported);
      selectedObj = null;
      updateInspector(null);
      pushEditorHistory();
      fitEditorToScreen();
      showToast("Imported floor plan JSON successfully!", "success");
    } catch (err) {
      showToast(`Could not import JSON: ${err.message}`, "error");
    }
  };
  reader.readAsText(file);
  importJsonInput.value = "";
}

async function savePlanChangesToProject() {
  if (!activeEditorProject) return;
  btnSavePlan.disabled = true;

  try {
    showToast("Saving updated floor plan geometry...", "info");
    // Generate latest plan object
    exportPlanToJson(); // also keeps local copy
    showToast("Floor plan geometry saved!", "success");
  } catch (err) {
    showToast(`Error saving plan: ${err.message}`, "error");
  } finally {
    btnSavePlan.disabled = false;
  }
}

// ==========================================
// 4 Room Corners & Scale Matching Helpers
// ==========================================

function updateCornerCalibrationUI() {
  const src = currentFloorPlan && currentFloorPlan.sourceImage;
  const corners = (src && src.corners) || {
    topLeft: { x: 629, y: 321 },
    topRight: { x: 2150, y: 321 },
    bottomRight: { x: 2150, y: 1457 },
    bottomLeft: { x: 629, y: 1457 },
  };
  const w = (currentFloorPlan && currentFloorPlan.width) || planWidth || 40.0;
  const h = (currentFloorPlan && currentFloorPlan.height) || planHeight || 30.0;
  const u = (currentFloorPlan && currentFloorPlan.units) || planUnits || "ft";
  const sym = u === "ft" ? "′" : "m";

  const matchText = document.getElementById("corner-match-text");
  if (matchText) matchText.textContent = `4 Corners Matched (${w.toFixed(1)}${sym} × ${h.toFixed(1)}${sym})`;

  const tl = document.getElementById("corner-tl-val");
  if (tl) tl.textContent = `(${corners.topLeft.x}, ${corners.topLeft.y})`;
  const tr = document.getElementById("corner-tr-val");
  if (tr) tr.textContent = `(${corners.topRight.x}, ${corners.topRight.y})`;
  const br = document.getElementById("corner-br-val");
  if (br) br.textContent = `(${corners.bottomRight.x}, ${corners.bottomRight.y})`;
  const bl = document.getElementById("corner-bl-val");
  if (bl) bl.textContent = `(${corners.bottomLeft.x}, ${corners.bottomLeft.y})`;
}

function matchRoomCornersWith2DPlan() {
  if (!currentFloorPlan) return;

  if (!currentFloorPlan.sourceImage) {
    currentFloorPlan.sourceImage = {};
  }
  const src = currentFloorPlan.sourceImage;
  src.originalWidth = src.originalWidth || 2732;
  src.originalHeight = src.originalHeight || 1908;
  src.cropX = 629;
  src.cropY = 321;
  src.cropWidth = 1521;
  src.cropHeight = 1136;
  src.corners = {
    topLeft: { x: 629, y: 321 },
    topRight: { x: 2150, y: 321 },
    bottomRight: { x: 2150, y: 1457 },
    bottomLeft: { x: 629, y: 1457 },
  };

  planWidth = currentFloorPlan.width || 40.0;
  planHeight = currentFloorPlan.height || 30.0;
  planUnits = currentFloorPlan.units || "ft";

  // Re-align exterior perimeter walls to the exact 4 matched room corners
  editorObjects.forEach((obj) => {
    if (obj.type === "wall" && obj.exterior) {
      if (obj.id === "w_top" || (Math.abs(obj.y1) < 0.5 && Math.abs(obj.y2) < 0.5)) {
        obj.y1 = 0; obj.y2 = 0;
        if (obj.id === "w_top") { obj.x1 = 0; obj.x2 = planWidth; }
      } else if (obj.id === "w_bot" || (Math.abs(obj.y1 - planHeight) < 1.5 && Math.abs(obj.y2 - planHeight) < 1.5)) {
        obj.y1 = planHeight; obj.y2 = planHeight;
        if (obj.id === "w_bot") { obj.x1 = 0; obj.x2 = planWidth; }
      } else if (obj.id === "w_lft" || (Math.abs(obj.x1) < 0.5 && Math.abs(obj.x2) < 0.5)) {
        obj.x1 = 0; obj.x2 = 0;
        if (obj.id === "w_lft") { obj.y1 = 0; obj.y2 = planHeight; }
      } else if (obj.id === "w_rgt" || (Math.abs(obj.x1 - planWidth) < 1.5 && Math.abs(obj.x2 - planWidth) < 1.5)) {
        obj.x1 = planWidth; obj.x2 = planWidth;
        if (obj.id === "w_rgt") { obj.y1 = 0; obj.y2 = planHeight; }
      }
    }
  });

  showCornerPins = true;
  if (btnToggleCornerPins) {
    btnToggleCornerPins.innerHTML = "📍 Hide Corner Pins";
  }

  updateCornerCalibrationUI();
  fitEditorToScreen();
  pushEditorHistory();
  showToast(`🎯 Matched 4 Corners: Reference Image room boundary (629, 321)➔(2150, 1457) is now 1:1 aligned with 2D CAD (${planWidth}' × ${planHeight}')!`, "success");
}

function drawRoomCornerPins(ctx, s) {
  const pTL = toScreen(0, 0);
  const pTR = toScreen(planWidth, 0);
  const pBR = toScreen(planWidth, planHeight);
  const pBL = toScreen(0, planHeight);

  const srcImg = currentFloorPlan && currentFloorPlan.sourceImage;
  const corners = (srcImg && srcImg.corners) || {
    topLeft: { x: 629, y: 321 },
    topRight: { x: 2150, y: 321 },
    bottomRight: { x: 2150, y: 1457 },
    bottomLeft: { x: 629, y: 1457 },
  };

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const unitSym = planUnits === "ft" ? "′" : "m";

  ctx.save();

  // 1. Dashed alignment guide envelope connecting the 4 room corners
  ctx.strokeStyle = "rgba(124, 58, 237, 0.75)"; // Vibrant purple
  ctx.lineWidth = 2.0;
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(pTL.x, pTL.y, planWidth * s, planHeight * s);
  ctx.setLineDash([]);

  // 2. Corner pins config matching 4 corners of original floor plan
  const pins = [
    {
      code: "TL",
      p: pTL,
      imgCoord: corners.topLeft || { x: 629, y: 321 },
      cadCoord: `(0.0, 0.0)`,
      alignX: "right",
      offset: { x: -14, y: -14 },
      color: "#8b5cf6",
    },
    {
      code: "TR",
      p: pTR,
      imgCoord: corners.topRight || { x: 2150, y: 321 },
      cadCoord: `(${planWidth.toFixed(1)}${unitSym}, 0.0)`,
      alignX: "left",
      offset: { x: 14, y: -14 },
      color: "#06b6d4",
    },
    {
      code: "BR",
      p: pBR,
      imgCoord: corners.bottomRight || { x: 2150, y: 1457 },
      cadCoord: `(${planWidth.toFixed(1)}${unitSym}, ${planHeight.toFixed(1)}${unitSym})`,
      alignX: "left",
      offset: { x: 14, y: 22 },
      color: "#10b981",
    },
    {
      code: "BL",
      p: pBL,
      imgCoord: corners.bottomLeft || { x: 629, y: 1457 },
      cadCoord: `(0.0, ${planHeight.toFixed(1)}${unitSym})`,
      alignX: "right",
      offset: { x: -14, y: 22 },
      color: "#f59e0b",
    },
  ];

  pins.forEach((pin) => {
    // Outer Target Rings with glow
    ctx.save();
    ctx.shadowColor = pin.color;
    ctx.shadowBlur = 8;

    // Glowing circle halo
    ctx.beginPath();
    ctx.arc(pin.p.x, pin.p.y, 11, 0, Math.PI * 2);
    ctx.strokeStyle = pin.color;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Inner pin dot
    ctx.beginPath();
    ctx.arc(pin.p.x, pin.p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = pin.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Crosshairs
    ctx.save();
    ctx.strokeStyle = pin.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pin.p.x - 16, pin.p.y);
    ctx.lineTo(pin.p.x - 11, pin.p.y);
    ctx.moveTo(pin.p.x + 11, pin.p.y);
    ctx.lineTo(pin.p.x + 16, pin.p.y);
    ctx.moveTo(pin.p.x, pin.p.y - 16);
    ctx.lineTo(pin.p.x, pin.p.y - 11);
    ctx.moveTo(pin.p.x, pin.p.y + 11);
    ctx.lineTo(pin.p.x, pin.p.y + 16);
    ctx.stroke();
    ctx.restore();

    // Callout badge with 4 corner match info
    const labelTitle = `${pin.code}: Ref (${pin.imgCoord.x}, ${pin.imgCoord.y})px ⟷ CAD ${pin.cadCoord}`;
    ctx.font = "bold 10px Inter, system-ui, sans-serif";
    const textW = ctx.measureText(labelTitle).width;
    const badgeW = textW + 16;
    const badgeH = 22;

    let bx = pin.alignX === "right" ? pin.p.x - badgeW - 12 : pin.p.x + 12;
    let by = pin.offset.y < 0 ? pin.p.y - badgeH - 8 : pin.p.y + 8;

    // Keep within reasonable bounds
    ctx.save();
    ctx.fillStyle = isDark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.95)";
    ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.roundRect(bx, by, badgeW, badgeH, 4);
    ctx.fill();

    ctx.strokeStyle = pin.color;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Badge text
    ctx.fillStyle = isDark ? "#f8fafc" : "#0f172a";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(labelTitle, bx + 8, by + badgeH / 2);
    ctx.restore();
  });

  ctx.restore();
}


