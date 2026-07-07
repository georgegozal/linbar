#import <Cocoa/Cocoa.h>

// Configure LinBar's overlay panel: stay visible during Mission Control / App Exposé
// (stationary collection behavior) without appearing in the Exposé window stack.
// Deliberately NOT FullScreenAuxiliary: fullscreen Spaces (videos, games) must
// cover the bar; it reappears when the user leaves fullscreen.
void linbar_configure_panel_window(void *nsViewHandle) {
  if (!nsViewHandle) return;
  NSView *view = (__bridge NSView *)nsViewHandle;
  NSWindow *window = view.window;
  if (!window) return;

  NSUInteger behavior = [window collectionBehavior];
  behavior &= ~(NSWindowCollectionBehaviorManaged | NSWindowCollectionBehaviorTransient);
  behavior &= ~NSWindowCollectionBehaviorFullScreenAuxiliary;
  behavior |= NSWindowCollectionBehaviorCanJoinAllSpaces;
  behavior |= NSWindowCollectionBehaviorStationary;
  behavior |= NSWindowCollectionBehaviorIgnoresCycle;
  [window setCollectionBehavior:behavior];
}
