/* SOLE Contractor Portal — v5.0.0
   Purpose:
   - Contractors create an Email/Password login (Firebase Auth)
   - Portal writes a contractor profile to Firestore: profiles/{uid}
   - Sales App (index.html) reads that profile and grants access when status === "approved"

   IMPORTANT (optional):
   - If you want to require an invite code, set SIGNUP.requireInviteCode = true
   - Then set SIGNUP.inviteCode = "YOUR_SECRET_CODE"
*/
(() => {
  "use strict";

  const APP_VERSION = "v5.0.0";
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyC_tp_Yll0eTa1dYOiKzGFGdamZfOdsyGw",
    authDomain: "solenterprises-58215.firebaseapp.com",
    projectId: "solenterprises-58215",
    storageBucket: "solenterprises-58215.firebasestorage.app",
    messagingSenderId: "794571115579",
    appId: "1:794571115579:web:6e4b7a3f5b3fdb9d0f0fbd"
  };

  const SIGNUP = {
    requireInviteCode: false,
    inviteCode: "CHANGE_ME",
    autoApprove: true   // if false: creates profile with status "pending"
  };

  const $ = (id) => document.getElementById(id);

  function setMsg(el, type, text) {
    if (!el) return;
    el.style.display = "block";
    el.classList.remove("ok", "bad");
    if (type) el.classList.add(type);
    el.textContent = text;
  }
  function clearMsg(el) {
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
    el.classList.remove("ok", "bad");
  }

  function setTab(active) {
    const tabs = [
      { key: "signin", btn: $("tabSignIn"), panel: $("panelSignIn") },
      { key: "signup", btn: $("tabSignUp"), panel: $("panelSignUp") },
      { key: "reset", btn: $("tabReset"), panel: $("panelReset") }
    ];
    tabs.forEach(t => {
      const on = t.key === active;
      if (t.btn) t.btn.classList.toggle("active", on);
      if (t.panel) t.panel.style.display = on ? "block" : "none";
    });
    clearMsg($("msgSignIn"));
    clearMsg($("msgSignUp"));
    clearMsg($("msgReset"));
  }

  function normalize(str) {
    return String(str || "").trim();
  }

  function inviteOk(code) {
    if (!SIGNUP.requireInviteCode) return true;
    return normalize(code) === normalize(SIGNUP.inviteCode);
  }

  function requireFirebase() {
    if (!window.firebase) throw new Error("Firebase SDK not loaded.");
    if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
  }

  async function writeProfile(uid, email, status) {
    const db = firebase.firestore();
    const ref = db.collection("profiles").doc(uid);
    const payload = {
      email: email || "",
      role: "contractor",
      status,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // Create if missing (merge keeps any existing fields)
    await ref.set(payload, { merge: true });
  }

  async function onSignUp() {
    const msg = $("msgSignUp");
    clearMsg(msg);

    const email = normalize($("upEmail")?.value);
    const pass = String($("upPass")?.value || "");
    const code = normalize($("upCode")?.value);

    if (!email || !email.includes("@")) return setMsg(msg, "bad", "Enter a valid email address.");
    if (pass.length < 8) return setMsg(msg, "bad", "Password must be at least 8 characters.");
    if (!inviteOk(code)) return setMsg(msg, "bad", "Invite code is invalid.");

    try {
      requireFirebase();
      const auth = firebase.auth();
      const cred = await auth.createUserWithEmailAndPassword(email, pass);

      const status = SIGNUP.autoApprove ? "approved" : "pending";
      await writeProfile(cred.user.uid, email, status);

      if (status === "approved") {
        setMsg(msg, "ok", "Account created and approved. Tap “Open SOLE Sales App”.");
      } else {
        setMsg(msg, "ok", "Account created. Status is pending approval.");
      }
    } catch (e) {
      const t = String(e && e.message ? e.message : e);
      setMsg(msg, "bad", t);
    }
  }

  async function onSignIn() {
    const msg = $("msgSignIn");
    clearMsg(msg);

    const email = normalize($("inEmail")?.value);
    const pass = String($("inPass")?.value || "");
    if (!email || !email.includes("@")) return setMsg(msg, "bad", "Enter a valid email address.");
    if (!pass) return setMsg(msg, "bad", "Enter your password.");

    try {
      requireFirebase();
      const auth = firebase.auth();
      await auth.signInWithEmailAndPassword(email, pass);
      setMsg(msg, "ok", "Signed in. You can open the Sales App now.");
    } catch (e) {
      const t = String(e && e.message ? e.message : e);
      setMsg(msg, "bad", t);
    }
  }

  async function onReset() {
    const msg = $("msgReset");
    clearMsg(msg);

    const email = normalize($("reEmail")?.value);
    if (!email || !email.includes("@")) return setMsg(msg, "bad", "Enter a valid email address.");

    try {
      requireFirebase();
      await firebase.auth().sendPasswordResetEmail(email);
      setMsg(msg, "ok", "Reset email sent. Check your inbox/spam.");
    } catch (e) {
      const t = String(e && e.message ? e.message : e);
      setMsg(msg, "bad", t);
    }
  }

  async function onSignOut() {
    try {
      requireFirebase();
      await firebase.auth().signOut();
    } catch (_) {}
  }

  function boot() {
    // Tabs
    $("tabSignIn")?.addEventListener("click", () => setTab("signin"));
    $("tabSignUp")?.addEventListener("click", () => setTab("signup"));
    $("tabReset")?.addEventListener("click", () => setTab("reset"));

    // Buttons
    $("signInBtn")?.addEventListener("click", onSignIn);
    $("signUpBtn")?.addEventListener("click", onSignUp);
    $("resetBtn")?.addEventListener("click", onReset);
    $("signOutBtn")?.addEventListener("click", onSignOut);
    $("clearUpBtn")?.addEventListener("click", () => {
      if ($("upEmail")) $("upEmail").value = "";
      if ($("upPass")) $("upPass").value = "";
      if ($("upCode")) $("upCode").value = "";
      clearMsg($("msgSignUp"));
    });

    // Firebase session display
    try {
      requireFirebase();
      const auth = firebase.auth();
      auth.onAuthStateChanged((u) => {
        const signed = $("signedInAs");
        const outBtn = $("signOutBtn");
        if (!signed) return;

        if (!u) {
          signed.textContent = "No — you are signed out.";
          if (outBtn) outBtn.style.display = "none";
          return;
        }

        const email = u.email || "Signed in";
        const uid = u.uid || "";
        signed.innerHTML = `Yes — <b>${email}</b> <span class="tiny">(${uid})</span>`;
        if (outBtn) outBtn.style.display = "inline-block";
      });
    } catch (e) {
      const signed = $("signedInAs");
      if (signed) signed.textContent = "Firebase not loaded. This page must be hosted (https) to use login.";
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
