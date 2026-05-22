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

    taskList.replaceChildren();
    for (const t of tasks) {
      const active = isFrontTask(t, front);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "task-btn" + (active ? " active" : "");
      b.title = t.process + " — " + t.title;
      const ico = document.createElement("span");
      ico.className = "task-ico";
      ico.setAttribute("aria-hidden", "true");
      const lab = document.createElement("span");
      lab.className = "task-label";
      lab.textContent = t.title;
      b.append(ico, lab);
      b.addEventListener("click", () => tb.activateTask(t));
      taskList.appendChild(b);
    }
  }

  async function refreshTasks() {
    try {
      applyTaskPayload(await tb.listTasks());
    } catch (e) {
      console.warn("LinBar refreshTasks:", e);
      lastSnapshot = "";
    }
  }

  refreshTasks();
  if (typeof tb.subscribeTasks === "function") {
    tb.subscribeTasks(applyTaskPayload);
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
