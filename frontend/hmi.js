/** Fixed-screen workspaces with native scrolling inside tables and forms. */
let activeLayout;
const pageState = new Map();

export function prepareScreen(page) {
  activeLayout?.destroy();
  const main = document.querySelector("main");
  main.classList.add("hmi-main");
  main.dataset.page = page;
  const heading = main.querySelector(":scope > .page-heading");
  const footer = main.querySelector(":scope > .page-footer");
  const workspace = document.createElement("div");
  workspace.className = "hmi-workspace";
  for (const child of [...main.children])
    if (child !== heading && child !== footer) workspace.append(child);
  main.insertBefore(workspace, footer);
  if (page === "configuration") {
    const content = workspace.querySelector(".config-content");
    if (content) content.dataset.section = window.P.S.configTab;
    const geography = content?.querySelector("#config-map");
    if (geography) {
      const body = geography.nextElementSibling;
      body.classList.add("hmi-map-footer");
      const notice = body.querySelector(".notice");
      const help = document.createElement("button");
      help.className = "btn small";
      help.textContent = "Map help";
      help.type = "button";
      help.onclick = () =>
        window.P.modal("Geographic editor help", notice.outerHTML);
      body.querySelector(".form-actions").prepend(help);
      notice.remove();
    }
    if (content?.dataset.section === "rules") {
      const form = content.querySelector("form");
      const list = document.createElement("div");
      list.className = "hmi-rule-list";
      const items = [...(form?.querySelectorAll(":scope > .list-card") || [])];
      if (items.length) {
        form.insertBefore(list, items[0]);
        items.forEach((item) => list.append(item));
      }
    }
  }
  if (page === "overview") addOverviewTabs(workspace);
}

