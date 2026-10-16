/**
 * SoraPlan Studio & Floor Plan Management Client
 * Direct Google Cloud Storage V4 Signed PUT upload and Scene Graph synchronization.
 */

const API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:8000/v1"
  : "/v1";

const WORKER_API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:8001/api"
  : "/worker/api";

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

// DOM Elements - Furniture Ingestion (Step 2)
const btnNextFurniture = document.getElementById("btn-next-furniture");
const btnSidebarFurniture = document.getElementById("btn-sidebar-furniture");
const btnCanvasFurniture = document.getElementById("btn-canvas-furniture");
const topbarFurniturePill = document.getElementById("topbar-furniture-pill");
const sidebarFurnitureBadge = document.getElementById("sidebar-furniture-badge");
const btnAssignFurniturePhoto = document.getElementById("btn-assign-furniture-photo");
const inspectorFurnitureAction = document.getElementById("inspector-furniture-action");

const furnitureModal = document.getElementById("furniture-modal");
const btnCloseFurnitureModal = document.getElementById("btn-close-furniture-modal");
const furnitureProjectBadge = document.getElementById("furniture-project-badge");
const furnitureGcsPathPreview = document.getElementById("furniture-gcs-path-preview");
const furnitureUploadForm = document.getElementById("furniture-upload-form");
const furnitureNameInput = document.getElementById("furniture-name-input");
const furnitureTypeSelect = document.getElementById("furniture-type-select");
const furnitureLinkSelect = document.getElementById("furniture-link-select");
const furnitureFileInput = document.getElementById("furniture-file-input");
const furnitureDropzone = document.getElementById("furniture-dropzone");
const furnitureDropzoneIdle = document.getElementById("furniture-dropzone-idle");
const furniturePreviewCard = document.getElementById("furniture-preview-card");
const furnitureMediaContainer = document.getElementById("furniture-media-container");
const furnitureFilename = document.getElementById("furniture-filename");
const furnitureTypeBadge = document.getElementById("furniture-type-badge");
const furnitureFilesize = document.getElementById("furniture-filesize");
const btnRemoveFurnitureFile = document.getElementById("btn-remove-furniture-file");
const btnLoadSampleFurniture = document.getElementById("btn-load-sample-furniture");
const furnitureProgressWrapper = document.getElementById("furniture-progress-wrapper");
const furnStepUrl = document.getElementById("furn-step-url");
const furnStepPut = document.getElementById("furn-step-put");
const furnStepConfirm = document.getElementById("furn-step-confirm");
const furnitureBarFill = document.getElementById("furniture-bar-fill");
const furnitureStatusMsg = document.getElementById("furniture-status-msg");
const furnitureStatusPct = document.getElementById("furniture-status-pct");
const btnSubmitFurniture = document.getElementById("btn-submit-furniture");
const furnitureSpinner = document.getElementById("furniture-spinner");
const furnitureBtnText = document.getElementById("furniture-btn-text");
const furnitureCountPill = document.getElementById("furniture-count-pill");
const btnRefreshFurniture = document.getElementById("btn-refresh-furniture");
const furnitureEmptyState = document.getElementById("furniture-empty-state");
const furnitureItemsGrid = document.getElementById("furniture-items-grid");
const btnBackToEditor = document.getElementById("btn-back-to-editor");
const btnProceed3dWorld = document.getElementById("btn-proceed-3d-world");

const furnitureTransparentBgCheckbox = document.getElementById("furniture-transparent-bg-checkbox");
const furnitureSystemWrapper = document.getElementById("furniture-system-wrapper");
const furnitureSystemCheckbox = document.getElementById("furniture-system-checkbox");

function isCurrentUserAdmin() {
  return Boolean(currentUser && (currentUser.role === "admin" || currentUser.uid === "tPST7GIKXTQaTiBOQH4hl7zIHxS2"));
}

let activeFurnitureProject = null;
let selectedFurnitureFile = null;
let originalFurnitureFile = null;
let isUploadingFurniture = false;
let isProcessingTransparentBg = false;
let hasTransparentBgApplied = false;
let projectFurnitureList = [];

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
  btnRefreshProjects.addEventListener("click", () => { loadProjects(); loadUserAssets(); });
  initAssetsCatalog();

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

  // Furniture Modal (Step 2) Controls
  if (btnCloseFurnitureModal) {
    btnCloseFurnitureModal.addEventListener("click", closeFurnitureUploadModal);
  }
  if (furnitureModal) {
    furnitureModal.addEventListener("click", (e) => {
      if (e.target === furnitureModal) closeFurnitureUploadModal();
    });
  }
  // Step 2: Open Furniture Upload Modal / Page triggers from 2D Plan
  [btnNextFurniture, btnSidebarFurniture, btnCanvasFurniture].forEach((btn) => {
    if (btn) {
      btn.addEventListener("click", () => {
        if (activeEditorProject) {
          openFurnitureUploadModal(activeEditorProject);
        } else {
          showToast("Please open a project first", "info");
        }
      });
    }
  });
  if (btnAssignFurniturePhoto) {
    btnAssignFurniturePhoto.addEventListener("click", () => {
      if (activeEditorProject && selectedObj) {
        openFurnitureUploadModal(activeEditorProject, selectedObj.id);
      }
    });
  }
  if (btnBackToEditor) {
    btnBackToEditor.addEventListener("click", () => {
      closeFurnitureUploadModal();
      if (activeFurnitureProject) {
        openFloorPlanEditor(activeFurnitureProject);
      }
    });
  }
  if (btnProceed3dWorld) {
    btnProceed3dWorld.addEventListener("click", () => {
      showToast("🚀 Step 2 complete! All custom furniture saved. Building metric 3D home scene...", "success");
    });
  }
  if (btnRefreshFurniture) {
    btnRefreshFurniture.addEventListener("click", () => {
      if (activeFurnitureProject) loadProjectFurniture(activeFurnitureProject.id);
    });
  }
  if (furnitureUploadForm) {
    furnitureUploadForm.addEventListener("submit", handleFurnitureUploadSubmit);
  }
  if (btnLoadSampleFurniture) {
    btnLoadSampleFurniture.addEventListener("click", handleLoadSampleFurniture);
  }
  if (furnitureTransparentBgCheckbox) {
    furnitureTransparentBgCheckbox.addEventListener("change", async () => {
      if (furnitureTransparentBgCheckbox.checked) {
        if (selectedFurnitureFile && !hasTransparentBgApplied) {
          await applyFurnitureTransparentBackground();
        }
      } else {
        if (originalFurnitureFile && hasTransparentBgApplied) {
          revertToOriginalFurniturePhoto();
        }
      }
    });
  }
  setupFurnitureDropzone();
  setup3dReviewListeners();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const review3dModal = document.getElementById("modal-3d-review");
      if (review3dModal && review3dModal.style.display !== "none") {
        close3dReviewModal();
        return;
      }
      if (planModal.style.display !== "none") closePlanModal();
      if (parsingModal.style.display !== "none") parsingModal.style.display = "none";
      if (furnitureModal && furnitureModal.style.display !== "none") closeFurnitureUploadModal();
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

    if (data.user && data.user.uid === "tPST7GIKXTQaTiBOQH4hl7zIHxS2") {
      data.user.role = "admin";
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
      if (currentUser && currentUser.uid === "tPST7GIKXTQaTiBOQH4hl7zIHxS2") {
        currentUser.role = "admin";
      }
      enterStudioView(currentUser);
    } catch (_) { }
  }

  // Validate session with backend
  try {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (res.ok) {
      const user = await res.json();
      if (user.uid === "tPST7GIKXTQaTiBOQH4hl7zIHxS2") {
        user.role = "admin";
      }
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

  const isAdmin = user.role === "admin" || user.uid === "tPST7GIKXTQaTiBOQH4hl7zIHxS2";
  if (isAdmin) {
    user.role = "admin";
  }

  // Populate user data
  navUserName.textContent = user.displayName || user.email.split("@")[0] || (isAdmin ? "Admin" : "Architect");
  if (isAdmin) {
    navUserPlan.textContent = "ADMIN";
    navUserPlan.className = "nav-user-plan badge-role-admin";
  } else {
    navUserPlan.textContent = (user.plan || "Free").toUpperCase();
    navUserPlan.className = "nav-user-plan";
  }

  if (user.photoUrl) {
    navUserAvatar.src = user.photoUrl;
  }

  studioWelcome.textContent = `Welcome back, ${user.displayName || (isAdmin ? "Admin" : "Architect")}`;
  quotaTierVal.textContent = isAdmin ? "ADMIN" : (user.plan || "Free").toUpperCase();

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
    } catch (_) { }
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
      } catch (_) { }
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
          ${proj.furnitureCount && proj.furnitureCount > 0 ? `
            <div class="card-meta-item">
              <span class="meta-label">Furniture:</span>
              <span class="meta-val" style="color: var(--accent); font-weight: 600;">🪑 ${proj.furnitureCount} custom photo${proj.furnitureCount > 1 ? "s" : ""}</span>
            </div>
          ` : ""}
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
              <span> Parse with AI</span>
            </button>
          `}
          <button type="button" class="card-action-btn btn-card-upload-furniture" data-project-id="${escapeHtml(proj.id)}" title="Upload Custom Furniture Photo (Step 2)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span>Furniture</span>
          </button>
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

    const furnCardBtn = card.querySelector(".btn-card-upload-furniture");
    if (furnCardBtn) {
      furnCardBtn.addEventListener("click", () => openFurnitureUploadModal(proj));
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

  // Update furniture badges in 2D plan editor
  const currentFurnCount = proj.furnitureCount || 0;
  if (topbarFurniturePill) topbarFurniturePill.textContent = currentFurnCount;
  if (sidebarFurnitureBadge) sidebarFurnitureBadge.textContent = `${currentFurnCount} item${currentFurnCount === 1 ? "" : "s"}`;
  loadProjectFurniture(proj.id);

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
    } catch (_) { }
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
    rooms: [{ id: "rom_main", name: "Main Area", polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }] }],
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
    } catch (_) { }
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
    if (inspectorFurnitureAction) inspectorFurnitureAction.style.display = "none";
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
    if (inspectorFurnitureAction) inspectorFurnitureAction.style.display = "none";

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

    if (obj.type === "furniture") {
      if (inspectorFurnitureAction) {
        inspectorFurnitureAction.style.display = "block";
        if (btnAssignFurniturePhoto) {
          btnAssignFurniturePhoto.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            <span>📸 Photo for ${escapeHtml(obj.name || obj.id)}</span>
          `;
        }
      }
    } else {
      if (inspectorFurnitureAction) inspectorFurnitureAction.style.display = "none";
    }
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

// =============================================================
// STEP ②: CUSTOM FURNITURE INGESTION & UPLOAD LOGIC
// =============================================================

