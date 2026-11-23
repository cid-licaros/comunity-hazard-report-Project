// HazardPin – shared script for all three pages (home, reports, report).
// Each page sets <body data-page="..."> so we know which part to run.

//notes

const PAGE = document.body.dataset.page;

// Default map center (Tankulan, Manolo Fortich). Change this to your own area.
const DEFAULT_LAT = 8.3596;
const DEFAULT_LNG = 124.8686;

const STATUSES = ["Pending", "In Progress", "Resolved"];
const STATUS_COLORS = {
  "Pending": "#e07a1f",
  "In Progress": "#3d7ccf",
  "Resolved": "#2a9d8f"
};
const HAZARD_ICON = "⚠️";
const FALLBACK_GRADIENT = ["#f5b700", "#e07a1f"]; // used when a report has no photo


/* ---------- Small helpers ---------- */

function $(selector) {
  return document.querySelector(selector);
}

// Escape user text before putting it into HTML, so nobody can inject markup.
function escapeHtml(text) {
  const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return String(text).replace(/[&<>"]/g, char => replacements[char]);
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

// CSS for a report's picture: its photo, or a colored gradient if it has none.
function photoStyle(report) {
  if (report.photo) {
    return `background-image:url(${report.photo})`;
  }
  return `background:linear-gradient(135deg,${FALLBACK_GRADIENT[0]},${FALLBACK_GRADIENT[1]})`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

// Link that opens the OpenWeather map centered on a spot.
function openWeatherMapUrl(lat, lng) {
  return `https://openweathermap.org/weathermap?basemap=map&cities=true&layer=temperature&lat=${lat}&lon=${lng}&zoom=14`;
}


/* ---------- Saved reports (localStorage) ---------- */

let reports = [];
let selectedId = null;
let filters = { status: "all" };

function isValidReport(r) {
  return r
    && typeof r.id === "string"
    && STATUSES.includes(r.status)
    && Number.isFinite(r.lat)
    && Number.isFinite(r.lng);
}

function loadReports() {
  try {
    const stored = JSON.parse(localStorage.getItem("hp-reports") || "[]");
    if (!Array.isArray(stored)) return;

    reports = stored.filter(isValidReport).map(r => ({
      ...r,
      // Older reports might not have a history yet, so start one from their current status.
      history: Array.isArray(r.history) ? r.history : [{ status: r.status, at: r.created }]
    }));
  } catch (err) {
    // Corrupted data: just start with an empty list.
  }
}

function saveReports() {
  try {
    localStorage.setItem("hp-reports", JSON.stringify(reports));
  } catch (err) {
    showToast("Could not save. Browser storage may be full.");
  }
}

loadReports();


/* ---------- OpenWeather ---------- */

// The API key is typed in by the user and only lives in this tab (sessionStorage).
// It is never saved together with the reports.
const apiKeyInput = $("#apiKey");

if (apiKeyInput) {
  try {
    apiKeyInput.value = sessionStorage.getItem("hp-key") || "";
  } catch (err) { }

  apiKeyInput.addEventListener("input", () => {
    try {
      sessionStorage.setItem("hp-key", apiKeyInput.value.trim());
    } catch (err) { }
  });
}

const weatherCache = new Map();
let latestWeatherRequest = 0;
const TEN_MINUTES = 10 * 60 * 1000;

async function fetchWeather(lat, lng) {
  const apiKey = apiKeyInput ? apiKeyInput.value.trim() : "";
  if (!apiKey) {
    throw new Error("Enter your OpenWeather API key first.");
  }

  // Round to 2 decimals (about 1 km) so nearby clicks reuse the same result.
  const cacheKey = lat.toFixed(2) + "," + lng.toFixed(2) + "|" + apiKey;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.time < TEN_MINUTES) {
    return cached.data;
  }

  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lng);
  url.searchParams.set("units", "metric");
  url.searchParams.set("appid", apiKey);

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error("Network error. Check your internet connection.");
  }

  if (response.status === 401) throw new Error("Invalid API key. New keys can take a while to activate.");
  if (response.status === 429) throw new Error("Too many requests. Please wait a bit and try again.");
  if (!response.ok) throw new Error("Weather request failed (HTTP " + response.status + ").");

  const data = await response.json();
  if (!data.main) throw new Error("Unexpected weather response. Try again.");

  weatherCache.set(cacheKey, { data, time: Date.now() });
  return data;
}

async function showWeather(lat, lng, label) {
  const box = $("#wx");
  if (!box) return;

  // If the user clicks around quickly, only the newest request is allowed to update the box.
  const requestId = ++latestWeatherRequest;
  box.innerHTML = '<p class="meta">Loading weather…</p>';

  try {
    const data = await fetchWeather(lat, lng);
    if (requestId !== latestWeatherRequest) return;

    const condition = (data.weather && data.weather[0]) || {};
    const iconOk = /^\d{2}[dn]$/.test(condition.icon || "");
    const iconHtml = iconOk
      ? `<img src="https://openweathermap.org/img/wn/${condition.icon}@2x.png" alt="${escapeHtml(condition.description || "")}">`
      : "";

    const windSpeed = data.wind && data.wind.speed != null ? data.wind.speed : null;
    const rainLastHour = data.rain && data.rain["1h"] != null ? data.rain["1h"] : 0;
    const isRisky = rainLastHour > 0 || (windSpeed ?? 0) >= 8;

    box.innerHTML = `
      <div class="wx">
        ${iconHtml}
        <div>
          <strong>${escapeHtml(label)}</strong>
          <div class="meta">${escapeHtml(condition.description || "Not available")}</div>
          <div class="temp">${data.main.temp.toFixed(1)} °C</div>
          <div class="meta">
            Feels like ${data.main.feels_like.toFixed(1)} °C ·
            Humidity ${data.main.humidity}% ·
            Wind ${windSpeed ?? "N/A"} m/s${rainLastHour ? " · Rain " + rainLastHour + " mm/h" : ""}
          </div>
        </div>
      </div>
      ${isRisky ? '<p class="warn">⚠ Rain or strong wind right now. Hazards like this can get worse, so take care nearby.</p>' : ""}`;
  } catch (err) {
    if (requestId !== latestWeatherRequest) return;
    box.innerHTML = `<p class="err">${escapeHtml(err.message || "Could not load weather data.")}</p>`;
  }
}


/* ---------- Reports page: map, list, details ---------- */

let map;
let pinLayer;
let lastVisibleIds = null;

function makePinIcon(report) {
  const selectedClass = selectedId === report.id ? " sel" : "";
  return L.divIcon({
    className: "",
    html: `<div class="pin${selectedClass}" style="--c:${STATUS_COLORS[report.status]}"><span>${HAZARD_ICON}</span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 34]
  });
}

function drawMap(visibleReports) {
  // Create the map the first time only.
  if (!map) {
    map = L.map("map").setView([DEFAULT_LAT, DEFAULT_LNG], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    pinLayer = L.layerGroup().addTo(map);
  }

  pinLayer.clearLayers();

  visibleReports.forEach(report => {
    const marker = L.marker([report.lat, report.lng], {
      icon: makePinIcon(report),
      title: "Hazard · " + report.status
    }).addTo(pinLayer);

    marker.bindTooltip("Hazard · " + report.status);
    marker.on("click", () => selectReport(report.id, false));
  });

  // Only re-fit the view when the visible reports actually change,
  // otherwise the map would jump every time you select a pin.
  const idsKey = visibleReports.map(r => r.id).join(",");
  if (idsKey !== lastVisibleIds) {
    if (visibleReports.length) {
      map.fitBounds(visibleReports.map(r => [r.lat, r.lng]), { padding: [40, 40], maxZoom: 17 });
    }
    lastVisibleIds = idsKey;
  }
}

function getVisibleReports() {
  const list = reports.filter(r => filters.status === "all" || r.status === filters.status);
  const sortBy = $("#sort").value;

  if (sortBy === "old") {
    return list.sort((a, b) => a.created.localeCompare(b.created));
  }
  if (sortBy === "status") {
    return list.sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status));
  }
  return list.sort((a, b) => b.created.localeCompare(a.created)); // newest first
}

function reportCardHtml(report) {
  return `
    <article class="card ${selectedId === report.id ? "on" : ""}" data-id="${report.id}" tabindex="0" aria-label="Select hazard report">
      <div class="photo" style="${photoStyle(report)}">
        ${report.photo ? "" : HAZARD_ICON}
        <span class="badge" style="background:${STATUS_COLORS[report.status]};color:#fff">${report.status}</span>
      </div>
      <div class="cbody">
        <h3>${HAZARD_ICON} Hazard report</h3>
        <div class="meta">${escapeHtml(report.loc)} · ${formatDate(report.created)}</div>
        <p class="desc">${escapeHtml(report.desc)}</p>
        <button class="del upd" data-open="${report.id}">Details &amp; update status</button>
      </div>
    </article>`;
}

function render() {
  if (PAGE === "reports") {
    const visible = getVisibleReports();

    if (visible.length) {
      $("#list").innerHTML = visible.map(reportCardHtml).join("");
    } else if (reports.length) {
      $("#list").innerHTML = '<div class="empty">No reports match these filters. Turn one off to see more.</div>';
    } else {
      $("#list").innerHTML = '<div class="empty">No hazards reported yet.<br><a class="btn pri" href="report.html" style="margin-top:14px">Report a Hazard</a></div>';
    }

    $("#result").textContent = visible.length + " of " + reports.length + " reports";
    drawMap(visible);
  }

  if (PAGE === "home") {
    $("#sCount").textContent = reports.length;
    $("#sPend").textContent = reports.filter(r => r.status === "Pending").length;
    $("#sRes").textContent = reports.filter(r => r.status === "Resolved").length;
  }
}

function selectReport(id, panToIt = true) {
  const report = reports.find(r => r.id === id);
  if (!report) return;

  selectedId = id;
  render();

  if (panToIt) {
    map.setView([report.lat, report.lng], Math.max(map.getZoom(), 16));
  }
  showWeather(report.lat, report.lng, "Hazard location");
}

function openReportDetails(id) {
  const report = reports.find(r => r.id === id);
  if (!report) return;

  const statusOptions = STATUSES
    .map(s => `<option${s === report.status ? " selected" : ""}>${s}</option>`)
    .join("");

  // Newest change first.
  const historyItems = report.history
    .slice()
    .reverse()
    .map(h => `<li><b>${escapeHtml(h.status)}</b> · <span class="meta">${formatDate(h.at)}</span></li>`)
    .join("");

  $("#dTitle").textContent = "Hazard report";
  $("#dBody").innerHTML = `
    <div class="big" style="${photoStyle(report)}">${report.photo ? "" : HAZARD_ICON}</div>
    <div>
      <h3 style="font-size:1.4rem">${HAZARD_ICON} Hazard report</h3>
      <div class="meta">${escapeHtml(report.loc)}</div>
      <div class="meta">Reported by ${escapeHtml(report.name)} · ${formatDate(report.created)} · ${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}</div>
      <p>${escapeHtml(report.desc)}</p>
      <span class="tag" style="--c:${STATUS_COLORS[report.status]}"><span class="dot"></span>${report.status}</span>
    </div>
    <div class="stbar">
      <label>Update status<select class="fld" id="dStatus">${statusOptions}</select></label>
      <button class="btn pri" id="dSave">Save</button>
    </div>
    <div>
      <div class="lbl">Status history</div>
      <ul class="tl">${historyItems}</ul>
    </div>
    <a class="btn" href="${openWeatherMapUrl(report.lat, report.lng)}" target="_blank" rel="noopener">View on OpenWeather map</a>
    <button class="del" id="dDel">Delete report</button>`;

  $("#dSave").onclick = () => {
    const newStatus = $("#dStatus").value;
    if (!STATUSES.includes(newStatus)) return;

    if (newStatus === report.status) {
      showToast("Status is already " + newStatus);
      return;
    }

    report.status = newStatus;
    report.history.push({ status: newStatus, at: new Date().toISOString() });
    saveReports();
    $("#dlg").close();
    render();
    showToast("Marked as " + newStatus);
  };

  $("#dDel").onclick = () => {
    if (!confirm("Delete this hazard report? This cannot be undone.")) return;

    reports = reports.filter(r => r.id !== id);
    if (selectedId === id) selectedId = null;
    saveReports();
    $("#dlg").close();
    render();
    showToast("Report deleted");
  };

  $("#dlg").showModal();
}

if (PAGE === "reports") {
  const dialog = $("#dlg");

  $("#dClose").onclick = () => dialog.close();

  // Clicking the dark backdrop closes the dialog.
  dialog.addEventListener("click", e => {
    if (e.target.id === "dlg") dialog.close();
  });

  $("#list").addEventListener("click", e => {
    const detailsButton = e.target.closest("[data-open]");
    if (detailsButton) {
      e.stopPropagation();
      openReportDetails(detailsButton.dataset.open);
      return;
    }

    const card = e.target.closest(".card");
    if (card) selectReport(card.dataset.id);
  });

  // Let keyboard users select a card with Enter or Space.
  $("#list").addEventListener("keydown", e => {
    const isActivateKey = e.key === "Enter" || e.key === " ";
    if (isActivateKey && e.target.classList.contains("card")) {
      e.preventDefault();
      selectReport(e.target.dataset.id);
    }
  });

  $("#chips").addEventListener("click", e => {
    const button = e.target.closest("button[data-k]");
    if (!button) return;

    const filterName = button.dataset.k;
    filters[filterName] = button.dataset.v;

    document.querySelectorAll(`button[data-k="${filterName}"]`).forEach(b => {
      b.setAttribute("aria-pressed", b === button);
    });
    render();
  });

  $("#sort").onchange = render;
}


/* ---------- Report form (report.html only) ---------- */

if (PAGE === "report") {
  let photoData = "";
  let pinMarker = null;
  let pinPosition = null;

  // True while the Location box holds text the map filled in (not something the user typed).
  let locationIsAutoFilled = true;
  let addressTimer;

  const pickMap = L.map("pick").setView([DEFAULT_LAT, DEFAULT_LNG], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(pickMap);

  $("#pLoc").addEventListener("input", () => {
    locationIsAutoFilled = false;
  });

  // Look up a street name for the pin and put it in the Location box.
  // The short delay stops us from spamming the address service while the pin is being dragged.
  function fillAddress(lat, lng) {
    clearTimeout(addressTimer);

    addressTimer = setTimeout(async () => {
      const box = $("#pLoc");
      const canFill = () => locationIsAutoFilled || !box.value.trim();
      const coords = lat.toFixed(5) + ", " + lng.toFixed(5);

      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`;
        const response = await fetch(url);
        const result = await response.json();
        const a = result.address || {};

        const street = a.road || a.pedestrian || a.amenity;
        const area = a.neighbourhood || a.suburb || a.village || a.hamlet;
        const town = a.city || a.town || a.municipality || a.county;
        const text = [street, area, town].filter(Boolean).join(", ") || result.display_name || coords;

        if (canFill()) {
          box.value = text;
          locationIsAutoFilled = true;
        }
      } catch (err) {
        if (canFill()) {
          box.value = coords;
          locationIsAutoFilled = true;
        }
      }
    }, 400);
  }

  function setPin(lat, lng) {
    pinPosition = [lat, lng];

    if (pinMarker) {
      pinMarker.setLatLng(pinPosition);
    } else {
      pinMarker = L.marker(pinPosition, { draggable: true }).addTo(pickMap);
      pinMarker.on("dragend", () => {
        const spot = pinMarker.getLatLng();
        setPin(spot.lat, spot.lng);
      });
    }

    $("#pickInfo").textContent = "Pin set at " + lat.toFixed(5) + ", " + lng.toFixed(5) + ". Drag it to adjust.";
    $("#pErr").textContent = "";
    fillAddress(lat, lng);
    showWeather(lat, lng, "Pinned location");
  }

  pickMap.on("click", e => setPin(e.latlng.lat, e.latlng.lng));

  $("#useMe").onclick = () => {
    if (!navigator.geolocation) {
      $("#pErr").textContent = "Your browser can't get your location. Tap the map instead.";
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        setPin(position.coords.latitude, position.coords.longitude);
        pickMap.setView(pinPosition, 17);
      },
      () => {
        $("#pErr").textContent = "Could not get your location. Tap the map instead.";
      }
    );
  };

  /* Photo upload: shrink it first so it fits in localStorage. */

  const dropZone = $("#drop");
  const fileInput = $("#pFile");

  dropZone.onclick = () => fileInput.click();
  dropZone.onkeydown = e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  };

  fileInput.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();

      image.onload = () => {
        const scale = Math.min(1, 600 / image.width); // max 600px wide
        const canvas = document.createElement("canvas");
        canvas.width = image.width * scale;
        canvas.height = image.height * scale;
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

        photoData = canvas.toDataURL("image/jpeg", 0.7);
        dropZone.style.backgroundImage = `url(${photoData})`;
        dropZone.textContent = "";
      };

      image.onerror = () => {
        $("#pErr").textContent = "That file is not a valid image.";
      };

      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  /* Submit */

  $("#postForm").onsubmit = e => {
    e.preventDefault();

    const locationName = $("#pLoc").value.trim();
    const description = $("#pDesc").value.trim();
    const reporterName = $("#pName").value.trim() || "Anonymous";

    if (!pinPosition) {
      $("#pErr").textContent = "Tap the map to drop a pin where the hazard is.";
      return;
    }
    if (!locationName) {
      $("#pErr").textContent = "Add a location name or let the map fill it in.";
      $("#pLoc").focus();
      return;
    }
    if (description.length < 10) {
      $("#pErr").textContent = "Explain what happened in at least 10 characters.";
      $("#pDesc").focus();
      return;
    }

    $("#pErr").textContent = "";
    const now = new Date().toISOString();

    reports.push({
      id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      loc: locationName,
      desc: description,
      name: reporterName,
      lat: pinPosition[0],
      lng: pinPosition[1],
      photo: photoData,
      status: "Pending",
      created: now,
      history: [{ status: "Pending", at: now }]
    });
    saveReports();

    window.location.href = "reports.html#posted"; // send the user to the Reports page
  };
}


/* ---------- Theme toggle + mobile menu ---------- */

const rootElement = document.documentElement;

function setTheme(theme) {
  rootElement.dataset.theme = theme;
  try {
    localStorage.setItem("hp-theme", theme);
  } catch (err) { }
  $("#theme").textContent = theme === "dark" ? "☀" : "☾";
}

let savedTheme = null;
try {
  savedTheme = localStorage.getItem("hp-theme");
} catch (err) { }

const systemPrefersDark = matchMedia("(prefers-color-scheme:dark)").matches;
setTheme(savedTheme || (systemPrefersDark ? "dark" : "light"));

$("#theme").onclick = () => {
  setTheme(rootElement.dataset.theme === "dark" ? "light" : "dark");
};

$("#menuBtn").onclick = () => {
  const isOpen = $("#nav").classList.toggle("open");
  $("#menuBtn").setAttribute("aria-expanded", isOpen);
};

$("#nav").addEventListener("click", () => $("#nav").classList.remove("open"));


/* ---------- Start ---------- */

render();

if (PAGE === "reports" && window.location.hash === "#posted") {
  showToast("Report submitted. Status: Pending");
  history.replaceState(null, "", "reports.html");
}
