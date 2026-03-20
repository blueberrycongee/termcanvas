import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "../stores/authStore";
import { useT } from "../i18n/useT";

export function LoginButton() {
  const { user, loading, login, logout } = useAuthStore();
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  if (loading) {
    return (
      <span
        className="text-[10px] text-[var(--text-faint)]"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        {t.auth_logging_in}
      </span>
    );
  }

  if (!user) {
    return (
      <button
        onClick={login}
        className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors px-1.5 py-0.5 rounded hover:bg-[var(--surface-hover)]"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        {t.auth_login_github}
      </button>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-[var(--surface-hover)] transition-colors"
      >
        <img
          src={user.avatarUrl}
          alt=""
          className="w-[18px] h-[18px] rounded-full"
        />
        <span
          className="text-[10px] text-[var(--text-muted)] truncate"
          style={{ fontFamily: '"Geist Mono", monospace', maxWidth: 80 }}
        >
          {user.username}
        </span>
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 rounded-md border border-[var(--border)] bg-[var(--bg)] shadow-lg py-0.5 min-w-[100px]">
          <button
            onClick={() => {
              setMenuOpen(false);
              logout();
            }}
            className="w-full text-left px-3 py-1.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.auth_logout}
          </button>
        </div>
      )}
    </div>
  );
}
