/**
 * The anti-flash script, inlined in `<head>` so it runs before first paint.
 *
 * Without it a user who chose dark gets a full frame of light paper before React hydrates, which
 * is the single most noticeable bug in any theme implementation.
 *
 * `system` is stored but deliberately does nothing here: the absence of the attribute is what
 * lets the `prefers-color-scheme` media query in `globals.css` decide, and keep deciding if the
 * machine switches at sunset. Writing a resolved value would freeze that at page load.
 *
 * Wrapped in try/catch because localStorage throws outright in some privacy modes, and a theme
 * preference is never worth taking the page down for.
 *
 * This file used to also export a `ThemeToggle` component. The theme is now chosen in settings and
 * flipped from the account menu, which left that component exported and called by nothing. An
 * unreachable export that looks finished is worse than an absent one, because a reader assumes the
 * feature is wired up, so it was deleted rather than left for somebody to find.
 */
const KEY = 'rw-theme'

export const themeScript = `try{var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`
