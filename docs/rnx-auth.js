/* Racenxt sign-in: two clear tabs, "Create account" (email + a password you choose, confirmed by a code by email)
   and "Sign in" (email + password). Both also offer a 6-digit code by email instead of a password.
   rnxAuth(container, { title, sub, mode: "signup"|"signin", onSession(session), offerPassword }) draws it into container.
   rnxSetPassword({ token, first }) opens "choose a password". Sessions are { access_token, refresh_token, expires_at }. */
(function () {
  const C = window.RNX_CONFIG;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const H = { apikey: C.key, "Content-Type": "application/json" };
  const sess = j => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() / 1000 + (j.expires_in || 3600) });
  const css = `
  .rxa{width:100%;max-width:400px;margin:0 auto;display:grid;gap:14px;text-align:left}
  .rxa h2{font:700 26px 'Barlow Condensed',Barlow,sans-serif;text-transform:uppercase;letter-spacing:.02em;margin:0}
  .rxa .sub{color:#a9abb2;font-size:15px;line-height:1.45;margin:-6px 0 2px}
  .rxa label{display:grid;gap:6px;font:600 13px Barlow,system-ui,sans-serif;color:#a9abb2}
  .rxa input{width:100%;min-height:50px;padding:0 14px;background:#0d0e11;border:1px solid #3b3e47;border-radius:12px;color:#f4f4f2;font:500 16px Barlow,system-ui,sans-serif;box-sizing:border-box}
  .rxa input:focus{outline:none;border-color:#FF5A1F}
  .rxa .pw{position:relative}.rxa .pw input{padding-right:64px}
  .rxa .pw button{position:absolute;right:6px;top:50%;transform:translateY(-50%);height:36px;padding:0 10px;border:0;background:none;color:#a9abb2;font:600 13px Barlow,sans-serif;cursor:pointer}
  .rxa .b{height:50px;border-radius:12px;border:1px solid #33363e;background:#1b1c22;color:#f4f4f2;font:700 16px Barlow,system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}
  .rxa .b.pri{background:#FF5A1F;border-color:#FF5A1F;color:#fff}
  .rxa .b:disabled{opacity:.6;cursor:default}
  .rxa .or{display:flex;align-items:center;gap:10px;color:#6f727b;font-size:12px;text-transform:uppercase;letter-spacing:.12em}
  .rxa .or::before,.rxa .or::after{content:"";flex:1;height:1px;background:#2a2d35}
  .rxa .msg{font-size:14px;color:#a9abb2;min-height:20px;line-height:1.4}
  .rxa .msg.bad{color:#ff8a7a}.rxa .msg.ok{color:#7ddf9a}
  .rxa .lnk{background:none;border:0;color:#FF5A1F;font:600 14px Barlow,sans-serif;cursor:pointer;padding:6px 0;justify-self:start}
  .rxa .code{letter-spacing:.5em;text-align:center;font:700 28px 'Barlow Condensed',Barlow,sans-serif;padding:0 0 0 .5em}
  .rxa .row{display:flex;justify-content:space-between;align-items:center;gap:10px}
  .rxa .tabs{display:grid;grid-template-columns:1fr 1fr;padding:4px;background:#0d0e11;border:1px solid #2a2d35;border-radius:14px}
  .rxa .tabs button{height:42px;border:0;border-radius:10px;background:none;color:#a9abb2;font:700 15px Barlow,system-ui,sans-serif;cursor:pointer}
  .rxa .tabs button[aria-selected="true"]{background:#23262d;color:#f4f4f2}
  .rxa .hint{font-size:13px;color:#8e919b;margin-top:-6px}
  .rxa-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(5,6,8,.72);display:flex;align-items:flex-end;justify-content:center}
  .rxa-box{width:100%;max-width:440px;background:#16181d;border:1px solid #2a2d35;border-radius:22px 22px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom));margin-bottom:var(--kb,0px);animation:rxaUp .32s cubic-bezier(.2,.85,.25,1)}
  @media (min-width:700px){.rxa-ov{align-items:center}.rxa-box{border-radius:22px}}
  @keyframes rxaUp{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
  @media (prefers-reduced-motion:reduce){.rxa-box{animation:none}}
  .rxa-box{max-height:calc(var(--vvh,100dvh) - 12px);overflow-y:auto}
  .rxa-x{width:36px;height:36px;border-radius:50%;border:1px solid #33363e;background:#1b1c22;color:#f4f4f2;cursor:pointer}
  .rxa-sb{display:grid;gap:12px}
  .rxa-sb section{display:grid;gap:8px;padding:14px;border:1px solid #2a2d35;border-radius:14px;background:#1b1c22}
  .rxa-sb h3{margin:0;font:700 15px Barlow,system-ui,sans-serif;display:flex;align-items:center;gap:8px}
  .rxa-sb p{margin:0;color:#a9abb2;font-size:14px;line-height:1.4}
  .rxa-sb .b{height:44px;font-size:15px}
  .rxa-sb .b.bad{color:#ff8a7a;border-color:#5a2e2a;background:transparent}
  .rxa-sb .danger{border-color:#3a2523}
  .rxa .tag{font:700 11px Barlow,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:#2a2d35;color:#a9abb2}
  .rxa .tag.on{background:rgba(64,190,110,.18);color:#7ddf9a}
  .rxa-dev{display:grid;gap:6px}
  .rxa-dev .d{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #26282e}
  .rxa-dev .d:last-child{border-bottom:0}
  .rxa-dev .d span{display:grid;gap:2px;min-width:0}.rxa-dev small{color:#8e919b;font-size:12.5px}
  .rxa-qr{display:flex;gap:12px;align-items:center;font-size:14px;color:#c9cad0;line-height:1.45}
  .rxa-qr img{width:132px;height:132px;flex:none;background:#fff;border-radius:10px;padding:6px;box-sizing:border-box}
  .rxa-qr code{font-size:12px;color:#f4f4f2;word-break:break-all}
  .rxa-qr a{color:#FF5A1F}`;
  const style = () => { if (!document.getElementById("rxa-css")) { const s = document.createElement("style"); s.id = "rxa-css"; s.textContent = css; document.head.appendChild(s); } };
  const post = (path, body, token) => fetch(`${C.url}/auth/v1/${path}`, { method: "POST", headers: { ...H, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const errText = async r => { const j = await r.json().catch(() => ({})); return { code: j.error_code || j.code || j.error || "", msg: j.msg || j.message || j.error_description || "" }; };

  window.rnxAuth = function (el, o = {}) {
    style();
    let email = o.email || localStorage.getItem("rnx_last_email") || "";
    const show = (sel, txt, cls) => { const m = el.querySelector(sel); m.className = "msg" + (cls ? " " + cls : ""); m.innerHTML = txt; };

    // "signup" for new people (no remembered email), "signin" for people who've been here
    let mode = o.mode === "signin" || o.mode === "signup" ? o.mode : (localStorage.getItem("rnx_last_email") ? "signin" : "signup");
    const tabs = () => `<div class="tabs" role="tablist"><button type="button" role="tab" data-m="signup" aria-selected="${mode === "signup"}">Create account</button><button type="button" role="tab" data-m="signin" aria-selected="${mode === "signin"}">Sign in</button></div>`;
    const bindTabs = () => el.querySelectorAll(".tabs button").forEach(b => b.onclick = () => { if (b.dataset.m === mode) return; const v = el.querySelector("#rxa-e")?.value.trim(); if (v) email = v; mode = b.dataset.m; step1(); });
    const eyeOn = (btn, inp) => { btn.onclick = () => { const on = inp.type === "password"; inp.type = on ? "text" : "password"; btn.textContent = on ? "Hide" : "Show"; }; };

    function step1(note, cls) {
      return mode === "signup" ? signupForm(note, cls) : signinForm(note, cls);
    }

    function signupForm(note, cls) {
      el.innerHTML = `<form class="rxa" id="rxa-f" novalidate>
        <h2>${esc(o.title || "Create your account")}</h2>${o.sub ? `<div class="sub">${o.sub}</div>` : ""}
        ${tabs()}
        <label>Email<input id="rxa-e" type="email" autocomplete="email" inputmode="email" autocapitalize="off" value="${esc(email)}" required></label>
        <label>Choose a password<span class="pw"><input id="rxa-p" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"><button type="button" id="rxa-eye">Show</button></span></label>
        <button class="b pri" id="rxa-in">Create account</button>
        <div class="hint">We'll email you a 6-digit code to confirm it's your address.</div>
        <div class="or">or</div>
        <button type="button" class="b" id="rxa-code">No password: email me a code</button>
        <div class="msg${cls ? " " + cls : ""}" id="rxa-m">${note ? esc(note) : ""}</div>
      </form>`;
      bindTabs();
      const e = el.querySelector("#rxa-e"), p = el.querySelector("#rxa-p");
      eyeOn(el.querySelector("#rxa-eye"), p);
      el.querySelector("#rxa-f").onsubmit = async ev => {
        ev.preventDefault(); if (!okEmail(e)) return;
        if (p.value.length < 8) { show("#rxa-m", "Choose a password of at least 8 characters, or use “No password: email me a code”.", "bad"); p.focus(); return; }
        const b = el.querySelector("#rxa-in"); b.disabled = true; b.textContent = "Creating your account…";
        const r = await post(`signup?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { email, password: p.value, data: { has_password: true } });
        b.disabled = false; b.textContent = "Create account";
        if (!r.ok) {
          const x = await errText(r);
          if (x.code === "user_already_exists" || /already registered/i.test(x.msg)) { mode = "signin"; return step1("You already have an account with this email: sign in.", "ok"); }
          show("#rxa-m", r.status === 429 ? "Too many tries. Wait a minute and try again." : x.code === "weak_password" ? "That password is too easy to guess. Try a longer one, mixing words and numbers." : x.code === "signup_disabled" ? "New accounts are closed for now." : /email/i.test(x.code) ? "Check the email address and try again." : "Couldn't create the account. Try again in a moment.", "bad");
          return;
        }
        const j = await r.json();
        // email confirmation off: signed in right away
        if (j.access_token) { const s = await second(sess(j)); return s ? o.onSession(s) : step1("Sign-in cancelled."); }
        // an existing address comes back with no identities (the server doesn't say so, to protect privacy)
        const u = j.user || j;
        if (u && Array.isArray(u.identities) && u.identities.length === 0) { mode = "signin"; return step1("You already have an account with this email: sign in with your password, or get a code.", "ok"); }
        step2(false, "signup");
      };
      el.querySelector("#rxa-code").onclick = async () => { if (!okEmail(e)) return; await sendCode(); };
      (email ? p : e).focus({ preventScroll: true });
    }

    function signinForm(note, cls) {
      el.innerHTML = `<form class="rxa" id="rxa-f" novalidate>
        <h2>${esc(o.signinTitle || "Welcome back")}</h2>
        ${tabs()}
        <label>Email<input id="rxa-e" type="email" autocomplete="username email" inputmode="email" autocapitalize="off" value="${esc(email)}" required></label>
        <label>Password<span class="pw"><input id="rxa-p" type="password" autocomplete="current-password"><button type="button" id="rxa-eye">Show</button></span></label>
        <button class="b pri" id="rxa-in">Sign in</button>
        <div class="or">or</div>
        <button type="button" class="b" id="rxa-code">Email me a sign-in code</button>
        <div class="hint">No password, or forgot it? The code signs you in.</div>
        <div class="msg${cls ? " " + cls : ""}" id="rxa-m">${note ? esc(note) : ""}</div>
      </form>`;
      bindTabs();
      const e = el.querySelector("#rxa-e"), p = el.querySelector("#rxa-p");
      eyeOn(el.querySelector("#rxa-eye"), p);
      el.querySelector("#rxa-f").onsubmit = async ev => {
        ev.preventDefault(); if (!okEmail(e)) return;
        if (!p.value) { show("#rxa-m", "Type your password, or use “Email me a sign-in code”.", "bad"); p.focus(); return; }
        const b = el.querySelector("#rxa-in"); b.disabled = true; b.textContent = "Signing in…";
        const r = await post("token?grant_type=password", { email, password: p.value });
        b.disabled = false; b.textContent = "Sign in";
        if (r.ok) { const s = await second(sess(await r.json())); return s ? o.onSession(s) : step1("Sign-in cancelled."); }
        const x = await errText(r);
        show("#rxa-m", r.status === 429 ? "Too many tries. Wait a minute, or use a sign-in code."
          : x.code === "email_not_confirmed" ? "Your email isn't confirmed yet: use “Email me a sign-in code”, it confirms it too."
          : `Wrong email or password. Forgot it? Use “Email me a sign-in code”. New here? <button type="button" class="lnk" id="rxa-tosu" style="padding:0">Create an account</button>`, "bad");
        const tosu = el.querySelector("#rxa-tosu"); if (tosu) tosu.onclick = () => { mode = "signup"; step1(); };
      };
      el.querySelector("#rxa-code").onclick = async () => { if (!okEmail(e)) return; await sendCode(); };
      (email ? p : e).focus({ preventScroll: true });
    }
    const okEmail = e => { email = e.value.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show("#rxa-m", "Type your email address first.", "bad"); e.focus(); return false; } localStorage.setItem("rnx_last_email", email); return true; };

    async function sendCode(again) {
      const b = el.querySelector("#rxa-code") || el.querySelector("#rxa-again"); if (b) b.disabled = true;
      const r = await post(`otp?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { email, create_user: true });
      if (b) b.disabled = false;
      if (!r.ok) {
        const t = r.status === 429 ? "Too many emails in a short time. Wait a minute and try again." : "Couldn't send the email. Check the address and try again.";
        if (el.querySelector("#rxa-m")) show("#rxa-m", t, "bad"); return;
      }
      step2(again);
    }

    function step2(again, kind) {
      const signup = kind === "signup";
      el.innerHTML = `<form class="rxa" id="rxa-f2" novalidate>
        <h2>${signup ? "Confirm your email" : "Check your email"}</h2>
        <div class="sub">We sent a ${signup ? "confirmation" : ""} code to <b style="color:#f4f4f2">${esc(email)}</b>. It can take a minute; check spam too.</div>
        <label>Sign-in code<input id="rxa-c" class="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="••••••"></label>
        <button class="b pri" id="rxa-ok">${signup ? "Confirm" : "Sign in"}</button>
        <div class="msg${again ? " ok" : ""}" id="rxa-m">${again ? "New code sent." : "You can also tap the link in the email."}</div>
        <div class="row"><button type="button" class="lnk" id="rxa-back">← Other email</button><button type="button" class="lnk" id="rxa-again">Send a new code</button></div>
      </form>`;
      const c = el.querySelector("#rxa-c");
      const go = async () => {
        const t = c.value.replace(/\D/g, ""); if (t.length < 6) { show("#rxa-m", "Type the code from the email.", "bad"); c.focus(); return; }
        const b = el.querySelector("#rxa-ok"); b.disabled = true; b.textContent = "Checking…";
        let r = await post("verify", { type: signup ? "signup" : "email", email, token: t });
        if (!r.ok) r = await post("verify", { type: signup ? "email" : "signup", email, token: t });
        b.disabled = false; b.textContent = signup ? "Confirm" : "Sign in";
        if (!r.ok) { show("#rxa-m", "That code doesn't work. Check it, or send a new one (each new code replaces the last).", "bad"); c.select(); return; }
        const j = await r.json(); let s = await second(sess(j)); if (!s) return step1("Sign-in cancelled.");
        const hasPw = !!(j.user && j.user.user_metadata && j.user.user_metadata.has_password);
        const skipK = "rnx_pw_skip_" + email, skipped = +localStorage.getItem(skipK) || 0;
        if (!hasPw && o.offerPassword !== false && Date.now() - skipped > 30 * 864e5) { const saved = await window.rnxSetPassword({ token: s.access_token, first: true }); if (!saved) localStorage.setItem(skipK, Date.now()); }
        o.onSession(s);
      };
      c.oninput = () => { c.value = c.value.replace(/\D/g, "").slice(0, 10); if (c.value.length === 6) go(); };
      el.querySelector("#rxa-f2").onsubmit = ev => { ev.preventDefault(); go(); };
      el.querySelector("#rxa-back").onclick = () => step1();
      el.querySelector("#rxa-again").onclick = () => signup ? resendSignup() : sendCode(true);
      c.focus({ preventScroll: true });
    }
    // a new confirmation code for an account created with a password
    async function resendSignup() {
      const r = await post(`resend?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { type: "signup", email });
      if (r.ok) return step2(true, "signup");
      show("#rxa-m", r.status === 429 ? "Too many emails in a short time. Wait a minute and try again." : "Couldn't send a new code. Try again in a moment.", "bad");
    }
    // accounts with two-step sign-in: the authenticator code comes next (null if cancelled)
    async function second(s) {
      const f = await window.rnxNeedsSecondStep(s.access_token);
      return f ? await window.rnxMfaVerify({ token: s.access_token, factor: f }) : s;
    }
    step1(o.note);
  };

  // choose / change the password. Resolves when saved or skipped.
  window.rnxSetPassword = function ({ token, first } = {}) {
    style();
    return new Promise(resolve => {
      const ov = document.createElement("div"); ov.className = "rxa-ov";
      ov.innerHTML = `<div class="rxa-box" role="dialog" aria-modal="true" aria-labelledby="rxa-pt"><form class="rxa" id="rxa-pf" novalidate>
        <h2 id="rxa-pt">${first ? "Add a password?" : "Your password"}</h2>
        <div class="sub">${first ? "Optional. Next time, sign in with your email and password, without waiting for a code." : "Choose a new password. You can always sign in with a code too."}</div>
        <input type="email" autocomplete="username" value="${esc(localStorage.getItem("rnx_last_email") || "")}" hidden>
        <label>New password<span class="pw"><input id="rxa-np" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"><button type="button" id="rxa-eye2">Show</button></span></label>
        <button class="b pri" id="rxa-ps">Save password</button>
        <button type="button" class="b" id="rxa-px">${first ? "Not now" : "Cancel"}</button>
        <div class="msg" id="rxa-pm"></div></form></div>`;
      document.body.appendChild(ov);
      const np = ov.querySelector("#rxa-np"), m = ov.querySelector("#rxa-pm");
      const close = v => { ov.remove(); resolve(v); };
      ov.querySelector("#rxa-eye2").onclick = () => { const on = np.type === "password"; np.type = on ? "text" : "password"; ov.querySelector("#rxa-eye2").textContent = on ? "Hide" : "Show"; };
      ov.querySelector("#rxa-px").onclick = () => close(false);
      ov.addEventListener("keydown", e => { if (e.key === "Escape") close(false); });
      ov.querySelector("#rxa-pf").onsubmit = async e => {
        e.preventDefault();
        if (np.value.length < 8) { m.className = "msg bad"; m.textContent = "At least 8 characters."; np.focus(); return; }
        const b = ov.querySelector("#rxa-ps"); b.disabled = true; b.textContent = "Saving…";
        const r = await fetch(`${C.url}/auth/v1/user`, { method: "PUT", headers: { ...H, Authorization: `Bearer ${token}` }, body: JSON.stringify({ password: np.value, data: { has_password: true } }) });
        b.disabled = false; b.textContent = "Save password";
        if (r.ok) { m.className = "msg ok"; m.textContent = "Password saved."; setTimeout(() => close(true), 700); return; }
        const x = await errText(r);
        m.className = "msg bad";
        m.textContent = x.code === "weak_password" ? "Too easy to guess. Try a longer one, mixing words and numbers." : x.code === "same_password" ? "That's already your password." : x.code === "reauthentication_needed" ? "For safety, sign in again with a code, then change it." : "Couldn't save it. Try again.";
      };
      setTimeout(() => np.focus(), 50);
    });
  };

  // ---------- 2-step sign-in (authenticator app) ----------
  const jwtAal = t => { try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aal || "aal1"; } catch (e) { return "aal1"; } };
  const authGet = (path, token) => fetch(`${C.url}/auth/v1/${path}`, { headers: { apikey: C.key, Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null);
  const totpOf = u => ((u && u.factors) || []).filter(f => f.factor_type === "totp");
  window.rnxNeedsSecondStep = async token => { if (jwtAal(token) === "aal2") return null; const u = await authGet("user", token); return totpOf(u).find(f => f.status === "verified") || null; };

  // ask for the 6-digit code from the authenticator app; resolves with the new (aal2) session, or null if cancelled
  window.rnxMfaVerify = function ({ token, factor, title, sub }) {
    style();
    return new Promise(resolve => {
      const ov = document.createElement("div"); ov.className = "rxa-ov";
      ov.innerHTML = `<div class="rxa-box" role="dialog" aria-modal="true" aria-labelledby="rxa-mt"><form class="rxa" id="rxa-mf" novalidate>
        <h2 id="rxa-mt">${esc(title || "Two-step sign-in")}</h2><div class="sub">${esc(sub || "Open your authenticator app and type the 6-digit code for Racenxt.")}</div>
        <label>Code from your app<input id="rxa-mc" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"></label>
        <button class="b pri" id="rxa-mok">Continue</button><button type="button" class="b" id="rxa-mx">Cancel</button>
        <div class="msg" id="rxa-mm"></div></form></div>`;
      document.body.appendChild(ov);
      const c = ov.querySelector("#rxa-mc"), m = ov.querySelector("#rxa-mm");
      const close = v => { ov.remove(); resolve(v); };
      ov.querySelector("#rxa-mx").onclick = () => close(null);
      const go = async () => {
        const code = c.value.replace(/\D/g, ""); if (code.length !== 6) { m.className = "msg bad"; m.textContent = "Type the 6 digits."; return; }
        const b = ov.querySelector("#rxa-mok"); b.disabled = true;
        const ch = await post(`factors/${factor.id}/challenge`, {}, token);
        const cj = ch.ok ? await ch.json() : null;
        const r = cj ? await post(`factors/${factor.id}/verify`, { challenge_id: cj.id, code }, token) : null;
        b.disabled = false;
        if (r && r.ok) return close(sess(await r.json()));
        m.className = "msg bad"; m.textContent = "That code doesn't work. Codes change every 30 seconds: use the one on screen now."; c.select();
      };
      c.oninput = () => { c.value = c.value.replace(/\D/g, "").slice(0, 6); if (c.value.length === 6) go(); };
      ov.querySelector("#rxa-mf").onsubmit = e => { e.preventDefault(); go(); };
      setTimeout(() => c.focus(), 50);
    });
  };

  // set up the authenticator app; resolves with the new (aal2) session, or null if cancelled
  window.rnxMfaEnroll = async function ({ token, required }) {
    style();
    const u = await authGet("user", token);
    for (const f of totpOf(u).filter(f => f.status !== "verified")) await fetch(`${C.url}/auth/v1/factors/${f.id}`, { method: "DELETE", headers: { apikey: C.key, Authorization: `Bearer ${token}` } });
    const r = await post("factors", { factor_type: "totp", friendly_name: "Racenxt " + new Date().toISOString().slice(0, 10), issuer: "Racenxt" }, token);
    if (!r.ok) { alert("Couldn't start the set-up. Try again in a minute."); return null; }
    const f = await r.json(), qr = f.totp?.qr_code || "", secret = f.totp?.secret || "", uri = f.totp?.uri || "";
    return new Promise(resolve => {
      const ov = document.createElement("div"); ov.className = "rxa-ov";
      ov.innerHTML = `<div class="rxa-box" role="dialog" aria-modal="true" aria-labelledby="rxa-et"><form class="rxa" id="rxa-ef" novalidate>
        <h2 id="rxa-et">${required ? "Secure your admin" : "Two-step sign-in"}</h2>
        <div class="sub">${required ? "Admin access needs a second step. " : ""}Use an authenticator app: the iPhone <b>Passwords</b> app, Google Authenticator or 1Password.</div>
        <div class="rxa-qr">${qr ? `<img src="${qr.startsWith("data:") ? qr : "data:image/svg+xml;utf8," + encodeURIComponent(qr)}" alt="QR code to scan with your authenticator app">` : ""}<div><b>1.</b> Scan this code with the app${uri ? ` (on this phone: <a href="${esc(uri)}">open in the app</a>)` : ""}.<br><small>Or type this key: <code>${esc(secret.replace(/(.{4})/g, "$1 ").trim())}</code></small></div></div>
        <label><span><b>2.</b> Type the 6-digit code the app shows</span><input id="rxa-ec" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"></label>
        <button class="b pri" id="rxa-eok">Turn on</button><button type="button" class="b" id="rxa-ex">${required ? "Sign out" : "Cancel"}</button>
        <div class="msg" id="rxa-em"></div></form></div>`;
      document.body.appendChild(ov);
      const c = ov.querySelector("#rxa-ec"), m = ov.querySelector("#rxa-em");
      const close = v => { ov.remove(); resolve(v); };
      ov.querySelector("#rxa-ex").onclick = () => close(null);
      const go = async () => {
        const code = c.value.replace(/\D/g, ""); if (code.length !== 6) { m.className = "msg bad"; m.textContent = "Type the 6 digits from the app."; return; }
        const b = ov.querySelector("#rxa-eok"); b.disabled = true;
        const ch = await post(`factors/${f.id}/challenge`, {}, token), cj = ch.ok ? await ch.json() : null;
        const v = cj ? await post(`factors/${f.id}/verify`, { challenge_id: cj.id, code }, token) : null;
        b.disabled = false;
        if (v && v.ok) { m.className = "msg ok"; m.textContent = "Two-step sign-in is on."; const s = sess(await v.json()); return setTimeout(() => close(s), 700); }
        m.className = "msg bad"; m.textContent = "That code doesn't work. Use the code the app shows right now."; c.select();
      };
      c.oninput = () => { c.value = c.value.replace(/\D/g, "").slice(0, 6); if (c.value.length === 6) go(); };
      ov.querySelector("#rxa-ef").onsubmit = e => { e.preventDefault(); go(); };
    });
  };

  // ---------- Security: password, two-step, devices, delete account ----------
  const device = ua => {
    ua = ua || ""; const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
    const br = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
    return br ? `${os} · ${br}` : os;
  };
  const ago = d => { const s = (Date.now() - new Date(d)) / 1000; return s < 120 ? "now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : Math.round(s / 86400) === 1 ? "yesterday" : `${Math.round(s / 86400)} days ago`; };
  window.rnxSecurity = function ({ getToken, onSession, email }) {
    style();
    const rpc = async (fn, body) => { const t = await getToken(); const r = await fetch(`${C.url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...H, Authorization: `Bearer ${t}` }, body: JSON.stringify(body || {}) }); if (!r.ok) { const x = await r.json().catch(() => ({})); throw new Error(x.message || "failed"); } return r.status === 204 ? null : r.json(); };
    const ov = document.createElement("div"); ov.className = "rxa-ov";
    const close = () => ov.remove();
    ov.innerHTML = `<div class="rxa-box rxa-sec" role="dialog" aria-modal="true" aria-labelledby="rxa-st"><div class="rxa">
      <div class="row"><h2 id="rxa-st">Security</h2><button type="button" class="rxa-x" id="rxa-sx" aria-label="Close">✕</button></div>
      <div id="rxa-sb" class="rxa-sb"><div class="msg">Loading…</div></div></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector("#rxa-sx").onclick = close;
    ov.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    const draw = async () => {
      const t = await getToken(), u = await authGet("user", t), f = totpOf(u).find(x => x.status === "verified");
      let ses = []; try { ses = await rpc("my_sessions"); } catch (e) {}
      ov.querySelector("#rxa-sb").innerHTML = `
        <section><h3>Password</h3><p>${u?.user_metadata?.has_password ? "You can sign in with your password, or with a code by email." : "No password yet: you sign in with a code by email."}</p>
          <button type="button" class="b" id="rxa-spw">${u?.user_metadata?.has_password ? "Change password" : "Add a password"}</button></section>
        <section><h3>Two-step sign-in <span class="tag ${f ? "on" : ""}">${f ? "On" : "Off"}</span></h3><p>${f ? "After your password or code, we also ask for the code from your authenticator app." : "Adds a code from an authenticator app after your password or email code. Recommended."}</p>
          <button type="button" class="b" id="rxa-s2">${f ? "Turn off" : "Turn on"}</button></section>
        <section><h3>Your devices</h3><div class="rxa-dev">${ses.map(s => `<div class="d"><span><b>${esc(device(s.user_agent))}</b><small>${s.current ? "This device" : "Last used " + ago(s.last_used)}${s.ip ? " · " + esc(s.ip) : ""}</small></span>${s.current ? "" : `<button type="button" class="lnk" data-end="${s.id}">Sign out</button>`}</div>`).join("") || `<div class="msg">No other device.</div>`}</div>
          ${ses.filter(s => !s.current).length ? `<button type="button" class="b" id="rxa-sall">Sign out everywhere else</button>` : ""}</section>
        <section class="danger"><h3>Delete my account</h3><p>Deletes your account and the pages you own, with their races, partners and events. This can't be undone.</p>
          <button type="button" class="b bad" id="rxa-sdel">Delete my account</button></section>
        <div class="msg" id="rxa-sm"></div>`;
      const msg = (txt, cls) => { const m = ov.querySelector("#rxa-sm"); m.className = "msg " + (cls || ""); m.textContent = txt; };
      ov.querySelector("#rxa-spw").onclick = () => changePassword(u);
      ov.querySelector("#rxa-s2").onclick = async () => {
        if (f) {
          if (!confirm("Turn off two-step sign-in? Your account will be protected by your password or email code only.")) return;
          let tok = await getToken();
          if (jwtAal(tok) !== "aal2") { const s = await window.rnxMfaVerify({ token: tok, factor: f, title: "Confirm it's you" }); if (!s) return; onSession(s); tok = s.access_token; }
          const r = await fetch(`${C.url}/auth/v1/factors/${f.id}`, { method: "DELETE", headers: { apikey: C.key, Authorization: `Bearer ${tok}` } });
          if (!r.ok) return msg("Couldn't turn it off. Sign in again and retry.", "bad");
          msg("Two-step sign-in is off.", "ok");
        } else {
          const s = await window.rnxMfaEnroll({ token: await getToken() }); if (s) { onSession(s); msg("Two-step sign-in is on.", "ok"); }
        }
        draw();
      };
      ov.querySelectorAll("[data-end]").forEach(b => b.onclick = async () => { try { await rpc("end_my_session", { sid: b.dataset.end }); draw(); } catch (e) { msg("Couldn't sign that device out.", "bad"); } });
      const all = ov.querySelector("#rxa-sall"); if (all) all.onclick = async () => { const r = await fetch(`${C.url}/auth/v1/logout?scope=others`, { method: "POST", headers: { ...H, Authorization: `Bearer ${await getToken()}` } }); msg(r.ok ? "Signed out everywhere else." : "Couldn't do it. Try again.", r.ok ? "ok" : "bad"); draw(); };
      ov.querySelector("#rxa-sdel").onclick = async () => {
        const w = prompt("This deletes your account and the pages you own, for good.\nType DELETE to confirm:");
        if ((w || "").trim().toUpperCase() !== "DELETE") return;
        try { await rpc("delete_my_account"); } catch (e) { return msg(/Admin/.test(e.message) ? "Admin accounts can't be deleted from the app." : "Couldn't delete the account. Try again.", "bad"); }
        try { localStorage.removeItem("rnx_sess"); localStorage.removeItem("rnx_profile"); } catch (e) {}
        alert("Your account has been deleted."); location.href = (window.RNX_BASE || "/") + "app.html";
      };
    };
    // a fresh code by email before a password change (someone holding your unlocked phone can't change it)
    const changePassword = async u => {
      const tok = await getToken();
      const r = await post("reauthenticate", {}, tok); // emails a confirmation code
      const b = ov.querySelector("#rxa-sb");
      b.innerHTML = `<form class="rxa" id="rxa-cp" novalidate><p class="sub">${r.ok ? `We emailed a confirmation code to <b style="color:#f4f4f2">${esc(u?.email || email || "you")}</b>.` : "Type your new password."}</p>
        ${r.ok ? `<label>Code from the email<input id="rxa-cn" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="••••••"></label>` : ""}
        <input type="email" autocomplete="username" value="${esc(u?.email || "")}" hidden>
        <label>New password<span class="pw"><input id="rxa-cnp" type="password" autocomplete="new-password" placeholder="At least 8 characters"><button type="button" id="rxa-eye3">Show</button></span></label>
        <button class="b pri">Save password</button><button type="button" class="b" id="rxa-cpx">Back</button><div class="msg" id="rxa-cm"></div></form>`;
      const np = b.querySelector("#rxa-cnp"), m = b.querySelector("#rxa-cm");
      b.querySelector("#rxa-eye3").onclick = () => { const on = np.type === "password"; np.type = on ? "text" : "password"; b.querySelector("#rxa-eye3").textContent = on ? "Hide" : "Show"; };
      b.querySelector("#rxa-cpx").onclick = draw;
      b.querySelector("#rxa-cp").onsubmit = async e => {
        e.preventDefault();
        const nonce = (b.querySelector("#rxa-cn")?.value || "").replace(/\D/g, "");
        if (r.ok && nonce.length < 6) { m.className = "msg bad"; m.textContent = "Type the code from the email."; return; }
        if (np.value.length < 8) { m.className = "msg bad"; m.textContent = "At least 8 characters."; return; }
        const x = await fetch(`${C.url}/auth/v1/user`, { method: "PUT", headers: { ...H, Authorization: `Bearer ${await getToken()}` }, body: JSON.stringify({ password: np.value, data: { has_password: true }, ...(nonce ? { nonce } : {}) }) });
        if (x.ok) { m.className = "msg ok"; m.textContent = "Password saved."; return setTimeout(draw, 900); }
        const er = await errText(x);
        m.className = "msg bad"; m.textContent = er.code === "weak_password" ? "Too easy to guess. Try a longer one." : er.code === "same_password" ? "That's already your password." : /nonce|reauth/i.test(er.code + er.msg) ? "That code doesn't work or has expired. Go back and try again." : "Couldn't save it. Try again.";
      };
    };
    draw();
  };
})();
