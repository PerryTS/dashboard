"use client";

import { useEffect, useState } from "react";

interface AccountData {
  id: string;
  github_username: string;
  email: string;
  tier: "free" | "pro";
  has_payment_method: boolean;
  usage: {
    publishes: number;
    publish_limit: number;
    deep_verifies: number;
    verify_limit: number;
    period: string;
  };
}

function UsageBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = Math.min(100, (used / limit) * 100);
  const isOver = used >= limit;
  return (
    <div className="mb-4">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-slate-400">{label}</span>
        <span className={isOver ? "text-red-400" : "text-slate-300"}>
          {used}/{limit}
        </span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isOver
              ? "bg-red-500"
              : pct > 80
                ? "bg-amber-500"
                : "bg-gradient-to-r from-amber-500 to-orange-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [apiToken, setApiToken] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) {
          window.location.href = "/login/";
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d) {
          setData(d.account);
          setApiToken(d.api_token || "");
        }
      })
      .catch(() => setError("Failed to load account"));
  }, []);

  function copyToken() {
    navigator.clipboard.writeText(apiToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login/";
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-red-400">{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">
              <span className="gradient-text">Perry Dashboard</span>
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              @{data.github_username}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                data.tier === "pro"
                  ? "bg-amber-500/20 text-amber-400"
                  : "bg-white/10 text-slate-400"
              }`}
            >
              {data.tier === "pro" ? "Pro" : "Free"}
            </span>
            <button
              onClick={handleLogout}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Usage */}
        <div className="card mb-6">
          <h2 className="font-semibold mb-4">
            Usage — {data.usage.period}
          </h2>
          <UsageBar
            label="Publishes"
            used={data.usage.publishes}
            limit={data.usage.publish_limit}
          />
          <UsageBar
            label="Deep Verifies"
            used={data.usage.deep_verifies}
            limit={data.usage.verify_limit}
          />
          {data.tier === "free" && (
            <a
              href="/dashboard/billing/"
              className="btn-primary inline-block text-sm mt-2"
            >
              Upgrade to Pro
            </a>
          )}
        </div>

        {/* API Token */}
        <div className="card mb-6">
          <h2 className="font-semibold mb-3">API Token</h2>
          <p className="text-sm text-slate-400 mb-3">
            Use this token with <code className="text-amber-400/80">perry login</code> or
            set <code className="text-amber-400/80">PERRY_LICENSE_KEY</code> in your environment.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 font-mono overflow-hidden">
              {tokenVisible ? apiToken : apiToken.substring(0, 8) + "..."}
            </code>
            <button
              onClick={() => setTokenVisible(!tokenVisible)}
              className="text-xs text-slate-400 hover:text-slate-300 px-2 py-2"
            >
              {tokenVisible ? "Hide" : "Show"}
            </button>
            <button
              onClick={copyToken}
              className="text-xs text-slate-400 hover:text-slate-300 px-2 py-2"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        {/* Billing */}
        <div className="card">
          <h2 className="font-semibold mb-3">Billing</h2>
          {data.tier === "pro" ? (
            <>
              <p className="text-sm text-slate-400 mb-3">
                Manage your Pro subscription, payment method, and invoices.
              </p>
              <form action="/api/portal" method="POST">
                <button type="submit" className="btn-secondary text-sm">
                  Manage billing
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-400 mb-3">
                Upgrade to Pro for 50 publishes/month, 20 deep verifies, and
                priority builds.
              </p>
              <a
                href="/dashboard/billing/"
                className="btn-primary inline-block text-sm"
              >
                See plans
              </a>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