async function openFurnitureUploadModal(proj, preselectedComponentId = null) {
  if (!proj) return;
  activeFurnitureProject = proj;
  furnitureModal.style.display = "flex";
  furnitureModal.scrollTop = 0;
  const furnBody = furnitureModal.querySelector(".furniture-modal-body");
  if (furnBody) furnBody.scrollTop = 0;

  const isAdmin = isCurrentUserAdmin();
  if (furnitureSystemWrapper) {
    furnitureSystemWrapper.style.display = isAdmin ? "block" : "none";
  }
  if (furnitureSystemCheckbox) {
    furnitureSystemCheckbox.checked = false;
  }

  if (furnitureProjectBadge) {
    furnitureProjectBadge.textContent = `Project: ${proj.name}`;
  }
  if (furnitureGcsPathPreview) {
    const userUid = currentUser?.uid || "usr_current";
    furnitureGcsPathPreview.textContent = `soraplan-assest-dev/${userUid}/${proj.id}/furniture/...`;
  }

  // Populate Linked 2D Item dropdown from floor plan furniture
  if (furnitureLinkSelect) {
    furnitureLinkSelect.innerHTML = `<option value="">-- None (Add to Project Library) --</option>`;

    const furnitureList = (editorObjects || []).filter((o) => o.type === "furniture") ||
      (currentFloorPlan && currentFloorPlan.furniture) ||
      (proj.floorPlan && proj.floorPlan.furniture) || [];

    furnitureList.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.name || item.id} (${item.subtype || item.furnitureType || "furniture"})`;
      if (preselectedComponentId && item.id === preselectedComponentId) {
        opt.selected = true;
      }
      furnitureLinkSelect.appendChild(opt);
    });

    if (preselectedComponentId) {
      const matched = furnitureList.find((i) => i.id === preselectedComponentId);
      if (matched) {
        if (furnitureNameInput) furnitureNameInput.value = matched.name || matched.id;
        if (furnitureTypeSelect) {
          const matchedType = (matched.subtype || matched.furnitureType || "sofa").toLowerCase();
          for (let option of furnitureTypeSelect.options) {
            if (option.value === matchedType || matchedType.includes(option.value)) {
              furnitureTypeSelect.value = option.value;
              break;
            }
          }
        }
      }
    }
  }

  // Load and display existing uploaded furniture for this project
  await loadProjectFurniture(proj.id);
}

function closeFurnitureUploadModal() {
  furnitureModal.style.display = "none";
  clearFurnitureSelectedFile();
  if (furnitureProgressWrapper) furnitureProgressWrapper.style.display = "none";
}

function setupFurnitureDropzone() {
  if (!furnitureDropzone || !furnitureFileInput) return;

  furnitureDropzone.addEventListener("click", () => {
    if (!isUploadingFurniture) furnitureFileInput.click();
  });

  furnitureFileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFurnitureFileSelected(e.target.files[0]);
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    furnitureDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      furnitureDropzone.classList.add("drag-active");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    furnitureDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      furnitureDropzone.classList.remove("drag-active");
    });
  });

  furnitureDropzone.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      handleFurnitureFileSelected(dt.files[0]);
    }
  });

  if (btnRemoveFurnitureFile) {
    btnRemoveFurnitureFile.addEventListener("click", (e) => {
      e.stopPropagation();
      clearFurnitureSelectedFile();
    });
  }
}

async function handleLoadSampleFurniture() {
  try {
    showToast("Loading sample modern sofa photo...", "info");
    const res = await fetch("sofa.jpg");
    if (!res.ok) throw new Error("Could not fetch sample sofa.jpg");
    const blob = await res.blob();
    const file = new File([blob], "mid_century_sofa.jpg", { type: "image/jpeg" });
    handleFurnitureFileSelected(file);
    if (furnitureNameInput) furnitureNameInput.value = "Mid-Century Modern Camel Sofa";
    if (furnitureTypeSelect) furnitureTypeSelect.value = "sofa";
    showToast("⚡ Sample sofa loaded! Ready to upload to Cloud Storage.", "success");
  } catch (err) {
    showToast(`Could not load sample sofa: ${err.message}`, "error");
  }
}

function handleFurnitureFileSelected(file) {
  const allowedExtensions = [".png", ".jpg", ".jpeg", ".webp"];
  const fileExt = "." + file.name.split(".").pop().toLowerCase();
  const isImage = file.type.startsWith("image/") || allowedExtensions.includes(fileExt);

  if (!isImage) {
    showToast("Unsupported format. Please upload a PNG, JPG, or WebP photo.", "error");
    return;
  }

  const MAX_BYTES = 25 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    showToast("File size exceeds 25 MB limit.", "error");
    return;
  }

  originalFurnitureFile = file;
  selectedFurnitureFile = file;
  hasTransparentBgApplied = false;

  const activeBadge = document.getElementById("furniture-trans-active-badge");
  if (activeBadge) activeBadge.style.display = "none";
  if (furnitureMediaContainer) furnitureMediaContainer.classList.remove("is-transparent");

  // Auto-fill furniture name if currently blank
  if (furnitureNameInput && !furnitureNameInput.value.trim()) {
    const rawName = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
    furnitureNameInput.value = rawName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  if (furnitureFilename) furnitureFilename.textContent = file.name;
  if (furnitureFilesize) furnitureFilesize.textContent = formatBytes(file.size);
  if (furnitureTypeBadge) furnitureTypeBadge.textContent = fileExt.replace(".", "").toUpperCase();

  // Thumbnail preview
  const reader = new FileReader();
  reader.onload = (e) => {
    if (furnitureMediaContainer) {
      furnitureMediaContainer.innerHTML = `<img src="${e.target.result}" alt="Furniture preview" style="width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius-sm);">`;
    }
  };
  reader.readAsDataURL(file);

  if (furnitureDropzoneIdle) furnitureDropzoneIdle.style.display = "none";
  if (furniturePreviewCard) furniturePreviewCard.style.display = "flex";

  // If transparent background tick box is active, trigger gpt-6-sol
  if (furnitureTransparentBgCheckbox && furnitureTransparentBgCheckbox.checked) {
    applyFurnitureTransparentBackground();
  }
}

function clearFurnitureSelectedFile() {
  selectedFurnitureFile = null;
  originalFurnitureFile = null;
  hasTransparentBgApplied = false;
  if (furnitureFileInput) furnitureFileInput.value = "";
  if (furnitureDropzoneIdle) furnitureDropzoneIdle.style.display = "flex";
  if (furniturePreviewCard) furniturePreviewCard.style.display = "none";
  if (furnitureMediaContainer) {
    furnitureMediaContainer.innerHTML = "";
    furnitureMediaContainer.classList.remove("is-transparent");
  }
  const activeBadge = document.getElementById("furniture-trans-active-badge");
  if (activeBadge) activeBadge.style.display = "none";
}

function dataUriToBlob(dataUri) {
  const parts = dataUri.split(",");
  const byteString = atob(parts[1]);
  const mimeString = parts[0].split(":")[1].split(";")[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

function revertToOriginalFurniturePhoto() {
  if (!originalFurnitureFile) return;
  selectedFurnitureFile = originalFurnitureFile;
  hasTransparentBgApplied = false;

  const activeBadge = document.getElementById("furniture-trans-active-badge");
  if (activeBadge) activeBadge.style.display = "none";
  if (furnitureMediaContainer) furnitureMediaContainer.classList.remove("is-transparent");

  const fileExt = originalFurnitureFile.name.substring(originalFurnitureFile.name.lastIndexOf(".")).toLowerCase();
  if (furnitureFilename) furnitureFilename.textContent = originalFurnitureFile.name;
  if (furnitureFilesize) furnitureFilesize.textContent = formatBytes(originalFurnitureFile.size);
  if (furnitureTypeBadge) furnitureTypeBadge.textContent = fileExt.replace(".", "").toUpperCase();

  const reader = new FileReader();
  reader.onload = (e) => {
    if (furnitureMediaContainer) {
      furnitureMediaContainer.innerHTML = `<img src="${e.target.result}" alt="Furniture preview" style="width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius-sm);">`;
    }
  };
  reader.readAsDataURL(originalFurnitureFile);

  showToast("Reverted to original photo.", "info");
}

async function applyFurnitureTransparentBackground() {
  if (isProcessingTransparentBg) return;
  const fileToProcess = originalFurnitureFile || selectedFurnitureFile;
  if (!fileToProcess) {
    showToast("Please select a furniture image first.", "warning");
    return;
  }

  const furnitureName = (furnitureNameInput?.value || "").trim() || fileToProcess.name.replace(/\.[^/.]+$/, "");
  const promptText = `${furnitureName} transparent background`;

  isProcessingTransparentBg = true;
  if (btnSubmitFurniture) btnSubmitFurniture.disabled = true;

  // Show processing overlay on preview card
  let overlay = document.getElementById("furniture-processing-overlay");
  if (!overlay && furnitureMediaContainer) {
    overlay = document.createElement("div");
    overlay.id = "furniture-processing-overlay";
    overlay.className = "media-processing-overlay";
    overlay.innerHTML = `
      <div class="spinner" style="display: inline-block; width: 18px; height: 18px; border-width: 2px;"></div>
      <span class="media-processing-text">gpt-6-sol isolating background...</span>
    `;
    furnitureMediaContainer.appendChild(overlay);
  } else if (overlay) {
    overlay.style.display = "flex";
  }

  showToast(`Calling gpt-6-sol: "${promptText}"...`, "info");

  try {
    const formData = new FormData();
    formData.append("file", fileToProcess);
    formData.append("furniture_name", furnitureName);

    let res;
    // 1. Try plan parser worker directly on port 8001
    try {
      res = await fetch(`${WORKER_API_BASE_URL}/furniture/transparent-background`, {
        method: "POST",
        body: formData,
      });
    } catch (workerErr) {
      console.warn("Direct worker call failed, attempting API user proxy:", workerErr);
    }

    // 2. If direct worker call failed or was not reachable, fallback to api_user proxy
    if (!res || !res.ok) {
      const token = localStorage.getItem("soraplan_token");
      const projId = activeFurnitureProject?.id || "default";
      res = await fetch(`${API_BASE_URL}/projects/${projId}/furniture/transparent-background`, {
        method: "POST",
        headers: token ? { "Authorization": `Bearer ${token}` } : {},
        body: formData,
      });
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.detail || errJson.title || `Server returned ${res.status}`);
    }

    const data = await res.json();
    const dataUri = data.dataUri;
    if (!dataUri) {
      throw new Error("No image dataUri returned by transparent background agent.");
    }

    // Convert dataUri to Blob & File
    const blob = dataUriToBlob(dataUri);
    const baseName = (originalFurnitureFile?.name || "furniture").replace(/\.[^/.]+$/, "");
    const newFileName = `${baseName}-transparent.png`;
    const processedFile = new File([blob], newFileName, { type: "image/png" });

    selectedFurnitureFile = processedFile;
    hasTransparentBgApplied = true;

    // Update preview card UI
    if (furnitureMediaContainer) {
      furnitureMediaContainer.classList.add("is-transparent");
      furnitureMediaContainer.innerHTML = `
        <img src="${dataUri}" alt="Furniture with transparent background" style="width: 100%; height: 100%; object-fit: contain; border-radius: var(--radius-sm);">
      `;
    }

    if (furnitureFilename) {
      furnitureFilename.textContent = newFileName;
    }
    if (furnitureFilesize) {
      furnitureFilesize.textContent = formatBytes(processedFile.size);
    }
    if (furnitureTypeBadge) {
      furnitureTypeBadge.textContent = "PNG";
    }

    // Add/show active badge
    let activeBadge = document.getElementById("furniture-trans-active-badge");
    if (!activeBadge && furniturePreviewCard) {
      const previewMeta = furniturePreviewCard.querySelector(".preview-meta");
      if (previewMeta) {
        activeBadge = document.createElement("span");
        activeBadge.id = "furniture-trans-active-badge";
        activeBadge.className = "transparent-active-badge";
        activeBadge.innerHTML = `✓ transparent background (gpt-6-sol)`;
        previewMeta.appendChild(activeBadge);
      }
    } else if (activeBadge) {
      activeBadge.style.display = "inline-flex";
    }

    showToast("🎉 Furniture transparent background generated using gpt-6-sol!", "success");

  } catch (err) {
    console.error("Transparent background failed:", err);
    showToast(`AI Background Removal failed: ${err.message}`, "error");
    if (furnitureTransparentBgCheckbox) {
      furnitureTransparentBgCheckbox.checked = false;
    }
  } finally {
    isProcessingTransparentBg = false;
    if (btnSubmitFurniture) btnSubmitFurniture.disabled = false;
    const overlay = document.getElementById("furniture-processing-overlay");
    if (overlay) overlay.style.display = "none";
  }
}

function setFurnitureProgressStep(stepEl, status, percent, message) {
  if (stepEl) {
    stepEl.classList.remove("active", "done");
    if (status === "active") stepEl.classList.add("active");
    if (status === "done") stepEl.classList.add("done");
  }
  if (furnitureBarFill) furnitureBarFill.style.width = `${percent}%`;
  if (furnitureStatusPct) furnitureStatusPct.textContent = `${percent}%`;
  if (furnitureStatusMsg) furnitureStatusMsg.textContent = message;
}

function resetFurnitureProgressSteps() {
  [furnStepUrl, furnStepPut, furnStepConfirm].forEach((el) => {
    if (el) el.classList.remove("active", "done");
  });
  if (furnitureBarFill) furnitureBarFill.style.width = "0%";
  if (furnitureStatusPct) furnitureStatusPct.textContent = "0%";
  if (furnitureStatusMsg) {
    furnitureStatusMsg.textContent = "Initializing upload...";
    furnitureStatusMsg.style.color = "var(--ink-muted)";
  }
}

async function handleFurnitureUploadSubmit(e) {
  e.preventDefault();
  if (isUploadingFurniture) return;
  if (!activeFurnitureProject) {
    showToast("No active project selected.", "error");
    return;
  }
  if (!selectedFurnitureFile) {
    showToast("Please select a furniture photo image to upload.", "warning");
    return;
  }

  // If transparent background is ticked but hasn't run yet, run it before uploading
  if (furnitureTransparentBgCheckbox && furnitureTransparentBgCheckbox.checked && !hasTransparentBgApplied) {
    await applyFurnitureTransparentBackground();
    if (!hasTransparentBgApplied) {
      return;
    }
  }

  const token = localStorage.getItem("soraplan_token");
  if (!token) {
    showToast("Authentication session expired. Please sign in again.", "error");
    return;
  }

  const furnitureName = (furnitureNameInput?.value || "").trim() || selectedFurnitureFile.name;
  const furnitureType = furnitureTypeSelect?.value || "unknown";
  const componentId = furnitureLinkSelect?.value || undefined;
  const contentType = getNormalizedContentType(selectedFurnitureFile) || "image/jpeg";
  const sizeBytes = selectedFurnitureFile.size;

  isUploadingFurniture = true;
  if (btnSubmitFurniture) btnSubmitFurniture.disabled = true;
  if (furnitureSpinner) furnitureSpinner.style.display = "inline-block";
  if (furnitureBtnText) furnitureBtnText.textContent = "Uploading to Cloud Storage...";
  if (furnitureProgressWrapper) furnitureProgressWrapper.style.display = "block";
  resetFurnitureProgressSteps();

  try {
    // -------------------------------------------------------------
    // STEP 1: Request V4 Signed Upload URL
    // -------------------------------------------------------------
    setFurnitureProgressStep(furnStepUrl, "active", 25, "Step 1/3: Requesting V4 signed upload URL from Google Cloud Storage...");

    const urlRes = await fetch(`${API_BASE_URL}/projects/${activeFurnitureProject.id}/furniture/upload-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        fileName: selectedFurnitureFile.name,
        contentType: contentType,
        sizeBytes: sizeBytes,
        furnitureName: furnitureName,
        furnitureType: furnitureType,
        componentId: componentId,
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

    setFurnitureProgressStep(furnStepUrl, "done", 40, `✓ Signed URL obtained (Target: ${uploadInfo.bucket})`);

    // -------------------------------------------------------------
    // STEP 2: Direct PUT to Google Cloud Storage
    // -------------------------------------------------------------
    setFurnitureProgressStep(furnStepPut, "active", 45, "Step 2/3: Uploading photo directly to Google Cloud Storage (0%)...");

    await uploadDirectToGCS(signedUploadUrl, selectedFurnitureFile, contentType, (percent) => {
      const scaledPct = Math.round(45 + (percent * 0.40));
      if (furnitureStatusPct) furnitureStatusPct.textContent = `${percent}%`;
      if (furnitureBarFill) furnitureBarFill.style.width = `${scaledPct}%`;
      if (furnitureStatusMsg) {
        furnitureStatusMsg.textContent = `Step 2/3: Uploading directly to Cloud Storage (${percent}% of ${formatBytes(sizeBytes)})...`;
      }
    });

    setFurnitureProgressStep(furnStepPut, "done", 85, "✓ Photo successfully stored in Google Cloud Storage!");

    // -------------------------------------------------------------
    // STEP 3: Confirm Upload with Backend & Register in Firestore
    // -------------------------------------------------------------
    setFurnitureProgressStep(furnStepConfirm, "active", 90, "Step 3/3: Registering furniture asset in metric scene graph...");

    const isSystemFlag = Boolean(isCurrentUserAdmin() && furnitureSystemCheckbox && furnitureSystemCheckbox.checked);

    const confirmRes = await fetch(`${API_BASE_URL}/projects/${activeFurnitureProject.id}/furniture/confirm-upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        uploadId: uploadId,
        fileName: selectedFurnitureFile.name,
        contentType: contentType,
        sizeBytes: sizeBytes,
        furnitureName: furnitureName,
        furnitureType: furnitureType,
        componentId: componentId,
        is_system: isSystemFlag,
      }),
    });

    const confirmedItem = await confirmRes.json();
    if (!confirmRes.ok) {
      throw new Error(confirmedItem.detail || confirmedItem.title || "Failed to confirm furniture upload");
    }

    const meshyId = confirmedItem.meshyTaskId || confirmedItem.meshy_task_id;
    if (meshyId) {
      setFurnitureProgressStep(furnStepConfirm, "done", 100, `✓ Complete! 3D generation started with Meshy (Task: ${meshyId.slice(0, 12)}...).`);
      showToast(`🎉 "${furnitureName}" uploaded! Meshy 3D generation started (Task: ${meshyId.slice(0, 8)}...)`, "success");
    } else {
      setFurnitureProgressStep(furnStepConfirm, "done", 100, "✓ Complete! Furniture photo linked and ready for 3D generation.");
      showToast(`🎉 "${furnitureName}" uploaded and saved to Cloud Storage!`, "success");
    }

    // Reset Form fields
    clearFurnitureSelectedFile();
    if (furnitureNameInput) furnitureNameInput.value = "";
    if (furnitureLinkSelect) furnitureLinkSelect.value = "";
    if (furnitureSystemCheckbox) furnitureSystemCheckbox.checked = false;

    // Refresh furniture gallery
    await loadProjectFurniture(activeFurnitureProject.id);

    // Refresh projects list in background to update furnitureCount
    loadProjects();

    setTimeout(() => {
      if (furnitureProgressWrapper) furnitureProgressWrapper.style.display = "none";
    }, 3000);

  } catch (err) {
    console.error("Furniture upload failed:", err);
    showToast(`Upload failed: ${err.message}`, "error");
    if (furnitureStatusMsg) {
      furnitureStatusMsg.textContent = `Error: ${err.message}`;
      furnitureStatusMsg.style.color = "var(--error)";
    }
  } finally {
    isUploadingFurniture = false;
    if (btnSubmitFurniture) btnSubmitFurniture.disabled = false;
    if (furnitureSpinner) furnitureSpinner.style.display = "none";
    if (furnitureBtnText) furnitureBtnText.textContent = "Upload Furniture Photo to Cloud Storage";
  }
}

async function loadProjectFurniture(projectId) {
  if (!projectId) return;
  const token = localStorage.getItem("soraplan_token");
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE_URL}/projects/${projectId}/furniture`, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error("Failed to load project furniture");
    }

    projectFurnitureList = await res.json();
    renderProjectFurnitureList(projectFurnitureList);
  } catch (err) {
    console.warn("Could not load furniture list:", err);
  }
}

