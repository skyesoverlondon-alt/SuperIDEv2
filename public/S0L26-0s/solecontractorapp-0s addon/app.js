/* SOLE Sales App — Standalone PWA (Firebase Auth + Firestore) — v6.0.0 */
(() => {
  "use strict";

  const APP_VERSION = "v6.0.0";

  /* ============ CONFIG ============ */
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyC_tp_Yll0eTa1dYOiKzGFGdamZfOdsyGw",
    authDomain: "solenterprises-58215.firebaseapp.com",
    projectId: "solenterprises-58215",
    storageBucket: "solenterprises-58215.firebasestorage.app"
  };

  const PIN_GATE = {
    enabled: true,
    pin: "7392",
    sessionHours: 6
  };

  // Fallback in-memory PIN session (covers browsers where localStorage is blocked)
  let PIN_MEM_TOKEN = null;


  // Contractor access control (pairs with portal.html signup)
  // - Contractors create an account in portal.html
  // - A profile doc is created at: profiles/{uid}
  // - Access is granted when status === "approved"
  const ACCESS = {
    requireApproved: true
  };

  const STAGES = [
    "New Lead (Unworked)",
    "Attempting Contact",
    "Connected (Conversation Started)",
    "Fit Check Scheduled (10 min)",
    "Fit Check Completed — PASS",
    "Discovery Scheduled (30–45 min)",
    "Discovery Completed",
    "Demo Scheduled",
    "Demo Completed",
    "Proposal Sent",
    "Verbal Yes / Pending Deposit",
    "Closed Won (Deposit Paid)",
    "Closed Lost",
    "Disqualified"
  ];

  const DEFAULT_TEMPLATES = [
    {
      channel: "DM",
      title: "Phoenix Local — Free Revamp Hook",
      text:
`Yo — I’m local (Phoenix/Glendale) and I do agency-level web builds.

I just did a complimentary revamp for a business as a welcome package — and it reminded me of your brand.

If I rebuilt your site to look like a premium portal (fast, mobile-perfect, high trust), would you want to see a 60-second demo?

If yes, drop the best email and I’ll send the demo link.`
    },
    {
      channel: "DM",
      title: "Straight Offer — 10 min Fit Check",
      text:
`Quick one: are you the owner/decision maker?

If yes — I can do a 10-minute fit check and tell you exactly what’s costing you leads on mobile + what a premium rebuild would look like.

No fluff. Want to book it this week?`
    },
    {
      channel: "SMS",
      title: "Short Text — Book Fit Check",
      text:
`Hey — this is {rep} with Skyes Over London LC. Quick question: are you the owner/decision maker for {business}? If yes, I can do a 10-min fit check and show what we’d rebuild to increase calls/leads.`
    },
    {
      channel: "CALL",
      title: "Opener — Permission + Frame",
      text:
`Hey {name}, it’s {rep} — I’ll be fast.

I’m calling because we build agency-level sites that feel engineered (not templated), and I noticed a couple of mobile trust leaks on yours.

Do you have 60 seconds so I can tell you what I saw, and if it’s worth a 10-minute fit check?`
    },
    {
      channel: "OBJECTIONS",
      title: "We already have a web guy",
      text:
`Totally fine — I’m not trying to replace anyone.

What I’m offering is a benchmark: we’ll show you what a premium rebuild looks like, what it would change for conversion, and what the gaps are.

If your guy can match it, win. If not, you have options.

Fair to do a 10-minute fit check?`
    },
    {
      channel: "CLOSE",
      title: "Close — Lock the Next Step",
      text:
`Perfect. Next step is simple:

1) 10-minute fit check.
2) If it’s a pass, we schedule the deeper call.

What’s better — tomorrow morning or tomorrow afternoon?`
    }
  ];

  /* ============ STATE ============ */
  let auth = null;
  let db = null;
  let user = null;

  let leads = [];
  let activeLead = null;

  let leadsUnsub = null;
  let activityUnsub = null;

  /* ============ DOM ============ */
  const $ = (id) => document.getElementById(id);

  const toastEl = $("toast");
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("on"), 1600);
  }

  /* ============ PWA UPDATE HARDENING ============ */
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      reg.update().catch(()=>{});
    }).catch(()=>{});

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
  }

  /* ============ MODAL SYSTEM ============ */
  function openModal(modalId) {
    const modal = $(modalId);
    const backdrop = $("modalBackdrop");
    if (!modal || !backdrop) return;
    backdrop.hidden = false;
    modal.hidden = false;
    // Focus first focusable
    setTimeout(() => {
      const focusable = modal.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
      if (focusable) focusable.focus();
    }, 0);
  }

  function closeModal(modalId) {
    const modal = $(modalId);
    const backdrop = $("modalBackdrop");
    if (!modal || !backdrop) return;
    modal.hidden = true;
    // if both modals are closed, hide backdrop
    const anyOpen = ["installModal","templatesModal"].some(id => !$(id).hidden);
    backdrop.hidden = anyOpen;
  }

  function closeAllModals() {
    closeModal("installModal");
    closeModal("templatesModal");
  }

  // Backdrop click closes whichever is open
  $("modalBackdrop").addEventListener("click", closeAllModals);

  // ESC closes
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
  });

  // Swipe-down close (install modal)
  (function swipeCloseInstall() {
    const card = $("installCard");
    if (!card) return;
    let startY = 0, startX = 0, active = false;
    card.addEventListener("pointerdown", (e) => {
      active = true;
      startY = e.clientY;
      startX = e.clientX;
    });
    card.addEventListener("pointermove", (e) => {
      if (!active) return;
      const dy = e.clientY - startY;
      const dx = Math.abs(e.clientX - startX);
      if (dy > 90 && dx < 40) {
        active = false;
        closeModal("installModal");
      }
    });
    card.addEventListener("pointerup", () => active = false);
    card.addEventListener("pointercancel", () => active = false);
  })();

  /* ============ INSTALL TIPS ============ */
  function showInstallTips(force=false) {
    if (!force) {
      const never = localStorage.getItem("SOLE_INSTALL_NEVER") === "1";
      if (never) return;
      const dismissed = localStorage.getItem("SOLE_INSTALL_DISMISSED") === "1";
      if (dismissed) return;
    }
    openModal("installModal");
  }

  $("installBtn").addEventListener("click", () => showInstallTips(true));
  $("installClose").addEventListener("click", () => closeModal("installModal"));
  $("installDismiss").addEventListener("click", () => {
    localStorage.setItem("SOLE_INSTALL_DISMISSED", "1");
    closeModal("installModal");
  });
  $("installNever").addEventListener("click", () => {
    localStorage.setItem("SOLE_INSTALL_NEVER", "1");
    closeModal("installModal");
  });

  /* ============ MOBILE NAV ============ */
  function setView(view) {
    document.body.setAttribute("data-view", view);
    $("navPipeline").dataset.active = view === "pipeline" ? "1" : "0";
    $("navLead").dataset.active = view === "lead" ? "1" : "0";
    $("navControl").dataset.active = view === "control" ? "1" : "0";
  }
  $("navPipeline").addEventListener("click", () => setView("pipeline"));
  $("navLead").addEventListener("click", () => setView("lead"));
  $("navControl").addEventListener("click", () => setView("control"));

  /* ============ DATE HELPERS ============ */
  function pad(n) { return String(n).padStart(2, "0"); }
  function localInputFromDate(d) {
    if (!d || isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function localInputFromTS(ts) {
    if (!ts) return "";
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return localInputFromDate(d);
    } catch(_) { return ""; }
  }
  function tsFromLocalInput(v) {
    if (!v) return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return firebase.firestore.Timestamp.fromDate(d);
  }
  function fmtTS(ts) {
    if (!ts) return "—";
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleString();
    } catch(_) { return String(ts); }
  }

  /* ============ PIN GATE ============ */
  function pinTokenValid() {
  // Prefer persisted token
  let raw = null;
  try { raw = localStorage.getItem("SOLE_PIN_TOKEN"); } catch(e) { raw = null; }
  if (raw) {
    try {
      const obj = JSON.parse(raw);
      if (obj && obj.exp && Date.now() < obj.exp) return true;
    } catch(_) {}
  }
  // Fallback to in-memory token
  if (PIN_MEM_TOKEN && PIN_MEM_TOKEN.exp && Date.now() < PIN_MEM_TOKEN.exp) return true;
  return false;
}

  function setPinToken() {
  const exp = Date.now() + (PIN_GATE.sessionHours * 3600 * 1000);
  const payload = JSON.stringify({ exp });
  // Persist if possible, otherwise keep a session token in memory.
  try { localStorage.setItem("SOLE_PIN_TOKEN", payload); } catch(e) {
    PIN_MEM_TOKEN = { exp };
  }
}

  function clearPinToken() {
  try { localStorage.removeItem("SOLE_PIN_TOKEN"); } catch(e) {}
  PIN_MEM_TOKEN = null;
}

  function showPinGate() {
    $("pinGate").hidden = false;
    $("auth").hidden = true;
    $("main").hidden = true;
  }
  function showAuth() {
    $("pinGate").hidden = true;
    $("auth").hidden = false;
    $("main").hidden = true;
  }
  function showMain() {
    $("pinGate").hidden = true;
    $("auth").hidden = true;
    $("main").hidden = false;
  }

  $("pinUnlockBtn").addEventListener("click", () => {
    const pin = String($("pinInput").value || "").trim();
    if (!pin) {
      $("pinMsg").textContent = "Enter the PIN.";
      toast("PIN required.");
      return;
    }
    if (pin !== PIN_GATE.pin) {
      $("pinMsg").textContent = "Invalid PIN.";
      $("pinInput").value = "";
      toast("Invalid PIN.");
      return;
    }
    setPinToken();
    $("pinMsg").textContent = "";
    showAuth();
    $("authEmail").focus();
  });

  $("pinClearBtn").addEventListener("click", () => {
    $("pinInput").value = "";
    $("pinInput").focus();
  });