function addOverviewTabs(workspace) {
  const tabs = document.createElement("div");
  tabs.className = "hmi-panel-tabs hmi-overview-tabs";
  tabs.setAttribute("aria-label", "Overview panels");
  const options = [
    ["map", "Port map"],
    ["operations", "Operations & berths"],
    ["analysis", "Cargo & delays"],
    ["alerts", "Alerts"],
  ];
  const selected = pageState.get("overview-panel") || "map";
  workspace.dataset.panel = selected;
  options.forEach(([id, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.classList.toggle("active", id === selected);
    b.onclick = () => {
      workspace.dataset.panel = id;
      pageState.set("overview-panel", id);
      [...tabs.children].forEach((x) => x.classList.toggle("active", x === b));
      window.dispatchEvent(new Event("resize"));
    };
    tabs.append(b);
  });
  workspace.insertBefore(tabs, workspace.querySelector(".dashboard-middle"));
}

function overviewScrollRegion(host) {
  host.classList.add("hmi-overview-region");
  host.tabIndex = 0;
  host.setAttribute("role", "region");
  host.setAttribute("aria-label", host.closest(".card")?.querySelector("h2,h3")?.textContent.trim() || "Dashboard records");
  let idle;
  const scrolling = () => {
    host.classList.add("is-scrolling");
    clearTimeout(idle);
    idle = setTimeout(() => host.classList.remove("is-scrolling"), 900);
  };
  host.addEventListener("scroll", scrolling, { passive: true });
  return { fit() {}, destroy() { clearTimeout(idle); host.removeEventListener("scroll", scrolling); } };
}

/** Native scrolling and composable table filters keep every record reachable. */
function scrollRegion(host, items, mode, key) {
  if (host.closest('.hmi-main[data-page="overview"]')) return overviewScrollRegion(host);
  host.classList.add("hmi-scroll-region");
  const card = host.closest(".card");
  const hasSearch = card?.querySelector(
    'input[type="search"],input[placeholder*="Search"],input[placeholder*="Find"],input[id*="search"]',
  );
  if (items.length > 4 && !hasSearch && !host.closest(".report-workbench")) {
    const bar = document.createElement("div");
    bar.className = "toolbar list-filter-toolbar";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Filter this list…";
    search.setAttribute("aria-label", "Filter this list");
    const column = document.createElement("select");
    column.setAttribute("aria-label", "Search column");
    column.innerHTML = '<option value="">All columns</option>';
    if (mode === "table")
      [...host.querySelectorAll("thead th")].forEach((th, i) => {
        if (th.textContent.trim()) {
          const o = document.createElement("option");
          o.value = i;
          o.textContent = th.textContent;
          column.append(o);
        }
      });
    const values = document.createElement("select");
    values.setAttribute("aria-label", "Exact value");
    values.innerHTML = '<option value="">Any value</option>';
    const count = document.createElement("span");
    count.className = "subtle";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "btn small";
    clear.textContent = "Reset";
    const advanced = document.createElement("details");
    advanced.className = "list-filter-options";
    const toggle = document.createElement("summary");
    toggle.textContent = "Filters";
    const controls = document.createElement("div");
    controls.className = "list-filter-controls";
    controls.append(column, values, clear);
    advanced.append(toggle, controls);
    count.setAttribute("role", "status");
    bar.append(search, count, advanced);
    host.before(bar);
    function filter() {
      const q = search.value.toLocaleLowerCase();
      let n = 0;
      for (const item of items) {
        const cell =
          column.value === "" ? item : item.children[Number(column.value)];
        const text = (cell?.textContent || "").trim();
        item.hidden = !(
          text.toLocaleLowerCase().includes(q) &&
          (!values.value || text === values.value)
        );
        if (!item.hidden) n++;
      }
      count.textContent = n + " / " + items.length;
    }
    column.onchange = () => {
      values.innerHTML = '<option value="">Any value</option>';
      if (column.value !== "") {
        const v = [
          ...new Set(
            items
              .map((item) =>
                item.children[Number(column.value)]?.textContent.trim(),
              )
              .filter(Boolean),
          ),
        ].sort();
        for (const text of v.slice(0, 200)) {
          const o = document.createElement("option");
          o.value = text;
          o.textContent = text;
          values.append(o);
        }
      }
      filter();
    };
    search.oninput = filter;
    values.onchange = filter;
    clear.onclick = () => {
      search.value = "";
      column.value = "";
      column.onchange();
    };
    filter();
  }
  return { fit() {}, destroy() {} };
}

export function activateScreen() {
  const main = document.querySelector(".hmi-main");
  if (!main) return;
  function revealSection(strip) {
    const active = strip.querySelector('button[aria-pressed="true"]');
    if (!active) return;
    const item = active.getBoundingClientRect(), bounds = strip.getBoundingClientRect();
    strip.scrollLeft += item.right > bounds.right ? item.right - bounds.right + 8 : item.left < bounds.left ? item.left - bounds.left - 8 : 0;
  }
  for (const selector of [".config-nav", ".workflow-tabs"]) {
    const strip = main.querySelector(selector);
    if (!strip) continue;
    const buttons = [...strip.querySelectorAll("button")];
    revealSection(strip);
    strip.onkeydown = async event => {
      const index = buttons.indexOf(event.target.closest("button"));
      if (index < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
      const rtl = getComputedStyle(strip).direction === "rtl";
      const step = event.key === "ArrowRight" ? (rtl ? -1 : 1) : event.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : step ? (index + step + buttons.length) % buttons.length : -1;
      if (next < 0) return;
      event.preventDefault();
      await buttons[next].onclick();
      document.querySelector(`.hmi-main ${selector}`)?.querySelectorAll("button")[next]?.focus({ preventScroll: true });
    };
  }
  const pagers = [],
    seen = new WeakSet(),
    signatures = new WeakMap();
  let frame;
  const keyBase = () =>
    [
      window.P.S.portId,
      main.dataset.page,
      window.P.S.tab,
      window.P.S.configTab,
    ].join(":");
  function add(host, items, mode, key) {
    if (!host) return;
    const old = signatures.get(host);
    if (
      seen.has(host) &&
      old?.length === items.length &&
      old.every((x, i) => x === items[i])
    )
      return;
    if (host.previousElementSibling?.classList.contains("list-filter-toolbar"))
      host.previousElementSibling.remove();
    signatures.set(host, items);
    seen.add(host);
    const p = scrollRegion(host, items, mode, keyBase() + ":" + key);
    if (p) pagers.push(p);
  }
  function scan() {
    if (main.dataset.page === "overview") {
      const alerts = main.querySelector(".alerts-list");
      if (alerts) add(alerts, [...alerts.children], "flow", "alerts");
      const products = main.querySelector(".throughput-products");
      if (products?.querySelector(".throughput-product")) add(products, [...products.children], "grid", "products");
    }
    main
      .querySelectorAll(".table-scroll")
      .forEach((host, i) =>
        add(
          host,
          [...host.querySelectorAll("tbody > tr")],
          "table",
          "table-" + i,
        ),
      );
    main.querySelectorAll(".report-grid,.approval-grid").forEach((host, i) =>
      add(
        host,
        [...host.children].filter((c) =>
          c.matches(".report-card,.approval-card"),
        ),
        "grid",
        "grid-" + i,
      ),
    );
    main.querySelectorAll("#audit-list,.hmi-rule-list").forEach((host, i) => {
      if (host.querySelector(".history-row,.list-card"))
        add(host, [...host.children], "flow", "list-" + host.id + i);
    });
    if (window.P.S.page === "center" && window.P.S.tab === "notifications") {
      const host = main.querySelector(
        "#notification-list",
      );
      add(host, [...(host?.children || [])], "flow", "notifications");
    }
    main
      .querySelectorAll(".config-content .form-body:not(.hmi-map-footer):not(.workflow-editor)")
      .forEach((body, i) => {
        if (seen.has(body)) return;
        seen.add(body);
        const actions = body.querySelector(":scope > .form-actions");
        const flow = document.createElement("div");
        flow.className = "hmi-form-flow";
        const children = [...body.children].filter((x) => x !== actions);
        // Table and list regions manage their own records, while the surrounding form stays fixed.
        if (body.querySelector(".table-scroll,#users-list,.hmi-rule-list"))
          return;
        children.forEach((c) => flow.append(c));
        body.insertBefore(flow, actions);
        add(flow, children, "flow", "form-" + i);
      });
    // Install navigation after async user/audit records arrive.
    pagers.forEach((p) => p.fit());
  }
  const mutation = new MutationObserver((records) => {
    if (
      records.some(
        (r) =>
          r.type === "childList" &&
          [...r.addedNodes].some(
            (n) => n.nodeType === 1 && !n.classList?.contains("hmi-pager"),
          ),
      )
    ) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scan);
    }
  });
  mutation.observe(main, { childList: true, subtree: true });
  const resize = () => {
    main.querySelectorAll(".config-nav,.workflow-tabs").forEach(revealSection);
    window.P.fitTimeline();
    pagers.forEach((p) => p.fit());
    window.P.S.map?.invalidateSize();
    window.P.S.configMap?.invalidateSize();
  };
  window.addEventListener("resize", resize);
  scan();
  activeLayout = {
    destroy() {
      mutation.disconnect();
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
      pagers.forEach((p) => p.destroy());
    },
  };
  requestAnimationFrame(resize);
}

export function activateModalLists(root) {
  root
    .querySelectorAll(".table-scroll,.source-table")
    .forEach((host, i) =>
      scrollRegion(
        host,
        [...host.querySelectorAll("tbody > tr")],
        "table",
        "modal-" + i,
      ),
    );
}
