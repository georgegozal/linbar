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

  const calendarPop = document.getElementById("calendarPop");
  const volPop = document.getElementById("volPop");
  const clipPop = document.getElementById("clipPop");

  // The window is permanently tall and click-through; re-enable mouse events
  // only while the cursor is over the bar or an open popup. Forwarded
  // mousemove events keep arriving even in ignore mode, so we can flip back.
  let mouseIgnored = true;
  function setMouseIgnore(flag) {
    if (flag === mouseIgnored) return;
    mouseIgnored = flag;
    tb.setMouseIgnore(flag);
  }

  document.addEventListener("mousemove", (e) => {
    const over =
      e.target && e.target.closest
        ? e.target.closest(".panel-wrap, .start-menu, .calendar-pop, .vol-pop, .clip-pop")
        : null;
    setMouseIgnore(!over);
  });

  document.addEventListener("mouseleave", () => setMouseIgnore(true));

  // --- App drawer (Whisker-menu style) ---
  const drawerSearch = document.getElementById("drawerSearch");
  const drawerGrid = document.getElementById("drawerGrid");
  const drawerCats = document.getElementById("drawerCats");
  const drawerViewIcons = document.getElementById("drawerViewIcons");
  const drawerViewList = document.getElementById("drawerViewList");
  const CAT_ORDER = ["All", "Accessories", "Development", "Games", "Graphics", "Internet", "Multimedia", "Office", "System", "Other"];
  let drawerLoaded = false;
  let selectedCat = "All";
  let drawerView = "icons";

  function applyDrawerView(view) {
    drawerView = view === "list" ? "list" : "icons";
    drawerGrid.classList.toggle("drawer-view-icons", drawerView === "icons");
    drawerGrid.classList.toggle("drawer-view-list", drawerView === "list");
    drawerViewIcons.classList.toggle("selected", drawerView === "icons");
    drawerViewList.classList.toggle("selected", drawerView === "list");
    drawerViewIcons.setAttribute("aria-pressed", drawerView === "icons" ? "true" : "false");
    drawerViewList.setAttribute("aria-pressed", drawerView === "list" ? "true" : "false");
  }

  tb.getDrawerView().then((v) => applyDrawerView(v)).catch(() => {});

  drawerViewIcons.addEventListener("click", (e) => {
    e.stopPropagation();
    applyDrawerView("icons");
    tb.setDrawerView("icons");
  });
  drawerViewList.addEventListener("click", (e) => {
    e.stopPropagation();
    applyDrawerView("list");
    tb.setDrawerView("list");
  });

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
  }, { root: null, rootMargin: "200px" });

  function renderCats(apps) {
    const present = new Set(apps.map((a) => a.category));
    drawerCats.replaceChildren();
    for (const cat of CAT_ORDER) {
      if (cat !== "All" && !present.has(cat)) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "drawer-cat" + (cat === selectedCat ? " selected" : "");
      b.textContent = cat === "All" ? "All Applications" : cat;
      b.dataset.cat = cat;
      b.addEventListener("click", () => {
        selectedCat = cat;
        for (const c of drawerCats.children) c.classList.toggle("selected", c.dataset.cat === cat);
        filterDrawer(drawerSearch.value);
      });
      drawerCats.appendChild(b);
    }
  }

  async function loadDrawer() {
    if (drawerLoaded) return;
    drawerLoaded = true;
    const apps = await tb.listInstalledApps();
    renderCats(apps);
    drawerGrid.replaceChildren();
    for (const a of apps) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "drawer-item";
      item.dataset.path = a.path;
      item.dataset.name = a.name.toLowerCase();
      item.dataset.cat = a.category || "Other";
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
      const matchesText = q === "" || item.dataset.name.includes(q);
      // Searching looks across every category, like Whisker.
      const matchesCat = q !== "" || selectedCat === "All" || item.dataset.cat === selectedCat;
      item.hidden = !(matchesText && matchesCat);
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
      volPop.hidden = true;
      clipPop.hidden = true;
      void loadDrawer();
      drawerSearch.value = "";
      filterDrawer("");
      setTimeout(() => drawerSearch.focus(), 0);
    }
    startBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  startBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setStartOpen(startMenu.hidden);
  });

  function closeAllPopups() {
    setStartOpen(false);
    setCalendarOpen(false);
    setVolOpen(false);
    setClipOpen(false);
  }

  document.addEventListener("click", closeAllPopups);
  // Focus moving to another app counts as clicking outside.
  if (typeof tb.onBlur === "function") tb.onBlur(closeAllPopups);
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
      volPop.hidden = true;
      clipPop.hidden = true;
      calCursor = new Date();
      renderCalendar();
    }
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

  // --- Clipboard history popup ---
  const clipList = document.getElementById("clipList");
  const trayClip = document.getElementById("trayClip");

  async function renderClipHistory() {
    const items = await tb.getClipboardHistory();
    clipList.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "clip-empty";
      empty.textContent = "Nothing copied yet.";
      clipList.appendChild(empty);
      return;
    }
    for (const text of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "clip-item";
      b.textContent = text.replace(/\s+/g, " ").trim().slice(0, 100) || "(whitespace)";
      b.title = "Click to copy";
      b.addEventListener("click", async () => {
        await tb.copyClipboardItem(text);
        b.classList.add("copied");
        setTimeout(() => setClipOpen(false), 250);
      });
      clipList.appendChild(b);
    }
  }

  function setClipOpen(open) {
    clipPop.hidden = !open;
    if (open) {
      startMenu.hidden = true;
      calendarPop.hidden = true;
      volPop.hidden = true;
      void renderClipHistory();
    }
  }

  trayClip.addEventListener("click", (e) => {
    e.stopPropagation();
    setClipOpen(clipPop.hidden);
  });
  clipPop.addEventListener("click", (e) => e.stopPropagation());

  // --- Volume: click opens a slider popup, scroll adjusts directly ---
  const volSlider = document.getElementById("volSlider");
  const volLevel = document.getElementById("volLevel");
  const volMuteBtn = document.getElementById("volMuteBtn");

  function applyVolumeUi(v) {
    const muted = !!v.muted;
    trayVol.classList.toggle("muted", muted);
    trayVol.title = muted ? "Muted" : "Volume " + Math.round(v.level) + "% — scroll to adjust";
    volSlider.value = Math.round(v.level);
    volLevel.textContent = Math.round(v.level) + "%";
    volMuteBtn.textContent = muted ? "Unmute" : "Mute";
  }

  async function syncVolumeUi() {
    applyVolumeUi(await tb.getVolume());
  }

  function setVolOpen(open) {
    volPop.hidden = !open;
    if (open) {
      startMenu.hidden = true;
      calendarPop.hidden = true;
      clipPop.hidden = true;
      void syncVolumeUi();
    }
  }

  syncVolumeUi();
  trayVol.addEventListener("click", (e) => {
    e.stopPropagation();
    setVolOpen(volPop.hidden);
  });
  volPop.addEventListener("click", (e) => e.stopPropagation());

  let volSetTimer = null;
  volSlider.addEventListener("input", () => {
    volLevel.textContent = volSlider.value + "%";
    if (volSetTimer) clearTimeout(volSetTimer);
    volSetTimer = setTimeout(async () => {
      applyVolumeUi(await tb.setVolume(Number(volSlider.value)));
    }, 120);
  });

  volMuteBtn.addEventListener("click", async () => {
    applyVolumeUi(await tb.toggleMute());
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

  // --- Battery indicator (hidden on machines without one) ---
  const trayBatt = document.getElementById("trayBatt");
  const battPct = document.getElementById("battPct");

  async function syncBattery() {
    try {
      const b = await tb.getBattery();
      if (!b.present || b.percent == null) {
        trayBatt.hidden = true;
        return;
      }
      trayBatt.hidden = false;
      battPct.textContent = b.percent + "%";
      trayBatt.classList.toggle("charging", b.onAC);
      trayBatt.classList.toggle("low", !b.onAC && b.percent <= 15);
      trayBatt.title = "Battery " + b.percent + "%" + (b.state ? " (" + b.state + ")" : "");
      const fill = trayBatt.querySelector(".batt-fill");
      if (fill) fill.setAttribute("width", String(Math.max(1, (13 * b.percent) / 100)));
    } catch {
      trayBatt.hidden = true;
    }
  }

  syncBattery();
  setInterval(syncBattery, 15_000);
  trayBatt.addEventListener("click", () => tb.openBatterySettings());
})();
