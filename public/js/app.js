const App = (function () {
  let supabaseClient;
  let authToken = null;
  let refreshToken = null;

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

  const _displayError = (errorMsg) => {
    const errorContainer = document.getElementById('alerts');
    errorContainer.innerHTML = `<div class="notification is-danger">${errorMsg}</div>`;
  }

  function init(supabaseUrl, supabaseKey) {
    document.addEventListener("DOMContentLoaded", async function () {
      // initialize supabase client
      supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
      if (_getAuthToken()) {
        supabaseClient.auth.getSession();
      }
      supabaseClient.auth.onAuthStateChange(_handleAuthStateChange);

      // add auth token to htmx requests
      document.body.addEventListener("htmx:configRequest", function (event) {
        if (_getAuthToken() && _getRefreshToken()) {
          event.detail.headers["Authorization"] = `Bearer ${authToken}`;
          event.detail.headers["Refresh-Token"] = refreshToken;
        }
      });

      // handle htmx errors
      document.body.addEventListener("htmx:responseError", function (event) {
        _displayError(event.detail.xhr.response);
      });
    });
  }

  function _handleAuthStateChange(event, session) {
    if (event === 'INITIAL_SESSION') {
      // handle initial session
    } else if (event === 'SIGNED_IN') {
      _setTokens(session.access_token, session.refresh_token);
      if (window.location.pathname === '/auth') {
        htmx.ajax('GET', '/profile', 'body');
      }
    } else if (event === 'SIGNED_OUT') {
      // handle sign out event
      _clearTokens();
      htmx.ajax('POST', '/auth/signout');
    } else if (event === 'PASSWORD_RECOVERY') {
      // handle password recovery event
    } else if (event === 'TOKEN_REFRESHED') {
      // handle token refreshed event
      _setTokens(session.access_token, session.refresh_token);
    } else if (event === 'USER_UPDATED') {
      // handle user updated event
    }
  }

  const signIn = async () => {
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

  const signOut = async () => {
    try {
      const { error } = await supabaseClient.auth.signOut('global');
      if (error) throw error;
    } catch (error) {
      _displayError(error.message);
    }
  };

  return {
    init,
    signIn,
    signOut
  };
})(document, supabase);