// Make PIN entry bulletproof on mobile (keyboard + on-screen keypad).
$("pinInput").addEventListener("input", () => { $("pinMsg").textContent = ""; });
$("pinInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("pinUnlockBtn").click();
});

const keypad = $("pinKeypad");
if (keypad) {
  keypad.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-k]");
    if (!btn) return;
    const k = btn.getAttribute("data-k");
    const el = $("pinInput");
    if (!el) return;

    if (k === "back") {
      el.value = el.value.slice(0, -1);
    } else if (k === "clear") {
      el.value = "";
    } else {
      if (el.value.length < 12) el.value += k;
    }
    $("pinMsg").textContent = "";
    el.focus();
  });
}


  /* ============ FIREBASE INIT ============ */
  function initFirebase() {
    if (!window.firebase || !firebase.apps) {
      toast("Firebase SDK failed to load.");
      return;
    }
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    auth = firebase.auth();
    db = firebase.firestore();

    auth.onAuthStateChanged((u) => {
      user = u || null;
      $("me").textContent = user ? (user.email || "signed-in") : "—";

      if (!user) {
        // Stop listeners when logged out
        if (leadsUnsub) leadsUnsub();
        leadsUnsub = null;
        clearLeadSelection();
        if (PIN_GATE.enabled && !pinTokenValid()) {
          showPinGate();
        } else {
          showAuth();
        }
      } else {
        (async()=>{
          const ok = await ensureContractorProfile_();
          if (!ok) return;
          showMain();
          setView("pipeline");
          bindLeadsListener();
          maybeAutoInstallTips();
        })();
      }
    });
  }

  async function ensureContractorProfile_() {
    try {
      if (!db || !user) return false;
      const ref = db.collection("profiles").doc(user.uid);
      const snap = await ref.get();

      if (!snap.exists) {
        await ref.set({
          email: user.email || "",
          role: "contractor",
          status: "pending",
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      const data = (snap.exists ? (snap.data() || {}) : { status: "pending" });
      const status = String(data.status || "pending").toLowerCase();

      if (ACCESS.requireApproved && status !== "approved") {
        // Keep the session signed-in, but block app content until approved.
        showAuth();
        $("authMsg").textContent =
          "Account is pending approval. Use the Contractor Portal to finish signup, or ask a manager to approve your profile.";
        toast("Pending approval.");
        return false;
      }

      // Update stamp
      await ref.set({
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return true;
    } catch (e) {
      // If rules block profile reads, fail open so reps can work.
      console.warn("Profile check failed:", e);
      return true;
    }
  }

  /* ============ AUTH UI ============ */
  $("authBtn").addEventListener("click", async () => {
    const email = String($("authEmail").value || "").trim();
    const pass = String($("authPass").value || "");
    if (!email || !pass) {
      $("authMsg").textContent = "Enter email + password.";
      toast("Email + password required.");
      return;
    }
    $("authMsg").textContent = "";
    try {
      await auth.signInWithEmailAndPassword(email, pass);
      toast("Signed in.");
    } catch (e) {
      $("authMsg").textContent = (e && e.message) ? e.message : String(e);
      toast("Sign-in failed.");
    }
  });

  $("authClearBtn").addEventListener("click", () => {
    $("authEmail").value = "";
    $("authPass").value = "";
    $("authEmail").focus();
  });

  $("lockBtn").addEventListener("click", async () => {
    // lock = sign out + clear pin token
    closeAllModals();
    try {
      if (auth && auth.currentUser) await auth.signOut();
    } catch(_) {}
    clearPinToken();
    toast("Locked.");
    if (PIN_GATE.enabled) showPinGate(); else showAuth();
  });

  /* ============ LEADS: REALTIME LISTENER ============ */
  function bindLeadsListener() {
    if (!db) return;
    if (leadsUnsub) leadsUnsub();

    leadsUnsub = db.collection("leads").onSnapshot((snap) => {
      const arr = [];
      snap.forEach((doc) => {
        const data = doc.data() || {};
        arr.push(Object.assign({ id: doc.id }, data));
      });
      // Sort by updatedAt desc if present
      arr.sort((a,b) => {
        const at = a.updatedAt && a.updatedAt.toMillis ? a.updatedAt.toMillis() : 0;
        const bt = b.updatedAt && b.updatedAt.toMillis ? b.updatedAt.toMillis() : 0;
        return bt - at;
      });
      leads = arr.map(l => Object.assign({}, l, { stage: l.stage || STAGES[0] }));
      renderAll();
      // keep active lead fresh
      if (activeLead) {
        const fresh = leads.find(x => x.id === activeLead.id);
        if (fresh) {
          activeLead = fresh;
          fillLeadForm(activeLead);
        }
      }
    }, (err) => {
      toast(err && err.message ? err.message : "Failed to load leads.");
    });
  }

  /* ============ ACTIVITIES: LISTENER PER LEAD ============ */
  function bindActivityListener(leadId) {
    if (activityUnsub) activityUnsub();
    if (!leadId) return;

    activityUnsub = db.collection("activities")
      .where("leadId", "==", leadId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .onSnapshot((snap) => {
        const items = [];
        snap.forEach(doc => items.push(Object.assign({ id: doc.id }, (doc.data()||{}))));
        renderActivities(items);
      }, (err) => {
        toast(err && err.message ? err.message : "Failed to load activities.");
      });
  }

  /* ============ RENDER: CONTROL + KPIs ============ */
  function setOptions(selectEl, values, withAll=false) {
    selectEl.innerHTML = "";
    if (withAll) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "All Stages";
      selectEl.appendChild(o);
    }
    values.forEach(v => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      selectEl.appendChild(o);
    });
  }

  setOptions($("stage"), STAGES, false);
  setOptions($("stageFilter"), STAGES, true);

  $("q").addEventListener("input", renderKanban);
  $("stageFilter").addEventListener("change", renderKanban);

  function renderKPIs() {
    $("kTotal").textContent = String(leads.length || 0);
    const hot = leads.filter(l => {
      const s = l.stage || "";
      return s.includes("Proposal") || s.includes("Verbal") || s.includes("Closed Won");
    }).length;
    $("kHot").textContent = String(hot);
  }

  /* ============ KANBAN ============ */
  function escHtml(s) {
    return String(s||"")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;");
  }

  function norm(s) {
    return String(s||"").toLowerCase().trim();
  }

  function buildLeadCard(l) {
    const card = document.createElement("div");
    card.className = "lead";
    card.draggable = true;

    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", l.id);
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("click", () => openLead(l.id));

    const name = l.businessName || "(No name)";
    const sub = [l.city, l.niche].filter(Boolean).join(" • ");
    const pkg = l.recommendedPackage || "";
    const prod = (l.productionInterest && l.productionInterest !== "None") ? l.productionInterest : "";
    const next = l.nextStepAt ? localInputFromTS(l.nextStepAt).replace("T"," ") : "";

    const tags = [];
    if (pkg) tags.push(`<span class="tag gold">${escHtml(pkg)}</span>`);
    if (prod) tags.push(`<span class="tag">${escHtml(prod)}</span>`);
    if (next) tags.push(`<span class="tag">Next: ${escHtml(next)}</span>`);

    card.innerHTML = `
      <div class="name">${escHtml(name)}</div>
      <div class="sub">${escHtml(sub || "—")}</div>
      ${tags.length ? `<div class="tagRow">${tags.join("")}</div>` : ""}
    `;
    return card;
  }

  async function moveLeadStage(leadId, stage) {
    if (!db) return;
    if (!STAGES.includes(stage)) return;
    try {
      await db.collection("leads").doc(leadId).set({
        stage,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      toast("Moved.");
    } catch (e) {
      toast(e && e.message ? e.message : "Move failed.");
    }
  }

  function renderKanban() {
    const kan = $("kanban");
    kan.innerHTML = "";

    const q = norm($("q").value);
    const sf = $("stageFilter").value;

    let list = leads.slice();
    if (sf) list = list.filter(l => (l.stage || STAGES[0]) === sf);
    if (q) {
      list = list.filter(l => {
        const hay = norm([l.businessName,l.contactName,l.city,l.niche,l.phone,l.email,l.instagram,l.website].join(" "));
        return hay.includes(q);
      });
    }

    STAGES.forEach(stage => {
      const inStage = list.filter(l => (l.stage || STAGES[0]) === stage);

      const col = document.createElement("div");
      col.className = "col";

      const top = document.createElement("div");
      top.className = "colTop";
      top.innerHTML = `
        <div>
          <b>${escHtml(stage)}</b>
          <div class="count">${inStage.length} lead${inStage.length===1?"":"s"}</div>
        </div>
        <div class="count">Drop here</div>
      `;

      const stack = document.createElement("div");
      stack.className = "stack";

      stack.addEventListener("dragover", (e) => {
        e.preventDefault();
        stack.classList.add("drop");
      });
      stack.addEventListener("dragleave", () => stack.classList.remove("drop"));
      stack.addEventListener("drop", (e) => {
        e.preventDefault();
        stack.classList.remove("drop");
        const leadId = e.dataTransfer.getData("text/plain");
        if (!leadId) return;
        moveLeadStage(leadId, stage);
      });

      inStage.forEach(l => stack.appendChild(buildLeadCard(l)));
      col.appendChild(top);
      col.appendChild(stack);
      kan.appendChild(col);
    });
  }

  /* ============ LEAD FORM ============ */
  function clearLeadSelection() {
    activeLead = null;
    $("dtTitle").textContent = "Lead";
    $("leadEmpty").hidden = false;
    $("leadForm").hidden = true;
    $("activityList").innerHTML = "";
    $("lastTouch").textContent = "—";
  }

  function showLeadForm() {
    $("leadEmpty").hidden = true;
    $("leadForm").hidden = false;
  }

  function fillLeadForm(l) {
    if (!l) return;
    showLeadForm();
    $("dtTitle").textContent = l.businessName ? `Lead: ${l.businessName}` : `Lead: ${l.id}`;

    $("businessName").value = l.businessName || "";
    $("contactName").value = l.contactName || "";
    $("phone").value = l.phone || "";
    $("email").value = l.email || "";
    $("instagram").value = l.instagram || "";
    $("website").value = l.website || "";
    $("city").value = l.city || "";
    $("niche").value = l.niche || "";

    $("stage").value = l.stage || STAGES[0];
    $("recommendedPackage").value = l.recommendedPackage || "";
    $("productionInterest").value = l.productionInterest || "";
    $("notes").value = l.notes || "";

    $("nextStepLocal").value = localInputFromTS(l.nextStepAt || null);

    const warn = !($("nextStepLocal").value);
    $("nextStepWarn").hidden = !warn;

    $("lastTouch").textContent = l.lastActivityAt ? `Last touch: ${fmtTS(l.lastActivityAt)}` : "No activity yet";
  }

  function leadFromForm() {
    const base = activeLead ? Object.assign({}, activeLead) : {};
    base.businessName = String($("businessName").value || "").trim();
    base.contactName = String($("contactName").value || "").trim();
    base.phone = String($("phone").value || "").trim();
    base.email = String($("email").value || "").trim();
    base.instagram = String($("instagram").value || "").trim();
    base.website = String($("website").value || "").trim();
    base.city = String($("city").value || "").trim();
    base.niche = String($("niche").value || "").trim();

    base.stage = $("stage").value || STAGES[0];
    base.recommendedPackage = $("recommendedPackage").value || "";
    base.productionInterest = $("productionInterest").value || "";
    base.notes = String($("notes").value || "").trim();

    const ts = tsFromLocalInput($("nextStepLocal").value);
    base.nextStepAt = ts;

    return base;
  }

  async function saveLead() {
    if (!db || !user) return;
    const data = leadFromForm();

    if (!data.businessName) {
      toast("Business name is required.");
      return;
    }

    const warn = !($("nextStepLocal").value);
    $("nextStepWarn").hidden = !warn;

    const payload = {
      ownerUid: user.uid,
      ownerEmail: user.email || "",
      businessName: data.businessName,
      contactName: data.contactName || "",
      phone: data.phone || "",
      email: data.email || "",
      instagram: data.instagram || "",
      website: data.website || "",
      city: data.city || "",
      niche: data.niche || "",
      stage: data.stage || STAGES[0],
      nextStepAt: data.nextStepAt || null,
      recommendedPackage: data.recommendedPackage || "",
      productionInterest: data.productionInterest || "",
      notes: data.notes || "",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
      if (!data.id) {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        payload.lastActivityAt = null;
        const docRef = await db.collection("leads").add(payload);
        toast("Lead created.");
        openLead(docRef.id);
      } else {
        await db.collection("leads").doc(data.id).set(payload, { merge: true });
        toast("Saved.");
      }
    } catch (e) {
      toast(e && e.message ? e.message : "Save failed.");
    }
  }

  function openLead(id) {
    const l = leads.find(x => x.id === id);
    if (!l) return;
    activeLead = l;
    fillLeadForm(activeLead);
    bindActivityListener(activeLead.id);
    // mobile convenience: go to Lead tab
    if (window.matchMedia("(max-width: 980px)").matches) setView("lead");
  }

  function newLead() {
    activeLead = null;
    $("dtTitle").textContent = "New Lead";
    showLeadForm();
    ["businessName","contactName","phone","email","instagram","website","city","niche","notes"].forEach(id => $(id).value = "");
    $("stage").value = STAGES[0];
    $("nextStepLocal").value = "";
    $("recommendedPackage").value = "";
    $("productionInterest").value = "";
    $("nextStepWarn").hidden = false;
    $("activityList").innerHTML = "";
    $("lastTouch").textContent = "—";
    if (activityUnsub) activityUnsub();
    activityUnsub = null;
    if (window.matchMedia("(max-width: 980px)").matches) setView("lead");
  }

  $("newBtn").addEventListener("click", newLead);
  $("saveBtn").addEventListener("click", saveLead);

  $("discardBtn").addEventListener("click", () => {
    if (activeLead) {
      const fresh = leads.find(x => x.id === activeLead.id);
      if (fresh) {
        activeLead = fresh;
        fillLeadForm(activeLead);
      }
      toast("Discarded.");
    } else {
      clearLeadSelection();
      toast("Discarded.");
    }
  });

  $("nextStepLocal").addEventListener("change", () => {
    const warn = !($("nextStepLocal").value);
    $("nextStepWarn").hidden = !warn;
  });

  /* ============ ACTIVITIES ============ */
  function renderActivities(items) {
    const list = $("activityList");
    list.innerHTML = "";
    if (!items || !items.length) {
      list.innerHTML = `
        <div class="item">
          <b>No activity yet</b>
          <div class="t">Log calls/text/DMs to keep history tight.</div>
        </div>`;
      return;
    }
    items.forEach(a => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <b>${escHtml(a.channel || "Activity")}</b>
        <div class="t">${escHtml(fmtTS(a.createdAt || a.ts || ""))}</div>
        <div class="n">${escHtml(a.note || "")}</div>
      `;
      list.appendChild(div);
    });
  }

  async function logActivity(channel) {
    if (!db || !user) return;
    if (!activeLead) {
      toast("Open a lead first.");
      return;
    }
    const note = prompt(`${channel} note:`, "");
    if (note === null) return;

    try {
      await db.collection("activities").add({
        leadId: activeLead.id,
        uid: user.uid,
        userEmail: user.email || "",
        channel,
        note: String(note || ""),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await db.collection("leads").doc(activeLead.id).set({
        lastActivityAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      toast("Logged.");
    } catch (e) {
      toast(e && e.message ? e.message : "Log failed.");
    }
  }

  $("logCallBtn").addEventListener("click", () => logActivity("Call"));
  $("logTextBtn").addEventListener("click", () => logActivity("Text"));
  $("logDMBtn").addEventListener("click", () => logActivity("Instagram DM"));

  /* ============ EXPORT CSV ============ */
  function downloadCSV(rows) {
    if (!rows.length) return;
    const headers = [
      "id","businessName","contactName","phone","email","instagram","website","city","niche",
      "stage","recommendedPackage","productionInterest","nextStepAt","lastActivityAt","createdAt","updatedAt","notes"
    ];
    const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const lines = [];
    lines.push(headers.join(","));
    for (const r of rows) {
      const row = [];
      for (const h of headers) {
        const v = r[h];
        if (v && v.toDate) row.push(esc(fmtTS(v)));
        else row.push(esc(v));
      }
      lines.push(row.join(","));
    }
    const csv = lines.join("\n");
const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sole_leads.csv";
    a.click();
  }

  $("exportBtn").addEventListener("click", () => {
    if (!leads.length) {
      toast("No leads to export.");
      return;
    }
    downloadCSV(leads);
  });

  /* ============ REFRESH (FORCE RELOAD SNAPSHOT) ============ */
  $("refreshBtn").addEventListener("click", async () => {
    toast("Refreshing…");
    // Listener already live; just re-render
    renderAll();
  });

  /* ============ ICS CALENDAR ============ */
  function downloadICS(title, startDate, durationMins) {
    const dt = new Date(startDate.getTime());
    const end = new Date(dt.getTime() + durationMins * 60000);

    const fmt = (d) => {
      const y = d.getUTCFullYear();
      const m = pad(d.getUTCMonth()+1);
      const da = pad(d.getUTCDate());
      const hh = pad(d.getUTCHours());
      const mm = pad(d.getUTCMinutes());
      const ss = pad(d.getUTCSeconds());
      return `${y}${m}${da}T${hh}${mm}${ss}Z`;
    };

    const uid = `${Date.now()}-sole@solenterprises`;
    const ics =
`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SOLE//Sales App//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${fmt(new Date())}
DTSTART:${fmt(dt)}
DTEND:${fmt(end)}
SUMMARY:${title}
DESCRIPTION:SOLE Sales Call
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([ics], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sole_call.ics";
    a.click();
  }

  $("icsBtn").addEventListener("click", () => {
    if (!activeLead) {
      toast("Open a lead first.");
      return;
    }
    const local = $("nextStepLocal").value;
    if (!local) {
      toast("Set Next Step time first.");
      return;
    }
    const start = new Date(local);
    if (isNaN(start.getTime())) {
      toast("Invalid time.");
      return;
    }
    const title = `${activeLead.businessName || "Business"} — Sales Call`;
    downloadICS(title, start, 45);
    toast("ICS downloaded.");
  });

  /* ============ TEMPLATES (FIRESTORE + FALLBACK) ============ */
  $("templatesBtn").addEventListener("click", () => {
    openModal("templatesModal");
    renderTemplates();
  });
  $("templatesClose").addEventListener("click", () => closeModal("templatesModal"));
  $("templatesDone").addEventListener("click", () => closeModal("templatesModal"));
  $("tplCategory").addEventListener("change", renderTemplates);

  let templatesCache = null;

  async function loadTemplatesFromFirestore() {
    if (!db || !user) return null;
    try {
      const snap = await db.collection("templates").get();
      const arr = [];
      snap.forEach(doc => arr.push(Object.assign({ id: doc.id }, (doc.data()||{}))));
      return arr;
    } catch (e) {
      return null;
    }
  }

  function templateListForChannel(all, channel) {
    const a = (all || []).filter(t => String(t.channel||"").toUpperCase() === channel.toUpperCase());
    return a.length ? a : DEFAULT_TEMPLATES.filter(t => t.channel === channel);
  }

  function renderTemplates() {
    const channel = String($("tplCategory").value || "DM").toUpperCase();
    const mount = $("tplList");
    mount.innerHTML = "";

    const render = (all) => {
      const list = templateListForChannel(all, channel);
      list.forEach((t, idx) => {
        const card = document.createElement("div");
        card.className = "panel";
        card.style.marginBottom = "12px";
        card.innerHTML = `
          <div class="panel__head">
            <div class="panel__title">${escHtml(t.title || "Script")}</div>
            <div class="panel__meta">
              <button class="btn btn--primary" type="button" data-copy="${idx}">Copy</button>
            </div>
          </div>
          <div class="panel__body">
            <pre style="white-space:pre-wrap;margin:0;font:13px/1.4 system-ui;color:var(--ink)">${escHtml(t.text || "")}</pre>
          </div>
        `;
        mount.appendChild(card);
      });

      mount.querySelectorAll("[data-copy]").forEach(btn => {
        btn.addEventListener("click", async () => {
          const i = Number(btn.getAttribute("data-copy"));
          const list = templateListForChannel(all, channel);
          const txt = list[i] ? (list[i].text || "") : "";
          try {
            await navigator.clipboard.writeText(txt);
            toast("Copied.");
          } catch(_) {
            toast("Copy failed.");
          }
        });
      });
    };

    if (templatesCache) {
      render(templatesCache);
      return;
    }

    // load async then render
    loadTemplatesFromFirestore().then((all) => {
      templatesCache = all;
      render(all);
    });
  }

  $("seedBtn").addEventListener("click", async () => {
    if (!db || !user) {
      toast("Sign in first.");
      return;
    }
    try {
      const batch = db.batch();
      DEFAULT_TEMPLATES.forEach((t, idx) => {
        const id = `seed_${t.channel}_${idx}`;
        const ref = db.collection("templates").doc(id);
        batch.set(ref, {
          channel: t.channel,
          title: t.title,
          text: t.text,
          published: true,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          _seeded: true
        }, { merge: true });
      });
      await batch.commit();
      templatesCache = null;
      toast("Scripts seeded.");
    } catch (e) {
      toast(e && e.message ? e.message : "Seed failed.");
    }
  });

  /* ============ RENDER ALL ============ */
  function renderAll() {
    renderKPIs();
    renderKanban();
    // keep lead panel in sync
    if (!activeLead) {
      clearLeadSelection();
    } else {
      fillLeadForm(activeLead);
    }
  }

  /* ============ AUTO INSTALL TIPS (ONCE) ============ */
  function maybeAutoInstallTips() {
    // only show once after first successful sign-in
    const already = localStorage.getItem("SOLE_INSTALL_SHOWN") === "1";
    if (already) return;
    localStorage.setItem("SOLE_INSTALL_SHOWN", "1");
    showInstallTips(false);
  }

  /* ============ BOOT ============ */
  function boot() {
    registerSW();

    // logo fallback to remote if you want (optional):
    $("brandLogo").addEventListener("error", () => {
      // remote fallback (optional) — leave empty if you don't want external requests
      // $("brandLogo").src = "https://cdn1.sharemyimage.com/2025/12/30/SkyesOverLondonLC_logo_transparent_clean_tight.png";
    });

    // initial gate routing
    if (PIN_GATE.enabled) {
      if (pinTokenValid()) showAuth(); else showPinGate();
    } else {
      showAuth();
    }

    initFirebase();
  }

  boot();

})();
