/** Stable editor modes. Geometry changes are staged and saved as one revision-checked batch. */
export function initGeography(forms) {
  const P = window.P,
    { S, $, icon, toast } = P;
  const map = (S.configMap = L.map("config-map", {
    preferCanvas: true,
    zoomAnimation: document.documentElement.dataset.motion !== "reduced",
    fadeAnimation: document.documentElement.dataset.motion !== "reduced",
    markerZoomAnimation: document.documentElement.dataset.motion !== "reduced",
  }).setView([...S.data.port.center].reverse(), S.data.port.zoom || 15));
  P.mapBase(map);
  const group = L.featureGroup().addTo(map),
    pending = new Map();
  let boundaryDirty = false,
    boundary = S.data.port.boundary,
    handler = null,
    mode = "pan",
    busy = false;
  const tools = document.createElement("div");
  tools.className = "geo-editor-tools toolbar";
  const definitions = [
    ["pan", "move", "Pan"],
    ["boundary", "pentagon", "Port boundary"],
    ["berth", "anchor", "Berth"],
    ["equipment", "construction", "Equipment"],
    ["edit", "square-pen", "Edit vertices"],
    ["remove", "eraser", "Remove"],
  ];
  tools.innerHTML =
    definitions
      .map(
        ([id, ic, label]) =>
          `<button class="btn small" data-geo-mode="${id}" type="button">${icon(ic)}${label}</button>`,
      )
      .join("") +
    `<button class="btn small danger" id="geo-clear" type="button" hidden>Clear map</button><button class="btn small primary" id="geo-finish" type="button" hidden>Finish drawing</button><span id="geo-editor-status" role="status">Pan to inspect the port.</span>`;
  $("#config-map").before(tools);
  const save = document.createElement("button");
  save.className = "btn small primary";
  save.type = "button";
  save.id = "geo-save";
  save.textContent = "Save changes";
  const cancel = document.createElement("button");
  cancel.className = "btn small";
  cancel.type = "button";
  cancel.id = "geo-cancel";
  cancel.textContent = "Cancel changes";
  $(".hmi-map-footer .form-actions").prepend(save, cancel);
  const dirty = () => pending.size > 0 || boundaryDirty;
  const message = (text) => ($("#geo-editor-status").textContent = text);
  function update() {
    const summary = document.querySelector(".hmi-map-footer .form-grid");
    if (summary) {
      const values = summary.querySelectorAll(".field p");
      if (values[0])
        values[0].textContent = boundary
          ? boundary.coordinates[0].length -
            1 +
            " boundary vertices" +
            (boundaryDirty ? " (unsaved)" : "")
          : "Boundary not defined" + (boundaryDirty ? " (unsaved)" : "");
      const counts = { berths: 0, equipment: 0, zones: 0 };
      group.eachLayer((l) => {
        const k = l._portside.kind;
        if (k in counts) counts[k]++;
      });
      if (values[1])
        values[1].textContent =
          counts.berths +
          " mapped berths · " +
          counts.equipment +
          " assets · " +
          counts.zones +
          " areas";
    }
    save.disabled = busy || !dirty();
    cancel.disabled = busy || !dirty();
    tools.querySelectorAll("[data-geo-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.geoMode === mode);
      b.disabled =
        busy || (!P.can("config.edit") && b.dataset.geoMode !== "pan");
    });
    $("#geo-clear").hidden = mode !== "remove";
    $("#geo-finish").hidden = !["boundary", "berth"].includes(mode);
  }
  function stop() {
    if (handler) {
      handler.disable();
      handler = null;
    }
    group.eachLayer((l) => {
      if (l.editing?.enabled()) {
        l.editing.disable();
      }
      l.dragging?.disable();
    });
  }
  function edited(layer) {
    const m = layer._portside;
    if (m.kind === "boundary") {
      boundary = layer.toGeoJSON().geometry;
      boundaryDirty = true;
    } else
      pending.set(m.kind + ":" + m.id, {
        kind: m.kind,
        id: m.id,
        revision: m.revision,
        action: "update",
        geometry: layer.toGeoJSON().geometry,
      });
    message("Unsaved changes. Save or cancel before leaving.");
    update();
  }
  function add(geometry, meta, style) {
    if (!geometry) return;
    L.geoJSON(geometry, {
      style,
      pointToLayer: (_, ll) => L.marker(ll, { draggable: false }),
    }).eachLayer((layer) => {
      layer._portside = meta;
      group.addLayer(layer);
      layer.bindTooltip(P.esc(meta.name || meta.kind), { direction: "top" });
      layer.on("edit", () => edited(layer));
      layer.on("dragend", () => edited(layer));
      layer.on("click", (event) => {
        if (mode !== "remove" || busy) return;
        L.DomEvent.stopPropagation(event);
        if (meta.kind === "boundary") {
          boundary = null;
          boundaryDirty = true;
        } else
          pending.set(meta.kind + ":" + meta.id, {
            kind: meta.kind,
            id: meta.id,
            revision: meta.revision,
            action: "remove",
          });
        group.removeLayer(layer);
        message(
          "Removed from this draft. Save changes to make it permanent on the map.",
        );
        update();
      });
    });
  }
  add(
    boundary,
    { kind: "boundary", name: "Port boundary" },
    { color: "#2563eb", weight: 2, fillOpacity: 0.08 },
  );
  for (const kind of ["berths", "equipment", "zones"])
    for (const r of S.data[kind])
      if (r.geometry && r.map_visible !== false)
        add(
          r.geometry,
          { kind, id: r.id, revision: r.revision, name: r.code || r.name },
          {
            color: kind === "berths" ? "#0891b2" : "#7c3aed",
            weight: kind === "berths" ? 5 : 2,
            fillOpacity: 0.08,
          },
        );
  async function saveChanges(quiet = false) {
    if (!dirty()) return;
    stop();
    busy = true;
    update();
    try {
      const payload = {
        port_revision: S.data.port.revision,
        changes: [...pending.values()],
      };
      if (boundaryDirty) payload.boundary = boundary;
      const result = await P.api(
        P.path("/configuration/geography"),
        "POST",
        payload,
      );
      pending.clear();
      boundaryDirty = false;
      await P.refresh(false);
      message("Geography saved. Assigned operational records are retained.");
      if (!quiet)
        toast(
          result.removed_from_map
            ? "Removed from the map. Existing vessel allocations remain in planning."
            : "Geography changes saved.",
        );
    } catch (e) {
      message("Not saved: " + e.message);
      throw e;
    } finally {
      busy = false;
      mode = "pan";
      update();
    }
  }
  async function setMode(next) {
    if (busy) return;
    stop();
    const targetMode =
      S.geoPlacement?.kind === "berths" ? "berth" : "equipment";
    if (S.geoPlacement && next !== targetMode) {
      S.geoPlacement = null;
      document.querySelector(".geo-placement-banner")?.remove();
    }
    mode = next;
    const instructions = {
      pan: "Pan to inspect the port.",
      boundary: "Click boundary corners, then Finish drawing.",
      berth: "Click the berth line endpoints, then Finish drawing.",
      equipment: "Click a location to place equipment.",
      edit: "Drag vertices or equipment. Then Save changes.",
      remove: "Click items to remove them from the map. Then Save changes.",
    };
    message(instructions[next]);
    if (next === "boundary")
      handler = new L.Draw.Polygon(map, {
        allowIntersection: false,
        shapeOptions: { color: "#2563eb" },
      });
    if (next === "berth")
      handler = new L.Draw.Polyline(map, {
        shapeOptions: { color: "#0891b2", weight: 5 },
      });
    if (next === "equipment") handler = new L.Draw.Marker(map, {});
    if (next === "edit")
      group.eachLayer((l) => {
        if (l.editing) l.editing.enable();
        if (l.dragging) l.dragging.enable();
      });
    else group.eachLayer((l) => l.dragging?.disable());
    handler?.enable();
    update();
  }
  map.on(L.Draw.Event.CREATED, (e) => {
    const geometry = e.layer.toGeoJSON().geometry;
    const before = () => saveChanges(true);
    const createdMode = mode;
    stop();
    mode = "pan";
    message(
      "Drawing complete. Assign the item in the dialog, or close it to cancel.",
    );
    update();
    if (createdMode === "berth")
      forms.assignGeometry("berths", geometry, before);
    else if (createdMode === "equipment")
      forms.assignGeometry("equipment", geometry, before);
    else forms.boundaryDialog(geometry, before);
  });
  tools
    .querySelectorAll("[data-geo-mode]")
    .forEach((b) => (b.onclick = () => setMode(b.dataset.geoMode)));
  $("#geo-finish").onclick = () => {
    const minimum = mode === "berth" ? 2 : 3;
    if ((handler?._markers?.length || 0) < minimum) {
      message(
        `Place at least ${minimum} points before finishing the ${mode === "berth" ? "berth line" : "boundary"}.`,
      );
      return;
    }
    handler?.completeShape?.();
  };
  $("#geo-clear").onclick = () => {
    group.eachLayer((l) => {
      const m = l._portside;
      if (m.kind === "boundary") {
        boundary = null;
        boundaryDirty = true;
      } else
        pending.set(m.kind + ":" + m.id, {
          kind: m.kind,
          id: m.id,
          revision: m.revision,
          action: "remove",
        });
    });
    group.clearLayers();
    message(
      "All map items removed from this draft. Save changes or draw a new boundary.",
    );
    update();
  };
  save.onclick = () => saveChanges().catch((e) => toast(e.message, true));
  cancel.onclick = () => {
    stop();
    P.renderApp();
  };
  // Preserve staged changes until an explicit save or cancel. Navigation never silently rehydrates them.
  const guarded = (fn) => async () => {
    try {
      await saveChanges(true);
      await fn();
    } catch (e) {
      toast(e.message, true);
    }
  };
  $("#geo-center-save").onclick = guarded(async () => {
    const c = map.getCenter();
    await P.api(P.path(""), "PUT", {
      ...S.data.port,
      center: [c.lng, c.lat],
      zoom: map.getZoom(),
    });
    await P.refresh();
    toast("Default port view saved");
  });
  $("#geo-to-overview").onclick = guarded(() => P.nav("overview"));
  $("#geo-go").onclick = () => {
    const x = Number($("#geo-lng").value),
      y = Number($("#geo-lat").value);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      Math.abs(x) > 180 ||
      Math.abs(y) > 90
    )
      return toast("Enter valid longitude and latitude", true);
    map.setView([y, x], 15, { animate: document.documentElement.dataset.motion !== "reduced" });
  };
  $("#geo-recenter").onclick = () =>
    map.setView([...S.data.port.center].reverse(), S.data.port.zoom || 15, { animate: document.documentElement.dataset.motion !== "reduced" });
  $("#geo-basemap").onclick = () => {
    map.eachLayer((l) => {
      if (l instanceof L.TileLayer) map.removeLayer(l);
    });
    S.basemap = S.basemap === "satellite" ? "map" : "satellite";
    P.mapBase(map);
  };
  // Import keeps its existing dialog; custom tools do not create Leaflet's expanding toolbar.
  $("#import-geo").onclick = () => P.importGeography?.();
  S.geoEditor = { dirty, save: saveChanges };
  const placement = S.geoPlacement?.port === S.portId ? S.geoPlacement : null;
  const target = placement
    ? S.data[placement.kind]?.find((x) => x.id === placement.id)
    : null;
  if (target && P.can("config.edit")) {
    const hint = document.createElement("div");
    hint.className = "geo-placement-banner";
    hint.innerHTML = `<span>${icon("map-pin")}Placing <strong>${P.esc(target.code ? target.code + " · " + target.name : target.name)}</strong> on ${P.esc(S.data.port.name)}</span><button class="btn small" type="button" id="cancel-asset-placement">Cancel placement</button>`;
    tools.before(hint);
    hint.querySelector("button").onclick = () => {
      S.geoPlacement = null;
      hint.remove();
      setMode("pan");
    };
    if (target.geometry) {
      const layer = L.geoJSON(target.geometry);
      if (layer.getBounds().isValid())
        map.fitBounds(layer.getBounds(), { maxZoom: 18, padding: [70, 70] });
    }
    setMode(placement.kind === "berths" ? "berth" : "equipment");
  }
  update();
  P.icons();
  requestAnimationFrame(() => map.invalidateSize());
}