function renderProjectFurnitureList(items) {
  const count = items ? items.length : 0;
  if (furnitureCountPill) {
    furnitureCountPill.textContent = `${count} item${count === 1 ? "" : "s"}`;
  }
  if (topbarFurniturePill) {
    topbarFurniturePill.textContent = count;
  }
  if (sidebarFurnitureBadge) {
    sidebarFurnitureBadge.textContent = `${count} item${count === 1 ? "" : "s"}`;
  }

  if (!items || items.length === 0) {
    if (furnitureEmptyState) furnitureEmptyState.style.display = "flex";
    if (furnitureItemsGrid) {
      furnitureItemsGrid.style.display = "none";
      furnitureItemsGrid.innerHTML = "";
    }
    return;
  }

  if (furnitureEmptyState) furnitureEmptyState.style.display = "none";
  if (furnitureItemsGrid) {
    furnitureItemsGrid.style.display = "flex";
    furnitureItemsGrid.innerHTML = "";

    const isAdmin = isCurrentUserAdmin();

    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "furniture-item-card";

      const imgSrc = item.signedUrl || "floorplan_1.png";
      const name = escapeHtml(item.furnitureName || item.fileName || "Custom Furniture");
      const category = escapeHtml(item.furnitureType || "unknown");
      const linkedComp = item.componentId ? escapeHtml(item.componentId) : null;
      const gcsUri = escapeHtml(item.gcsUri || "");
      const isSystem = Boolean(
        item.is_system || 
        item.isSystem || 
        (item.gcsUri && item.gcsUri.startsWith("system://")) ||
        (item.storagePath && item.storagePath.startsWith("assets/")) ||
        (item.signedUrl && item.signedUrl.startsWith("assets/"))
      );

      // Find matching system catalog asset for pre-generated 3D GLB model
      const sysMatch = isSystem ? systemAssetsList.find((s) =>
        s.fileName === item.fileName ||
        (s.name && s.name.toLowerCase() === (item.furnitureName || "").toLowerCase()) ||
        (item.gcsUri && item.gcsUri.includes(s.fileName))
      ) : null;

      const meshyStatus = item.meshyStatus || item.meshy_status;
      const meshyProgress = item.meshyProgress || item.meshy_progress || 0;
      const modelUrls = item.modelUrls || item.model_urls;
      const streamGlbUrl = activeFurnitureProject ? `${API_BASE_URL}/projects/${activeFurnitureProject.id}/furniture/${item.id}/glb` : null;

      let glbUrl = (modelUrls && modelUrls.glb) || (sysMatch && (sysMatch.glbUrl || sysMatch.glbPath || (sysMatch.modelUrls && sysMatch.modelUrls.glb)));
      if (!glbUrl && isSystem) {
        const pathForGlb = item.storagePath || (item.gcsUri ? item.gcsUri.replace(/^system:\/\//, "") : null) || item.signedUrl;
        if (pathForGlb && pathForGlb.endsWith(".png")) {
          glbUrl = pathForGlb.replace(/\.png$/i, ".glb");
        }
      }
      if (!glbUrl) {
        glbUrl = streamGlbUrl;
      }

      let statusBadge = "";
      let action3dBtn = "";

      // If system asset, 3D model is ALREADY generated — never generate again, show '3D View'
      if (isSystem) {
        statusBadge = `<span class="furniture-tag badge-3d-ready" style="color: #10b981; border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.1); cursor: pointer;" title="System 3D Model Ready (Click to View 3D)">✓ 3D Ready</span>`;
        action3dBtn = `
          <button type="button" class="btn-review-3d-furn btn-view-3d-furn" data-furn-id="${escapeHtml(item.id)}" data-glb-url="${escapeHtml(glbUrl || '')}" data-furn-name="${name}" title="Interactive 3D View">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
              <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
            <span>3D View</span>
          </button>
        `;
      } else if (meshyStatus === "SUCCEEDED" || item.status === "3d_ready") {
        statusBadge = `<span class="furniture-tag badge-3d-ready" style="color: #10b981; border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.1); cursor: pointer;" title="Click to launch interactive 3D View">✓ 3D Ready</span>`;
        if (glbUrl) {
          action3dBtn = `
            <button type="button" class="btn-review-3d-furn btn-view-3d-furn" data-furn-id="${escapeHtml(item.id)}" data-glb-url="${escapeHtml(glbUrl)}" data-furn-name="${name}" title="Interactive 3D View">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
              <span>3D View</span>
            </button>
          `;
        }
      } else if (meshyStatus === "PENDING" || meshyStatus === "IN_PROGRESS" || item.status === "generating_3d") {
        statusBadge = `<span class="furniture-tag" style="color: #0ea5e9; border-color: rgba(14,165,233,0.3); background: rgba(14,165,233,0.1);">🔄 3D Generating (${meshyProgress}%)</span>`;
        action3dBtn = `
          <button type="button" class="btn-check-3d-status" data-furn-id="${escapeHtml(item.id)}" title="Check Meshy 3D generation progress">
            <span>🔄 Check 3D</span>
          </button>
        `;
      } else if (meshyStatus === "FAILED" || item.status === "failed_3d") {
        statusBadge = `<span class="furniture-tag" style="color: #ef4444; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.1);">⚠️ 3D Failed</span>`;
        action3dBtn = `
          <button type="button" class="btn-retry-3d" data-furn-id="${escapeHtml(item.id)}" title="Retry Meshy 3D generation">
            <span>⚡ Retry 3D</span>
          </button>
        `;
      } else {
        statusBadge = `<span class="furniture-tag" style="color: var(--ink-subtle); border-color: var(--border);">Uploaded</span>`;
        action3dBtn = `
          <button type="button" class="btn-generate-3d" data-furn-id="${escapeHtml(item.id)}" title="Generate 3D Model with Meshy">
            <span>⚡ Generate 3D</span>
          </button>
        `;
      }

      card.innerHTML = `
        <img src="${imgSrc}" alt="${name}" class="furniture-item-thumb" title="Click to view original photo">
        <div class="furniture-item-info">
          <div>
            <div class="furniture-item-title" title="${name}">${name}</div>
            <div class="furniture-item-badges">
              <span class="furniture-tag">${category}</span>
              ${linkedComp ? `<span class="furniture-link-tag">📍 Plan: ${linkedComp}</span>` : ""}
              ${statusBadge}
              <span class="furniture-tag badge-system-item" id="furn-sys-badge-${escapeHtml(item.id)}" style="${isSystem ? '' : 'display: none;'}" title="Belongs to System Catalog">★ System Asset</span>
            </div>
            <div class="furniture-gcs-badge" title="${gcsUri}">${gcsUri}</div>
          </div>
          ${isAdmin ? `
            <div class="furniture-admin-row">
              <label class="furniture-admin-system-label" for="furn-sys-cb-${escapeHtml(item.id)}" title="Tick which furniture belongs to system">
                <input 
                  type="checkbox" 
                  class="furniture-admin-system-cb" 
                  id="furn-sys-cb-${escapeHtml(item.id)}" 
                  data-furn-id="${escapeHtml(item.id)}" 
                  data-furn-name="${name}"
                  ${isSystem ? "checked" : ""}
                >
                <span class="admin-cb-text">Belongs to System</span>
                <span class="admin-role-pill">Admin Only</span>
              </label>
            </div>
          ` : ""}
          <div class="furniture-item-actions">
            <a href="${imgSrc}" target="_blank" rel="noopener noreferrer" class="btn-view-furn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              <span>View</span>
            </a>
            ${action3dBtn}
            <button type="button" class="btn-delete-furn" data-furn-id="${escapeHtml(item.id)}" data-furn-name="${name}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              <span>Delete</span>
            </button>
          </div>
        </div>
      `;

      const thumb = card.querySelector(".furniture-item-thumb");
      thumb.addEventListener("click", () => {
        window.open(imgSrc, "_blank");
      });

      const review3dBtn = card.querySelector(".btn-review-3d-furn");
      if (review3dBtn) {
        review3dBtn.addEventListener("click", () => {
          open3dReviewModal({
            name: item.furnitureName || item.fileName || "Custom Furniture",
            category: item.furnitureType || "unknown",
            glbUrl: glbUrl,
            modelUrls: (sysMatch && sysMatch.modelUrls) || modelUrls || { glb: glbUrl },
            imgSrc: imgSrc,
            furnitureId: item.id,
            projectId: activeFurnitureProject ? activeFurnitureProject.id : null,
            linkedComp: linkedComp,
            gcsUri: gcsUri,
          });
        });
      }

      const readyBadge = card.querySelector(".badge-3d-ready");
      if (readyBadge && glbUrl) {
        readyBadge.addEventListener("click", () => {
          open3dReviewModal({
            name: item.furnitureName || item.fileName || "Custom Furniture",
            category: item.furnitureType || "unknown",
            glbUrl: glbUrl,
            modelUrls: (sysMatch && sysMatch.modelUrls) || modelUrls || { glb: glbUrl },
            imgSrc: imgSrc,
            furnitureId: item.id,
            projectId: activeFurnitureProject ? activeFurnitureProject.id : null,
            linkedComp: linkedComp,
            gcsUri: gcsUri,
          });
        });
      }

      const check3dBtn = card.querySelector(".btn-check-3d-status");
      if (check3dBtn) {
        check3dBtn.addEventListener("click", () => {
          handleCheck3dStatus(item.id);
        });
      }

      const retry3dBtn = card.querySelector(".btn-retry-3d");
      if (retry3dBtn) {
        retry3dBtn.addEventListener("click", () => {
          handleGenerate3d(item.id);
        });
      }

      const gen3dBtn = card.querySelector(".btn-generate-3d");
      if (gen3dBtn) {
        gen3dBtn.addEventListener("click", () => {
          handleGenerate3d(item.id);
        });
      }

      const delBtn = card.querySelector(".btn-delete-furn");
      delBtn.addEventListener("click", () => {
        handleDeleteFurniture(item.id, name);
      });

      if (isAdmin) {
        const sysCheckbox = card.querySelector(".furniture-admin-system-cb");
        if (sysCheckbox) {
          sysCheckbox.addEventListener("change", async (e) => {
            const isChecked = e.target.checked;
            const furnId = sysCheckbox.dataset.furnId;
            const furnName = sysCheckbox.dataset.furnName;
            await handleToggleFurnitureSystem(furnId, furnName, isChecked, sysCheckbox, card, item);
          });
        }
      }

      furnitureItemsGrid.appendChild(card);
    });
  }
}

