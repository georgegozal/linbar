(function () {
  const tb = window.taskbar;
  if (!tb) {
    console.error("LinBar: preload API missing");
    return;
  }

  const startBtn = document.getElementById("startBtn");
  const startMenu = document.getElementById("startMenu");
  const taskList = document.getElementById("taskList");
  const trayVol = document.getElementById("trayVol");

  function formatTime(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function formatDate(d) {
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function tickClock() {
    const d = new Date();
    document.getElementById("clockTime").textContent = formatTime(d);
    document.getElementById("clockDate").textContent = formatDate(d);
  }

  tickClock();
  setInterval(tickClock, 1000);

  function setStartOpen(open) {
    startMenu.hidden = !open;
    startBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  startBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setStartOpen(startMenu.hidden);
  });

  document.addEventListener("click", () => setStartOpen(false));
  startMenu.addEventListener("click", (e) => e.stopPropagation());

  startMenu.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.getAttribute("data-action");
      const arg = btn.getAttribute("data-arg");
      if (action === "app" && arg) await tb.openApp(arg);
      if (action === "special" && arg) await tb.openSpecialPath(arg);
      if (action === "settings") await tb.openSystemSettings();
      setStartOpen(false);
    });
  });

  document.querySelectorAll(".js-ql").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.getAttribute("data-action");
      const arg = btn.getAttribute("data-arg");
      if (action === "app" && arg) await tb.openApp(arg);
      if (action === "special" && arg) await tb.openSpecialPath(arg);
    });
  });

  let lastSnapshot = "";
  const taskButtonByKey = new Map();
  let applyTimer = null;
  let pendingPayload = null;

  /** process name -> data URL string | null (null = fetch in progress or failed) */
  const iconCache = new Map();

  function taskKey(t) {
    if (t && typeof t.key === "string" && t.key) return t.key;
    return String(t.process) + "::" + String(t.kind) + "::" + String(t.ref);
  }

  function applyIconToButton(button, dataUrl) {
    const ico = button.querySelector(".task-ico");
    if (!ico) return;
    if (dataUrl) {
      ico.style.backgroundImage = `url("${dataUrl}")`;
      ico.style.backgroundColor = "transparent";
    }
  }

  function ensureIcon(processName) {
    if (iconCache.has(processName)) {
      const url = iconCache.get(processName);
      if (!url) return; // failed or in flight
      // Apply to any existing buttons for this process
      for (const [key, btn] of taskButtonByKey.entries()) {
        if (key.split("::")[0] === processName) applyIconToButton(btn, url);
      }
      return;
    }
    iconCache.set(processName, null); // mark in-flight
    tb.getAppIcon(processName).then((url) => {
      iconCache.set(processName, url || null);
      if (!url) return;
      for (const [key, btn] of taskButtonByKey.entries()) {
        if (key.split("::")[0] === processName) applyIconToButton(btn, url);
      }
    }).catch(() => {});
  }

  function createTaskButton(t) {
    const b = document.createElement("button");
    b.type = "button";
    const ico = document.createElement("span");
    ico.className = "task-ico";
    ico.setAttribute("aria-hidden", "true");
    const lab = document.createElement("span");
    lab.className = "task-label";
    b.append(ico, lab);
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      tb.contextMenuTask(t);
    });
    return b;
  }

  function patchTaskButton(button, t, active) {
    button.className = "task-btn" + (active ? " active" : "");
    button.title = t.process + " — " + t.title;
    const label = button.querySelector(".task-label");
    if (label && label.textContent !== t.title) label.textContent = t.title;
    if (button._taskKey !== taskKey(t)) {
      button._taskKey = taskKey(t);
      button.onclick = () => tb.activateTask(t);
      button.oncontextmenu = (e) => { e.preventDefault(); tb.contextMenuTask(t); };
    }
    // Apply cached icon immediately or fetch
    const cachedUrl = iconCache.get(t.process);
    if (cachedUrl) {
      applyIconToButton(button, cachedUrl);
    } else {
      ensureIcon(t.process);
    }
  }

  function isFrontTask(t, front) {
    if (!t || !front) return false;
    return (
      t.process === front.process &&
      t.kind === front.kind &&
      Number(t.ref) === Number(front.ref)
    );
  }

  function applyTaskPayload(data) {
    const tasks = data && Array.isArray(data.tasks) ? data.tasks : [];
    const front = data && data.front ? data.front : null;
    if (data && data.error) console.warn("LinBar:", data.error);
    const snap = JSON.stringify({ tasks, front });
    if (snap === lastSnapshot) return;
    lastSnapshot = snap;

    const nextKeys = new Set();
    const frag = document.createDocumentFragment();
    for (const t of tasks) {
      const key = taskKey(t);
      nextKeys.add(key);
      const active = isFrontTask(t, front);
      const b = taskButtonByKey.get(key) || createTaskButton(t);
      patchTaskButton(b, t, active);
      taskButtonByKey.set(key, b);
      frag.appendChild(b);
    }

    for (const [key, button] of taskButtonByKey.entries()) {
      if (nextKeys.has(key)) continue;
      taskButtonByKey.delete(key);
      if (button.parentNode === taskList) taskList.removeChild(button);
    }
    taskList.replaceChildren(frag);
  }

  function queueTaskPayload(data) {
    pendingPayload = data;
    if (applyTimer) return;
    applyTimer = setTimeout(() => {
      applyTimer = null;
      const next = pendingPayload;
      pendingPayload = null;
      if (next) applyTaskPayload(next);
    }, 80);
  }

  async function refreshTasks() {
    try {
      queueTaskPayload(await tb.listTasks());
    } catch (e) {
      console.warn("LinBar refreshTasks:", e);
      lastSnapshot = "";
    }
  }

  refreshTasks();
  if (typeof tb.subscribeTasks === "function") {
    tb.subscribeTasks(queueTaskPayload);
  }
  if (typeof tb.pokeTasks === "function") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tb.pokeTasks();
    });
  }

  document.getElementById("trayAbout").addEventListener("click", () => tb.openAboutMac());
  document.getElementById("trayNotif").addEventListener("click", () => tb.openNotificationSettings());

  document.getElementById("trayClip").addEventListener("click", async () => {
    const r = await tb.getClipboardPreview();
    if (r.ok) window.alert(r.preview);
    else window.alert("Clipboard: " + (r.error || "unavailable"));
  });

  async function syncVolumeUi() {
    const v = await tb.getVolume();
    trayVol.classList.toggle("muted", !!v.muted);
    trayVol.title = v.muted ? "Unmute" : "Mute";
  }

  syncVolumeUi();
  trayVol.addEventListener("click", async () => {
    await tb.toggleMute();
    syncVolumeUi();
  });
})();
