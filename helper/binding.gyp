{
  "targets": [
    {
      "target_name": "linbar_panel",
      "sources": ["panel_binding.cc", "panel-window.m"],
      "conditions": [
        ["OS=='mac'", {
          "link_settings": {
            "libraries": ["-framework", "Cocoa"]
          },
          "xcode_settings": {
            "GCC_ENABLE_OBJC_ARC": "YES",
            "OTHER_CFLAGS": ["-ObjC++"]
          }
        }]
      ]
    }
  ]
}