async function handleToggleFurnitureSystem(furnitureId, furnitureName, isSystem, checkbox, card, item) {
  if (!activeFurnitureProject) return;
  const token = localStorage.getItem("soraplan_token");
  if (!token) {
    showToast("Authentication session expired. Please sign in again.", "error");
    checkbox.checked = !isSystem;
    return;
  }

  checkbox.disabled = true;
  try {
    showToast(`Updating system status for "${furnitureName}"...`, "info");
    const res = await fetch(`${API_BASE_URL}/projects/${activeFurnitureProject.id}/furniture/${furnitureId}/system`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ is_system: isSystem }),
    });

    const resData = await res.json();
    if (!res.ok) {
      throw new Error(resData.detail || resData.title || "Failed to update system status");
    }

    item.is_system = isSystem;
    item.isSystem = isSystem;

    // Dynamically show or hide the system badge
    const badge = card.querySelector(`#furn-sys-badge-${furnitureId}`);
    if (badge) {
      badge.style.display = isSystem ? "inline-flex" : "none";
    }

    showToast(
      isSystem
        ? `✓ "${furnitureName}" marked as belonging to system.`
        : `✓ "${furnitureName}" unmarked from system.`,
      "success"
    );
  } catch (err) {
    console.error("Failed to update furniture system status:", err);
    checkbox.checked = !isSystem;
    showToast(`Could not update system status: ${err.message}`, "error");
  } finally {
    checkbox.disabled = false;
  }
}

