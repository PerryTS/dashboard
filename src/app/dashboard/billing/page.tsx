"use client";

import { useEffect, useState } from "react";

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4 text-amber-400 shrink-0 mt-0.5"
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
  );
}

export default function BillingPage() {
  const [tier, setTier] = useState<"free" | "pro">("free");
  const [loading, setLoading] = useState(false);

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
        if (d) setTier(d.account.tier);
      });
  }, []);

  async function handleUpgrade() {
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "pro" }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setLoading(false);
    }
  }

  async function handleManage() {
    setLoading(true);
    try {
      const res = await fetch("/api/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setLoading(false);
    }
  }

  if (tier === "pro") {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="card max-w-sm w-full text-center">
          <span className="inline-block bg-amber-500/20 text-amber-400 text-xs font-bold px-2.5 py-1 rounded-full mb-4">
            Pro
          </span>
          <h1 className="text-xl font-bold mb-2">You&apos;re on Pro</h1>
          <p className="text-sm text-slate-400 mb-6">
            50 publishes/month, 20 deep verifies, priority queue.
          </p>
          <button
            onClick={handleManage}
            disabled={loading}
            className="btn-secondary w-full"
          >
            {loading ? "Redirecting..." : "Manage billing"}
          </button>
          <a
            href="/dashboard/"
            className="inline-block text-sm text-slate-500 hover:text-slate-300 mt-4"
          >
            Back to dashboard
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold mb-2">
            <span className="gradient-text">Upgrade to Pro</span>
          </h1>
          <p className="text-slate-400 text-sm">
            Ship faster with more publishes and priority builds.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {/* Current free plan */}
          <div className="card">
            <h2 className="font-semibold mb-1">Free</h2>
            <p className="text-3xl font-bold mb-4">
              $0<span className="text-sm text-slate-500 font-normal">/mo</span>
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <CheckIcon />
                <span className="text-slate-400">15 publishes/month</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon />
                <span className="text-slate-400">2 deep verifies/month</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon />
                <span className="text-slate-400">$0.99/publish overage</span>
              </li>
            </ul>
            <div className="mt-6">
              <span className="text-xs text-slate-500">Current plan</span>
            </div>
          </div>

          {/* Pro plan */}
          <div className="card border-amber-500/30">
            <h2 className="font-semibold mb-1">Pro</h2>
            <p className="text-3xl font-bold mb-4">
              $19<span className="text-sm text-slate-500 font-normal">/mo</span>
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <CheckIcon />
                <span className="text-slate-300">50 publishes/month</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon />
                <span className="text-slate-300">20 deep verifies/month</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon />
                <span className="text-slate-300">$0.49/publish overage</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon />
                <span className="text-slate-300">Priority build queue</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckIcon />
                <span className="text-slate-300">Unlimited projects</span>
              </li>
            </ul>
            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="btn-primary w-full mt-6 text-sm"
            >
              {loading ? "Redirecting to checkout..." : "Subscribe to Pro"}
            </button>
          </div>
        </div>

        <div className="text-center mt-6">
          <a
            href="/dashboard/"
            className="text-sm text-slate-500 hover:text-slate-300"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
