"use client";

import { useEffect, useState } from "react";

export default function CliAuthorizePage() {
  const [code, setCode] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Extract device code from URL
    const params = new URLSearchParams(window.location.search);
    const c = params.get("code") || "";
    setCode(c);
  }, []);

  async function handleAuthorize() {
    setLoading(true);
    try {
      const res = await fetch("/api/cli/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: code }),
      });
      if (!res.ok) {
        const data = await res.json();
        if (data.error?.code === "AUTH_REQUIRED") {
          // Not logged in — redirect to login, then back here
          window.location.href =
            "/api/auth/github?redirect=" +
            encodeURIComponent("/cli/authorize/?code=" + code);
          return;
        }
        setError(data.error?.message || "Authorization failed");
      } else {
        setAuthorized(true);
      }
    } catch {
      setError("Network error");
    }
    setLoading(false);
  }

  if (authorized) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="card max-w-sm w-full text-center">
          <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-6 h-6 text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold mb-2">CLI Authorized</h1>
          <p className="text-sm text-slate-400">
            You can close this tab and return to your terminal.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card max-w-sm w-full text-center">
        <h1 className="text-xl font-bold mb-2">
          <span className="gradient-text">Authorize Perry CLI</span>
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          The Perry CLI is requesting access to your account.
        </p>

        {code && (
          <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 mb-6">
            <p className="text-xs text-slate-500 mb-1">Device code</p>
            <p className="font-mono text-lg tracking-wider text-slate-200">
              {code}
            </p>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm mb-4">{error}</p>
        )}

        <button
          onClick={handleAuthorize}
          disabled={loading || !code}
          className="btn-primary w-full"
        >
          {loading ? "Authorizing..." : "Authorize"}
        </button>
      </div>
    </main>
  );
}
