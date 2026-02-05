const App = (function (document, supabase, htmx, FullCalendar) {
  let supabaseClient;
  let authToken = null;
  let refreshToken = null;

  let calendar;

  const _getAuthToken = () => {
    return authToken || localStorage.getItem('authToken');
  };

  const _setTokens = (token, refresh) => {
    authToken = token;
    refreshToken = refresh;
    localStorage.setItem('authToken', token);
    localStorage.setItem('refreshToken', refresh);
  };

  const _clearTokens = () => {
    authToken = null;
    refreshToken = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
  };

  const _getRefreshToken = () => {
    return refreshToken || localStorage.getItem('refreshToken');
  };

  const _displayNotification = (alertType, message) => {
    const messageContainer = document.getElementById('alerts');
    messageContainer.innerHTML = `<div class="notification is-${alertType}">${message}</div>`;
  }

  const _displayError = (message) => {
    _displayNotification('danger', message);
  }

  function _toggleFormLoading(form, isLoading) {
    if (!form) return;
    // Overlay for whole form
    form.classList.toggle('has-form-overlay', !!isLoading);
    let overlay = form.querySelector('.form-loading-overlay');
    if (isLoading) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'form-loading-overlay';
        const spinner = document.createElement('div');
        spinner.className = 'form-loading-spinner';
        overlay.appendChild(spinner);
        form.appendChild(overlay);
      }
    } else if (overlay) {
      overlay.remove();
    }

    // Bulma loading indicators
    const submitButton = form.querySelector('button[type="submit"]');
    const controls = form.querySelectorAll('input, button, select, textarea');
    const bulmaControls = form.querySelectorAll('.control');
    if (submitButton) {
      if (isLoading) {
        submitButton.classList.add('is-loading');
      } else {
        submitButton.classList.remove('is-loading');
      }
    }
    bulmaControls.forEach((el) => {
      if (isLoading) {
        el.classList.add('is-loading');
      } else {
        el.classList.remove('is-loading');
      }
    });
    controls.forEach((el) => {
      if (isLoading) {
        el.setAttribute('disabled', 'disabled');
      } else {
        el.removeAttribute('disabled');
      }
    });
    form.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  }

  const _safeParseJson = (value) => {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  };

  const _normalizeCropData = (data, imageData) => {
    if (!data || !imageData || !imageData.naturalWidth || !imageData.naturalHeight) return null;
    const naturalWidth = imageData.naturalWidth;
    const naturalHeight = imageData.naturalHeight;
    if (!naturalWidth || !naturalHeight) return null;
    return {
      x: data.x / naturalWidth,
      y: data.y / naturalHeight,
      width: data.width / naturalWidth,
      height: data.height / naturalHeight,
      naturalWidth,
      naturalHeight
    };
  };

  const _applyCropToElement = (el, src, crop) => {
    if (!el) return;
    const isPreview = el.classList.contains('profile-image-editor__preview');
    const isRenderedImage = el.hasAttribute('data-cropped-image');
    if (!src) {
      el.style.backgroundImage = '';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      if (!isPreview) {
        el.style.removeProperty('aspect-ratio');
      }
      return;
    }
    el.style.backgroundImage = `url(${src})`;
    const width = crop?.width;
    const height = crop?.height;
    const x = crop?.x || 0;
    const y = crop?.y || 0;
    if (width && height) {
      const sizeX = `${(100 / width).toFixed(4)}%`;
      const sizeY = `${(100 / height).toFixed(4)}%`;
      const posX = `${(-x / width * 100).toFixed(4)}%`;
      const posY = `${(-y / height * 100).toFixed(4)}%`;
      el.style.backgroundSize = `${sizeX} ${sizeY}`;
      el.style.backgroundPosition = `${posX} ${posY}`;
      // Don't override aspect-ratio for preview - let CSS handle it
      // For rendered images, always use 4:3 aspect ratio
      if (!isPreview) {
        if (isRenderedImage) {
          el.style.aspectRatio = '4 / 3';
        } else {
          el.style.aspectRatio = `${width} / ${height}`;
        }
      }
    } else {
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      if (!isPreview) {
        if (isRenderedImage) {
          el.style.aspectRatio = '4 / 3';
        } else {
          el.style.removeProperty('aspect-ratio');
        }
      }
    }
  };

  const _applySavedCrops = (root) => {
    const container = root || document;
    container.querySelectorAll('[data-cropped-image]').forEach((el) => {
      const src = el.getAttribute('data-image-src');
      if (!src) return;
      const crop = {
        x: parseFloat(el.getAttribute('data-crop-x')) || 0,
        y: parseFloat(el.getAttribute('data-crop-y')) || 0,
        width: parseFloat(el.getAttribute('data-crop-width')) || 0,
        height: parseFloat(el.getAttribute('data-crop-height')) || 0,
      };
      const hasCrop = crop.width > 0 && crop.height > 0;
      _applyCropToElement(el, src, hasCrop ? crop : null);
    });
  };

  const _initImageCroppers = (root) => {
    const containerList = (root || document).querySelectorAll('[data-image-cropper]');
    if (!containerList.length || typeof Cropper === 'undefined') return;

    containerList.forEach((container) => {
      if (container.dataset.initialized === 'true') return;
      const img = container.querySelector('[data-cropper-image]');
      const preview = container.querySelector('[data-crop-preview]');
      const placeholder = container.querySelector('[data-crop-placeholder]');

      const imageSelector = container.dataset.imageInput || container.getAttribute('data-image-input');
      const cropSelector = container.dataset.cropInput || container.getAttribute('data-crop-input');
      const urlInput = imageSelector
        ? (container.querySelector(imageSelector) || (root || document).querySelector(imageSelector))
        : container.querySelector('input[name="image_url"]');
      const cropInput = cropSelector
        ? (container.querySelector(cropSelector) || (root || document).querySelector(cropSelector))
        : container.querySelector('input[name="image_crop"]');

      if (!img || !urlInput || !cropInput || !preview) return;

      container.dataset.initialized = 'true';

      let cropper;
      let currentUrl = null;
      const defaultPlaceholderText = placeholder ? placeholder.textContent : '';

      const syncPreview = () => {
        if (!img.getAttribute('src')) {
          cropInput.value = '';
          _applyCropToElement(preview, null, null);
          if (placeholder) placeholder.hidden = false;
          return;
        }
        if (cropper) {
          const data = cropper.getData();
          const imageData = cropper.getImageData();
          const normalized = _normalizeCropData(data, imageData);
          if (normalized) {
            cropInput.value = JSON.stringify(normalized);
            _applyCropToElement(preview, img.src, normalized);
          }
        } else {
          cropInput.value = '';
          _applyCropToElement(preview, img.src, null);
        }
      };

      const applySavedCrop = () => {
        const savedCrop = _safeParseJson(cropInput.value);
        if (cropper && savedCrop && savedCrop.width && savedCrop.height && savedCrop.naturalWidth && savedCrop.naturalHeight) {
          cropper.setData({
            x: savedCrop.x * savedCrop.naturalWidth,
            y: savedCrop.y * savedCrop.naturalHeight,
            width: savedCrop.width * savedCrop.naturalWidth,
            height: savedCrop.height * savedCrop.naturalHeight,
          });
        }
        syncPreview();
      };

      const destroyCropper = () => {
        if (cropper) {
          cropper.destroy();
          cropper = null;
        }
      };

      const handleUrlChange = (url) => {
        const nextUrl = (url || '').trim();
        if (nextUrl === currentUrl) return;
        currentUrl = nextUrl;
        destroyCropper();
        cropInput.value = '';
        if (!nextUrl) {
          img.removeAttribute('src');
          if (placeholder) {
            placeholder.hidden = false;
            placeholder.textContent = defaultPlaceholderText || placeholder.textContent;
          }
          _applyCropToElement(preview, null, null);
          return;
        }
        img.crossOrigin = 'anonymous';
        img.src = nextUrl;
        if (placeholder) placeholder.hidden = true;
      };

      img.addEventListener('load', () => {
        destroyCropper();
        if (placeholder) placeholder.hidden = true;
        cropper = new Cropper(img, {
          viewMode: 1,
          autoCropArea: 1,
          responsive: true,
          background: false,
          movable: true,
          zoomable: true,
          scalable: false,
          rotatable: false,
          aspectRatio: 4 / 3,
          cropBoxMovable: true,
          cropBoxResizable: true,
          dragMode: 'crop',
          ready() {
            if (placeholder) placeholder.hidden = true;
            applySavedCrop();
          },
          crop() {
            syncPreview();
          },
          zoom() {
            syncPreview();
          }
        });
      });

      img.addEventListener('error', () => {
        destroyCropper();
        _applyCropToElement(preview, null, null);
        cropInput.value = '';
        if (placeholder) {
          placeholder.hidden = false;
          placeholder.textContent = 'Unable to load image. Check the URL and try again.';
        }
      });

      urlInput.addEventListener('change', (event) => {
        handleUrlChange(event.target.value);
      });
      urlInput.addEventListener('input', (event) => {
        handleUrlChange(event.target.value);
      });

      if (urlInput.value) {
        handleUrlChange(urlInput.value);
      } else {
        syncPreview();
      }
    });
  };

  // Store ToastUI Editor instances for cleanup and form sync
  const toastUIEditors = new Map();

  const _initToastUIEditors = (root, retryCount = 0) => {
    const container = root || document;
    // ToastUI Editor can be exposed as Editor or toastui.Editor depending on CDN version
    // Wait for library to be available
    const EditorClass = (typeof Editor !== 'undefined') ? Editor : (typeof toastui !== 'undefined' && toastui.Editor) ? toastui.Editor : null;
    if (!EditorClass) {
      // If library not ready yet, retry after a short delay (max 10 retries = 1 second)
      if (retryCount < 10) {
        setTimeout(() => _initToastUIEditors(root, retryCount + 1), 100);
      } else {
        console.warn('ToastUI Editor library not available after retries');
      }
      return;
    }

    // Find all textareas with data-toast-editor attribute, or skip readonly ones
    const textareas = container.querySelectorAll('textarea[data-toast-editor]:not([readonly])');
    
    textareas.forEach((textarea) => {
      // Skip if already initialized - check both the dataset flag and if container exists
      if (textarea.dataset.toastEditorInitialized === 'true' || textarea.classList.contains('toast-editor-initialized')) {
        // Ensure textarea stays hidden
        textarea.style.setProperty('display', 'none', 'important');
        // Check if container exists and is still valid
        const existingContainer = textarea.nextElementSibling;
        if (existingContainer && existingContainer.classList.contains('toastui-editor-container')) {
          // Ensure container is visible
          existingContainer.style.setProperty('display', 'block', 'important');
          existingContainer.style.setProperty('visibility', 'visible', 'important');
        }
        return;
      }
      
      // Check if editor container already exists (might happen on re-initialization)
      const existingContainer = textarea.nextElementSibling;
      if (existingContainer && existingContainer.classList.contains('toastui-editor-container')) {
        // Check if container is still in DOM and has a valid parent
        if (!document.body.contains(existingContainer) || !textarea.parentNode) {
          // Container was removed, clean it up and reinitialize
          if (existingContainer._toastEditorObserver) {
            existingContainer._toastEditorObserver.disconnect();
          }
          existingContainer.remove();
        } else {
          // Container exists and is valid, ensure it's visible and mark textarea as initialized
          existingContainer.style.setProperty('display', 'block', 'important');
          existingContainer.style.setProperty('visibility', 'visible', 'important');
          existingContainer.style.setProperty('opacity', '1', 'important');
          textarea.style.setProperty('display', 'none', 'important');
          textarea.dataset.toastEditorInitialized = 'true';
          textarea.classList.add('toast-editor-initialized');
          return;
        }
      }
      
      // Skip if editor instance already exists
      const textareaId = textarea.id || textarea.name || `toast-editor-${Date.now()}-${Math.random()}`;
      if (toastUIEditors.has(textareaId)) {
        // Clean up existing instance if textarea was removed and re-added
        const existingEditor = toastUIEditors.get(textareaId);
        if (existingEditor) {
          try {
            // Check if editor's container still exists before destroying
            const editorEl = existingEditor.getRootElement ? existingEditor.getRootElement() : null;
            if (editorEl && document.body.contains(editorEl)) {
              if (existingEditor.destroy) {
                existingEditor.destroy();
              }
            }
          } catch (e) { 
            // Ignore errors during cleanup
          }
        }
        toastUIEditors.delete(textareaId);
      }

      try {
        // Get configuration from data attributes
        const height = textarea.getAttribute('data-editor-height') || '300px';
        const minHeight = textarea.getAttribute('data-editor-min-height') || '200px';
        const editType = textarea.getAttribute('data-editor-mode') || 'wysiwyg';
        const previewStyle = textarea.getAttribute('data-editor-preview') || 'vertical';
        
        // Get initial value from textarea
        const initialValue = textarea.value || '';

        // Create container div for editor
        const editorContainer = document.createElement('div');
        editorContainer.className = 'toastui-editor-container';
        editorContainer.setAttribute('data-toast-editor-wrapper', 'true');
        editorContainer.style.minHeight = minHeight;
        editorContainer.style.width = '100%';
        editorContainer.style.display = 'block';
        editorContainer.style.visibility = 'visible';
        editorContainer.style.opacity = '1';
        
        // Insert container after textarea (BEFORE hiding textarea)
        textarea.parentNode.insertBefore(editorContainer, textarea.nextSibling);
        
        // Add a MutationObserver to prevent the container from being hidden
        // Only observe the container itself, not the body, to avoid conflicts
        const observer = new MutationObserver((mutations) => {
          // Check if container still exists in DOM before manipulating
          if (!document.body.contains(editorContainer) || !textarea.parentNode) {
            observer.disconnect();
            return;
          }
          
          mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
              // Verify container is still in DOM before checking styles
              if (!document.body.contains(editorContainer)) {
                observer.disconnect();
                return;
              }
              const display = window.getComputedStyle(editorContainer).display;
              const visibility = window.getComputedStyle(editorContainer).visibility;
              if (display === 'none' || visibility === 'hidden') {
                // Only restore if container is still in DOM
                if (document.body.contains(editorContainer)) {
                  editorContainer.style.setProperty('display', 'block', 'important');
                  editorContainer.style.setProperty('visibility', 'visible', 'important');
                }
              }
            }
          });
        });
        observer.observe(editorContainer, { attributes: true, attributeFilter: ['style', 'class'] });
        
        // Store observer reference for cleanup if needed
        editorContainer._toastEditorObserver = observer;

        // Initialize ToastUI Editor in the container
        const editor = new EditorClass({
          el: editorContainer,
          height: height,
          initialEditType: editType,
          previewStyle: previewStyle,
          initialValue: initialValue,
          usageStatistics: false
        });

        // Verify editor was created successfully (check for editor instance and container content)
        if (!editor) {
          throw new Error('ToastUI Editor instance not created');
        }
        
        // Wait a tiny bit for editor to render, then verify
        setTimeout(() => {
          // Check if editor has rendered content (various possible class names)
          const hasEditorContent = editorContainer.children.length > 0 || 
                                   editorContainer.querySelector('.toastui-editor') ||
                                   editorContainer.querySelector('[class*="toastui"]') ||
                                   editorContainer.innerHTML.trim().length > 0;
          
          if (!hasEditorContent) {
            console.warn('ToastUI Editor container appears empty after initialization');
            // Don't throw - let it continue, might still work
          }
        }, 50);

        // Store editor instance
        toastUIEditors.set(textareaId, editor);
        textarea.dataset.toastEditorId = textareaId;
        
        // Ensure editor container is visible immediately
        editorContainer.style.setProperty('display', 'block', 'important');
        editorContainer.style.setProperty('visibility', 'visible', 'important');
        editorContainer.style.setProperty('opacity', '1', 'important');
        
        // NOW hide the original textarea after editor is created
        textarea.style.setProperty('display', 'none', 'important');
        textarea.style.setProperty('visibility', 'hidden', 'important');
        textarea.style.setProperty('position', 'absolute', 'important');
        textarea.style.setProperty('left', '-9999px', 'important');
        textarea.setAttribute('aria-hidden', 'true');
        textarea.dataset.toastEditorInitialized = 'true';
        textarea.classList.add('toast-editor-initialized');

        // Sync editor content to textarea on change
        editor.on('change', () => {
          const markdown = editor.getMarkdown();
          textarea.value = markdown;
          // Trigger input event for HTMX and other listeners
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        });

        // Also sync on blur for safety
        editor.on('blur', () => {
          const markdown = editor.getMarkdown();
          textarea.value = markdown;
        });

      } catch (e) {
        console.error('ToastUI Editor init error:', e);
        // If editor fails, show textarea again and remove initialization flag
        textarea.style.display = '';
        textarea.dataset.toastEditorInitialized = 'false';
        textarea.classList.remove('toast-editor-initialized');
      }
    });
  };

  const _syncToastUIEditorsToTextareas = (form) => {
    if (!form) return;
    
    // Find all textareas with editors in this form
    const textareas = form.querySelectorAll('textarea[data-toast-editor]');
    textareas.forEach((textarea) => {
      const editorId = textarea.dataset.toastEditorId;
      if (editorId && toastUIEditors.has(editorId)) {
        const editor = toastUIEditors.get(editorId);
        if (editor && editor.getMarkdown) {
          try {
            const markdown = editor.getMarkdown();
            textarea.value = markdown;
          } catch (e) {
            console.error('Error syncing ToastUI Editor:', e);
          }
        }
      }
    });
  };

  // Handle form submissions - sync editors before submit
  const _setupFormSync = () => {
    document.body.addEventListener('submit', function(event) {
      const form = event.target;
      if (form && form.tagName === 'FORM') {
        _syncToastUIEditorsToTextareas(form);
      }
    }, true); // Use capture phase to run before HTMX

    // Also sync before HTMX requests
    document.body.addEventListener('htmx:configRequest', function(event) {
      const form = event.detail.elt;
      if (form && form.tagName === 'FORM') {
        _syncToastUIEditorsToTextareas(form);
      }
    });
  };

  function init(supabaseUrl, supabaseKey) {
    document.addEventListener("DOMContentLoaded", async function () {
      // System message visibility control
      (function () {
        const banner = document.getElementById('system-banner');
        if (!banner) return;
        const dismissedKey = 'dismissedSystemMessageId';
        const id = banner.getAttribute('data-id');
        const dismissedId = localStorage.getItem(dismissedKey);
        if (dismissedId === id) {
          banner.remove();
        }
      })();
      // initialize supabase client
      supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
      supabaseClient.auth.onAuthStateChange(_handleAuthStateChange);

      // add auth token to htmx requests
      document.body.addEventListener("htmx:configRequest", function (event) {
        const authToken = _getAuthToken();
        const refreshToken = _getRefreshToken();
        if (authToken && refreshToken) {
          event.detail.headers["Authorization"] = `Bearer ${authToken}`;
          event.detail.headers["Refresh-Token"] = refreshToken;
        }
      });

      // handle htmx errors
      document.body.addEventListener("htmx:responseError", function (event) {
        _displayError(event.detail.xhr.response);
      });

      document.addEventListener('htmx:afterRequest', function (evt) {
        if (!_getAuthToken()) return;
        const pathInfo = evt.detail && evt.detail.pathInfo;
        if (!pathInfo || pathInfo.finalRequestPath !== '/') return;
        renderCalendar();
      });

      // Add handler for htmx:afterSettle
      document.body.addEventListener('htmx:afterSettle', function(event) {
        const xhr = event.detail && event.detail.xhr;
        if (!xhr) return;
        const authOptional = xhr.getResponseHeader('X-Auth-Optional') === 'true';
        if (authOptional) {
          document.body.setAttribute('data-auth-optional', 'true');
        } else {
          document.body.setAttribute('data-auth-optional', 'false');
        }
      });

      const _initTooltips = (root) => {
        const container = root || document;
        if (typeof tippy !== 'function') return;
        const els = container.querySelectorAll('[data-tooltip-markdown]');
        els.forEach((el) => {
          try {
            if (el._tippy) return;
            const ref = el.getAttribute('data-tooltip-markdown');
            let contentEl = null;
            if (ref) {
              if (ref.startsWith('#')) {
                const id = ref.slice(1);
                contentEl = document.getElementById(id) || (container.getElementById ? container.getElementById(id) : null);
              }
              if (!contentEl) {
                try { contentEl = container.querySelector(ref) || document.querySelector(ref); } catch (_) { /* ignore */ }
              }
            }
            if (!contentEl && el.nextElementSibling && el.nextElementSibling.classList && el.nextElementSibling.classList.contains('tooltip-markdown')) {
              contentEl = el.nextElementSibling;
            }
            if (!contentEl) return;
            tippy(el, {
              theme: 'light-border',
              allowHTML: true,
              interactive: true,
              maxWidth: 350,
              content: contentEl.innerHTML,
              placement: 'top',
              appendTo: () => document.body,
            });
          } catch (e) { /* noop per element */ }
        });
      };

      const _initSearchableSelects = (root) => {
        const container = root || document;
        if (typeof TomSelect !== 'function') return;
        const els = container.querySelectorAll('[data-searchable-select]');
        els.forEach((el) => {
          try {
            // Skip if already initialized
            if (el.tomselect) return;
            new TomSelect(el, {
              create: false,
              maxOptions: null,
              placeholder: 'Type to search...',
              allowEmptyOption: false,
              dropdownParent: 'body',
              controlInput: '<input type="text" autocomplete="off" size="1" />',
              render: {
                optgroup_header: function(data, escape) {
                  return '<div class="optgroup-header">' + escape(data.label) + '</div>';
                }
              }
            });
          } catch (e) { console.error('Tom Select init error:', e); }
        });
      };

      document.body.addEventListener('htmx:afterSwap', function(evt) {
        // Handle character search results visibility
        const targetEl = evt.detail && evt.detail.target;
        if (targetEl && targetEl.id === 'characterSearchResults') {
          targetEl.classList.remove('is-hidden');
          setTimeout(() => {
            targetEl.classList.add('is-hidden');
          }, 10000);
        }
        // Initialize tooltips after swaps (for boosted navs and partial swaps)
        _initTooltips(targetEl || document);
        // Initialize searchable selects after swaps
        _initSearchableSelects(targetEl || document);
        // Initialize profile image cropper when swapping in profile form
        _initImageCroppers(targetEl || document);
        // Apply saved crop styles on swapped content
        _applySavedCrops(targetEl || document);
        // Initialize ToastUI editors after swaps
        // Use a delay to ensure DOM is fully settled after swap and auth redirects
        setTimeout(() => {
          _initToastUIEditors(targetEl || document);
        }, 150);
      });

      // Global keydown handler for closing modals on Escape
      document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
          const activeModal = document.querySelector('.modal.is-active');
          if (activeModal) {
            App.closeModal('#' + activeModal.id);
          }
          // Also close any open dropdowns
          document.querySelectorAll('.dropdown.is-active').forEach(function(dropdown) {
            dropdown.classList.remove('is-active');
          });
        }
      });

      // Global click handler for closing dropdowns when clicking outside
      document.addEventListener('click', function(event) {
        const dropdowns = document.querySelectorAll('.dropdown.is-active');
        dropdowns.forEach(function(dropdown) {
          if (!dropdown.contains(event.target)) {
            dropdown.classList.remove('is-active');
          }
        });
      });

      // Setup form sync for ToastUI editors
      _setupFormSync();

      // trigger initial session handling immediately
      const { data: { session } } = await supabaseClient.auth.getSession();
      await _handleAuthStateChange('INITIAL_SESSION', session);

      // Initialize UI components after auth check completes
      // Use a function that can be called after HTMX swaps
      const initializeUIComponents = (root = document) => {
        // Initialize any tooltips present
        _initTooltips(root);
        // Initialize any searchable selects present
        _initSearchableSelects(root);
        // Initialize any image croppers if present
        _initImageCroppers(root);
        // Apply any persisted crop marks
        _applySavedCrops(root);
        // Initialize any ToastUI editors present
        // Use a small delay to ensure ToastUI Editor library is fully loaded
        setTimeout(() => {
          _initToastUIEditors(root);
        }, 100);
      };

      // Initialize on initial load (after auth check)
      initializeUIComponents();
    });
  }

  function redirectTo(url) {
    const token = _getAuthToken();
    const refresh = _getRefreshToken();
    const headers = { 'redirect-to': url };
    if (token && refresh) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['Refresh-Token'] = refresh;
    }
    // Use swap: 'outerHTML' to ensure proper body replacement
    htmx.ajax('GET', url, { target: 'body', swap: 'outerHTML', headers });
  }

  function getRedirectUrl() {
    const url = new URL(window.location.href);
    return url.searchParams.get('r');
  }

  function getReturnUrl() {
    let returnUrl = getRedirectUrl();
    if (returnUrl && (returnUrl.startsWith('/auth') || returnUrl === '/')) {
      returnUrl = null;
    }
    return returnUrl ? `/auth?r=${encodeURIComponent(returnUrl)}` : '/auth';
  }

  async function _handleAuthStateChange(event, session) {
    if (event === 'INITIAL_SESSION') {
      // Handle initial session deterministically
      if (session) {
        if (_getAuthToken() !== session.access_token) {
          _setTokens(session.access_token, session.refresh_token);
        }
        const onAuthPage = window.location.pathname.startsWith('/auth');
        const redirectParam = getRedirectUrl();
        await _syncDiscordToProfile();
        // Only redirect if we're on an auth page or an explicit return URL is present
        if (onAuthPage) {
          redirectTo(redirectParam || '/');
        } else if (redirectParam) {
          redirectTo(redirectParam);
        } else {
          // Refresh the current page with auth headers so server can render authed view
          const current = window.location.pathname + window.location.search;
          // Use a small delay to ensure any editors are initialized first, then redirect
          setTimeout(() => {
            redirectTo(current);
          }, 100);
        }
      } else {
        _clearTokens();

        const authOptional = document.body.getAttribute('data-auth-optional') === 'true';
        if (!authOptional) {
          let returnUrl = getReturnUrl();
          await _syncDiscordToProfile();
          redirectTo(returnUrl);
        }
      }
    } else if (event === 'SIGNED_IN') {
      // handle sign in event
      if (session && _getAuthToken() !== session.access_token) {
        _setTokens(session.access_token, session.refresh_token);
        await _syncDiscordToProfile();
        const onAuthPage = window.location.pathname.startsWith('/auth');
        const redirectParam = getRedirectUrl();
        if (onAuthPage) {
          redirectTo(redirectParam || '/');
        } else if (redirectParam) {
          redirectTo(redirectParam);
        } else {
          const current = window.location.pathname + window.location.search;
          redirectTo(current);
        }
      }
    } else if (event === 'SIGNED_OUT') {
      let returnUrl = getReturnUrl();

      // handle sign out event
      _clearTokens();
      window.location.href = returnUrl;
    } else if (event === 'PASSWORD_RECOVERY') {
      // handle password recovery event
    } else if (event === 'TOKEN_REFRESHED') {
      // handle token refreshed event
      _setTokens(session.access_token, session.refresh_token);
    } else if (event === 'USER_UPDATED') {
      // user identity may have changed; attempt to sync discord id to profile
      await _syncDiscordToProfile();
    }
  }

  async function _syncDiscordToProfile() {
    try {
      const { data: userData, error } = await supabaseClient.auth.getUser();
      if (error) return;
      const user = userData?.user;
      if (!user) return;
      const discordIdentity = (user.identities || []).find((i) => i.provider === 'discord');
      const identityData = discordIdentity?.identity_data || {};
      const discordId = identityData.sub || identityData.id || null;
      const discordEmail = identityData.email || null;
      const authToken = _getAuthToken();
      const refreshToken = _getRefreshToken();
      if (discordId && authToken && refreshToken) {
        await fetch('/profile/discord/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
            'Refresh-Token': `${refreshToken}`
          },
          body: JSON.stringify({ discord_id: discordId, discord_email: discordEmail })
        });
      }
    } catch (e) {
      // noop
    }
  }

  const signIn = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const form = document.getElementById('sign-in');
    const formData = new FormData(form);
    const email = formData.get('email');
    const password = formData.get('password');

    try {
      _toggleFormLoading(form, true);
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      _setTokens(data.session.access_token, data.session.refresh_token);
    } catch (error) {
      _displayError(error.message);
    }
  };

  const signUp = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const form = document.getElementById('sign-up');
    const formData = new FormData(form);
    const email = formData.get('email');
    const password = formData.get('password');

    try {
      _toggleFormLoading(form, true);
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;

      const message = 'Please verify your email address to continue.';
      htmx.swap(form, `<div class="notification is-info">${message}</div>`, { swapStyle: 'innerHTML' });
    } catch (error) {
      _displayError(error.message);
    }
  };

  const sendSignInLink = async (event) => {
    const form = document.getElementById('sign-in');
    const formData = new FormData(form);
    const email = formData.get('email');
    if (!email) {
      _displayError('Email is required');
      return;
    }

    try {
      _toggleFormLoading(form, true);
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/check` }
      });
      if (error) throw error;
      const message = 'Check your email for a magic link to sign in.';
      htmx.swap('#sign-in', `<div class="notification is-info">${message}</div>`, { swapStyle: 'innerHTML' });
    } catch (error) {
      _displayError(error.message);
    }
  };

  const sendSignUpLink = async (event) => {
    const form = document.getElementById('sign-up');
    const formData = new FormData(form);
    const email = formData.get('email');
    if (!email) {
      _displayError('Email is required');
      return;
    }

    try {
      _toggleFormLoading(form, true);
      const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/check` }
      });
      if (error) throw error;

      const message = 'Please check your email for a magic link to continue.';
      htmx.swap('#sign-up', `<div class="notification is-info">${message}</div>`, { swapStyle: 'innerHTML' });
    } catch (error) {
      _displayError(error.message);
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabaseClient.auth.signOut('global');
      if (error) throw error;
    } catch (error) {
      _displayError(error.message);
    }
  };

  const signInWithDiscord = async () => {
    try {
      const r = getRedirectUrl();
      const redirectTo = r
        ? `${window.location.origin}/auth/check?r=${encodeURIComponent(r)}`
        : `${window.location.origin}/auth/check`;
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'discord',
        options: { redirectTo, scopes: 'identify email' }
      });
      if (error) throw error;
    } catch (error) {
      _displayError(error.message);
    }
  };

  const signUpWithDiscord = async () => {
    try {
      const r = getRedirectUrl();
      const redirectTo = r
        ? `${window.location.origin}/auth/check?r=${encodeURIComponent(r)}`
        : `${window.location.origin}/auth/check`;
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'discord',
        options: { redirectTo, scopes: 'identify email' }
      });
      if (error) throw error;
    } catch (error) {
      _displayError(error.message);
    }
  };

  const linkDiscord = async () => {
    try {
      const redirectTo = `${window.location.origin}/auth/check?r=${encodeURIComponent('/profile')}`
      const { error } = await supabaseClient.auth.linkIdentity({
        provider: 'discord',
        options: { redirectTo, scopes: 'identify email' }
      });
      if (error) throw error;
    } catch (error) {
      _displayError(error.message);
    }
  };

  const unlinkDiscord = async () => {
    try {
      // Best-effort clear on server. Unlinking identity may require identity id; handle DB clear regardless.
      const authToken = _getAuthToken();
      const refreshToken = _getRefreshToken();
      await fetch('/profile/discord/clear', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Refresh-Token': `${refreshToken}`
        }
      });
    } catch (error) {
      _displayError(error.message);
    }
  };

  // UI helpers
  const openModal = (selector) => {
    const modal = htmx.find(selector);
    if (!modal) return;
    if (!modal.classList.contains('is-active')) {
      htmx.toggleClass(modal, 'is-active');
    }
    if (!document.body.classList.contains('modal-open')) {
      htmx.toggleClass(document.body, 'modal-open');
    }
  };

  const closeModal = (selector) => {
    const modal = htmx.find(selector);
    if (!modal) return;
    if (modal.classList.contains('is-active')) {
      htmx.toggleClass(modal, 'is-active');
    }
    if (document.body.classList.contains('modal-open')) {
      htmx.toggleClass(document.body, 'modal-open');
    }
    // If modal requests clearing target on close
    const clearOnClose = modal.getAttribute('data-clear-on-close') === 'true';
    const clearTarget = modal.getAttribute('data-clear-target');
    if (clearOnClose && clearTarget) {
      const el = htmx.find(clearTarget);
      if (el) el.innerHTML = '';
    }
  };

  const copyToClipboard = async (text, evt) => {
    try {
      await navigator.clipboard.writeText(text);
      const button = evt && evt.target ? evt.target.closest('button') : null;
      if (button) {
        const original = button.innerHTML;
        button.innerHTML = '<span class="icon"><i class="fas fa-check"></i></span><span>Copied!</span>';
        htmx.removeClass(button, 'is-success');
        htmx.toggleClass(button, 'is-info');
        setTimeout(() => {
          button.innerHTML = original;
          htmx.removeClass(button, 'is-info');
          htmx.toggleClass(button, 'is-success');
        }, 2000);
      }
    } catch (e) {
      _displayError('Failed to copy to clipboard');
    }
  };

  const renderCalendar = () => {
    const calendarEl = htmx.find('#calendar');
    if (calendarEl) {
      calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        headerToolbar: {
          left: 'prev,next',
          center: 'title',
          right: 'dayGridMonth,dayGridWeek'
        },
        eventClick: function (info) {
          info.jsEvent.preventDefault();
          const event = info.event;
          const url = `/lfg/${event.id}`;
          htmx.ajax('GET', url, { target: 'body', headers: { 'x-calendar': 1 } });
        },
        events: async () => {
          // fetch events
          const r = await fetch('/lfg/events/all', {
            headers: {
              'Authorization': `Bearer ${_getAuthToken()}`,
              'Refresh-Token': `${_getRefreshToken()}`
            }
          })
            .then(response => response.json())
            .catch(error => {
              _displayError('Failed to load events');
              console.error('Error fetching events:', error);
              return [];
            });
          return r;
        }
      });
      calendar.render();
    }
  };

  return {
    init,
    initTooltips: (root) => { try { _initTooltips(root); } catch (e) { /* noop */ } },
    dismissSystemMessage: (id) => {
      try {
        localStorage.setItem('dismissedSystemMessageId', id);
      } catch (e) { /* noop */ }
      const el = document.getElementById('system-banner');
      if (el) el.remove();
    },
    checkSessionNow: async () => { if (supabaseClient) { await supabaseClient.auth.getSession(); } },
    signIn,
    signUp,
    sendSignInLink,
    sendSignUpLink,
    signOut,
    renderCalendar,
    signInWithDiscord,
    signUpWithDiscord,
    linkDiscord,
    unlinkDiscord,
    openModal,
    closeModal,
    copyToClipboard
  };
})(document, supabase, htmx, FullCalendar);
