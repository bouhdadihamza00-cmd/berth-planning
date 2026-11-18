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

/** Native scrolling and composable table filters keep every record reachable. */
function scrollRegion(host, items, mode, key) {
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
    bar.append(search, column, values, count, clear);
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
