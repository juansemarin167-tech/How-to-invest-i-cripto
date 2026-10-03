(() => {
  "use strict";

  const COINS = [
    { sym: "BTC", name: "Bitcoin", gecko: "bitcoin" },
    { sym: "ETH", name: "Ethereum", gecko: "ethereum" },
    { sym: "SOL", name: "Solana", gecko: "solana" },
    { sym: "BNB", name: "BNB", gecko: "binancecoin" },
    { sym: "XRP", name: "XRP", gecko: "ripple" },
    { sym: "ADA", name: "Cardano", gecko: "cardano" },
  ];

  // Each band: upper bound (exclusive), label, advice, how much of your usual amount to buy.
  const BANDS = [
    { max: 25, label: "Freezing", advice: "Deep discount against its own history. Historically the best time to add.", mult: 2 },
    { max: 45, label: "Cold", advice: "Trading below trend while the market is nervous. A good time to add more than usual.", mult: 1.5 },
    { max: 60, label: "Mild", advice: "Close to fair value. Stick to your usual amount.", mult: 1 },
    { max: 75, label: "Warm", advice: "Price is getting stretched. Add less than usual.", mult: 0.5 },
    { max: 101, label: "Hot", advice: "Euphoria. Hold most of your cash and consider taking some profit.", mult: 0.25 },
  ];

  const STOPS = [[0, "#1F4E8C"], [30, "#4F8FC0"], [52, "#9DB3A5"], [72, "#E8A33D"], [100, "#C8372D"]];

  const $ = (id) => document.getElementById(id);
  const DAY = 86400000;
  const state = { coin: COINS[0], days: null, fng: null };

  // ---------- helpers ----------
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  function piecewise(x, pts) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
    return pts[pts.length - 1][1];
  }
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function tempColor(t) {
    t = clamp(t, 0, 100);
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
        const k = (t - a) / (b - a), A = hexToRgb(ca), B = hexToRgb(cb);
        return `rgb(${A.map((v, j) => Math.round(v + (B[j] - v) * k)).join(",")})`;
      }
    }
    return STOPS[STOPS.length - 1][1];
  }
  const bandFor = (t) => BANDS.find((b) => t < b.max);
  const dateKey = (ms) => new Date(ms).toISOString().slice(0, 10);
  const fmtUsd = (v) => {
    const d = v >= 1000 ? 0 : v >= 1 ? 2 : 4;
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const fmtDate = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const pct = (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%";

  // ---------- data ----------
  async function getJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
    return r.json();
  }
  async function loadPrices(coin) {
    const binance = ["https://data-api.binance.vision", "https://api.binance.com"];
    for (const host of binance) {
      try {
        const rows = await getJson(`${host}/api/v3/klines?symbol=${coin.sym}USDT&interval=1d&limit=1000`);
        if (Array.isArray(rows) && rows.length > 30) return rows.map((r) => ({ t: r[0], close: +r[4] }));
      } catch (e) { /* try next source */ }
    }
    const g = await getJson(`https://api.coingecko.com/api/v3/coins/${coin.gecko}/market_chart?vs_currency=usd&days=365&interval=daily`);
    const byDay = new Map();
    g.prices.forEach(([t, p]) => byDay.set(dateKey(t), { t: Date.parse(dateKey(t)), close: p }));
    return [...byDay.values()];
  }
  async function loadFng() {
    try {
      const j = await getJson("https://api.alternative.me/fng/?limit=1100");
      const m = new Map();
      j.data.forEach((d) => m.set(dateKey(+d.timestamp * 1000), +d.value));
      return m;
    } catch (e) { return new Map(); }
  }

  // ---------- indicators ----------
  function computeTemps(days, fng) {
    const n = days.length, closes = days.map((d) => d.close);
    // Wilder RSI(14)
    const rsi = new Array(n).fill(null);
    let g = 0, l = 0;
    for (let i = 1; i < n; i++) {
      const ch = closes[i] - closes[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
      if (i <= 14) { g += up / 14; l += dn / 14; if (i === 14) rsi[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
      else { g = (g * 13 + up) / 14; l = (l * 13 + dn) / 14; rsi[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    }
    // Trend average: 200 days, or as many as we have when the coin is young
    const smaLen = Math.min(200, Math.floor(n * 0.5));
    let run = 0;
    return days.map((d, i) => {
      run += closes[i];
      if (i >= smaLen) run -= closes[i - smaLen];
      const sma = i >= smaLen - 1 ? run / smaLen : null;
      const win = closes.slice(Math.max(0, i - 364), i + 1);
      const lo = Math.min(...win), hi = Math.max(...win);
      const out = { ...d, sma, rsi: rsi[i], fng: fng.get(dateKey(d.t)) ?? null };
      if (sma == null || rsi[i] == null || win.length < 60) return out;

      const parts = [
        { key: "trend", w: 0.35, v: piecewise(d.close / sma, [[0.5, 0], [0.8, 20], [1, 40], [1.3, 65], [1.8, 88], [2.4, 100]]), raw: d.close / sma },
        { key: "momentum", w: 0.2, v: piecewise(rsi[i], [[20, 0], [30, 15], [50, 50], [70, 85], [85, 100]]), raw: rsi[i] },
        { key: "range", w: 0.2, v: hi === lo ? 50 : ((d.close - lo) / (hi - lo)) * 100, raw: { lo, hi } },
      ];
      if (out.fng != null) parts.push({ key: "mood", w: 0.25, v: out.fng, raw: out.fng });
      const wsum = parts.reduce((s, p) => s + p.w, 0);
      out.temp = parts.reduce((s, p) => s + p.v * p.w, 0) / wsum;
      out.parts = parts;
      return out;
    });
  }

  // ---------- render: coin picker ----------
  function renderCoins() {
    $("coins").innerHTML = "";
    COINS.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = c.sym;
      b.title = c.name;
      b.setAttribute("aria-pressed", String(c === state.coin));
      b.addEventListener("click", () => {
        if (c === state.coin) return;
        state.coin = c;
        history.replaceState(null, "", "#" + c.sym.toLowerCase());
        renderCoins();
        load();
      });
      $("coins").appendChild(b);
    });
  }

  // ---------- render: hero + drivers ----------
  function renderHero(series) {
    const today = series[series.length - 1];
    const t = Math.round(today.temp), band = bandFor(today.temp), color = tempColor(today.temp);
    document.documentElement.style.setProperty("--temp", color);
    $("heroCoin").textContent = `${state.coin.name} today`;
    $("degrees").textContent = t + "°";
    $("band").textContent = band.label;
    $("advice").textContent = band.advice;
    $("thermo").setAttribute("aria-label", `Temperature ${t} out of 100: ${band.label}`);
    const m = $("marker");
    requestAnimationFrame(() => { m.style.setProperty("--shown", 1); m.style.setProperty("--pos", t + "%"); });

    const yearAgo = series.find((d) => d.t >= today.t - 365 * DAY) || series[0];
    const ath = Math.max(...series.map((d) => d.close));
    $("priceLine").innerHTML =
      `Price <strong>${fmtUsd(today.close)}</strong>, ${pct((today.close / yearAgo.close - 1) * 100)} over the year, ` +
      `${pct((today.close / ath - 1) * 100)} from its ${series.length > 400 ? "recent" : "one‑year"} high.`;

    const p = Object.fromEntries(today.parts.map((x) => [x.key, x]));
    const rows = [
      { part: p.trend, name: "Distance from long‑term trend",
        text: `Price is ${(p.trend.raw).toFixed(2)}× its ${today.sma ? "200‑day" : ""} average. Below 1 has historically been a discount; above 1.8 has marked tops.` },
      { part: p.momentum, name: "Short‑term momentum",
        text: `14‑day RSI is ${Math.round(p.momentum.raw)}. Under 30 means it's been sold hard recently; over 70 means it's run up fast.` },
      { part: p.range, name: "Where it sits in the past year",
        text: `Between a low of ${fmtUsd(p.range.raw.lo)} and a high of ${fmtUsd(p.range.raw.hi)}, it's ${Math.round(p.range.v)}% of the way up.` },
      p.mood
        ? { part: p.mood, name: "Market mood", text: `The Fear & Greed index reads ${p.mood.raw}. Buying when others are fearful has tended to pay off.` }
        : { part: null, name: "Market mood", text: "The Fear & Greed index didn't load, so today's reading uses the other three signals." },
    ];
    $("drivers").innerHTML = rows.map((r) => {
      const v = r.part ? Math.round(r.part.v) : null;
      return `<li class="driver"><div><h3>${r.name}</h3><p>${r.text}</p></div>
        <div class="meter" aria-hidden="true"><span style="--w:${v ?? 0}%;--c:${v == null ? "transparent" : tempColor(v)}"></span></div>
        <span class="score" aria-label="Score ${v ?? "unavailable"}">${v ?? "–"}</span></li>`;
    }).join("");
  }

  // ---------- render: chart ----------
  function renderChart(series) {
    const svg = $("chart"), tip = $("tip");
    const W = svg.clientWidth || 800, H = svg.clientHeight || 360;
    const pad = { l: 8, r: 64, t: 12, b: 28 }, stripeH = Math.round(H * 0.16), gap = 10;
    const last = series.slice(-365);
    const plotH = H - pad.t - pad.b - stripeH - gap;
    const vals = last.flatMap((d) => (d.sma ? [d.close, d.sma] : [d.close]));
    const lo = Math.min(...vals) * 0.97, hi = Math.max(...vals) * 1.03;
    const x = (i) => pad.l + (i / (last.length - 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * plotH;
    const sw = (W - pad.l - pad.r) / last.length;
    const stripeY = pad.t + plotH + gap;

    let s = "";
    const ticks = 4;
    for (let k = 0; k <= ticks; k++) {
      const v = Math.exp(Math.log(lo) + (k / ticks) * (Math.log(hi) - Math.log(lo)));
      s += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      s += `<text class="axis" x="${W - pad.r + 8}" y="${y(v) + 4}">${fmtUsd(v).replace(/\.\d+$/, (m) => (v < 10 ? m : ""))}</text>`;
    }
    last.forEach((d, i) => {
      if (d.temp == null) return;
      s += `<rect x="${(pad.l + i * sw).toFixed(2)}" y="${stripeY}" width="${(sw + 0.6).toFixed(2)}" height="${stripeH}" fill="${tempColor(d.temp)}"/>`;
    });
    const path = (key) => last.map((d, i) => (d[key] ? `${i && last[i - 1][key] ? "L" : "M"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}` : "")).join("");
    s += `<path class="sma" d="${path("sma")}"/><path class="price" d="${path("close")}"/>`;
    [0, Math.floor(last.length / 2), last.length - 1].forEach((i, k) => {
      const anchor = ["start", "middle", "end"][k];
      const label = new Date(last[i].t).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
      s += `<text class="axis" x="${k === 2 ? W - pad.r : x(i)}" y="${H - 6}" text-anchor="${anchor}">${label}</text>`;
    });
    s += `<line class="cursor" id="cursor" y1="${pad.t}" y2="${stripeY + stripeH}" visibility="hidden"/>`;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = s;

    const cursor = svg.querySelector("#cursor");
    const show = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const px = clientX - rect.left;
      const i = clamp(Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (last.length - 1)), 0, last.length - 1);
      const d = last[i];
      cursor.setAttribute("x1", x(i)); cursor.setAttribute("x2", x(i)); cursor.setAttribute("visibility", "visible");
      const tempTxt = d.temp == null ? "not enough history" : `<b style="color:${tempColor(d.temp)}">${Math.round(d.temp)}°</b> ${bandFor(d.temp).label.toLowerCase()}`;
      tip.innerHTML = `${fmtDate(d.t)}<br>${fmtUsd(d.close)} · ${tempTxt}`;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = clamp(x(i) - tw / 2, 0, rect.width - tw) + "px";
    };
    svg.onpointermove = (e) => show(e.clientX);
    svg.onpointerdown = (e) => show(e.clientX);
    svg.onpointerleave = () => { tip.hidden = true; cursor.setAttribute("visibility", "hidden"); };
  }

  // ---------- render: plan + backtest ----------
  function renderPlan(series) {
    const amount = Math.max(1, +$("amount").value || 100);
    const every = +$("freq").value;
    const today = series[series.length - 1], band = bandFor(today.temp);
    const buy = amount * band.mult;
    const period = { 7: "this week", 14: "these two weeks", 30: "this month" }[every];
    $("nextBuy").innerHTML = band.mult === 1
      ? `Buy your usual <span class="amt">${fmtUsd(buy)}</span> ${period}.`
      : `Buy <span class="amt">${fmtUsd(buy)}</span> ${period}, ${band.mult}× your usual ${fmtUsd(amount)}.`;

    const span = series.filter((d) => d.t >= today.t - 365 * DAY && d.temp != null);
    const fixed = { spent: 0, coins: 0 }, sized = { spent: 0, coins: 0 };
    let buys = 0;
    for (let i = 0; i < span.length; i += every) {
      const d = span[i];
      fixed.spent += amount; fixed.coins += amount / d.close;
      const a = amount * bandFor(d.temp).mult;
      sized.spent += a; sized.coins += a / d.close;
      buys++;
    }
    if (!buys) { $("backtest").innerHTML = ""; $("backtestNote").textContent = "Not enough history for this coin yet."; return; }
    const stat = (o) => {
      const value = o.coins * today.close;
      return { spent: o.spent, avg: o.spent / o.coins, value, ret: (value / o.spent - 1) * 100 };
    };
    const A = stat(fixed), B = stat(sized);
    const row = (label, a, b, fmt, better) => {
      const wa = better && better(A, B) === "a", wb = better && better(A, B) === "b";
      return `<tr><th scope="row">${label}</th><td class="${wa ? "win" : ""}">${fmt(a)}</td><td class="${wb ? "win" : ""}">${fmt(b)}</td></tr>`;
    };
    $("backtest").innerHTML =
      row("Total put in", A.spent, B.spent, fmtUsd) +
      row("Average price paid", A.avg, B.avg, fmtUsd, (a, b) => (a.avg <= b.avg ? "a" : "b")) +
      row(`${state.coin.sym} bought`, fixed.coins, sized.coins, (v) => v.toLocaleString("en-US", { maximumSignificantDigits: 5 })) +
      row("Worth today", A.value, B.value, fmtUsd) +
      row("Return", A.ret, B.ret, pct, (a, b) => (a.ret >= b.ret ? "a" : "b"));
    const cheaper = (1 - B.avg / A.avg) * 100;
    $("backtestNote").textContent =
      `${buys} buys over the period. ` +
      (cheaper > 0
        ? `Sizing by temperature paid ${cheaper.toFixed(1)}% less per ${state.coin.sym} on average.`
        : `This year, sizing by temperature paid ${Math.abs(cheaper).toFixed(1)}% more per ${state.coin.sym} on average: in a steady uptrend, waiting for cold days costs you.`) +
      ` The totals differ because the sized plan spends more in cold stretches and less in hot ones.`;
  }

  // ---------- flow ----------
  function setLoading() {
    $("heroCoin").textContent = `${state.coin.name}`;
    $("degrees").textContent = "–°";
    $("band").textContent = "Reading the market";
    $("advice").textContent = "Pulling daily prices and the Fear & Greed index.";
    $("marker").style.setProperty("--shown", 0);
    document.documentElement.style.removeProperty("--temp");
  }
  function renderAll() {
    const series = state.series;
    renderHero(series);
    renderChart(series);
    renderPlan(series);
    $("updated").textContent = `Last close: ${fmtDate(series[series.length - 1].t)}.`;
  }
  let token = 0;
  async function load() {
    const my = ++token;
    $("error").hidden = true;
    setLoading();
    try {
      const [days, fng] = await Promise.all([loadPrices(state.coin), state.fng || loadFng()]);
      if (my !== token) return;
      state.fng = fng;
      state.series = computeTemps(days, fng);
      if (state.series[state.series.length - 1].temp == null) throw new Error("not enough price history");
      renderAll();
    } catch (e) {
      if (my !== token) return;
      $("band").textContent = "No reading";
      $("advice").textContent = "";
      $("errorText").textContent = `Couldn't load ${state.coin.name} prices (${e.message}). Check your connection, then try again.`;
      $("error").hidden = false;
    }
  }

  const fromHash = COINS.find((c) => "#" + c.sym.toLowerCase() === location.hash);
  if (fromHash) state.coin = fromHash;
  renderCoins();
  $("retry").addEventListener("click", load);
  $("amount").addEventListener("input", () => state.series && renderPlan(state.series));
  $("freq").addEventListener("change", () => state.series && renderPlan(state.series));
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => state.series && renderChart(state.series), 150); });
  load();
})();
