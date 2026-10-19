"use client";

import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type User = { id: number; name: string; email: string; mfa_enabled: boolean };
type Weather = {
  temperature: number;
  apparent_temperature: number;
  humidity: number;
  wind_speed: number;
  weather_code: number;
  is_day: number;
  time: string;
};
type Notice = { kind: "success" | "error"; text: string } | null;
type Mode = "login" | "register" | "forgot" | "reset";

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
const DEFAULT_LOCATION = { name: "Manila", latitude: 14.5995, longitude: 120.9842 };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) {
    throw new Error("API is not configured. Set NEXT_PUBLIC_API_URL to your Laravel API origin.");
  }
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const xsrf = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("XSRF-TOKEN="))
    ?.slice("XSRF-TOKEN=".length);
  if (xsrf && !["GET", "HEAD", "OPTIONS"].includes(init.method || "GET")) {
    headers.set("X-XSRF-TOKEN", decodeURIComponent(xsrf));
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  const responseBody = await response.text();
  let data: T & {
    message?: string;
    errors?: Record<string, string[]>;
  };
  if (responseBody) {
    try {
      const parsed: unknown = JSON.parse(responseBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("The API returned an invalid JSON response.");
      }
      data = parsed as typeof data;
    } catch {
      if (response.ok) throw new Error("The API returned an invalid JSON response.");
      data = {} as typeof data;
    }
  } else if (response.ok && response.status !== 204) {
    throw new Error("The API returned an empty response.");
  } else {
    data = {} as typeof data;
  }
  if (!response.ok) {
    const firstError = data.errors && Object.values(data.errors)[0]?.[0];
    throw new ApiError(firstError || data.message || "Something went wrong. Please try again.", response.status);
  }
  return data;
}

function weatherLabel(code: number): string {
  if (code === 0) return "Clear sky";
  if ([1, 2, 3].includes(code)) return "Partly cloudy";
  if ([45, 48].includes(code)) return "Foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain showers";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  return "Current conditions";
}