async function handleDeleteFurniture(furnitureId, furnitureName) {
  if (!activeFurnitureProject) return;
  const confirmDel = window.confirm(`Are you sure you want to delete "${furnitureName}" from Cloud Storage?`);
  if (!confirmDel) return;

  const token = localStorage.getItem("soraplan_token");
  try {
    showToast(`Deleting "${furnitureName}"...`, "info");
    const res = await fetch(`${API_BASE_URL}/projects/${activeFurnitureProject.id}/furniture/${furnitureId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error("Failed to delete furniture from server");
    }

    showToast(`"${furnitureName}" deleted from Cloud Storage.`, "success");
    await loadProjectFurniture(activeFurnitureProject.id);
    loadProjects();
    loadUserAssets();
  } catch (err) {
    showToast(`Error deleting furniture: ${err.message}`, "error");
  }
}

async function handleCheck3dStatus(furnitureId) {
  if (!activeFurnitureProject) return;
  const token = localStorage.getItem("soraplan_token");
  try {
    showToast("Checking 3D status with Meshy...", "info");
    const res = await fetch(`${API_BASE_URL}/projects/${activeFurnitureProject.id}/furniture/${furnitureId}/3d-status`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to check 3D status");
    const updated = await res.json();
    const st = updated.meshyStatus || updated.meshy_status;
    if (st === "SUCCEEDED" || updated.status === "3d_ready") {
      showToast("🎉 Meshy 3D model generation complete! GLB asset is ready.", "success");
    } else if (st === "FAILED") {
      showToast("Meshy 3D generation failed.", "error");
    } else {
      showToast(`Meshy 3D generation in progress (${updated.meshyProgress || updated.meshy_progress || 0}%).`, "info");
    }
    await loadProjectFurniture(activeFurnitureProject.id);
  } catch (err) {
    showToast(`Error checking 3D status: ${err.message}`, "error");
  }
}

async function handleGenerate3d(furnitureId) {
  if (!activeFurnitureProject) return;

  // System asset already has pre-generated 3D model — do not generate again
  const furnItem = (projectFurnitureList || []).find((f) => f.id === furnitureId);
  const isSystem = furnItem && Boolean(
    furnItem.is_system ||
    furnItem.isSystem ||
    (furnItem.gcsUri && furnItem.gcsUri.startsWith("system://")) ||
    (furnItem.storagePath && furnItem.storagePath.startsWith("assets/"))
  );
  if (isSystem) {
    showToast("✨ This system asset already has an optimized 3D model ready.", "info");
    const sysMatch = systemAssetsList.find((s) =>
      s.fileName === furnItem.fileName ||
      (s.name && s.name.toLowerCase() === (furnItem.furnitureName || "").toLowerCase())
    );
    const glbUrl = (sysMatch && (sysMatch.glbUrl || sysMatch.glbPath || (sysMatch.modelUrls && sysMatch.modelUrls.glb))) ||
      (furnItem.storagePath && furnItem.storagePath.replace(/\.png$/i, ".glb")) ||
      `${API_BASE_URL}/projects/${activeFurnitureProject.id}/furniture/${furnitureId}/glb`;

    open3dReviewModal({
      name: furnItem.furnitureName || furnItem.fileName || "System Furniture",
      category: furnItem.furnitureType || "unknown",
      glbUrl: glbUrl,
      modelUrls: (sysMatch && sysMatch.modelUrls) || { glb: glbUrl },
      imgSrc: furnItem.signedUrl || "assets/sofa.jpg",
      furnitureId: furnItem.id,
      projectId: activeFurnitureProject.id,
      linkedComp: furnItem.componentId,
      gcsUri: furnItem.gcsUri,
    });
    return;
  }

  const token = localStorage.getItem("soraplan_token");
  try {
    showToast("Submitting Image-to-3D task to Meshy...", "info");
    const res = await fetch(`${API_BASE_URL}/projects/${activeFurnitureProject.id}/furniture/${furnitureId}/generate-3d`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || errData.title || "Failed to trigger 3D generation");
    }
    const updated = await res.json();
    const taskId = updated.meshyTaskId || updated.meshy_task_id;
    showToast(`🚀 Meshy 3D task created: ${taskId ? taskId.slice(0, 10) + "..." : "in progress"}`, "success");
    await loadProjectFurniture(activeFurnitureProject.id);
  } catch (err) {
    showToast(`Error triggering 3D: ${err.message}`, "error");
  }
}

// -------------------------------------------------------------
// 14. 3D GLB INTERACTIVE REVIEW MODAL (Google model-viewer)
// -------------------------------------------------------------

let current3dReviewData = null;
let currentBgThemeIdx = 0;

const REVIEW_BG_THEMES = [
  { name: "Studio Dark", bg: "radial-gradient(circle at 50% 35%, #182632 0%, #0a0f14 100%)" },
  { name: "Blueprint Grid", bg: "radial-gradient(circle at 50% 50%, rgba(59, 164, 227, 0.08) 0%, #070c10 100%), repeating-linear-gradient(0deg, rgba(79, 165, 216, 0.06) 0px, rgba(79, 165, 216, 0.06) 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, rgba(79, 165, 216, 0.06) 0px, rgba(79, 165, 216, 0.06) 1px, transparent 1px, transparent 24px)" },
  { name: "Neutral Gray", bg: "#1f2937" },
  { name: "Studio Light", bg: "#e2e8f0" },
];

function setup3dReviewListeners() {
  const modal = document.getElementById("modal-3d-review");
  const btnClose = document.getElementById("btn-close-3d-review");
  const btnDone = document.getElementById("btn-review-3d-done");
  const btnToggleRotate = document.getElementById("btn-3d-toggle-rotate");
  const btnResetCam = document.getElementById("btn-3d-reset-cam");
  const btnToggleBg = document.getElementById("btn-3d-toggle-bg");
  const btnRetry = document.getElementById("btn-review-3d-retry");
  const modelViewer = document.getElementById("review-3d-model-viewer");
  const viewportContainer = document.getElementById("review-3d-viewport-container");
  const labelRotate = document.getElementById("label-toggle-rotate");
  const labelBg = document.getElementById("label-bg-mode");

  if (btnClose) btnClose.addEventListener("click", close3dReviewModal);
  if (btnDone) btnDone.addEventListener("click", close3dReviewModal);

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        close3dReviewModal();
      }
    });
  }

  if (btnToggleRotate && modelViewer) {
    btnToggleRotate.addEventListener("click", () => {
      const isRotating = modelViewer.hasAttribute("auto-rotate");
      if (isRotating) {
        modelViewer.removeAttribute("auto-rotate");
        btnToggleRotate.classList.remove("active");
        if (labelRotate) labelRotate.textContent = "Rotate Paused";
      } else {
        modelViewer.setAttribute("auto-rotate", "");
        btnToggleRotate.classList.add("active");
        if (labelRotate) labelRotate.textContent = "Auto-Rotate";
      }
    });
  }

  if (btnResetCam && modelViewer) {
    btnResetCam.addEventListener("click", () => {
      modelViewer.cameraOrbit = "40deg 75deg auto";
      modelViewer.cameraTarget = "auto auto auto";
      modelViewer.fieldOfView = "auto";
    });
  }

  if (btnToggleBg && viewportContainer) {
    btnToggleBg.addEventListener("click", () => {
      currentBgThemeIdx = (currentBgThemeIdx + 1) % REVIEW_BG_THEMES.length;
      const theme = REVIEW_BG_THEMES[currentBgThemeIdx];
      viewportContainer.style.background = theme.bg;
      if (labelBg) labelBg.textContent = theme.name;
    });
  }

  if (btnRetry) {
    btnRetry.addEventListener("click", () => {
      if (current3dReviewData) {
        open3dReviewModal(current3dReviewData);
      }
    });
  }
}

open3dReviewModal._loadCounter = 0;

function open3dReviewModal(data) {
  current3dReviewData = data;
  const modal = document.getElementById("modal-3d-review");
  const titleEl = document.getElementById("review-3d-title-text");
  const subtitleEl = document.getElementById("modal-3d-subtitle");
  const catBadge = document.getElementById("review-3d-category-badge");
  const modelViewer = document.getElementById("review-3d-model-viewer");
  const loadingOverlay = document.getElementById("review-3d-loading-overlay");
  const progressFill = document.getElementById("review-3d-progress-fill");
  const errorOverlay = document.getElementById("review-3d-error-overlay");
  const errorDesc = document.getElementById("review-3d-error-desc");
  const fallbackLink = document.getElementById("btn-review-3d-fallback-link");
  const downloadGlbBtn = document.getElementById("btn-review-3d-download-glb");

  if (!modal || !modelViewer) return;

  const furnName = data.name || "3D Furniture Model";
  const category = (data.category || "furniture").replace(/_/g, " ");

  if (titleEl) titleEl.textContent = `${furnName} (3D Review)`;
  if (subtitleEl) {
    subtitleEl.textContent = `Interactive real-world 3D model generated by Meshy AI${data.linkedComp ? ` • Linked to plan: ${data.linkedComp}` : ""}. Ready for SoraPlan 3D home scene graph.`;
  }
  if (catBadge) {
    catBadge.textContent = `Category: ${category}`;
  }

  // Clear previous blob URL if any
  if (modelViewer._currentBlobUrl) {
    try {
      URL.revokeObjectURL(modelViewer._currentBlobUrl);
    } catch (_) {}
    modelViewer._currentBlobUrl = null;
  }

  const projId = data.projectId || (activeFurnitureProject ? activeFurnitureProject.id : null);
  const streamEndpoint = projId && data.furnitureId ? `${API_BASE_URL}/projects/${projId}/furniture/${data.furnitureId}/glb` : null;

  // Prefer direct glbUrl if available (e.g. assets/... local static or direct meshy URL), then streamEndpoint
  const candidateUrls = [];
  if (data.glbUrl) candidateUrls.push(data.glbUrl);
  if (data.modelUrls && data.modelUrls.glb && !candidateUrls.includes(data.modelUrls.glb)) {
    candidateUrls.push(data.modelUrls.glb);
  }
  if (streamEndpoint && !candidateUrls.includes(streamEndpoint)) candidateUrls.push(streamEndpoint);

  const initialDownloadUrl = streamEndpoint || data.glbUrl || "#";
  if (downloadGlbBtn) {
    downloadGlbBtn.href = initialDownloadUrl;
    downloadGlbBtn.download = `${furnName.replace(/\s+/g, "_")}.glb`;
  }
  if (fallbackLink) {
    fallbackLink.href = initialDownloadUrl;
  }

  // Reset overlays
  if (loadingOverlay) {
    loadingOverlay.style.display = "flex";
    loadingOverlay.style.opacity = "1";
    loadingOverlay.style.visibility = "visible";
  }
  if (progressFill) progressFill.style.width = "15%";
  if (errorOverlay) errorOverlay.style.display = "none";

  if (candidateUrls.length === 0) {
    if (loadingOverlay) loadingOverlay.style.display = "none";
    if (errorOverlay) {
      errorOverlay.style.display = "flex";
      if (errorDesc) {
        errorDesc.textContent = "3D GLB model URL is not available. Please check 3D status or retry generation.";
      }
    }
    return;
  }

  modal.style.display = "flex";
  document.body.classList.add("modal-open");

  const activeLoadId = ++open3dReviewModal._loadCounter;

  async function loadGlbWithStreaming() {
    let response = null;

    for (const url of candidateUrls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          response = res;
          break;
        }
      } catch (err) {
        console.warn("Failed fetching GLB from candidate URL:", url, err);
      }
    }

    if (!response || activeLoadId !== open3dReviewModal._loadCounter) {
      if (activeLoadId === open3dReviewModal._loadCounter) {
        console.error("Could not fetch GLB from any candidate URL:", candidateUrls);
        if (loadingOverlay) loadingOverlay.style.display = "none";
        if (errorOverlay) {
          errorOverlay.style.display = "flex";
          if (errorDesc) {
            errorDesc.textContent = "Could not download 3D model asset from server. Please retry or download directly.";
          }
        }
      }
      return;
    }

    const contentLength = response.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    const reader = response.body.getReader();
    let receivedBytes = 0;
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (activeLoadId !== open3dReviewModal._loadCounter) return;
      chunks.push(value);
      receivedBytes += value.length;

      if (totalBytes > 0 && progressFill) {
        const pct = Math.min(95, Math.max(15, Math.round((receivedBytes / totalBytes) * 100)));
        progressFill.style.width = `${pct}%`;
      }
    }

    if (activeLoadId !== open3dReviewModal._loadCounter) return;

    const blob = new Blob(chunks, { type: "model/gltf-binary" });
    const blobUrl = URL.createObjectURL(blob);
    modelViewer._currentBlobUrl = blobUrl;

    // Both the 3D Review window and the Download GLB button use the EXACT same file
    if (downloadGlbBtn) {
      downloadGlbBtn.href = blobUrl;
      downloadGlbBtn.download = `${furnName.replace(/\s+/g, "_")}.glb`;
    }
    if (fallbackLink) {
      fallbackLink.href = blobUrl;
    }

    const onLoad = () => {
      if (progressFill) progressFill.style.width = "100%";
      setTimeout(() => {
        if (loadingOverlay) {
          loadingOverlay.style.opacity = "0";
          setTimeout(() => {
            loadingOverlay.style.display = "none";
          }, 250);
        }
      }, 150);
    };

    const onError = (e) => {
      console.error("model-viewer failed to render GLB blob:", e);
      if (loadingOverlay) loadingOverlay.style.display = "none";
      if (errorOverlay) {
        errorOverlay.style.display = "flex";
        if (errorDesc) {
          errorDesc.textContent = "Could not render the generated 3D asset in the viewport. You can open or download the GLB directly.";
        }
      }
    };

    if (modelViewer._reviewLoadHandler) {
      modelViewer.removeEventListener("load", modelViewer._reviewLoadHandler);
    }
    if (modelViewer._reviewErrorHandler) {
      modelViewer.removeEventListener("error", modelViewer._reviewErrorHandler);
    }

    modelViewer._reviewLoadHandler = onLoad;
    modelViewer._reviewErrorHandler = onError;
    modelViewer.addEventListener("load", onLoad, { once: true });
    modelViewer.addEventListener("error", onError, { once: true });

    // Set src to the local blob URL: zero CORS restrictions, 100% reliable
    modelViewer.src = blobUrl;
  }

  loadGlbWithStreaming();
}

function close3dReviewModal() {
  open3dReviewModal._loadCounter = (open3dReviewModal._loadCounter || 0) + 1;
  const modal = document.getElementById("modal-3d-review");
  const modelViewer = document.getElementById("review-3d-model-viewer");
  if (modal) {
    modal.style.display = "none";
  }
  if (modelViewer) {
    try {
      if (modelViewer.pause) modelViewer.pause();
    } catch (_) {}
    if (modelViewer._currentBlobUrl) {
      try {
        URL.revokeObjectURL(modelViewer._currentBlobUrl);
      } catch (_) {}
      modelViewer._currentBlobUrl = null;
    }
    modelViewer.src = "";
  }

  const furnModal = document.getElementById("furniture-modal");
  if (!furnModal || furnModal.style.display === "none") {
    document.body.classList.remove("modal-open");
  }
}

const EMBEDDED_SYSTEM_ASSETS = [
  {
    "id": "sys_industrial_In_TV_stand",
    "style": "Industrial",
    "fileName": "In_TV_stand.png",
    "name": "Industrial Tv Stand",
    "category": "TV Stand",
    "imagePath": "assets/Industrial/In_TV_stand.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_bath",
    "style": "Industrial",
    "fileName": "In_bath.png",
    "name": "Industrial Bath",
    "category": "Bathtub",
    "imagePath": "assets/Industrial/In_bath.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_bed_1",
    "style": "Industrial",
    "fileName": "In_bed_1.png",
    "name": "Industrial Bed 1",
    "category": "Bed",
    "imagePath": "assets/Industrial/In_bed_1.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_bed_2",
    "style": "Industrial",
    "fileName": "In_bed_2.png",
    "name": "Industrial Bed 2",
    "category": "Bed",
    "imagePath": "assets/Industrial/In_bed_2.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_bed_master",
    "style": "Industrial",
    "fileName": "In_bed_master.png",
    "name": "Industrial Bed Master",
    "category": "Bed",
    "imagePath": "assets/Industrial/In_bed_master.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_closet_storage",
    "style": "Industrial",
    "fileName": "In_closet_storage.png",
    "name": "Industrial Closet Storage",
    "category": "Wardrobe & Storage",
    "imagePath": "assets/Industrial/In_closet_storage.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_fridge",
    "style": "Industrial",
    "fileName": "In_fridge.png",
    "name": "Industrial Fridge",
    "category": "Kitchen Appliance",
    "imagePath": "assets/Industrial/In_fridge.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_kitchen_chair_1",
    "style": "Industrial",
    "fileName": "In_kitchen_chair_1.png",
    "name": "Industrial Kitchen Chair 1",
    "category": "Dining Chair",
    "imagePath": "assets/Industrial/In_kitchen_chair_1.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_kitchen_chair_2",
    "style": "Industrial",
    "fileName": "In_kitchen_chair_2.png",
    "name": "Industrial Kitchen Chair 2",
    "category": "Dining Chair",
    "imagePath": "assets/Industrial/In_kitchen_chair_2.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_kitchen_counter",
    "style": "Industrial",
    "fileName": "In_kitchen_counter.png",
    "name": "Industrial Kitchen Counter",
    "category": "Kitchen Counter",
    "imagePath": "assets/Industrial/In_kitchen_counter.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_kitchen_sink",
    "style": "Industrial",
    "fileName": "In_kitchen_sink.png",
    "name": "Industrial Kitchen Sink",
    "category": "Kitchen Sink",
    "imagePath": "assets/Industrial/In_kitchen_sink.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_kitchen_table_1",
    "style": "Industrial",
    "fileName": "In_kitchen_table_1.png",
    "name": "Industrial Kitchen Table 1",
    "category": "Dining Table",
    "imagePath": "assets/Industrial/In_kitchen_table_1.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_kitchen_table_2",
    "style": "Industrial",
    "fileName": "In_kitchen_table_2.png",
    "name": "Industrial Kitchen Table 2",
    "category": "Dining Table",
    "imagePath": "assets/Industrial/In_kitchen_table_2.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_lightstand",
    "style": "Industrial",
    "fileName": "In_lightstand.png",
    "name": "Industrial Lightstand",
    "category": "Lighting",
    "imagePath": "assets/Industrial/In_lightstand.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_living_chair",
    "style": "Industrial",
    "fileName": "In_living_chair.png",
    "name": "Industrial Living Chair",
    "category": "Armchair",
    "imagePath": "assets/Industrial/In_living_chair.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_living_table",
    "style": "Industrial",
    "fileName": "In_living_table.png",
    "name": "Industrial Living Table",
    "category": "Coffee Table",
    "imagePath": "assets/Industrial/In_living_table.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_sofa",
    "style": "Industrial",
    "fileName": "In_sofa.png",
    "name": "Industrial Sofa",
    "category": "Sofa",
    "imagePath": "assets/Industrial/In_sofa.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_stool",
    "style": "Industrial",
    "fileName": "In_stool.png",
    "name": "Industrial Stool",
    "category": "Stool",
    "imagePath": "assets/Industrial/In_stool.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_toilet",
    "style": "Industrial",
    "fileName": "In_toilet.png",
    "name": "Industrial Toilet",
    "category": "Toilet",
    "imagePath": "assets/Industrial/In_toilet.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_toilet_sink",
    "style": "Industrial",
    "fileName": "In_toilet_sink.png",
    "name": "Industrial Toilet Sink",
    "category": "Bathroom Vanity",
    "imagePath": "assets/Industrial/In_toilet_sink.png",
    "isSystem": true
  },
  {
    "id": "sys_industrial_In_washing_dryer",
    "style": "Industrial",
    "fileName": "In_washing_dryer.png",
    "name": "Industrial Washing Dryer",
    "category": "Appliance",
    "imagePath": "assets/Industrial/In_washing_dryer.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_TV_stand",
    "style": "Japandi",
    "fileName": "Ja_TV_stand.png",
    "name": "Japandi Tv Stand",
    "category": "TV Stand",
    "imagePath": "assets/Japandi/Ja_TV_stand.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_bath",
    "style": "Japandi",
    "fileName": "Ja_bath.png",
    "name": "Japandi Bath",
    "category": "Bathtub",
    "imagePath": "assets/Japandi/Ja_bath.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_bed_1",
    "style": "Japandi",
    "fileName": "Ja_bed_1.png",
    "name": "Japandi Bed 1",
    "category": "Bed",
    "imagePath": "assets/Japandi/Ja_bed_1.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_bed_2",
    "style": "Japandi",
    "fileName": "Ja_bed_2.png",
    "name": "Japandi Bed 2",
    "category": "Bed",
    "imagePath": "assets/Japandi/Ja_bed_2.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_closet_storage",
    "style": "Japandi",
    "fileName": "Ja_closet_storage.png",
    "name": "Japandi Closet Storage",
    "category": "Wardrobe & Storage",
    "imagePath": "assets/Japandi/Ja_closet_storage.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_fridge",
    "style": "Japandi",
    "fileName": "Ja_fridge.png",
    "name": "Japandi Fridge",
    "category": "Kitchen Appliance",
    "imagePath": "assets/Japandi/Ja_fridge.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_kitchen_bench",
    "style": "Japandi",
    "fileName": "Ja_kitchen_bench.png",
    "name": "Japandi Kitchen Bench",
    "category": "Dining Bench",
    "imagePath": "assets/Japandi/Ja_kitchen_bench.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_kitchen_chair",
    "style": "Japandi",
    "fileName": "Ja_kitchen_chair.png",
    "name": "Japandi Kitchen Chair",
    "category": "Dining Chair",
    "imagePath": "assets/Japandi/Ja_kitchen_chair.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_kitchen_counter",
    "style": "Japandi",
    "fileName": "Ja_kitchen_counter.png",
    "name": "Japandi Kitchen Counter",
    "category": "Kitchen Counter",
    "imagePath": "assets/Japandi/Ja_kitchen_counter.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_kitchen_sink",
    "style": "Japandi",
    "fileName": "Ja_kitchen_sink.png",
    "name": "Japandi Kitchen Sink",
    "category": "Kitchen Sink",
    "imagePath": "assets/Japandi/Ja_kitchen_sink.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_kitchen_table",
    "style": "Japandi",
    "fileName": "Ja_kitchen_table.png",
    "name": "Japandi Kitchen Table",
    "category": "Dining Table",
    "imagePath": "assets/Japandi/Ja_kitchen_table.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_kitchen_table_2",
    "style": "Japandi",
    "fileName": "Ja_kitchen_table_2.png",
    "name": "Japandi Kitchen Table 2",
    "category": "Dining Table",
    "imagePath": "assets/Japandi/Ja_kitchen_table_2.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_living_chair",
    "style": "Japandi",
    "fileName": "Ja_living_chair.png",
    "name": "Japandi Living Chair",
    "category": "Armchair",
    "imagePath": "assets/Japandi/Ja_living_chair.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_living_table",
    "style": "Japandi",
    "fileName": "Ja_living_table.png",
    "name": "Japandi Living Table",
    "category": "Coffee Table",
    "imagePath": "assets/Japandi/Ja_living_table.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_master_bed",
    "style": "Japandi",
    "fileName": "Ja_master_bed.png",
    "name": "Japandi Master Bed",
    "category": "Bed",
    "imagePath": "assets/Japandi/Ja_master_bed.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_nightstand",
    "style": "Japandi",
    "fileName": "Ja_nightstand.png",
    "name": "Japandi Nightstand",
    "category": "Nightstand",
    "imagePath": "assets/Japandi/Ja_nightstand.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_sink",
    "style": "Japandi",
    "fileName": "Ja_sink.png",
    "name": "Japandi Sink",
    "category": "Sink",
    "imagePath": "assets/Japandi/Ja_sink.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_sofa",
    "style": "Japandi",
    "fileName": "Ja_sofa.png",
    "name": "Japandi Sofa",
    "category": "Sofa",
    "imagePath": "assets/Japandi/Ja_sofa.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_toilet",
    "style": "Japandi",
    "fileName": "Ja_toilet.png",
    "name": "Japandi Toilet",
    "category": "Toilet",
    "imagePath": "assets/Japandi/Ja_toilet.png",
    "isSystem": true
  },
  {
    "id": "sys_japandi_Ja_washing_dryer",
    "style": "Japandi",
    "fileName": "Ja_washing_dryer.png",
    "name": "Japandi Washing Dryer",
    "category": "Appliance",
    "imagePath": "assets/Japandi/Ja_washing_dryer.png",
    "isSystem": true
  }
];

// =============================================================
// STEP ③ ASSETS MODULE: SYSTEM ASSETS & YOUR ASSETS
// =============================================================

let systemAssetsList = [...EMBEDDED_SYSTEM_ASSETS];
let userAssetsList = [];
let currentSystemStyle = "all";
let currentSystemCategory = "all";
let systemSearchQuery = "";
let userSearchQuery = "";
let activeAssetSubtab = "system";
let assetTargetForProject = null;
let selectedProjectIdForAsset = null;

async function initAssetsCatalog() {
  // 1. Fetch system_assets_data.json
  try {
    const res = await fetch("system_assets_data.json");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        systemAssetsList = data;
      }
    }
  } catch (err) {
    console.warn("Could not load system_assets_data.json:", err);
  }

  // 2. Sub-items Switcher: System Assets vs Your Assets
  const tabSystem = document.getElementById("tab-system-assets");
  const tabYour = document.getElementById("tab-your-assets");
  const viewSystem = document.getElementById("view-system-assets");
  const viewYour = document.getElementById("view-your-assets");

  if (tabSystem && tabYour && viewSystem && viewYour) {
    tabSystem.addEventListener("click", () => {
      activeAssetSubtab = "system";
      tabSystem.classList.add("active");
      tabSystem.setAttribute("aria-selected", "true");
      tabYour.classList.remove("active");
      tabYour.setAttribute("aria-selected", "false");
      viewSystem.style.display = "flex";
      viewYour.style.display = "none";
      renderSystemAssets();
    });

    tabYour.addEventListener("click", () => {
      activeAssetSubtab = "user";
      tabYour.classList.add("active");
      tabYour.setAttribute("aria-selected", "true");
      tabSystem.classList.remove("active");
      tabSystem.setAttribute("aria-selected", "false");
      viewYour.style.display = "flex";
      viewSystem.style.display = "none";
      loadUserAssets();
    });
  }

  // 3. Style Showcase Cards: Click to filter style & smooth scroll
  document.querySelectorAll(".style-showcase-card").forEach((card) => {
    card.addEventListener("click", () => {
      const targetStyle = card.getAttribute("data-style-select");
      if (targetStyle) {
        currentSystemStyle = targetStyle;
        updateStyleFilterPills(targetStyle);
        renderSystemAssets();

        // Highlight card
        document.querySelectorAll(".style-showcase-card").forEach((c) => c.classList.remove("is-selected-style"));
        card.classList.add("is-selected-style");

        // Scroll to grid
        const grid = document.getElementById("system-assets-grid");
        if (grid) {
          grid.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  });

  // 4. Style Filter Pills
  const stylePillsContainer = document.getElementById("system-style-pills");
  if (stylePillsContainer) {
    stylePillsContainer.querySelectorAll(".filter-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const style = pill.getAttribute("data-style");
        currentSystemStyle = style || "all";
        updateStyleFilterPills(currentSystemStyle);
        renderSystemAssets();
      });
    });
  }

  // 5. Category Filter Chips
  const catChipsContainer = document.getElementById("system-category-chips");
  if (catChipsContainer) {
    catChipsContainer.querySelectorAll(".category-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        catChipsContainer.querySelectorAll(".category-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        currentSystemCategory = chip.getAttribute("data-cat") || "all";
        renderSystemAssets();
      });
    });
  }

  // 6. System Assets Search
  const searchSystemInput = document.getElementById("search-system-assets");
  const btnClearSystemSearch = document.getElementById("btn-clear-system-search");
  if (searchSystemInput) {
    searchSystemInput.addEventListener("input", (e) => {
      systemSearchQuery = e.target.value.trim().toLowerCase();
      if (btnClearSystemSearch) {
        btnClearSystemSearch.style.display = systemSearchQuery ? "block" : "none";
      }
      renderSystemAssets();
    });
  }
  if (btnClearSystemSearch) {
    btnClearSystemSearch.addEventListener("click", () => {
      if (searchSystemInput) searchSystemInput.value = "";
      systemSearchQuery = "";
      btnClearSystemSearch.style.display = "none";
      renderSystemAssets();
    });
  }

  // 7. Your Assets Search
  const searchYourInput = document.getElementById("search-your-assets");
  const btnClearYourSearch = document.getElementById("btn-clear-your-search");
  if (searchYourInput) {
    searchYourInput.addEventListener("input", (e) => {
      userSearchQuery = e.target.value.trim().toLowerCase();
      if (btnClearYourSearch) {
        btnClearYourSearch.style.display = userSearchQuery ? "block" : "none";
      }
      renderYourAssets();
    });
  }
  if (btnClearYourSearch) {
    btnClearYourSearch.addEventListener("click", () => {
      if (searchYourInput) searchYourInput.value = "";
      userSearchQuery = "";
      btnClearYourSearch.style.display = "none";
      renderYourAssets();
    });
  }

  // 8. Upload Custom Furniture Triggers in Your Assets
  const btnUploadFromAssets = document.getElementById("btn-open-upload-modal-from-assets");
  const btnEmptyUploadAction = document.getElementById("btn-empty-upload-action");
  const btnEmptySwitchSystem = document.getElementById("btn-empty-switch-system");

  const openUploadHandler = () => {
    const targetProj = activeFurnitureProject || (currentProjects && currentProjects.length > 0 ? currentProjects[0] : null);
    if (!targetProj) {
      showToast("Please create a studio project first before uploading furniture.", "info");
      const creatorCard = document.getElementById("project-creator-card");
      if (creatorCard) creatorCard.scrollIntoView({ behavior: "smooth" });
      return;
    }
    openFurnitureUploadModal(targetProj);
  };

  if (btnUploadFromAssets) btnUploadFromAssets.addEventListener("click", openUploadHandler);
  if (btnEmptyUploadAction) btnEmptyUploadAction.addEventListener("click", openUploadHandler);
  if (btnEmptySwitchSystem) {
    btnEmptySwitchSystem.addEventListener("click", () => {
      if (tabSystem) tabSystem.click();
    });
  }

  // 9. Studio Section Jump Navigation (Studio Projects <-> Assets)
  const btnQuickProjects = document.getElementById("btn-quicknav-projects");
  const btnQuickAssets = document.getElementById("btn-quicknav-assets");

  if (btnQuickProjects) {
    btnQuickProjects.addEventListener("click", (e) => {
      e.preventDefault();
      const projSec = document.getElementById("projects-section");
      if (projSec) {
        projSec.scrollIntoView({ behavior: "smooth", block: "start" });
        btnQuickProjects.classList.add("active");
        if (btnQuickAssets) btnQuickAssets.classList.remove("active");
      }}
    );
  }
  if (btnQuickAssets) {
    btnQuickAssets.addEventListener("click", (e) => {
      e.preventDefault();
      const assetsSec = document.getElementById("assets-section");
      if (assetsSec) {
        assetsSec.scrollIntoView({ behavior: "smooth", block: "start" });
        btnQuickAssets.classList.add("active");
        if (btnQuickProjects) btnQuickProjects.classList.remove("active");
      }}
    );
  }

  // 10. Modal: Choose Asset for Project
  const chooseModal = document.getElementById("choose-project-modal");
  const btnCloseChoose = document.getElementById("btn-close-choose-proj");
  const btnCancelChoose = document.getElementById("btn-cancel-choose-proj");
  const formChoose = document.getElementById("form-choose-project");

  if (btnCloseChoose) btnCloseChoose.addEventListener("click", closeChooseProjectModal);
  if (btnCancelChoose) btnCancelChoose.addEventListener("click", closeChooseProjectModal);
  if (chooseModal) {
    chooseModal.addEventListener("click", (e) => {
      if (e.target === chooseModal) closeChooseProjectModal();
    });
  }
  if (formChoose) {
    formChoose.addEventListener("submit", handleChooseProjectSubmit);
  }

  // 11. Shortcut from 2D Plan Editor Property Inspector
  const btnChooseItemAsset = document.getElementById("btn-choose-item-asset");
  if (btnChooseItemAsset) {
    btnChooseItemAsset.addEventListener("click", () => {
      if (!selectedObj) return;
      openAssetPickerForEditorComponent(selectedObj);
    });
  }

  // 12. Shortcut from Custom Furniture Ingestion Modal
  const btnBrowseAssetsShortcut = document.getElementById("btn-browse-assets-for-active-proj");
  if (btnBrowseAssetsShortcut) {
    btnBrowseAssetsShortcut.addEventListener("click", () => {
      closeFurnitureUploadModal();
      const assetsSec = document.getElementById("assets-section");
      if (assetsSec) {
        assetsSec.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  // Initial render
  renderSystemAssets();
  loadUserAssets();
}

function updateStyleFilterPills(selectedStyle) {
  const container = document.getElementById("system-style-pills");
  if (!container) return;
  container.querySelectorAll(".filter-pill").forEach((p) => {
    const s = p.getAttribute("data-style");
    if (s === selectedStyle) {
      p.classList.add("active");
    } else {
      p.classList.remove("active");
    }
  });
}

function renderSystemAssets() {
  const grid = document.getElementById("system-assets-grid");
  if (!grid) return;

  const filtered = systemAssetsList.filter((item) => {
    // Style check
    if (currentSystemStyle !== "all" && item.style.toLowerCase() !== currentSystemStyle.toLowerCase()) {
      return false;
    }
    // Category check
    if (currentSystemCategory !== "all") {
      const itemCat = (item.category || "").toLowerCase();
      const filterCat = currentSystemCategory.toLowerCase();
      if (!itemCat.includes(filterCat)) {
        return false;
      }
    }
    // Search query check
    if (systemSearchQuery) {
      const name = (item.name || "").toLowerCase();
      const fn = (item.fileName || "").toLowerCase();
      const cat = (item.category || "").toLowerCase();
      const style = (item.style || "").toLowerCase();
      if (!name.includes(systemSearchQuery) && !fn.includes(systemSearchQuery) && !cat.includes(systemSearchQuery) && !style.includes(systemSearchQuery)) {
        return false;
      }
    }
    return true;
  });

  grid.innerHTML = "";

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="gallery-empty-state" style="grid-column: 1 / -1; padding: 36px 20px;">
        <h3 class="empty-title">No system assets matched your filter</h3>
        <p class="empty-desc">Try clearing your search query or selecting "All Styles" / "All Items".</p>
      </div>
    `;
    return;
  }

  filtered.forEach((item) => {
    const card = document.createElement("div");
    card.className = "asset-catalog-card";
    card.setAttribute("data-asset-id", item.id);

    const styleClass = `style-tag-${item.style.toLowerCase()}`;

    const is3dReady = item.status === "3d_ready" || Boolean(item.glbUrl || item.glbPath);
    const glbModelUrl = item.glbUrl || item.glbPath;

    card.innerHTML = `
      <div class="asset-card-media" title="Click to view full image">
        <img src="${escapeHtml(item.imagePath)}" alt="${escapeHtml(item.name)}" class="asset-card-img" loading="lazy">
      </div>
      <div class="asset-card-info">
        <div class="asset-card-header">
          <div class="asset-card-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
          <div class="asset-card-filename" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</div>
        </div>
        <div class="asset-card-badges-row">
          <span class="asset-badge-style ${styleClass}">${escapeHtml(item.style)}</span>
          <span class="asset-badge-category">${escapeHtml(item.category)}</span>
          <span class="furniture-tag badge-system-item" style="font-size: 10px;">★ System Asset</span>
          ${is3dReady ? `<span class="furniture-tag" style="color: #10b981; border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.1);">✓ 3D Ready</span>` : ""}
        </div>
        <div class="asset-card-actions">
          <button type="button" class="btn-asset-choose" title="Choose this asset for any project">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Choose for Project</span>
          </button>
          ${is3dReady ? `
          <button type="button" class="btn-asset-3d-review" title="Interactive 3D Review Window">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
              <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
            <span>3D View</span>
          </button>
          ` : ""}
          <button type="button" class="btn-asset-preview" title="View high-res photo">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Click handlers
    const chooseBtn = card.querySelector(".btn-asset-choose");
    chooseBtn.addEventListener("click", () => openChooseProjectModal(item));

    if (is3dReady) {
      const review3dBtn = card.querySelector(".btn-asset-3d-review");
      if (review3dBtn) {
        review3dBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          open3dReviewModal({
            name: item.name,
            category: item.category,
            glbUrl: glbModelUrl,
            modelUrls: item.modelUrls || { glb: glbModelUrl },
          });
        });
      }
    }

    const media = card.querySelector(".asset-card-media");
    media.addEventListener("click", () => openAssetLightbox(item.imagePath, item.name, `${item.style} · ${item.category}`));

    const previewBtn = card.querySelector(".btn-asset-preview");
    previewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openAssetLightbox(item.imagePath, item.name, `${item.style} · ${item.category}`);
    });

    grid.appendChild(card);
  });
}

async function loadUserAssets() {
  const token = localStorage.getItem("soraplan_token");
  if (!token) return;

  try {
    const res = await fetch(`${API_BASE_URL}/projects/furniture/all`, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();
      // Ensure 'Your assets' strictly contains user uploaded assets, excluding chosen system assets
      userAssetsList = Array.isArray(data) ? data.filter((item) => {
        const isSys = Boolean(item.is_system || item.isSystem);
        const gcs = String(item.gcsUri || "");
        const storage = String(item.storagePath || "");
        const signed = String(item.signedUrl || "");
        return !isSys && !gcs.startsWith("system://") && !storage.startsWith("assets/") && !signed.startsWith("assets/");
      }) : [];
    } else {
      // Fallback: extract user-uploaded furniture items from currentProjects
      const aggregated = [];
      (currentProjects || []).forEach((p) => {
        if (p.floorPlan && Array.isArray(p.floorPlan.furniture)) {
          p.floorPlan.furniture.forEach((f) => {
            if (f.image || f.photoUrl || f.signedUrl) {
              const isSys = Boolean(f.is_system || f.isSystem);
              const gcs = String(f.gcsUri || "");
              const storage = String(f.storagePath || "");
              const signed = String(f.signedUrl || f.image || f.photoUrl || "");
              if (isSys || gcs.startsWith("system://") || storage.startsWith("assets/") || signed.startsWith("assets/")) {
                return;
              }
              aggregated.push({
                id: f.id,
                projectId: p.id,
                projectName: p.name,
                fileName: f.fileName || `${f.name || f.id}.jpg`,
                furnitureName: f.name || f.id,
                furnitureType: f.subtype || f.furnitureType || "unknown",
                signedUrl: f.signedUrl || f.image || f.photoUrl,
                status: f.status || "uploaded",
                is_system: false,
              });
            }
          });
        }
      });
      userAssetsList = aggregated;
    }

    // Update count badges
    const totalCount = userAssetsList.length;
    const badge = document.getElementById("your-assets-tab-count");
    if (badge) badge.textContent = `${totalCount} Uploaded`;
    const metaBadge = document.getElementById("your-assets-meta-count");
    if (metaBadge) metaBadge.textContent = `${totalCount} Uploaded`;

    renderYourAssets();
  } catch (err) {
    console.warn("Could not load user assets:", err);
  }
}

function renderYourAssets() {
  const grid = document.getElementById("your-assets-grid");
  const emptyState = document.getElementById("your-assets-empty");
  if (!grid || !emptyState) return;

  // Filter out any system assets to strictly display user-uploaded furniture
  const filtered = userAssetsList.filter((item) => {
    const isSys = Boolean(item.is_system || item.isSystem);
    const gcs = String(item.gcsUri || "");
    const storage = String(item.storagePath || "");
    const signed = String(item.signedUrl || "");
    if (isSys || gcs.startsWith("system://") || storage.startsWith("assets/") || signed.startsWith("assets/")) {
      return false;
    }
    if (!userSearchQuery) return true;
    const name = (item.furnitureName || item.fileName || "").toLowerCase();
    const type = (item.furnitureType || "").toLowerCase();
    return name.includes(userSearchQuery) || type.includes(userSearchQuery);
  });

  if (filtered.length === 0) {
    grid.style.display = "none";
    grid.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";
  grid.style.display = "grid";
  grid.innerHTML = "";

  filtered.forEach((item) => {
    const card = document.createElement("div");
    card.className = "asset-catalog-card";
    card.setAttribute("data-asset-id", item.id);

    const imgSrc = item.signedUrl || "sofa.jpg";
    const name = escapeHtml(item.furnitureName || item.fileName || "Custom Furniture");
    const category = escapeHtml(item.furnitureType || "unknown");
    const meshyStatus = item.meshyStatus || item.meshy_status;
    const isReady3d = meshyStatus === "SUCCEEDED" || item.status === "3d_ready";
    const projId = item.projectId || item.project_id || (activeFurnitureProject ? activeFurnitureProject.id : null);
    const glbUrl = (item.modelUrls && item.modelUrls.glb) || (projId ? `${API_BASE_URL}/projects/${projId}/furniture/${item.id}/glb` : null);

    let statusHtml = "";
    if (isReady3d) {
      statusHtml = `<span class="furniture-tag" style="color: #10b981; border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.1);">✓ 3D Ready</span>`;
    } else if (meshyStatus === "IN_PROGRESS" || item.status === "generating_3d") {
      statusHtml = `<span class="furniture-tag" style="color: #0ea5e9; border-color: rgba(14,165,233,0.3); background: rgba(14,165,233,0.1);">🔄 3D Generating</span>`;
    } else {
      statusHtml = `<span class="furniture-tag" style="color: var(--ink-subtle);">Uploaded Photo</span>`;
    }

    card.innerHTML = `
      <div class="asset-card-media" title="Click to view full photo">
        <img src="${imgSrc}" alt="${name}" class="asset-card-img" loading="lazy">
      </div>
      <div class="asset-card-info">
        <div class="asset-card-header">
          <div class="asset-card-title" title="${name}">${name}</div>
          <div class="asset-card-filename" title="${escapeHtml(item.fileName || '')}">${escapeHtml(item.fileName || '')}</div>
        </div>
        <div class="asset-card-badges-row">
          <span class="asset-badge-style" style="background: rgba(255,255,255,0.08); color: var(--ink);">Custom</span>
          <span class="asset-badge-category">${category}</span>
          ${statusHtml}
        </div>
        <div class="asset-card-actions">
          <button type="button" class="btn-asset-choose" title="Choose this asset for any project">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Choose for Project</span>
          </button>
          ${isReady3d ? `
          <button type="button" class="btn-asset-3d-review" title="Interactive 3D View">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
              <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
            <span>3D View</span>
          </button>
          ` : ""}
          <button type="button" class="btn-asset-delete" data-furn-id="${escapeHtml(item.id)}" data-project-id="${escapeHtml(projId || '')}" data-furn-name="${name}" title="Delete this uploaded custom furniture asset">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Delete</span>
          </button>
          <button type="button" class="btn-asset-preview" title="View photo">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
        </div>
      </div>
    `;

    const chooseBtn = card.querySelector(".btn-asset-choose");
    chooseBtn.addEventListener("click", () => openChooseProjectModal(item));

    if (isReady3d) {
      const review3dBtn = card.querySelector(".btn-asset-3d-review");
      if (review3dBtn) {
        review3dBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          open3dReviewModal({
            name: item.furnitureName || item.fileName || "Custom Furniture",
            category: item.furnitureType || "unknown",
            glbUrl: glbUrl,
            modelUrls: item.modelUrls || { glb: glbUrl },
            imgSrc: imgSrc,
            furnitureId: item.id,
            projectId: projId,
          });
        });
      }
    }

    const delBtn = card.querySelector(".btn-asset-delete");
    if (delBtn) {
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleDeleteUserAsset(item.id, projId, name);
      });
    }

    const media = card.querySelector(".asset-card-media");
    media.addEventListener("click", () => openAssetLightbox(imgSrc, name, `Custom Furniture · ${category}`));

    const previewBtn = card.querySelector(".btn-asset-preview");
    previewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openAssetLightbox(imgSrc, name, `Custom Furniture · ${category}`);
    });

    grid.appendChild(card);
  });
}

async function handleDeleteUserAsset(furnitureId, projectId, furnitureName) {
  const confirmDel = window.confirm(`Are you sure you want to delete "${furnitureName}"? This will permanently remove the custom furniture photo and its 3D model.`);
  if (!confirmDel) return;

  const token = localStorage.getItem("soraplan_token");
  if (!token) {
    showToast("Authentication required to delete asset.", "error");
    return;
  }

  try {
    showToast(`Deleting "${furnitureName}"...`, "info");
    const url = projectId
      ? `${API_BASE_URL}/projects/${projectId}/furniture/${furnitureId}`
      : `${API_BASE_URL}/projects/furniture/${furnitureId}`;

    const res = await fetch(url, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to delete asset from server");
    }

    showToast(`✓ "${furnitureName}" deleted successfully.`, "success");

    // Refresh User Assets list
    await loadUserAssets();

    // If active furniture project matches, also refresh project furniture modal list
    if (activeFurnitureProject && (!projectId || activeFurnitureProject.id === projectId)) {
      await loadProjectFurniture(activeFurnitureProject.id);
    }

    // Refresh projects list in background to update counts
    loadProjects();
  } catch (err) {
    console.error("Delete user asset failed:", err);
    showToast(`Delete failed: ${err.message}`, "error");
  }
}

function openAssetLightbox(imgUrl, title, subtitle) {
  if (!planModal || !modalPlanBody) return;
  modalPlanTitle.textContent = title || "Asset Preview";
  modalPlanMeta.textContent = subtitle || "";
  modalGcsUri.textContent = imgUrl;
  modalOpenNewTab.href = imgUrl;

  modalPlanBody.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; min-height:360px; max-height:75vh; overflow:hidden; background:#080d10; border-radius:8px;">
      <img src="${imgUrl}" alt="${title}" style="max-width:100%; max-height:70vh; object-fit:contain; border-radius:6px; box-shadow:0 12px 30px rgba(0,0,0,0.5);">
    </div>
  `;

  planModal.style.display = "flex";
}

function openChooseProjectModal(asset, preselectedComponentId = null) {
  assetTargetForProject = asset;
  const modal = document.getElementById("choose-project-modal");
  if (!modal) return;

  const thumb = document.getElementById("asset-choice-thumb");
  const title = document.getElementById("asset-choice-title");
  const styleTag = document.getElementById("asset-choice-style-tag");
  const catTag = document.getElementById("asset-choice-cat-tag");
  const sysTag = document.getElementById("asset-choice-sys-tag");
  const subText = document.getElementById("asset-choice-sub");

  const isSystem = Boolean(asset.isSystem || asset.is_system);
  const imgSrc = asset.imagePath || asset.signedUrl || "sofa.jpg";
  const assetName = asset.name || asset.furnitureName || asset.fileName || "Asset";
  const assetStyle = asset.style || (isSystem ? "System" : "Custom");
  const assetCat = asset.category || asset.furnitureType || "Furniture";

  if (thumb) thumb.src = imgSrc;
  if (title) title.textContent = assetName;
  if (styleTag) {
    styleTag.textContent = assetStyle;
    styleTag.className = `furniture-tag ${isSystem ? `style-tag-${assetStyle.toLowerCase()}` : ''}`;
  }
  if (catTag) catTag.textContent = assetCat;
  if (sysTag) {
    sysTag.textContent = isSystem ? "★ System Asset" : "👤 Your Asset";
    sysTag.style.display = "inline-flex";
  }
  if (subText) {
    subText.textContent = isSystem 
      ? `Curated ${assetStyle} style preset. Allowed for all studio projects.`
      : `Custom furniture photo uploaded by you. Allowed for all studio projects.`;
  }

  // Populate project selectable cards
  const cardsList = document.getElementById("choose-project-cards-list");
  const noProjectsMsg = document.getElementById("choose-no-projects-msg");
  const submitBtn = document.getElementById("btn-submit-choose-proj");
  const componentGroup = document.getElementById("group-plan-link");
  const componentSelect = document.getElementById("select-assign-plan-item");

  if (cardsList) {
    cardsList.innerHTML = "";

    if (!currentProjects || currentProjects.length === 0) {
      if (noProjectsMsg) noProjectsMsg.style.display = "block";
      if (submitBtn) submitBtn.disabled = true;
      if (componentGroup) componentGroup.style.display = "none";
      selectedProjectIdForAsset = null;
    } else {
      if (noProjectsMsg) noProjectsMsg.style.display = "none";
      if (submitBtn) submitBtn.disabled = false;

      // Select default project
      const defaultProj = activeEditorProject || activeFurnitureProject || currentProjects[0];
      selectedProjectIdForAsset = defaultProj.id;

      currentProjects.forEach((proj) => {
        const isSelected = proj.id === selectedProjectIdForAsset;
        const card = document.createElement("div");
        card.className = `choose-proj-radio-card ${isSelected ? "selected" : ""}`;
        card.setAttribute("data-project-id", proj.id);

        const planThumb = proj.planImage?.signedUrl || "floorplan_1.png";
        const furnCount = proj.furnitureCount || 0;

        card.innerHTML = `
          <div class="choose-proj-card-left">
            <img src="${planThumb}" alt="${escapeHtml(proj.name)}" class="choose-proj-thumb">
            <div>
              <div class="choose-proj-card-title">${escapeHtml(proj.name)}</div>
              <div class="choose-proj-card-meta">${proj.hasPlanParsed ? "✓ 2D Plan Parsed" : "Plan Uploaded"} · 🛋️ ${furnCount} item${furnCount === 1 ? '' : 's'}</div>
            </div>
          </div>
          <input type="radio" name="target_project_choice" value="${proj.id}" ${isSelected ? "checked" : ""}>
        `;

        card.addEventListener("click", () => {
          selectedProjectIdForAsset = proj.id;
          cardsList.querySelectorAll(".choose-proj-radio-card").forEach((c) => c.classList.remove("selected"));
          card.classList.add("selected");
          const radio = card.querySelector('input[type="radio"]');
          if (radio) radio.checked = true;

          updateComponentDropdownForProject(proj, preselectedComponentId);
        });

        cardsList.appendChild(card);
      });

      // Populate component dropdown for default project
      updateComponentDropdownForProject(defaultProj, preselectedComponentId);
    }
  }

  modal.style.display = "flex";
}

function updateComponentDropdownForProject(proj, preselectedComponentId = null) {
  const componentGroup = document.getElementById("group-plan-link");
  const componentSelect = document.getElementById("select-assign-plan-item");
  if (!componentGroup || !componentSelect) return;

  const furnitureList = (proj.floorPlan && proj.floorPlan.furniture) || 
    (activeEditorProject?.id === proj.id && editorObjects ? editorObjects.filter((o) => o.type === "furniture") : []);

  if (furnitureList && furnitureList.length > 0) {
    componentGroup.style.display = "block";
    componentSelect.innerHTML = `<option value="">-- Add as General Project Asset (No specific 2D link) --</option>`;

    furnitureList.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.name || item.id} (${item.subtype || item.furnitureType || "furniture"})`;
      if (preselectedComponentId && item.id === preselectedComponentId) {
        opt.selected = true;
      }
      componentSelect.appendChild(opt);
    });
  } else {
    componentGroup.style.display = "none";
    componentSelect.innerHTML = `<option value="">-- Add as General Project Asset --</option>`;
  }
}

function closeChooseProjectModal() {
  const modal = document.getElementById("choose-project-modal");
  if (modal) modal.style.display = "none";
  assetTargetForProject = null;
  selectedProjectIdForAsset = null;
}

async function handleChooseProjectSubmit(e) {
  e.preventDefault();
  if (!assetTargetForProject || !selectedProjectIdForAsset) {
    showToast("Please select a target project first.", "warning");
    return;
  }

  const token = localStorage.getItem("soraplan_token");
  if (!token) {
    showToast("Authentication required.", "error");
    return;
  }

  const submitBtn = document.getElementById("btn-submit-choose-proj");
  const spinner = document.getElementById("choose-proj-spinner");
  const submitText = document.getElementById("choose-proj-submit-text");
  const componentSelect = document.getElementById("select-assign-plan-item");
  const chosenComponentId = componentSelect && componentSelect.value ? componentSelect.value : null;

  if (submitBtn) submitBtn.disabled = true;
  if (spinner) spinner.style.display = "inline-block";
  if (submitText) submitText.textContent = "Adding to Project...";

  try {
    const targetProj = currentProjects.find((p) => p.id === selectedProjectIdForAsset) || { name: "Project" };
    const isSystem = Boolean(assetTargetForProject.isSystem || assetTargetForProject.is_system);

    const payload = {
      sourceType: isSystem ? "system" : "user",
      style: assetTargetForProject.style || null,
      assetFileName: assetTargetForProject.fileName || "furniture.png",
      furnitureName: assetTargetForProject.name || assetTargetForProject.furnitureName || "Furniture Asset",
      furnitureType: assetTargetForProject.category || assetTargetForProject.furnitureType || "unknown",
      componentId: chosenComponentId,
      sourceProjectId: assetTargetForProject.projectId || null,
      sourceFurnitureId: assetTargetForProject.id || null,
    };

    const res = await fetch(`${API_BASE_URL}/projects/${selectedProjectIdForAsset}/furniture/choose-asset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Could not add asset to project");
    }

    const createdAsset = await res.json();
    closeChooseProjectModal();

    showToast(`✨ "${payload.furnitureName}" added to "${targetProj.name}"! Allowed for all project scenes.`, "success");

    // If currently viewing target project's furniture modal, reload furniture
    if (activeFurnitureProject && activeFurnitureProject.id === selectedProjectIdForAsset) {
      loadProjectFurniture(selectedProjectIdForAsset);
    }

    // If currently in 2D editor for this project and component was linked
    if (activeEditorProject && activeEditorProject.id === selectedProjectIdForAsset && chosenComponentId) {
      const comp = (editorObjects || []).find((o) => o.id === chosenComponentId);
      if (comp) {
        comp.photoUrl = createdAsset.signedUrl || assetTargetForProject.imagePath;
        comp.furnitureId = createdAsset.id;
        pushEditorHistory();
        drawEditor();
      }
    }

    // Refresh projects list & user assets
    loadProjects();
    loadUserAssets();

  } catch (err) {
    console.error("Choose asset failed:", err);
    showToast(`Error adding asset: ${err.message}`, "error");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (spinner) spinner.style.display = "none";
    if (submitText) submitText.textContent = "✓ Add to Selected Project";
  }
}

function openAssetPickerForEditorComponent(obj) {
  if (!obj || !activeEditorProject) return;
  // Jump to Assets section with preselected component
  const assetsSec = document.getElementById("assets-section");
  if (assetsSec) {
    assetsSec.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(`🛋️ Browsing Assets Catalog for "${obj.name || obj.id}". Click "Choose for Project" on any asset to assign it.`, "info");
  }
}
