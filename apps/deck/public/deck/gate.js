// The browser gate: a classic script that runs in every browser before the deck's module code.
// When the browser lacks what the deck is built on, or cannot load its code at all, this page says
// so in words instead of staying blank. It builds its message with DOM calls, never markup.
// Supported: the last two major versions of Chrome, Edge, Firefox and Safari (docs/BROWSER_SUPPORT.md).
(function () {
  var missing = [];
  if (typeof WebGL2RenderingContext === "undefined") missing.push("WebGL 2");
  if (typeof CompressionStream === "undefined") missing.push("CompressionStream (Chrome 80, Firefox 113, Safari 16.4)");
  if (typeof structuredClone === "undefined") missing.push("structuredClone");
  if (typeof BroadcastChannel === "undefined") missing.push("BroadcastChannel");
  if (!Array.prototype.at) missing.push("Array.prototype.at");
  if (!(window.crypto && window.crypto.subtle)) missing.push("Web Crypto (a secure https or localhost page)");
  if (typeof ResizeObserver === "undefined") missing.push("ResizeObserver");

  function mounted() { var root = document.getElementById("root"); return root && root.firstElementChild && root.firstElementChild.id !== "gate"; }
  function show(reason) {
    var root = document.getElementById("root");
    if (!root || mounted()) return;
    while (root.firstChild) root.removeChild(root.firstChild);
    var box = document.createElement("div"); box.id = "gate"; box.setAttribute("role", "alert");
    box.style.cssText = "max-width:44rem;margin:12vh auto;padding:0 24px;font:16px/1.5 system-ui,sans-serif;color:#e8ecf3";
    var h = document.createElement("h1"); h.textContent = "This browser cannot run the deck"; h.style.cssText = "font-size:22px;font-weight:600;margin:0 0 12px";
    var p = document.createElement("p"); p.textContent = reason;
    var q = document.createElement("p"); q.textContent = "The deck runs on the last two major versions of Chrome, Edge, Firefox and Safari, with hardware acceleration on. Open it there, or ask whoever hosts it for docs/BROWSER_SUPPORT.md.";
    box.appendChild(h); box.appendChild(p); box.appendChild(q); root.appendChild(box);
    document.documentElement.style.background = "#0b0e14";
  }

  if (missing.length) show("It lacks " + missing.join(", ") + ".");
  // A browser that parses but cannot run the module code (an older syntax level) raises a window error before anything mounts.
  window.addEventListener("error", function (event) {
    if (mounted()) return;
    var text = String(event && event.message || "");
    if (/Unexpected token|import|export|await|module|Cannot use/i.test(text)) show("Its JavaScript engine could not load the deck's code (" + text.slice(0, 120) + ").");
  });
  // No module code at all after a while, and nothing drawn: the script failed to load, or was blocked.
  window.setTimeout(function () { if (!mounted() && !document.getElementById("gate") && !document.getElementById("root").hasChildNodes()) show("Its code did not load within 20 seconds: the network, a content filter or a policy may be blocking the deck's scripts."); }, 20000);
})();
