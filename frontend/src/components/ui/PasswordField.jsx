import { useState } from 'react';

export default function PasswordField({ id, value, onChange, placeholder, required, autoComplete }) {
  const [show, setShow] = useState(false);

  return (
    <div className="password-field">
      <input
        type={show ? 'text' : 'password'}
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setShow(!show)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
      >
        {show ? '🙈' : '👁'}
      </button>
    </div>
  );
}
