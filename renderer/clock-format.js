(function () {
  function pad(n) {
    return String(n).padStart(2, "0");
  }

  const DATE_FORMAT_LABELS = {
    long: "Tuesday, June 16, 2026",
    medium: "Jun 16, 2026",
    short: "6/16/26",
    iso: "2026-06-16",
    weekdayDate: "Tuesday, June 16",
    dmyNumeric: "16/06/2026",
    dmyDots: "16.06.2026",
    dmyShort: "16 Jun 2026",
    dmyLong: "16 June 2026",
    dmyWeekday: "Tuesday, 16 June 2026",
  };

  function localizedMonth(d, style) {
    return d.toLocaleDateString(undefined, { month: style });
  }

  function formatTime(d, opts) {
    const hour12 = Boolean(opts && opts.hour12);
    const h24 = d.getHours();
    const m = pad(d.getMinutes());
    if (hour12) {
      const ampm = h24 >= 12 ? "PM" : "AM";
      const h12 = h24 % 12 || 12;
      return h12 + ":" + m + " " + ampm;
    }
    return pad(h24) + ":" + m;
  }

  function formatDate(d, style) {
    const s = style || "long";
    const day = d.getDate();
    const year = d.getFullYear();
    if (s === "dmyNumeric") {
      return pad(day) + "/" + pad(d.getMonth() + 1) + "/" + year;
    }
    if (s === "dmyDots") {
      return pad(day) + "." + pad(d.getMonth() + 1) + "." + year;
    }
    if (s === "dmyShort") {
      return day + " " + localizedMonth(d, "short") + " " + year;
    }
    if (s === "dmyLong") {
      return day + " " + localizedMonth(d, "long") + " " + year;
    }
    if (s === "dmyWeekday") {
      const wd = d.toLocaleDateString(undefined, { weekday: "long" });
      return wd + ", " + day + " " + localizedMonth(d, "long") + " " + year;
    }
    if (s === "medium") {
      return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    }
    if (s === "short") {
      return d.toLocaleDateString(undefined, { dateStyle: "short" });
    }
    if (s === "iso") {
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
    if (s === "weekdayDate") {
      return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    }
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function clockOptsFromConfig(cfg) {
    return {
      showDate: Boolean(cfg && cfg.clockShowDate),
      hour12: Boolean(cfg && cfg.clockHour12),
      dateFormat: (cfg && cfg.clockDateFormat) || "long",
    };
  }

  function applyClock(cfg) {
    const d = new Date();
    const opts = clockOptsFromConfig(cfg);
    const timeEl = document.getElementById("clockTime");
    const dateEl = document.getElementById("clockDate");
    const clockEl = document.getElementById("clock");
    if (!timeEl) return;
    timeEl.textContent = formatTime(d, { hour12: opts.hour12 });
    if (dateEl) {
      dateEl.hidden = !opts.showDate;
      dateEl.textContent = opts.showDate ? formatDate(d, opts.dateFormat) : "";
    }
    if (clockEl) clockEl.classList.toggle("clock--time-only", !opts.showDate);
  }

  window.LinbarClockFormat = {
    DATE_FORMAT_LABELS,
    formatTime,
    formatDate,
    clockOptsFromConfig,
    applyClock,
  };
})();
