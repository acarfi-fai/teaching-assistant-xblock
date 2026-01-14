function AgentTestXBlock(runtime, element, initArgs) {
  const handlerUrl = runtime.handlerUrl(element, "chat");

  const messagesEl = element.querySelector("#messages");
  const inputEl = element.querySelector("#input");
  const sendBtn = element.querySelector("#sendBtn");
  const errEl = element.querySelector("#err");
  const statusEl = element.querySelector("#agtStatus");
  const metaEl = element.querySelector("#agtVideoMeta");
  const fsButtons = element.querySelectorAll("[data-agt-fs]");
  const spinnerEl = element.querySelector("#agtSendSpinner");
  const rootEl = element.querySelector(".agt-root");
  const playerHost = element.querySelector("#ytPlayer");

  function nowTime() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(";").shift();
    return null;
  }

  function formatSeconds(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const pad2 = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`;
  }

  function append(role, text, meta) {
    const group = document.createElement("div");
    group.className = "agt-msg-group";

    const bubble = document.createElement("div");
    bubble.className = "agt-msg " + (role === "user" ? "agt-msg-user" : "agt-msg-assistant");
    bubble.textContent = text;

    const m = document.createElement("div");
    m.className = "agt-msg-meta";

    const who = document.createElement("span");
    who.className = "agt-chip";
    who.textContent = role === "user" ? "You" : "Assistant";

    const time = document.createElement("span");
    time.className = "agt-chip";
    time.textContent = nowTime();

    m.appendChild(who);
    m.appendChild(time);

    if (meta && meta.video_time != null) {
      const vt = document.createElement("span");
      vt.className = "agt-chip";
      vt.textContent = `t=${formatSeconds(meta.video_time)}`;
      m.appendChild(vt);
    }

    group.appendChild(bubble);
    group.appendChild(m);

    messagesEl.appendChild(group);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function parseYouTubeVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
      if (u.hostname === "youtu.be") return u.pathname.replace("/", "");
      return null;
    } catch {
      return null;
    }
  }

  // ---- Fullscreen (video + chat) ----
  function isFullscreen() {
    return document.fullscreenElement === rootEl;
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenEnabled) {
        errEl.textContent = "Fullscreen is not supported by this browser/context.";
        return;
      }

      if (!isFullscreen()) {
        await rootEl.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      errEl.textContent = "Fullscreen error: " + String(e);
    }
  }

  function updateFsUi() {
    const on = isFullscreen();
    rootEl.classList.toggle("agt-fullscreen", on);
    fsButtons.forEach((btn) => {
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      const labelEl = btn.querySelector(".agt-btn-label");
      if (labelEl) labelEl.textContent = on ? "Exit Fullscreen" : "Fullscreen";
    });
  }

  fsButtons.forEach((btn) => btn.addEventListener("click", toggleFullscreen));
  document.addEventListener("fullscreenchange", updateFsUi);

  // ---- YouTube Player ----
  let player = null;
  const youtubeUrl = initArgs.youtube_url || "";
  const videoId = parseYouTubeVideoId(youtubeUrl);

  if (!videoId) {
    errEl.textContent = "Invalid YouTube URL (cannot extract video id).";
    statusEl.textContent = "Error.";
    return;
  }

  metaEl.textContent = `YouTube id: ${videoId}`;

  function loadYouTubeApi() {
    return new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve();

      if (!document.querySelector("script[data-yt-iframe-api]")) {
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        s.async = true;
        s.dataset.ytIframeApi = "1";
        document.head.appendChild(s);
      }

      const start = Date.now();
      const t = setInterval(() => {
        if (window.YT && window.YT.Player) {
          clearInterval(t);
          resolve();
        } else if (Date.now() - start > 12000) {
          clearInterval(t);
          reject(new Error("Timed out loading YouTube IFrame API"));
        }
      }, 50);
    });
  }

  async function initPlayer() {
    statusEl.textContent = "Loading player…";
    await loadYouTubeApi();

    const mountId = "ytPlayer_" + Math.random().toString(16).slice(2);
    playerHost.id = mountId;

    player = new YT.Player(mountId, {
      videoId,
      width: "100%",
      height: "100%",
      playerVars: {
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
      },
      events: {
        onReady: () => {
          statusEl.textContent = "Ready.";
        },
        onError: (e) => {
          statusEl.textContent = "Player error.";
          errEl.textContent = `YouTube error: ${e && e.data}`;
        },
      },
    });
  }

  // ---- Handler call ----
  async function callHandler(payload) {
    const csrf = getCookie("csrftoken") || "";
    const r = await fetch(handlerUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrf,
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Non-JSON response from handler: " + text.slice(0, 200));
    }
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }

  function setLoading(isLoading) {
    if (isLoading) {
      sendBtn.disabled = true;
      sendBtn.classList.add("is-loading");
      spinnerEl.style.display = "inline-block";
      statusEl.textContent = "Thinking…";
    } else {
      sendBtn.disabled = false;
      sendBtn.classList.remove("is-loading");
      spinnerEl.style.display = "none";
      statusEl.textContent = "Ready.";
    }
  }

  async function send() {
    const message = (inputEl.value || "").trim();
    if (!message) return;

    errEl.textContent = "";

    const t =
      player && typeof player.getCurrentTime === "function"
        ? player.getCurrentTime()
        : 0;

    inputEl.value = "";
    append("user", message, { video_time: t });
    setLoading(true);

    const payload = {
      message,
      video_time: t,
      transcript_window_text: "",
      youtube_url: youtubeUrl,
      video_id: videoId,
    };

    try {
      const data = await callHandler(payload);
      if (data.error) throw new Error(data.error);
      append("assistant", data.answer || "(no answer)", { video_time: t });
    } catch (e) {
      errEl.textContent = String(e);
    } finally {
      setLoading(false);
      inputEl.focus();
    }
  }

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      send();
    }
  });

  // Seed message
  append("assistant", "Hello! Ask me a question about the video.", { video_time: 0 });

  // Start
  initPlayer().catch((e) => {
    statusEl.textContent = "Error.";
    errEl.textContent = String(e);
  });

  // FS initial label/state
  updateFsUi();
}
