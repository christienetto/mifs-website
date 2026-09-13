/* MIFS — product page behaviour. No dependencies. */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Songs ---------- */

  const TINTS = {
    "send-me-the-chorus": "#c8457f",
    "neon-harbor": "#7a2f8f",
    "paper-satellites": "#2b3c73",
  };
  const SONGS = {};
  for (const s of window.MIFS_SONGS || []) {
    SONGS[s.id] = {
      ...s,
      art: `assets/art/${s.id}.webp`,
      thumb: `assets/art/${s.id}-thumb.webp`,
      audio: `assets/audio/${s.id}.m4a`,
      tint: TINTS[s.id] || "#5a3fcf",
    };
  }
  const SONG_ORDER = ["send-me-the-chorus", "neon-harbor", "paper-satellites"];

  /** "0:07", "3:42". */
  const clock = (sec) => {
    const t = Math.max(0, Math.floor(sec + 1e-6));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  };

  /** The mean level in each of `n` equal buckets of [from, to), stretched to fill the height. */
  function bucket(levels, from, to, n) {
    const a = Math.max(0, Math.floor(from * 10));
    const b = Math.min(levels.length, Math.ceil(to * 10));
    const seg = levels.slice(a, b);
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = Math.floor((i * seg.length) / n);
      const e = Math.max(s + 1, Math.floor(((i + 1) * seg.length) / n));
      let sum = 0;
      for (let j = s; j < e; j++) sum += seg[j] || 0;
      out.push(sum / (e - s));
    }
    const hi = Math.max(...out, 0.001);
    const lo = Math.min(...out) * 0.7;
    return out.map((v) => clamp(0.16 + (0.84 * (v - lo)) / Math.max(0.001, hi - lo), 0.16, 1));
  }

  /* ---------- Player: one snippet at a time ---------- */

  const Player = (() => {
    const audios = {};
    let cur = null;

    function audioFor(id) {
      if (!audios[id]) {
        const a = new Audio();
        a.preload = "auto";
        a.src = SONGS[id].audio;
        audios[id] = a;
      }
      return audios[id];
    }

    function play({ key, songId, start, length, onTick, onState }) {
      stop();
      const a = audioFor(songId);
      const c = (cur = { key, a, start, length, onTick, onState, started: false, raf: 0 });
      onState && onState("loading");
      const seek = () => {
        if (cur !== c) return;
        const r = a.seekable;
        if ((!r.length || r.end(r.length - 1) < start) && !a.dataset.local) {
          // The host can't serve byte ranges, so seeking fails. Load the whole file locally instead.
          a.pause();
          a.dataset.local = "1";
          fetch(SONGS[songId].audio)
            .then((res) => res.blob())
            .then((blob) => {
              a.src = URL.createObjectURL(blob);
              a.addEventListener("loadedmetadata", () => {
                if (cur !== c) return;
                a.currentTime = start;
                a.play().catch(() => { if (cur === c) stop(); });
              }, { once: true });
            })
            .catch(() => { if (cur === c) stop(); });
          return;
        }
        try { a.currentTime = start; } catch (_) {}
      };
      a.volume = 1;
      if (a.readyState >= 1) seek();
      else a.addEventListener("loadedmetadata", seek, { once: true });
      const p = a.play();
      if (p && p.catch) p.catch(() => { if (cur === c) stop(); });

      const tick = () => {
        if (cur !== c) return;
        const t = a.currentTime - start;
        if (!c.started && !a.paused && !a.seeking && t >= -0.05 && t < length) {
          c.started = true;
          onState && onState("playing");
        }
        if (c.started) {
          const prog = clamp(t / length, 0, 1);
          onTick && onTick(prog, a.currentTime);
          const remain = length - t;
          a.volume = remain < 0.45 ? clamp(remain / 0.45, 0, 1) : 1;
          if (t >= length || a.ended) { stop(); return; }
        }
        c.raf = requestAnimationFrame(tick);
      };
      c.raf = requestAnimationFrame(tick);
    }

    function stop() {
      if (!cur) return;
      const c = cur;
      cur = null;
      cancelAnimationFrame(c.raf);
      c.a.pause();
      c.onTick && c.onTick(0, null);
      c.onState && c.onState("idle");
    }

    const isActive = (key) => !!cur && cur.key === key;
    const toggle = (opts) => (isActive(opts.key) ? stop() : play(opts));
    return { play, stop, toggle, isActive };
  })();

  let uid = 0;
  const nextKey = (prefix) => `${prefix}-${++uid}`;

  /* ---------- The MIFS bubble ---------- */

  const PLAY_SVG = '<svg class="i-play" viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 3.8l10 6.2-10 6.2z" fill="currentColor"/></svg>';
  const STOP_SVG = '<svg class="i-stop" viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="4.5" width="11" height="11" rx="2" fill="currentColor"/></svg>';

  function cardHTML(song, start, length) {
    const bars = bucket(song.waveform, start, start + length, 22)
      .map((v) => `<i style="height:${(v * 100).toFixed(1)}%"></i>`)
      .join("");
    return (
      `<span class="mif-card" style="--tint:${song.tint}">` +
      `<img class="mif-art" src="${song.art}" alt="">` +
      `<span class="mif-bars">${bars}</span>` +
      `<span class="mif-badge">${PLAY_SVG}${STOP_SVG}</span>` +
      `<span class="mif-time">${clock(length)}</span>` +
      `</span>`
    );
  }

  function buildMif(el) {
    const song = SONGS[el.dataset.song];
    if (!song) return;
    const start = parseFloat(el.dataset.start);
    const length = parseFloat(el.dataset.length);
    el.innerHTML =
      cardHTML(song, start, length) +
      `<span class="mif-caption"><span class="mif-title">${song.title}</span>` +
      `<span class="mif-sub"><span>${song.artist}</span><span>▶︎ ${clock(length)}</span></span></span>`;
    if (el.tagName !== "BUTTON") return;

    el.setAttribute("aria-label", `Play ${song.title} by ${song.artist}, ${Math.round(length)} second snippet`);
    const key = nextKey("mif");
    const bars = $$(".mif-bars i", el);
    const time = $(".mif-time", el);
    el.addEventListener("click", () => {
      Player.toggle({
        key, songId: song.id, start, length,
        onState(s) {
          el.classList.toggle("loading", s === "loading");
          el.classList.toggle("playing", s === "playing");
          el.setAttribute("aria-pressed", s === "idle" ? "false" : "true");
        },
        onTick(p, t) {
          const n = Math.round(p * bars.length);
          bars.forEach((b, i) => b.classList.toggle("played", i < n));
          time.textContent = clock(t == null ? length : Math.ceil(length * (1 - p)));
        },
      });
    });
  }

  $$(".mif[data-song]").forEach(buildMif);
  $$("[data-card]").forEach((el) => {
    const song = SONGS[el.dataset.card];
    if (song) el.innerHTML = cardHTML(song, song.highlight, 10);
  });
  $$("[data-mini]").forEach((el) => {
    const song = SONGS[el.dataset.mini];
    if (song) el.innerHTML = cardHTML(song, song.highlight, 10);
  });

  /* ---------- Canvas helpers ---------- */

  function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    return { ctx, w: r.width, h: r.height };
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    else ctx.rect(x, y, w, h);
  }

  /** The editor's timeline: waveform under a fixed, centred selection window, with a lyric lane. */
  function drawScrubber(canvas, song, start, length, playhead, visible) {
    const f = fit(canvas);
    if (!f) return 0;
    const { ctx, w, h } = f;
    const lane = song.lyrics.length ? Math.max(8, Math.round(h * 0.11)) : 0;
    const waveH = h - lane - 6;
    const mid = 3 + waveH / 2;
    const pps = w / visible;
    const winW = length * pps;
    const left = (w - winW) / 2;
    const x0 = left - start * pps;
    const step = pps / 10;
    const bw = Math.max(1, step * 0.62);
    const end = start + length;

    for (let i = 0; i < song.waveform.length; i++) {
      const x = x0 + i * step;
      if (x < -bw || x > w) continue;
      const t = i / 10;
      const inSel = t >= start - 0.05 && t < end;
      const bh = Math.max(bw, Math.pow(song.waveform[i], 1.5) * waveH * 0.94);
      if (!inSel) ctx.fillStyle = "rgba(255,255,255,0.3)";
      else if (playhead == null || t < playhead) ctx.fillStyle = "#fff";
      else ctx.fillStyle = "rgba(255,255,255,0.6)";
      rr(ctx, x, mid - bh / 2, bw, bh, bw / 2);
      ctx.fill();
    }

    if (lane) {
      const y = h - lane / 2 - 1.5;
      for (const l of song.lyrics) {
        const xs = x0 + l.s * pps, xe = x0 + l.e * pps;
        if (xe < 0 || xs > w) continue;
        ctx.fillStyle = l.s < end && l.e > start ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.22)";
        rr(ctx, xs + 1, y, Math.max(3, xe - xs - 2), 3, 1.5);
        ctx.fill();
      }
    }

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    rr(ctx, left, 1.25, winW, h - 2.5, Math.min(14, h * 0.13));
    ctx.fill();
    ctx.stroke();

    if (playhead != null) {
      const px = left + (playhead - start) * pps;
      ctx.fillStyle = "#fff";
      rr(ctx, px - 1, 6, 2, h - 12, 1);
      ctx.fill();
    }
    return pps;
  }

  /** A whole song as gradient bars, with the highlight window marked. */
  function drawFullWave(canvas, song) {
    const f = fit(canvas);
    if (!f) return;
    const { ctx, w, h } = f;
    const n = Math.floor(w / 5);
    const bars = bucket(song.waveform, 0, song.duration, n);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "#9277ff");
    g.addColorStop(0.45, "#d25cff");
    g.addColorStop(0.75, "#ff4f99");
    g.addColorStop(1, "#ff8a5c");
    const bw = 3;
    const hs = song.highlight / song.duration, he = (song.highlight + 10) / song.duration;
    for (let i = 0; i < n; i++) {
      const x = i * (w / n);
      const bh = Math.max(bw, bars[i] * h * 0.86);
      const frac = i / n;
      ctx.globalAlpha = frac >= hs && frac <= he ? 1 : 0.4;
      ctx.fillStyle = g;
      rr(ctx, x, (h - bh) / 2, bw, bh, 1.5);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    rr(ctx, hs * w - 5, 1, (he - hs) * w + 8, h - 2, 10);
    ctx.stroke();
  }

  const staticWaves = () => {
    $$(".ed-wave").forEach((c) => {
      const song = SONGS[c.dataset.song];
      if (song) drawScrubber(c, song, parseFloat(c.dataset.start), parseFloat(c.dataset.length), null, 20);
    });
    $$(".full-wave").forEach((c) => { const s = SONGS[c.dataset.song]; if (s) drawFullWave(c, s); });
  };

  /* ---------- Navigation ---------- */

  const nav = $("#nav");
  const menu = $("#nav-menu");
  const links = $("#nav-links");
  const lightSections = $$(".light");
  const onScrollNav = () => {
    nav.classList.toggle("scrolled", window.scrollY > 8);
    const y = nav.offsetHeight / 2;
    nav.classList.toggle("on-light", lightSections.some((sec) => {
      const r = sec.getBoundingClientRect();
      return r.top <= y && r.bottom >= y;
    }));
  };
  onScrollNav();
  window.addEventListener("scroll", onScrollNav, { passive: true });
  menu.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    menu.setAttribute("aria-expanded", String(open));
  });
  links.addEventListener("click", (e) => {
    if (e.target.closest("a")) { links.classList.remove("open"); menu.setAttribute("aria-expanded", "false"); }
  });

  /* ---------- Reveal on scroll ---------- */

  const revealer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add("in-view"); revealer.unobserve(e.target); }
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  $$(".reveal").forEach((el) => revealer.observe(el));

  requestAnimationFrame(() => { const t = $("#hero-thread"); if (t) t.classList.add("go"); });

  /* ---------- Statement: words light up as you scroll ---------- */

  const statement = $("[data-words]");
  let words = [];
  if (statement) {
    const text = statement.textContent.trim();
    statement.innerHTML = text.split(/\s+/).map((w) => {
      const hl = /^(ten|seconds\.)$/i.test(w) ? " hl" : "";
      return `<span class="w${hl}">${w}</span>`;
    }).join(" ");
    words = $$(".w", statement);
  }
  function updateStatement() {
    if (!words.length) return;
    const r = statement.getBoundingClientRect();
    const vh = window.innerHeight;
    const startY = vh * 0.85, endY = vh * 0.4;
    const p = clamp((startY - r.top) / (startY - endY + r.height * 0.6), 0, 1);
    const n = reduceMotion ? words.length : Math.round(p * words.length);
    words.forEach((w, i) => w.classList.toggle("on", i < n));
  }

  /* ---------- How it works ---------- */

  const howPhone = $("#how-phone");
  const steps = $$(".how-step");
  if (howPhone) {
    // Narrow screens: each step gets its own phone with its screen.
    steps.forEach((step) => {
      const screen = $(`.screen[data-screen="${step.dataset.screen}"]`, howPhone);
      const slot = $(".how-slot", step);
      if (!screen || !slot) return;
      const phone = document.createElement("div");
      phone.className = "phone";
      const scr = document.createElement("div");
      scr.className = "phone-screen";
      scr.innerHTML = '<div class="island"></div>';
      const clone = screen.cloneNode(true);
      clone.classList.add("active");
      scr.appendChild(clone);
      phone.appendChild(scr);
      slot.appendChild(phone);
    });
    $$(".how-slot .mif[data-song]").forEach(buildMif);

    const setStep = (i) => {
      steps.forEach((s) => s.classList.toggle("active", s.dataset.screen === String(i)));
      $$(".screen", howPhone).forEach((s) => s.classList.toggle("active", s.dataset.screen === String(i)));
    };
    setStep(0);
    const stepObserver = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setStep(e.target.dataset.screen);
    }, { rootMargin: "-45% 0px -45% 0px" });
    steps.forEach((s) => stepObserver.observe(s));
  }

  /* ---------- Try it: the editor ---------- */

  const demo = $("#demo");
  const D = demo && {
    songs: $("#demo-songs"),
    art: $("#demo-art"),
    backdrop: $("#demo-backdrop"),
    title: $("#demo-title"),
    artist: $("#demo-artist"),
    lyrics: $("#demo-lyrics"),
    from: $("#demo-from"),
    to: $("#demo-to"),
    len: $("#demo-len"),
    scrub: $("#demo-scrub"),
    canvas: $("#demo-canvas"),
    overview: $("#demo-overview"),
    lengths: $("#demo-lengths"),
    play: $("#demo-play"),
    ring: $("#demo-play .ring circle"),
    send: $("#demo-send"),
    thread: $("#demo-thread"),
  };
  const state = { song: null, start: 0, length: 10, playhead: null, pps: 30, raf: 0, lit: "" };
  const REPLIES = {
    "send-me-the-chorus": ["THE DROP 😭", "ok this is my whole personality now", "sending this to everyone I know"],
    "neon-harbor": ["this sounds like driving at 2am", "the synths!! 🌆", "neon harbor supremacy"],
    "paper-satellites": ["this is so cozy", "lo-fi and rain, perfect", "on repeat all night"],
  };
  let replyTurn = 0;

  const visibleSeconds = () => (D.scrub.clientWidth < 520 ? 14 : 20);
  const maxStart = () => Math.max(0, state.song.duration - state.length);

  function render() {
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      paint();
    });
  }

  function paint() {
    const s = state.song;
    const end = state.start + state.length;
    state.pps = drawScrubber(D.canvas, s, state.start, state.length, state.playhead, visibleSeconds()) || state.pps;
    D.from.textContent = clock(state.start);
    D.to.textContent = clock(end);
    D.overview.style.left = `${(state.start / s.duration) * 100}%`;
    D.overview.style.width = `${(state.length / s.duration) * 100}%`;
    D.scrub.setAttribute("aria-valuenow", String(Math.round(state.start)));
    D.scrub.setAttribute("aria-valuemax", String(Math.round(maxStart())));
    D.scrub.setAttribute("aria-valuetext", `${clock(state.start)} to ${clock(end)}`);

    const items = $$("li", D.lyrics);
    let firstLit = -1;
    const lit = [];
    s.lyrics.forEach((l, i) => {
      // Same rule as the app: a line counts once half a second (or half the line) is inside.
      const overlap = Math.min(end, l.e) - Math.max(state.start, l.s);
      const on = overlap > 0 && overlap >= Math.min(0.5, (l.e - l.s) / 2);
      const sung = state.playhead != null && state.playhead >= l.s && state.playhead < l.e;
      items[i].classList.toggle("lit", on);
      items[i].classList.toggle("sung", sung);
      if (on) { lit.push(i); if (firstLit < 0) firstLit = i; }
    });
    const key = lit.join(",");
    if (key !== state.lit) {
      state.lit = key;
      let target = firstLit;
      if (target < 0) {
        // Instrumental passage: keep the nearest upcoming line in view.
        target = s.lyrics.findIndex((l) => l.s >= state.start);
        if (target < 0) target = s.lyrics.length - 1;
      }
      const el = items[target];
      if (el) D.lyrics.scrollTo({ top: Math.max(0, el.offsetTop - D.lyrics.clientHeight * 0.22), behavior: reduceMotion ? "auto" : "smooth" });
    }
  }

  function setStart(v) {
    state.start = clamp(v, 0, maxStart());
    render();
  }

  let tween = 0;
  function animateTo(target, then) {
    cancelAnimationFrame(tween);
    const from = state.start;
    const to = clamp(target, 0, maxStart());
    const t0 = performance.now();
    const dur = reduceMotion ? 1 : 480;
    const step = (now) => {
      const k = clamp((now - t0) / dur, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      setStart(from + (to - from) * e);
      if (k < 1) tween = requestAnimationFrame(step);
      else if (then) then();
    };
    tween = requestAnimationFrame(step);
  }

  function stopPreview() { if (Player.isActive("demo")) Player.stop(); }

  function preview() {
    Player.toggle({
      key: "demo",
      songId: state.song.id,
      start: state.start,
      length: state.length,
      onState(s) {
        D.play.classList.toggle("playing", s !== "idle");
        D.play.setAttribute("aria-label", s === "idle" ? "Preview snippet" : "Stop preview");
      },
      onTick(p, t) {
        D.ring.style.strokeDashoffset = String(160.2 * (1 - p));
        state.playhead = t == null ? null : t;
        render();
      },
    });
  }

  function setSong(id) {
    stopPreview();
    const s = SONGS[id];
    state.song = s;
    state.lit = "";
    $$("button", D.songs).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.id === id)));
    D.art.src = s.art;
    D.art.alt = `${s.title} artwork`;
    D.backdrop.style.opacity = "0";
    setTimeout(() => { D.backdrop.src = s.art; D.backdrop.style.opacity = "1"; }, reduceMotion ? 0 : 200);
    D.title.textContent = s.title;
    D.artist.textContent = s.artist;
    D.lyrics.innerHTML = s.lyrics.map((l, i) => `<li><button type="button" data-i="${i}">${l.t}</button></li>`).join("");
    D.lyrics.scrollTop = 0;
    state.start = clamp(s.highlight, 0, maxStart());
    render();
  }

  if (D) {
    D.songs.innerHTML = SONG_ORDER.filter((id) => SONGS[id]).map((id) =>
      `<button class="song-chip" type="button" role="radio" data-id="${id}" aria-checked="false"><img src="${SONGS[id].thumb}" alt="">${SONGS[id].title}</button>`
    ).join("");
    D.songs.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (b && b.dataset.id !== state.song.id) setSong(b.dataset.id);
    });

    D.lyrics.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (!b) return;
      stopPreview();
      const line = state.song.lyrics[+b.dataset.i];
      animateTo(line.s - 0.25, preview);
    });

    D.lengths.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-len]");
      if (!b) return;
      const wasPlaying = Player.isActive("demo");
      stopPreview();
      state.length = +b.dataset.len;
      $$("button", D.lengths).forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      D.len.textContent = `${state.length}s snippet`;
      setStart(state.start);
      if (wasPlaying) preview();
    });

    D.play.addEventListener("click", preview);

    // Dragging, with momentum.
    let drag = null, inertia = 0;
    D.scrub.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      cancelAnimationFrame(inertia);
      cancelAnimationFrame(tween);
      stopPreview();
      drag = { x: e.clientX, start: state.start, lastX: e.clientX, lastT: performance.now(), v: 0 };
      D.scrub.setPointerCapture(e.pointerId);
    });
    D.scrub.addEventListener("pointermove", (e) => {
      if (!drag) return;
      setStart(drag.start - (e.clientX - drag.x) / state.pps);
      const now = performance.now();
      const dt = now - drag.lastT;
      if (dt > 0) drag.v = 0.75 * ((e.clientX - drag.lastX) / dt) + 0.25 * drag.v;
      drag.lastX = e.clientX;
      drag.lastT = now;
    });
    const endDrag = () => {
      if (!drag) return;
      let vel = -drag.v / state.pps; // seconds per ms
      if (performance.now() - drag.lastT > 80) vel = 0;
      drag = null;
      if (reduceMotion || Math.abs(vel) < 0.0004) return;
      let last = performance.now();
      const glide = (now) => {
        const dt = now - last;
        last = now;
        const before = state.start;
        setStart(state.start + vel * dt);
        vel *= Math.pow(0.94, dt / 16);
        if (Math.abs(vel) > 0.0003 && state.start !== before) inertia = requestAnimationFrame(glide);
      };
      inertia = requestAnimationFrame(glide);
    };
    D.scrub.addEventListener("pointerup", endDrag);
    D.scrub.addEventListener("pointercancel", () => { drag = null; });
    D.scrub.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      stopPreview();
      setStart(state.start + e.deltaX / state.pps);
    }, { passive: false });
    D.scrub.addEventListener("keydown", (e) => {
      const big = e.shiftKey ? 5 : 0.5;
      const moves = { ArrowLeft: -big, ArrowRight: big, ArrowDown: -big, ArrowUp: big };
      if (e.key in moves) { e.preventDefault(); stopPreview(); setStart(state.start + moves[e.key]); }
      else if (e.key === "Home") { e.preventDefault(); setStart(0); }
      else if (e.key === "End") { e.preventDefault(); setStart(maxStart()); }
      else if (e.key === " " || e.key === "Enter") { e.preventDefault(); preview(); }
    });

    // Sending.
    D.send.addEventListener("click", () => {
      stopPreview();
      const s = state.song;
      const start = +state.start.toFixed(2);
      $$(".delivered", D.thread).forEach((d) => d.remove());
      const wrap = document.createElement("div");
      wrap.className = "out-wrap demo-thread-in";
      wrap.innerHTML = `<button class="mif" type="button" data-song="${s.id}" data-start="${start}" data-length="${state.length}"></button>`;
      D.thread.appendChild(wrap);
      buildMif($(".mif", wrap));
      const delivered = document.createElement("p");
      delivered.className = "delivered demo-thread-in";
      delivered.textContent = "Delivered";
      D.thread.appendChild(delivered);

      D.send.disabled = true;
      const label = D.send.lastChild;
      label.textContent = " Sent";
      setTimeout(() => { D.send.disabled = false; label.textContent = " Send"; }, 1400);

      const typing = document.createElement("div");
      typing.className = "typing demo-thread-in";
      typing.innerHTML = "<i></i><i></i><i></i>";
      setTimeout(() => D.thread.appendChild(typing), 900);
      setTimeout(() => {
        typing.remove();
        const reply = document.createElement("div");
        reply.className = "bubble in demo-thread-in";
        const list = REPLIES[s.id] || ["🔥"];
        reply.textContent = list[replyTurn++ % list.length];
        D.thread.appendChild(reply);
        while (D.thread.children.length > 14) D.thread.firstElementChild.remove();
      }, 2300);
    });

    setSong(SONG_ORDER[0]);
  }

  /* ---------- Bento: lyric roll ---------- */

  const roll = $(".lyric-roll");
  if (roll && !reduceMotion) {
    const lit = $$("li.lit", roll);
    let i = 1, timer = 0;
    const io = new IntersectionObserver(([e]) => {
      clearInterval(timer);
      if (e.isIntersecting) timer = setInterval(() => {
        lit.forEach((l) => l.classList.remove("sung"));
        i = (i + 1) % lit.length;
        lit[i].classList.add("sung");
      }, 1700);
    });
    io.observe(roll);
  }

  /* ---------- Songs on demand ---------- */

  const dCard = $("#demand-card");
  if (dCard) {
    const pipe = $$(".pipeline li", dCard);
    let timers = [];
    const clear = () => { timers.forEach(clearTimeout); timers = []; };
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    const cycle = () => {
      clear();
      dCard.dataset.state = "add";
      pipe.forEach((p) => p.classList.remove("done"));
      at(1400, () => { dCard.dataset.state = "adding"; });
      pipe.forEach((p, i) => at(1800 + i * 520, () => p.classList.add("done")));
      at(1800 + pipe.length * 520 + 200, () => { dCard.dataset.state = "ready"; });
      at(1800 + pipe.length * 520 + 3200, cycle);
    };
    if (reduceMotion) { dCard.dataset.state = "ready"; pipe.forEach((p) => p.classList.add("done")); }
    else {
      dCard.dataset.state = "add";
      new IntersectionObserver(([e]) => (e.isIntersecting ? cycle() : clear()), { threshold: 0.3 }).observe(dCard);
    }
  }

  /* ---------- Telegram button ---------- */

  $$(".tg-btn[data-song]").forEach((btn) => {
    const key = nextKey("tg");
    const label = $(".tg-btn-label", btn);
    btn.addEventListener("click", () => {
      Player.toggle({
        key, songId: btn.dataset.song, start: +btn.dataset.start, length: +btn.dataset.length,
        onState(s) { label.textContent = s === "idle" ? "▶︎ Play Snippet" : s === "loading" ? "Loading…" : "■ Stop"; },
        onTick(p) { btn.style.setProperty("--progress", `${p * 100}%`); },
      });
    });
  });

  /* ---------- House band ---------- */

  $$(".album[data-song]").forEach((btn) => {
    const key = nextKey("album");
    const bar = $(".album-bar i", btn);
    const s = SONGS[btn.dataset.song];
    if (s) btn.setAttribute("aria-label", `Play the chorus of ${s.title} by ${s.artist}`);
    btn.addEventListener("click", () => {
      Player.toggle({
        key, songId: btn.dataset.song, start: +btn.dataset.start, length: +btn.dataset.length,
        onState(st) { btn.classList.toggle("playing", st !== "idle"); btn.setAttribute("aria-pressed", String(st !== "idle")); },
        onTick(p) { bar.style.width = `${p * 100}%`; },
      });
    });
  });

  /* ---------- Frame loop hooks ---------- */

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; updateStatement(); });
  }, { passive: true });

  let resizeT = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { staticWaves(); if (D) paint(); updateStatement(); }, 120);
  });

  // Canvases inside hidden containers draw when they appear.
  const waveIO = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) staticWaves();
  });
  $$(".ed-wave, .full-wave").forEach((c) => waveIO.observe(c));

  const whenFonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  whenFonts.then(() => { staticWaves(); if (D) paint(); updateStatement(); });
  updateStatement();
})();
