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

  // Popups live above the 48px bar, so the window must grow while one is open.
  const calendarPop = document.getElementById("calendarPop");
  const PANEL_H = 48;
  const DRAWER_H = 560;
  const CALENDAR_H = 380;

  function syncPanelHeight() {
    let h = PANEL_H;
    if (!startMenu.hidden) h = DRAWER_H;
    else if (!calendarPop.hidden) h = CALENDAR_H;
    tb.setPanelHeight(h);
  }

  // --- App drawer (Whisker-menu style) ---
  const drawerSearch = document.getElementById("drawerSearch");
  const drawerGrid = document.getElementById("drawerGrid");
  let drawerLoaded = false;

  const drawerIconObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const item = entry.target;
      drawerIconObserver.unobserve(item);
      const appPath = item.dataset.path;
      tb.getAppIconByPath(appPath).then((url) => {
        if (!url) return;
        const ico = item.querySelector(".drawer-ico");
        ico.textContent = "";
        ico.style.backgroundImage = `url("${url}")`;
      }).catch(() => {});
    }
  }, { root: null, rootMargin: "120px" });

  async function loadDrawer() {
    if (drawerLoaded) return;
    drawerLoaded = true;
    const apps = await tb.listInstalledApps();
    drawerGrid.replaceChildren();
    for (const a of apps) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "drawer-item";
      item.dataset.path = a.path;
      item.dataset.name = a.name.toLowerCase();
      item.title = a.name;
      const ico = document.createElement("span");
      ico.className = "drawer-ico";
      ico.textContent = a.name.slice(0, 1);
      const lab = document.createElement("span");
      lab.className = "drawer-label";
      lab.textContent = a.name;
      item.append(ico, lab);
      item.addEventListener("click", () => {
        tb.openAppPath(a.path);
        setStartOpen(false);
      });
      drawerGrid.appendChild(item);
      drawerIconObserver.observe(item);
    }
  }

  function filterDrawer(query) {
    const q = query.trim().toLowerCase();
    for (const item of drawerGrid.children) {
      item.hidden = q !== "" && !item.dataset.name.includes(q);
    }
  }

  drawerSearch.addEventListener("input", () => filterDrawer(drawerSearch.value));
  drawerSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = [...drawerGrid.children].find((c) => !c.hidden);
      if (first) first.click();
    } else if (e.key === "Escape") {
      setStartOpen(false);
    }
  });

  function setStartOpen(open) {
    startMenu.hidden = !open;
    if (open) {
      calendarPop.hidden = true;
      void loadDrawer();
      drawerSearch.value = "";
      filterDrawer("");
      setTimeout(() => drawerSearch.focus(), 0);
    }
    startBtn.setAttribute("aria-expanded", open ? "true" : "false");
    syncPanelHeight();
  }

  startBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setStartOpen(startMenu.hidden);
  });

  document.addEventListener("click", () => {
    setStartOpen(false);
    setCalendarOpen(false);
  });
  startMenu.addEventListener("click", (e) => e.stopPropagation());

  // --- Calendar popup (Orage-style) ---
  const calTitle = document.getElementById("calTitle");
  const calGrid = document.getElementById("calGrid");
  let calCursor = new Date();

  function renderCalendar() {
    const year = calCursor.getFullYear();
    const month = calCursor.getMonth();
    calTitle.textContent = calCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    calGrid.replaceChildren();

    const fmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
    // Monday-first week, like XFCE defaults.
    for (let i = 0; i < 7; i++) {
      const d = new Date(2024, 0, i + 1); // 2024-01-01 is a Monday
      const h = document.createElement("span");
      h.className = "cal-dow";
      h.textContent = fmt.format(d).slice(0, 2);
      calGrid.appendChild(h);
    }

    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7; // days from Monday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    for (let i = 0; i < lead; i++) calGrid.appendChild(document.createElement("span"));
    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("span");
      cell.className = "cal-day";
      cell.textContent = String(day);
      if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
        cell.classList.add("today");
      }
      calGrid.appendChild(cell);
    }
  }

  function setCalendarOpen(open) {
    calendarPop.hidden = !open;
    if (open) {
      startMenu.hidden = true;
      calCursor = new Date();
      renderCalendar();
    }
    syncPanelHeight();
  }

  document.getElementById("clock").addEventListener("click", (e) => {
    e.stopPropagation();
    setCalendarOpen(calendarPop.hidden);
  });
  calendarPop.addEventListener("click", (e) => e.stopPropagation());
  document.getElementById("calPrev").addEventListener("click", () => {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("calNext").addEventListener("click", () => {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
    renderCalendar();
  });

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

  // --- Pinned launchers (XFCE launcher items) ---
  const quickLaunch = document.getElementById("quickLaunch");

  function renderPins(pinned) {
    if (!quickLaunch) return;
    quickLaunch.replaceChildren();
    for (const appName of pinned || []) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "icon-btn pin-btn";
      b.title = appName;
      b.setAttribute("aria-label", appName);
      const ico = document.createElement("span");
      ico.className = "ql-icon ql-app";
      ico.textContent = appName.slice(0, 1);
      b.appendChild(ico);
      tb.getAppIcon(appName).then((url) => {
        if (!url) return;
        ico.textContent = "";
        ico.style.backgroundImage = `url("${url}")`;
      }).catch(() => {});
      b.addEventListener("click", () => tb.openApp(appName));
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        tb.contextMenuPin(appName);
      });
      quickLaunch.appendChild(b);
    }
  }

  tb.getPins().then(renderPins).catch(() => {});
  if (typeof tb.subscribePins === "function") tb.subscribePins(renderPins);

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
      if (!url) {
        iconCache.delete(processName); // retry on a later snapshot
        return;
      }
      iconCache.set(processName, url);
      for (const [key, btn] of taskButtonByKey.entries()) {
        if (key.split("::")[0] === processName) applyIconToButton(btn, url);
      }
    }).catch(() => iconCache.delete(processName));
  }

  function createTaskButton() {
    const b = document.createElement("button");
    b.type = "button";
    const ico = document.createElement("span");
    ico.className = "task-ico";
    ico.setAttribute("aria-hidden", "true");
    const lab = document.createElement("span");
    lab.className = "task-label";
    b.append(ico, lab);

    // XFCE semantics: click focuses; clicking the active window minimizes it;
    // middle-click closes; right-click opens the window menu.
    b.addEventListener("click", () => {
      const t = b._task;
      if (!t) return;
      if (b.classList.contains("active") && !b.classList.contains("minimized")) {
        b.classList.remove("active");
        b.classList.add("minimized");
        tb.minimizeTask(t);
      } else {
        b.classList.remove("minimized");
        setOptimisticActive(taskKey(t));
        tb.activateTask(t);
      }
    });
    b.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      const t = b._task;
      if (t) tb.closeTask(t);
    });
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const t = b._task;
      if (t) tb.contextMenuTask(t);
    });
    return b;
  }

  /** Reflect a click immediately; the next snapshot confirms or corrects it. */
  function setOptimisticActive(key) {
    for (const [k, btn] of taskButtonByKey.entries()) {
      btn.classList.toggle("active", k === key);
    }
  }

  function patchTaskButton(button, t, active) {
    button._task = t;
    button._taskKey = taskKey(t);
    button.className =
      "task-btn" + (active ? " active" : "") + (t.minimized ? " minimized" : "");
    button.title = t.process + " — " + t.title;
    const label = button.querySelector(".task-label");
    if (label && label.textContent !== t.title) label.textContent = t.title;
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

    // Reconcile in place: re-inserting an unchanged node restarts its CSS
    // animation and reads as a visible "refresh", so only move what moved.
    const nextKeys = new Set();
    let cursor = 0;
    for (const t of tasks) {
      const key = taskKey(t);
      nextKeys.add(key);
      const active = isFrontTask(t, front);
      const b = taskButtonByKey.get(key) || createTaskButton();
      patchTaskButton(b, t, active);
      taskButtonByKey.set(key, b);
      const atCursor = taskList.children[cursor];
      if (atCursor !== b) taskList.insertBefore(b, atCursor || null);
      cursor++;
    }

    for (const [key, button] of taskButtonByKey.entries()) {
      if (nextKeys.has(key)) continue;
      taskButtonByKey.delete(key);
      button.remove();
    }
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

  document.getElementById("trayClip").addEventListener("click", () => {
    tb.getClipboardPreview();
  });

  function applyVolumeUi(v) {
    trayVol.classList.toggle("muted", !!v.muted);
    trayVol.title = (v.muted ? "Muted" : "Volume " + Math.round(v.level) + "%") + " — click to toggle, scroll to adjust";
  }

  async function syncVolumeUi() {
    applyVolumeUi(await tb.getVolume());
  }

  syncVolumeUi();
  trayVol.addEventListener("click", async () => {
    await tb.toggleMute();
    syncVolumeUi();
  });

  let volWheelBusy = false;
  trayVol.addEventListener("wheel", async (e) => {
    e.preventDefault();
    if (volWheelBusy) return;
    volWheelBusy = true;
    try {
      applyVolumeUi(await tb.changeVolume(e.deltaY < 0 ? 6 : -6));
    } finally {
      volWheelBusy = false;
    }
  }, { passive: false });
})();
