/* Racenxt sign-in: password, or a 6-digit code by email (also how new accounts are created).
   rnxAuth(container, { title, sub, brandSub, onSession(session), onOfferPassword }) draws the sign-in into container.
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
  .rxa-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(5,6,8,.72);display:flex;align-items:flex-end;justify-content:center}
  .rxa-box{width:100%;max-width:440px;background:#16181d;border:1px solid #2a2d35;border-radius:22px 22px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom));margin-bottom:var(--kb,0px);animation:rxaUp .32s cubic-bezier(.2,.85,.25,1)}
  @media (min-width:700px){.rxa-ov{align-items:center}.rxa-box{border-radius:22px}}
  @keyframes rxaUp{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
  @media (prefers-reduced-motion:reduce){.rxa-box{animation:none}}`;
  const style = () => { if (!document.getElementById("rxa-css")) { const s = document.createElement("style"); s.id = "rxa-css"; s.textContent = css; document.head.appendChild(s); } };
  const post = (path, body, token) => fetch(`${C.url}/auth/v1/${path}`, { method: "POST", headers: { ...H, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const errText = async r => { const j = await r.json().catch(() => ({})); return { code: j.error_code || j.code || j.error || "", msg: j.msg || j.message || j.error_description || "" }; };

  window.rnxAuth = function (el, o = {}) {
    style();
    let email = o.email || localStorage.getItem("rnx_last_email") || "";
    const show = (sel, txt, cls) => { const m = el.querySelector(sel); m.className = "msg" + (cls ? " " + cls : ""); m.innerHTML = txt; };

    function step1(note) {
      el.innerHTML = `<form class="rxa" id="rxa-f" novalidate>
        <h2>${esc(o.title || "Sign in")}</h2>${o.sub ? `<div class="sub">${o.sub}</div>` : ""}
        <label>Email<input id="rxa-e" type="email" autocomplete="username email" inputmode="email" autocapitalize="off" value="${esc(email)}" required></label>
        <label>Password<span class="pw"><input id="rxa-p" type="password" autocomplete="current-password" placeholder="If you set one"><button type="button" id="rxa-eye">Show</button></span></label>
        <button class="b pri" id="rxa-in">Sign in</button>
        <div class="or">or</div>
        <button type="button" class="b" id="rxa-code">Email me a sign-in code</button>
        <div class="msg" id="rxa-m">${note ? esc(note) : "New here or no password? The code signs you in, and creates your account if it's your first time."}</div>
      </form>`;
      const e = el.querySelector("#rxa-e"), p = el.querySelector("#rxa-p");
      el.querySelector("#rxa-eye").onclick = () => { const on = p.type === "password"; p.type = on ? "text" : "password"; el.querySelector("#rxa-eye").textContent = on ? "Hide" : "Show"; };
      const okEmail = () => { email = e.value.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show("#rxa-m", "Type your email address first.", "bad"); e.focus(); return false; } localStorage.setItem("rnx_last_email", email); return true; };
      el.querySelector("#rxa-f").onsubmit = async ev => {
        ev.preventDefault(); if (!okEmail()) return;
        if (!p.value) { show("#rxa-m", "Type your password, or use “Email me a sign-in code”.", "bad"); p.focus(); return; }
        const b = el.querySelector("#rxa-in"); b.disabled = true; b.textContent = "Signing in…";
        const r = await post("token?grant_type=password", { email, password: p.value });
        b.disabled = false; b.textContent = "Sign in";
        if (r.ok) return o.onSession(sess(await r.json()));
        const x = await errText(r);
        show("#rxa-m", r.status === 429 ? "Too many tries. Wait a minute, or use a sign-in code." : x.code === "email_not_confirmed" ? "Confirm your email first: use “Email me a sign-in code”." : "Wrong email or password. Forgot it? Use “Email me a sign-in code”.", "bad");
      };
      el.querySelector("#rxa-code").onclick = async () => { if (!okEmail()) return; await sendCode(); };
      (email ? p : e).focus({ preventScroll: true });
    }

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

    function step2(again) {
      el.innerHTML = `<form class="rxa" id="rxa-f2" novalidate>
        <h2>Check your email</h2>
        <div class="sub">We sent a code to <b style="color:#f4f4f2">${esc(email)}</b>. It can take a minute; check spam too.</div>
        <label>Sign-in code<input id="rxa-c" class="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" placeholder="••••••"></label>
        <button class="b pri" id="rxa-ok">Sign in</button>
        <div class="msg${again ? " ok" : ""}" id="rxa-m">${again ? "New code sent." : "You can also tap the link in the email."}</div>
        <div class="row"><button type="button" class="lnk" id="rxa-back">← Other email</button><button type="button" class="lnk" id="rxa-again">Send a new code</button></div>
      </form>`;
      const c = el.querySelector("#rxa-c");
      const go = async () => {
        const t = c.value.replace(/\D/g, ""); if (t.length < 6) { show("#rxa-m", "Type the code from the email.", "bad"); c.focus(); return; }
        const b = el.querySelector("#rxa-ok"); b.disabled = true; b.textContent = "Checking…";
        let r = await post("verify", { type: "email", email, token: t });
        if (!r.ok) r = await post("verify", { type: "signup", email, token: t });
        b.disabled = false; b.textContent = "Sign in";
        if (!r.ok) { show("#rxa-m", "That code doesn't work. Check it, or send a new one (each new code replaces the last).", "bad"); c.select(); return; }
        const j = await r.json(), s = sess(j);
        const hasPw = !!(j.user && j.user.user_metadata && j.user.user_metadata.has_password);
        const skipK = "rnx_pw_skip_" + email, skipped = +localStorage.getItem(skipK) || 0;
        if (!hasPw && o.offerPassword !== false && Date.now() - skipped > 30 * 864e5) { const saved = await window.rnxSetPassword({ token: s.access_token, first: true }); if (!saved) localStorage.setItem(skipK, Date.now()); }
        o.onSession(s);
      };
      c.oninput = () => { c.value = c.value.replace(/\D/g, "").slice(0, 10); if (c.value.length === 6) go(); };
      el.querySelector("#rxa-f2").onsubmit = ev => { ev.preventDefault(); go(); };
      el.querySelector("#rxa-back").onclick = () => step1();
      el.querySelector("#rxa-again").onclick = () => sendCode(true);
      c.focus({ preventScroll: true });
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
})();
