(function () {
  const api = window.linbarSettings;
  const launchAtLogin = document.getElementById("launchAtLogin");
  const hideDockIcon = document.getElementById("hideDockIcon");
  const openAccessibility = document.getElementById("openAccessibility");

  async function init() {
    const cfg = await api.getConfig();
    launchAtLogin.checked = Boolean(cfg.launchAtLogin);
    hideDockIcon.checked = Boolean(cfg.hideDockIcon);
  }

  launchAtLogin.addEventListener("change", () => {
    void api.setConfig({ launchAtLogin: launchAtLogin.checked });
  });

  hideDockIcon.addEventListener("change", () => {
    void api.setConfig({ hideDockIcon: hideDockIcon.checked });
  });

  openAccessibility.addEventListener("click", () => {
    void api.openAccessibilitySettings();
  });

  void init();
})();
