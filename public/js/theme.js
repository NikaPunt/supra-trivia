// Runs before first paint so the chosen look never flashes. Classic script on purpose (not a module).
(function () {
  var d = "pirosmani";
  try {
    var saved = localStorage.getItem("trivia-design");
    if (/^(pirosmani|supper|paper|show)$/.test(saved)) d = saved;
  } catch (e) { /* storage blocked: use the default */ }
  document.documentElement.setAttribute("data-design", d);
  // Ask for this look's main fonts straight away, instead of waiting until the stylesheet has arrived and been read.
  // The addresses must match the ones in styles.css exactly, or the browser would download them twice.
  var fonts = d === "show" ? ["bricolage-grotesque-latin-wght-normal"] : ["fraunces-latin-full-normal", "alegreya-sans-latin-400-normal"];
  for (var i = 0; i < fonts.length; i++) {
    var l = document.createElement("link");
    l.rel = "preload"; l.as = "font"; l.type = "font/woff2"; l.crossOrigin = "anonymous";
    l.href = "/fonts/" + fonts[i] + ".woff2";
    document.head.appendChild(l);
  }
})();
