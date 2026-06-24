#include <node_api.h>
#include <stdint.h>

extern void linbar_configure_panel_window(void *nsViewHandle);

static napi_value Configure(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "expected native window handle buffer");
    return nullptr;
  }

  void *data = nullptr;
  size_t len = 0;
  napi_status status = napi_get_buffer_info(env, argv[0], &data, &len);
  if (status != napi_ok || data == nullptr || len < sizeof(void *)) {
    napi_throw_type_error(env, nullptr, "invalid native window handle");
    return nullptr;
  }

  void *view = nullptr;
#if UINTPTR_MAX == 0xffffffffffffffffu
  view = (void *)(uintptr_t)(*(const uint64_t *)data);
#else
  view = (void *)(uintptr_t)(*(const uint32_t *)data);
#endif

  linbar_configure_panel_window(view);
  return nullptr;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor desc = {
    "configure",
    nullptr,
    Configure,
    nullptr,
    nullptr,
    nullptr,
    napi_default,
    nullptr,
  };
  napi_define_properties(env, exports, 1, &desc);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
