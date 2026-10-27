# Mobile surface

Inherited KAIDEN identity, not a redesign of desktop.
Approved logo: apps/web/public/kaiden-logo.png, copied without redrawing.
Semantic CSS roles: surface, raised, text, muted, line, accent, on-accent, error, focus.
Compact: five bottom destinations; expanded: rail.
Public @orion/ui/theme presets and themeDocumentVariables are the color/geometry source.
Precision/Obsidian/Midnight/Emerald/Crimson for dark; Arctic for light.
Default dark palette: Precision. Theme mode and dark palette are local preferences.
48px minimum touch targets, readable system body face, full-screen editor, native Back.
Empty, failed-storage, draft, saving, archived and local-only states are explicit.
Light/dark use system preference; reduced motion disables the entrance.
Browser snapshots prove the shared UI only. Android insets, keyboard, TalkBack,
system font scale, SQLite durability and ColorOS require native acceptance.

Motion: finite feedback (90–260ms); orbit menu is the focal moment. Hit targets remain stable. Keyboard/reduced-motion routes are instant. Native animator preference is read on resume. Presentation styles are mobile-only.

Depth: native gravity adapter drives a shared screen-space parallax, without per-card rotation/perspective. Static background -> content plane (up to 2px/axis) -> card (+1px) -> text (+0.4px). Chrome moves subtly; fixed navigation/gesture overlays stay anchored. All planes freeze through the last pointer release, reset for input/background/reduced motion. Hold/release without selection now latches quick actions; descendant capture loss is not cancellation (alpha.9).

