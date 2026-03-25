"use client";

import { useEffect } from "react";

// Root page: check if logged in, redirect accordingly
export default function RootPage() {
  useEffect(() => {
    // Check for session cookie — if present, go to dashboard; otherwise login
    const hasSession = document.cookie.includes("perry_session=");
    if (hasSession) {
      window.location.href = "/dashboard/";
    } else {
      window.location.href = "/login/";
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-slate-500">Redirecting...</p>
    </div>
  );
}
