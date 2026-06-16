(function () {
  const api = window.linbarSettings;
  const clockShowDate = document.getElementById("clockShowDate");
  const clockHour12 = document.getElementById("clockHour12");
  const clockDateFormat = document.getElementById("clockDateFormat");
  const clockDateFormatRow = document.getElementById("clockDateFormatRow");
  const clockPreview = document.getElementById("clockPreview");
  const launchAtLogin = document.getElementById("launchAtLogin");
  const hideDockIcon = document.getElementById("hideDockIcon");
  const reserveScreenSpace = document.getElementById("reserveScreenSpace");
  const openAccessibility = document.getElementById("openAccessibility");

  function currentClockConfig() {
    return {
      clockShowDate: clockShowDate.checked,
      clockHour12: clockHour12.value === "12",
      clockDateFormat: clockDateFormat.value,
    };
  }

  function syncDateFormatRow() {
    clockDateFormatRow.classList.toggle("disabled", !clockShowDate.checked);
  }

  function renderPreview() {
    const fmt = window.LinbarClockFormat;
    if (!fmt || !clockPreview) return;
    const cfg = currentClockConfig();
    const d = new Date();
    const opts = fmt.clockOptsFromConfig(cfg);
    const time = fmt.formatTime(d, { hour12: opts.hour12 });
    let html = '<span class="preview-time">' + time + "</span>";
    if (opts.showDate) {
      html += '<div class="preview-date">' + fmt.formatDate(d, opts.dateFormat) + "</div>";
    }
    clockPreview.innerHTML = html;
  }

  async function init() {
    const cfg = await api.getConfig();
    clockShowDate.checked = Boolean(cfg.clockShowDate);
    clockHour12.value = cfg.clockHour12 ? "12" : "24";
    clockDateFormat.value = cfg.clockDateFormat || "long";
    launchAtLogin.checked = Boolean(cfg.launchAtLogin);
    hideDockIcon.checked = Boolean(cfg.hideDockIcon);
    reserveScreenSpace.checked = cfg.reserveScreenSpace !== false;
    syncDateFormatRow();
    renderPreview();
  }

  function saveClock() {
    syncDateFormatRow();
    renderPreview();
    void api.setConfig(currentClockConfig());
  }

  clockShowDate.addEventListener("change", saveClock);
  clockHour12.addEventListener("change", saveClock);
  clockDateFormat.addEventListener("change", saveClock);

  launchAtLogin.addEventListener("change", () => {
    void api.setConfig({ launchAtLogin: launchAtLogin.checked });
  });

  hideDockIcon.addEventListener("change", () => {
    void api.setConfig({ hideDockIcon: hideDockIcon.checked });
  });

  reserveScreenSpace.addEventListener("change", () => {
    void api.setConfig({ reserveScreenSpace: reserveScreenSpace.checked });
  });

  openAccessibility.addEventListener("click", () => {
    void api.openAccessibilitySettings();
  });

  void init();
})();
