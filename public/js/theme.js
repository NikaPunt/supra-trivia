// Runs before first paint so the chosen look never flashes. Classic script on purpose (not a module).
(function () {
  var d = "pirosmani";
  try {
    var saved = localStorage.getItem("trivia-design");
    if (/^(pirosmani|supper|paper|show)$/.test(saved)) d = saved;
  } catch (e) { /* storage blocked: use the default */ }
  document.documentElement.setAttribute("data-design", d);
})();
