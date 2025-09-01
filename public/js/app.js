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
        if (evt.detail.pathInfo.finalRequestPath !== '/') return;
        renderCalendar();
      });

      // Add handler for htmx:afterSettle
      document.body.addEventListener('htmx:afterSettle', function(event) {
        const xhr = event.detail.xhr;
        const authOptional = xhr.getResponseHeader('X-Auth-Optional') === 'true';
        if (authOptional) {
          document.body.setAttribute('data-auth-optional', 'true');
        } else {
          document.body.setAttribute('data-auth-optional', 'false');
        }
      });

      document.body.addEventListener('htmx:afterSwap', function(evt) {
        // Handle character search results visibility
        if (evt.detail.target.id === 'characterSearchResults') {
          evt.detail.target.classList.remove('is-hidden');
          setTimeout(() => {
            evt.detail.target.classList.add('is-hidden');
          }, 10000);
        }
      });

      // Global keydown handler for closing modals on Escape
      document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
          const activeModal = document.querySelector('.modal.is-active');
          if (activeModal) {
            App.closeModal('#' + activeModal.id);
          }
        }
      });

      // trigger initial session detection/emit events after listeners are ready
      await supabaseClient.auth.getSession();
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
    htmx.ajax('GET', url, { target: 'body', headers });
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
        const redirectUrl = getRedirectUrl() || '/';
        await _syncDiscordToProfile();
        redirectTo(redirectUrl);
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
      const redirectUrl = getRedirectUrl() || '/';
      // handle sign in event
      if (session && _getAuthToken() !== session.access_token) {
        _setTokens(session.access_token, session.refresh_token);
        await _syncDiscordToProfile();
        redirectTo(redirectUrl);
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
      htmx.swap(`#${event.target.id}`, `<div class="notification is-info">${message}</div>`, { swapStyle: 'innerHTML' });
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
