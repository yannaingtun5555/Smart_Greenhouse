export default function Button({ children, variant = 'primary', className = '', disabled, loading, type = 'button', onClick, ...props }) {
  return (
    <button
      type={type}
      className={`btn-${variant} ${className}`}
      disabled={disabled || loading}
      onClick={onClick}
      {...props}
    >
      <span className="btn-text" style={{ opacity: loading ? 0.5 : 1 }}>{children}</span>
      {loading && <span className="btn-loader" aria-hidden="true">⟳</span>}
    </button>
  );
}
