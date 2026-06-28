import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import useAuthStore from '../../store/useAuthStore';
import useGreenhouseStore from '../../store/useGreenhouseStore';
import PasswordField from '../ui/PasswordField';
import Button from '../ui/Button';

function formatApiError(error) {
  if (error?.data && typeof error.data === 'object') {
    const parts = [];
    for (const [field, errs] of Object.entries(error.data)) {
      parts.push(`${field}: ${Array.isArray(errs) ? errs.join(' ') : errs}`);
    }
    if (parts.length) return parts.join('\n');
  }
  return error?.message || 'Request failed';
}

export default function AuthScreen() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const is_loading = useAuthStore((s) => s.is_loading);
  const bootstrapApp = useGreenhouseStore((s) => s.bootstrapApp);

  const [tab, setTab] = useState('login');
  const [loginError, setLoginError] = useState('');
  const [registerError, setRegisterError] = useState('');

  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [registerForm, setRegisterForm] = useState({
    first_name: '',
    last_name: '',
    username: '',
    email: '',
    phone: '',
    password: '',
    password2: '',
  });

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      await login(loginForm.username, loginForm.password);
      await bootstrapApp();
      navigate('/overview');
    } catch (error) {
      setLoginError(formatApiError(error));
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setRegisterError('');
    if (registerForm.password !== registerForm.password2) {
      setRegisterError('Passwords do not match.');
      return;
    }
    try {
      const payload = {
        username: registerForm.username,
        email: registerForm.email,
        password: registerForm.password,
        password2: registerForm.password2,
      };
      if (registerForm.first_name) payload.first_name = registerForm.first_name;
      if (registerForm.last_name) payload.last_name = registerForm.last_name;
      if (registerForm.phone) payload.phone = registerForm.phone;
      await register(payload);
      toast.success('Account created! Please sign in.');
      setTab('login');
    } catch (error) {
      setRegisterError(formatApiError(error));
    }
  };

  return (
    <div id="auth-screen" className="screen auth-screen active" role="main">
      <div className="auth-bg">
        <div className="auth-orb orb-1" />
        <div className="auth-orb orb-2" />
        <div className="auth-orb orb-3" />
        <div className="auth-orb orb-4" />
        <div className="auth-orb orb-5" />
      </div>
      <div className="auth-card glass-strong">
        <div className="auth-logo">
          <span className="logo-icon" aria-hidden="true">🌿</span>
          <span className="logo-text">GreenMind</span>
        </div>
        <p className="auth-tagline">Smart Greenhouse Control Platform</p>

        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            id="tab-login"
            className={`auth-tab${tab === 'login' ? ' active' : ''}`}
            role="tab"
            aria-selected={tab === 'login'}
            onClick={() => setTab('login')}
          >
            Sign In
          </button>
          <button
            type="button"
            id="tab-register"
            className={`auth-tab${tab === 'register' ? ' active' : ''}`}
            role="tab"
            aria-selected={tab === 'register'}
            onClick={() => setTab('register')}
          >
            Register
          </button>
        </div>

        {tab === 'login' ? (
          <form id="login-form" className="auth-form" onSubmit={handleLogin} noValidate>
            <div className="field-group">
              <label htmlFor="login-username">Username</label>
              <input
                type="text"
                id="login-username"
                placeholder="your_username"
                required
                autoComplete="username"
                value={loginForm.username}
                onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
              />
            </div>
            <div className="field-group">
              <label htmlFor="login-password">Password</label>
              <PasswordField
                id="login-password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              />
            </div>
            {loginError && <div id="login-error" className="form-error" role="alert">{loginError}</div>}
            <Button type="submit" id="login-btn" className="full-width" loading={is_loading}>
              Sign In
            </Button>
          </form>
        ) : (
          <form id="register-form" className="auth-form" onSubmit={handleRegister} noValidate>
            <div className="field-row">
              <div className="field-group">
                <label htmlFor="reg-first">First Name</label>
                <input
                  type="text"
                  id="reg-first"
                  placeholder="John"
                  autoComplete="given-name"
                  value={registerForm.first_name}
                  onChange={(e) => setRegisterForm({ ...registerForm, first_name: e.target.value })}
                />
              </div>
              <div className="field-group">
                <label htmlFor="reg-last">Last Name</label>
                <input
                  type="text"
                  id="reg-last"
                  placeholder="Doe"
                  autoComplete="family-name"
                  value={registerForm.last_name}
                  onChange={(e) => setRegisterForm({ ...registerForm, last_name: e.target.value })}
                />
              </div>
            </div>
            <div className="field-group">
              <label htmlFor="reg-username">Username</label>
              <input
                type="text"
                id="reg-username"
                placeholder="farmer_john"
                required
                autoComplete="username"
                value={registerForm.username}
                onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })}
              />
            </div>
            <div className="field-group">
              <label htmlFor="reg-email">Email</label>
              <input
                type="email"
                id="reg-email"
                placeholder="john@farm.com"
                required
                autoComplete="email"
                value={registerForm.email}
                onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
              />
            </div>
            <div className="field-group">
              <label htmlFor="reg-phone">Phone (optional)</label>
              <input
                type="tel"
                id="reg-phone"
                placeholder="+959123456789"
                autoComplete="tel"
                value={registerForm.phone}
                onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })}
              />
            </div>
            <div className="field-group">
              <label htmlFor="reg-password">Password</label>
              <PasswordField
                id="reg-password"
                placeholder="••••••••"
                required
                autoComplete="new-password"
                value={registerForm.password}
                onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
              />
            </div>
            <div className="field-group">
              <label htmlFor="reg-password2">Confirm Password</label>
              <PasswordField
                id="reg-password2"
                placeholder="••••••••"
                required
                autoComplete="new-password"
                value={registerForm.password2}
                onChange={(e) => setRegisterForm({ ...registerForm, password2: e.target.value })}
              />
            </div>
            {registerError && <div id="register-error" className="form-error" role="alert">{registerError}</div>}
            <Button type="submit" id="register-btn" className="full-width" loading={is_loading}>
              Create Account
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
