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

  function init(supabaseUrl, supabaseKey) {
    document.addEventListener("DOMContentLoaded", async function () {
      // initialize supabase client
      supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
      supabaseClient.auth.onAuthStateChange(_handleAuthStateChange);

      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      if (code) {
        try {
          const { error } = await supabaseClient.auth.exchangeCodeForSession(code);
          if (error) throw error;
          window.history.replaceState({}, document.title, url.pathname + url.hash);
        } catch (error) {
          _displayError(error.message);
        }
      }

      await supabaseClient.auth.getSession();

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
    });
  }

  function redirectTo(url) {
    htmx.ajax('GET', url, { target: 'body', headers: { 'redirect-to': url } });
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

  function _handleAuthStateChange(event, session) {
    if (event === 'INITIAL_SESSION') {
      // Handle initial session deterministically
      if (session) {
        if (_getAuthToken() !== session.access_token) {
          _setTokens(session.access_token, session.refresh_token);
        }
        const redirectUrl = getRedirectUrl() || '/';
        redirectTo(redirectUrl);
      } else {
        _clearTokens();

        const authOptional = document.body.getAttribute('data-auth-optional') === 'true';
        if (!authOptional) {
          let returnUrl = getReturnUrl();
          redirectTo(returnUrl);
        }
      }
    } else if (event === 'SIGNED_IN') {
      const redirectUrl = getRedirectUrl() || '/';
      // handle sign in event
      if (session && _getAuthToken() !== session.access_token) {
        _setTokens(session.access_token, session.refresh_token);
        redirectTo(redirectUrl);
      }
    } else if (event === 'SIGNED_OUT') {
      let returnUrl = getReturnUrl();

      // handle sign out event
      _clearTokens();
      window.location.href = returnUrl;
    } else if (event === 'PASSWORD_RECOVERY') {
      redirectTo('/auth/update-password-form');
    } else if (event === 'TOKEN_REFRESHED') {
      // handle token refreshed event
      _setTokens(session.access_token, session.refresh_token);
    } else if (event === 'USER_UPDATED') {
      // handle user updated event
      console.log('user updated');
    }
  }

  const signIn = async (event) => {
    const form = document.getElementById('sign-in');
    const formData = new FormData(form);
    const email = formData.get('email');
    const password = formData.get('password');

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      _setTokens(data.session.access_token, data.session.refresh_token);
    } catch (error) {
      _displayError(error.message);
    }
  };

  const signUp = async (event) => {
    const form = document.getElementById('sign-up');
    const formData = new FormData(form);
    const email = formData.get('email');
    const password = formData.get('password');

    try {
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

  const sendPasswordReset = async (event) => {
    event.preventDefault();
    const form = document.getElementById('sign-in');
    const formData = new FormData(form);
    const email = formData.get('email');
    if (!email) {
      _displayError('Email is required');
      return;
    }

    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`
      });
      if (error) throw error;
      const message = 'Check your email for a password reset link.';
      htmx.swap('#sign-in', `<div class="notification is-info">${message}</div>`, { swapStyle: 'innerHTML' });
    } catch (error) {
      _displayError(error.message);
    }
  };

  const updatePassword = async (event) => {
    event.preventDefault();
    const form = document.getElementById('update-password');
    const formData = new FormData(form);
    const password = formData.get('password');

    try {
      const { error } = await supabaseClient.auth.updateUser({ password });
      if (error) throw error;
      _displayNotification('success', 'Password updated successfully.');
      redirectTo('/');
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
    signIn,
    signUp,
    sendSignInLink,
    sendSignUpLink,
    sendPasswordReset,
    updatePassword,
    signOut,
    renderCalendar
  };
})(document, supabase, htmx, FullCalendar);
