(function () {
  function randomPart() {
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  }

  function next(scope) {
    var s = String(scope || "ui").slice(0, 24);
    var ts = Date.now().toString(36);
    return "corr-" + s + "-" + ts + "-" + randomPart();
  }

  window.SkyeCorrelation = window.SkyeCorrelation || {};
  window.SkyeCorrelation.next = next;
})();