function WaypointApp() {
  const searchParams = useSearchParams();
  const tokenFromLink = searchParams.get("token") || "";
  const emailFromLink = searchParams.get("email") || "";
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<Mode>(tokenFromLink && emailFromLink ? "reset" : "login");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [mfaUri, setMfaUri] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [resetToken] = useState(tokenFromLink);
  const [resetEmail, setResetEmail] = useState(emailFromLink);
  const [showMfaSetup, setShowMfaSetup] = useState(false);

  const refreshWeather = useCallback(async (latitude = location.latitude, longitude = location.longitude) => {
    setWeatherBusy(true);
    try {
      const result = await request<Weather>(
        `/api/weather?latitude=${latitude}&longitude=${longitude}`,
      );
      setWeather(result);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Weather is unavailable." });
    } finally {
      setWeatherBusy(false);
    }
  }, [location.latitude, location.longitude]);

  useEffect(() => {
    if (resetToken && resetEmail) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    request<User>("/api/user")
      .then((currentUser) => {
        setUser(currentUser);
        setWeatherBusy(true);
        void request<Weather>(
          `/api/weather?latitude=${DEFAULT_LOCATION.latitude}&longitude=${DEFAULT_LOCATION.longitude}`,
        )
          .then(setWeather)
          .catch((error: unknown) => setNotice({
            kind: "error",
            text: error instanceof Error ? error.message : "Weather is unavailable.",
          }))
          .finally(() => setWeatherBusy(false));
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) return;
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "The API could not be reached.",
        });
      })
      .finally(() => setBooting(false));
  }, [resetEmail, resetToken]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    const body: Record<string, string> = {};
    for (const [key, value] of form.entries()) body[key] = String(value);
    try {
      await request("/sanctum/csrf-cookie", { method: "GET" });
      if (mode === "forgot") {
        await request("/api/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email: body.email }),
        });
        setNotice({ kind: "success", text: "If an account matches, a password reset link will be sent shortly." });
      } else if (mode === "reset") {
        await request("/api/reset-password", {
          method: "POST",
          body: JSON.stringify({
            ...body,
            email: resetEmail || body.email,
            token: resetToken || body.token,
          }),
        });
        setMode("login");
        setNotice({ kind: "success", text: "Password updated. You can now sign in with your new password." });
      } else if (mode === "register") {
        const result = await request<{ user: User }>("/api/register", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setUser(result.user);
        setNotice({ kind: "success", text: `Welcome, ${result.user.name}. Your account is ready.` });
        void refreshWeather();
      } else {
        const result = await request<{ user?: User; requires_mfa?: boolean }>("/api/login", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (result.requires_mfa) {
          setNeedsMfa(true);
          setNotice({ kind: "success", text: "Enter the current code from your authenticator app." });
        } else if (result.user) {
          setUser(result.user);
          void refreshWeather();
        }
      }
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to complete the request." });
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await request("/sanctum/csrf-cookie");
      const result = await request<{ user: User }>("/api/mfa/login", {
        method: "POST",
        body: JSON.stringify({ code: mfaCode }),
      });
      setUser(result.user);
      setNeedsMfa(false);
      setMfaCode("");
      setNotice({ kind: "success", text: "Two-factor verification complete." });
      void refreshWeather();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Verification failed." });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await request("/api/logout", { method: "POST", body: "{}" });
      setUser(null);
      setNeedsMfa(false);
      setWeather(null);
      setMode("login");
      setNotice({ kind: "success", text: "You have been securely signed out." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not sign out." });
    } finally {
      setBusy(false);
    }
  }

  async function beginMfaSetup() {
    setBusy(true);
    try {
      const result = await request<{ uri: string; secret: string }>("/api/mfa/setup", { method: "POST", body: "{}" });
      setMfaUri(result.uri);
      setMfaSecret(result.secret);
      setShowMfaSetup(true);
      setNotice({ kind: "success", text: "Add this account to your authenticator app, then verify a code." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not start MFA setup." });
    } finally {
      setBusy(false);
    }
  }

  async function confirmMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request<{ user: User }>("/api/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ code: mfaCode }),
      });
      setUser(result.user);
      setShowMfaSetup(false);
      setMfaUri("");
      setMfaSecret("");
      setMfaCode("");
      setNotice({ kind: "success", text: "Two-factor authentication is enabled." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "The code could not be verified." });
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request<{ user: User }>("/api/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ code: mfaCode }),
      });
      setUser(result.user);
      setMfaCode("");
      setNotice({ kind: "success", text: "Two-factor authentication has been disabled." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "The code could not be verified." });
    } finally {
      setBusy(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setNotice({ kind: "error", text: "Location is not supported by this browser." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          name: "Your current location",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setLocation(next);
        void refreshWeather(next.latitude, next.longitude);
        setNotice({ kind: "success", text: "Map and weather updated for your current location." });
      },
      () => setNotice({ kind: "error", text: "Location access was denied or is unavailable." }),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${location.longitude - 0.08}%2C${location.latitude - 0.055}%2C${location.longitude + 0.08}%2C${location.latitude + 0.055}&layer=mapnik&marker=${location.latitude}%2C${location.longitude}`;

  if (booting) {
    return <main className="loading-screen"><span className="loader" />Loading your secure workspace…</main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Waypoint home">
          <span className="brand-mark">W</span><span>waypoint<span className="brand-period">.</span></span>
        </Link>
        <div className="topbar-right">
          <span className="secure-label"><span className="secure-dot" /> Secure workspace</span>
          {user && <button className="button button-quiet signout" onClick={logout} disabled={busy}>Sign out</button>}
        </div>
      </header>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role="status">
          <span>{notice.kind === "success" ? "✓" : "!"}</span>{notice.text}
          <button onClick={() => setNotice(null)} aria-label="Dismiss notification">×</button>
        </div>
      )}

      {user ? (
        <section className="dashboard">
          <div className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> YOUR PERSONAL DASHBOARD</div>
              <h1>Good day, {user.name.split(" ")[0]}<span className="heading-period">.</span></h1>
              <p className="subheading">A clear view of your world, all in one place.</p>
            </div>
            <div className="profile-chip">
              <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{user.name}</strong><small>{user.email}</small></span>
              <span className="verified-badge" title="Authenticated session">✓</span>
            </div>
          </div>
          <div className="dashboard-grid">
            <article className="card weather-card">
              <div className="card-heading">
                <div><span className="card-kicker">LIVE CONDITIONS</span><h2>Weather</h2></div>
                <button className="icon-button" onClick={() => void refreshWeather()} title="Refresh weather" aria-label="Refresh weather" disabled={weatherBusy}>↻</button>
              </div>
              {weatherBusy && !weather ? <div className="card-loading"><span className="loader" />Checking the sky…</div> : weather ? (
                <>
                  <div className="weather-main">
                    <span className="weather-icon" aria-hidden>{weather.weather_code === 0 ? "☀" : weather.weather_code >= 95 ? "ϟ" : "☁"}</span>
                    <div><strong>{Math.round(weather.temperature)}°</strong><span>{weatherLabel(weather.weather_code)}</span></div>
                  </div>
                  <div className="weather-place"><span className="pin">⌖</span>{location.name}</div>
                  <div className="weather-stats">
                    <div><span>FEELS LIKE</span><strong>{Math.round(weather.apparent_temperature)}°</strong></div>
                    <div><span>HUMIDITY</span><strong>{weather.humidity}%</strong></div>
                    <div><span>WIND</span><strong>{Math.round(weather.wind_speed)} <small>km/h</small></strong></div>
                  </div>
                  <p className="data-credit">Live data by Open-Meteo</p>
                </>
              ) : <div className="card-loading">Weather data is unavailable.</div>}
            </article>

            <article className="card map-card">
              <div className="card-heading">
                <div><span className="card-kicker">EXPLORE YOUR AREA</span><h2>Map & location</h2></div>
                <button className="button button-outline locate-button" onClick={useMyLocation}>⌖ <span>Use my location</span></button>
              </div>
              <div className="map-frame">
                <iframe title={`Map showing ${location.name}`} src={mapUrl} loading="lazy" referrerPolicy="no-referrer" />
              </div>
              <div className="map-caption"><span className="map-dot" /><span><strong>{location.name}</strong><small>{location.latitude.toFixed(4)}°, {location.longitude.toFixed(4)}°</small></span><a href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=12/${location.latitude}/${location.longitude}`} target="_blank" rel="noreferrer">Open map ↗</a></div>
              <p className="data-credit">Map tiles © OpenStreetMap contributors</p>
            </article>

            <article className="card security-card">
              <div className="card-heading">
                <div><span className="card-kicker">ACCOUNT PROTECTION</span><h2>Two-factor auth</h2></div>
                <span className={`status-pill ${user.mfa_enabled ? "status-on" : "status-off"}`}><span />{user.mfa_enabled ? "Enabled" : "Not enabled"}</span>
              </div>
              {!showMfaSetup && !user.mfa_enabled && <><p className="security-copy">Add a time-based code from an authenticator app for an extra layer of security at sign-in.</p><button className="button button-primary" onClick={beginMfaSetup} disabled={busy}>Set up authenticator <span>→</span></button></>}
              {!showMfaSetup && user.mfa_enabled && <form className="inline-form" onSubmit={disableMfa}><p className="security-copy">Your account asks for an authenticator code each time you sign in.</p><label htmlFor="disable-code">Verify a code to turn off MFA</label><div className="inline-controls"><input id="disable-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" pattern="[0-9]{6}" placeholder="000000" required /><button className="button button-outline" disabled={busy}>Disable</button></div></form>}
              {showMfaSetup && <form className="mfa-setup" onSubmit={confirmMfa}><p className="security-copy">Add the account in your authenticator app using this secret, then enter its six-digit code.</p><code className="mfa-uri">{mfaSecret}</code><details className="setup-details"><summary>Manual setup URI</summary><code className="mfa-uri">{mfaUri}</code></details><label htmlFor="setup-code">Authenticator code</label><div className="inline-controls"><input id="setup-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" pattern="[0-9]{6}" placeholder="000000" required /><button className="button button-primary" disabled={busy}>Verify & enable</button></div><button type="button" className="text-button" onClick={() => { setShowMfaSetup(false); setMfaCode(""); setMfaSecret(""); setMfaUri(""); }}>Cancel setup</button></form>}
            </article>
          </div>
          <footer className="dashboard-footer"><span>WAYPOINT <span className="brand-period">·</span> A connected view of your day</span><span>Session protected with Laravel Sanctum</span></footer>
        </section>
      ) : (
        <section className="auth-layout">
          <div className="auth-story">
            <div className="eyebrow"><span className="eyebrow-line" /> YOUR WORLD, IN FOCUS</div>
            <h1>Everything in<br />its right <em>place.</em></h1>
            <p className="story-copy">A thoughtful space for the information that matters where you are, and where you&apos;re going.</p>
            <div className="story-visual" aria-hidden>
              <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
              <span className="orbit-center">W</span><span className="orbit-point point-one">⌖</span><span className="orbit-point point-two">☼</span><span className="orbit-point point-three">✦</span>
              <span className="orbit-label label-one">YOUR LOCATION</span><span className="orbit-label label-two">LIVE CONDITIONS</span>
            </div>
            <div className="trust-note"><span className="trust-icon">◇</span><span><strong>Your data stays yours.</strong><small>Secure sessions. Encrypted credentials. Always.</small></span></div>
          </div>
          <div className="auth-panel">
            <div className="auth-card">
              <div className="auth-card-top"><span className="card-kicker">{needsMfa ? "SECOND FACTOR" : mode === "register" ? "GET STARTED" : mode === "forgot" ? "ACCOUNT RECOVERY" : mode === "reset" ? "CHOOSE A NEW PASSWORD" : "WELCOME BACK"}</span><h2>{needsMfa ? "Verify it's you" : mode === "register" ? "Create your account" : mode === "forgot" ? "Reset your password" : mode === "reset" ? "Set a new password" : "Sign in to Waypoint"}</h2><p>{needsMfa ? "Enter the six-digit code from your authenticator app." : mode === "register" ? "Start your secure, personal dashboard." : mode === "forgot" ? "We'll email a secure link if the address is registered." : mode === "reset" ? "Choose a strong password you haven't used before." : "Your personal dashboard is just a step away."}</p></div>
              {needsMfa ? (
                <form className="auth-form" onSubmit={verifyMfa}><label htmlFor="login-code">Authenticator code</label><input id="login-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" placeholder="000000" required /><button className="button button-primary submit-button" disabled={busy}>{busy ? "Verifying…" : "Verify & continue"} <span>→</span></button><button type="button" className="text-button" onClick={() => { setNeedsMfa(false); setMfaCode(""); }}>Back to sign in</button></form>
              ) : (
                <form className="auth-form" onSubmit={submitAuth}>
                  {mode === "register" && <><label htmlFor="name">Full name</label><input id="name" name="name" autoComplete="name" placeholder="Alex Morgan" minLength={2} maxLength={100} required /></>}
                  {mode === "reset" && <><label htmlFor="reset-email">Email address</label><input id="reset-email" name="email" type="email" autoComplete="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} required /></>}
                  {mode !== "reset" && <><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></>}
                  {mode !== "forgot" && <><label htmlFor="password">{mode === "reset" ? "New password" : "Password"}{mode === "login" && <button className="forgot-link" type="button" onClick={() => { setMode("forgot"); setNotice(null); }}>Forgot password?</button>}</label><input id="password" name={mode === "reset" ? "password" : "password"} type="password" autoComplete={mode === "register" ? "new-password" : mode === "reset" ? "new-password" : "current-password"} minLength={mode === "login" ? undefined : 8} placeholder={mode === "register" || mode === "reset" ? "At least 8 characters" : "Enter your password"} required /></>}
                  {(mode === "register" || mode === "reset") && <><label htmlFor="password_confirmation">Confirm password</label><input id="password_confirmation" name="password_confirmation" type="password" autoComplete="new-password" minLength={8} placeholder="Enter your password again" required /></>}
                  <button className="button button-primary submit-button" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : "Update password"} <span>→</span></button>
                  {mode === "forgot" && <p className="auth-switch"><button className="text-button" type="button" onClick={() => setMode("login")}>← Back to sign in</button></p>}
                  {(mode === "login" || mode === "register") && <p className="auth-switch">{mode === "login" ? "New to Waypoint?" : "Already have an account?"} <button className="text-button" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setNotice(null); }}>{mode === "login" ? "Create an account" : "Sign in"}</button></p>}
                </form>
              )}
              <div className="auth-foot"><span className="lock-icon">⌑</span> Your connection is protected with HTTPS and secure sessions.</div>
            </div>
            <div className="copyright">© 2026 WAYPOINT <span>·</span> BUILT FOR EVERYWHERE</div>
          </div>
        </section>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="loading-screen"><span className="loader" />Loading your secure workspace…</main>}>
      <WaypointApp />
    </Suspense>
  );
}
