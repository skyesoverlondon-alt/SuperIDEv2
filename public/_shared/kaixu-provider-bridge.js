(function () {
  if (window.SkyeKaixuBridge && window.SkyeKaixuBridge.installed) return;

  const nativeFetch = window.fetch.bind(window);
  const TRANSPARENT_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sY9qs8AAAAASUVORK5CYII=";

  function getWorkspaceId() {
    return new URLSearchParams(window.location.search).get("ws_id") || "primary-workspace";
  }

  function stringifyText(value) {
    if (Array.isArray(value)) {
      return value.map(stringifyText).filter(Boolean).join("\n").trim();
    }
    if (value && typeof value === "object") {
      if (typeof value.text === "string") return value.text;
      if (typeof value.content === "string") return value.content;
      if (Array.isArray(value.parts)) return stringifyText(value.parts);
      if (Array.isArray(value.content)) return stringifyText(value.content);
    }
    return typeof value === "string" ? value : "";
  }

  function extractOpenAIText(body) {
    const messages = Array.isArray(body && body.messages) ? body.messages : [];
    let system = "";
    let prompt = "";
    for (const message of messages) {
      const role = String(message && message.role || "").toLowerCase();
      const text = stringifyText(message && message.content);
      if (!text) continue;
      if (role === "system") {
        system = system ? system + "\n\n" + text : text;
      } else if (role === "user") {
        prompt = prompt ? prompt + "\n\n" + text : text;
      }
    }
    return { prompt, system };
  }

  function extractGeminiText(body) {
    const system = stringifyText(body && body.systemInstruction && body.systemInstruction.parts);
    const prompt = stringifyText(body && body.contents);
    return { prompt, system };
  }

  function renderPromptSvg(promptText, label) {
    const esc = function (value) {
      return String(value || "").replace(/[&<>"']/g, function (match) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[match];
      });
    };
    const body = esc(String(promptText || "").slice(0, 540));
    const tag = esc(label || "kAIxU Gateway Render");
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
      + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#312e81"/></linearGradient></defs>'
      + '<rect width="1024" height="1024" fill="url(#g)"/>'
      + '<rect x="44" y="44" width="936" height="936" rx="24" fill="none" stroke="#eab308" stroke-opacity="0.55" stroke-width="4"/>'
      + '<text x="72" y="118" fill="#eab308" font-size="36" font-family="Arial, sans-serif" font-weight="700">' + tag + '</text>'
      + '<foreignObject x="72" y="168" width="880" height="780"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;color:#e2e8f0;font-size:30px;line-height:1.35;white-space:pre-wrap;">' + body + '</div></foreignObject>'
      + '</svg>';
  }

  async function renderPromptPngBase64(promptText, label) {
    const svg = renderPromptSvg(promptText, label);
    const svgUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    return await new Promise(function (resolve) {
      const image = new Image();
      image.onload = function () {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 1024;
          canvas.height = 1024;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""));
        } catch {
          resolve(TRANSPARENT_PNG_BASE64);
        }
      };
      image.onerror = function () {
        resolve(TRANSPARENT_PNG_BASE64);
      };
      image.src = svgUrl;
    });
  }

  async function ensureUnlockedAccess() {
    if (window.SkyeAuthUnlock && typeof window.SkyeAuthUnlock.ensureUnlockedAccess === "function") {
      await window.SkyeAuthUnlock.ensureUnlockedAccess({
        labelPrefix: "kaixu-standalone",
        pinPrompt: "Enter your session PIN to unlock kAIxU access"
      });
    }
  }

  function buildGatewayHeaders(inputHeaders) {
    const headers = new Headers(inputHeaders || {});
    if (!headers.get("Content-Type")) headers.set("Content-Type", "application/json");
    if (window.SkyeAuthUnlock && typeof window.SkyeAuthUnlock.authHeaders === "function") {
      const authHeaders = window.SkyeAuthUnlock.authHeaders();
      Object.keys(authHeaders).forEach(function (key) {
        if (!headers.get(key)) headers.set(key, authHeaders[key]);
      });
    }
    if (!headers.get("x-correlation-id") && window.SkyeCorrelation && typeof window.SkyeCorrelation.nextId === "function") {
      headers.set("x-correlation-id", window.SkyeCorrelation.nextId("kaixu-standalone"));
    }
    return headers;
  }

  function matchesPath(pathname, parts) {
    return pathname === "/" + parts.join("/");
  }

  async function gatewayGenerate(prompt, system, inputHeaders) {
    await ensureUnlockedAccess();
    const response = await nativeFetch("/api/kaixu-generate", {
      method: "POST",
      credentials: "include",
      headers: buildGatewayHeaders(inputHeaders),
      body: JSON.stringify({
        ws_id: getWorkspaceId(),
        activePath: window.location.pathname,
        prompt: [String(system || "").trim(), String(prompt || "").trim()].filter(Boolean).join("\n\n")
      })
    });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      throw new Error(data && (data.error || data.message) ? data.error || data.message : "kAIxU gateway error");
    }
    return data && (data.text || data.output) ? data.text || data.output : "";
  }

  function responseJson(payload, status) {
    return new Response(JSON.stringify(payload), {
      status: status || 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  async function interceptRequest(input, init) {
    const requestUrl = typeof input === "string" ? input : input && input.url;
    if (!requestUrl) {
      return nativeFetch(input, init);
    }

    const normalizedUrl = new URL(requestUrl, window.location.origin);
    const bodyText = init && typeof init.body === "string" ? init.body : "";
    const body = bodyText ? JSON.parse(bodyText) : null;

    if (normalizedUrl.pathname === "/api/kaixu-generate") {
      await ensureUnlockedAccess();
      const nextInit = Object.assign({}, init || {});
      nextInit.credentials = nextInit.credentials || "include";
      nextInit.headers = buildGatewayHeaders(nextInit.headers);
      return nativeFetch(input, nextInit);
    }

    if (normalizedUrl.hostname === "api.openai.com" && matchesPath(normalizedUrl.pathname, ["v1", "chat", "completions"])) {
      const extracted = extractOpenAIText(body || {});
      const text = await gatewayGenerate(extracted.prompt, extracted.system, init && init.headers);
      return responseJson({ choices: [{ message: { content: text } }] });
    }

    if (normalizedUrl.hostname === "generativelanguage.googleapis.com" && normalizedUrl.pathname.indexOf(":generateContent") !== -1) {
      const extracted = extractGeminiText(body || {});
      const text = await gatewayGenerate(extracted.prompt, extracted.system, init && init.headers);
      return responseJson({ candidates: [{ content: { parts: [{ text: text }] } }] });
    }

    if (normalizedUrl.hostname === "api.openai.com" && matchesPath(normalizedUrl.pathname, ["v1", "images", "generations"])) {
      const visualPrompt = String(body && body.prompt || "").trim();
      const artDirection = await gatewayGenerate(visualPrompt, "Create a concise visual art direction paragraph for this scene.", init && init.headers);
      const pngBase64 = await renderPromptPngBase64(artDirection || visualPrompt, "kAIxU Gateway Render");
      return responseJson({ data: [{ b64_json: pngBase64 }] });
    }

    if (normalizedUrl.hostname === "generativelanguage.googleapis.com" && normalizedUrl.pathname.indexOf(":predict") !== -1) {
      const visualPrompt = stringifyText(body && body.instances && body.instances.prompt);
      const artDirection = await gatewayGenerate(visualPrompt, "Create a concise visual art direction paragraph for this scene.", init && init.headers);
      const pngBase64 = await renderPromptPngBase64(artDirection || visualPrompt, "kAIxU Gateway Render");
      return responseJson({ predictions: [{ bytesBase64Encoded: pngBase64 }] });
    }

    return nativeFetch(input, init);
  }

  window.fetch = function (input, init) {
    return interceptRequest(input, init);
  };

  window.SkyeKaixuBridge = { installed: true };
})();