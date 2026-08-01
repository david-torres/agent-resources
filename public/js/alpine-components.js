// Alpine.data() registrations.
//
// This file MUST load before the Alpine CDN tag in head.handlebars.
// Alpine's CDN build calls Alpine.start() inside a queueMicrotask that
// fires immediately after its own script tag — before the next deferred
// script — so an alpine:init listener registered later never runs.
//
// Unlike the character-* modules this is loaded from <head>, outside the
// hx-boost swap region, so it executes exactly once and can use const.
document.addEventListener('alpine:init', () => {
  // Components are registered here as they are converted.
});
