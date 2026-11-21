// Run on a signed-in overview. Uses a temporary editor draft and leaves saved layouts alone.
async () => {
  const {S, renderApp} = window.P;
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  assert(!S.dashboardLayoutDraft, "Close the current dashboard editor before running this test.");
  S.dashboardLayoutDraft = {key: JSON.stringify([S.user.id, S.portId]), layout: []};
  renderApp();
  const tracks = 2 * Number(getComputedStyle(document.querySelector(".metrics-editing")).getPropertyValue("--widget-grid-columns"));
  const columns = tracks / 2;
  const ids = ["active", "upcoming", "utilization", "waiting"];
  const layout = ids.map((id, i) => ({id, width: 1, position: {
    column: i % columns * 2 + 1, row: Math.floor(i / columns) + 1, tracks,
  }}));
  layout.push({id: "turnaround", width: 1, position: {column: 1, row: 4, tracks}});
  const initialOrder = layout.map(card => card.id).join();
  S.dashboardLayoutDraft = {key: JSON.stringify([S.user.id, S.portId]), layout};
  renderApp();
  try {
    const grid = document.querySelector(".metrics-editing");
    assert(grid, "Editor not rendered");
    const children = () => [...grid.children];
    const [firstCard, secondCard] = children();
    const gap = parseFloat(getComputedStyle(grid).columnGap);
    assert(Math.abs(firstCard.offsetWidth - firstCard.offsetHeight) <= 1, "A 1×1 card is not square");
    assert(Math.abs(secondCard.offsetLeft - firstCard.offsetLeft - firstCard.offsetWidth - gap) <= 2,
      "There is an extra grid slot between adjacent KPIs");
    const source = children().find(node => node.dataset.kpiId === ids.at(-1));
    // Synthetic pointers exercise the actual handlers without a hardware capture target.
    source.setPointerCapture = () => {};
    const point = node => {
      const {left, top, width, height} = node.getBoundingClientRect();
      return {x: left + width / 2, y: top + height / 2};
    };
    const send = (type, {x, y}) => source.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, isPrimary: true, bubbles: true, clientX: x, clientY: y,
    }));
    const start = point(source);
    const target = point(children()[0]);
    const settle = () => new Promise(resolve => setTimeout(resolve, 200));
    const coordinates = () => JSON.stringify(children().map(node => node.dataset.widgetPosition));
    const baseline = coordinates();
    const originalDraft = S.dashboardLayoutDraft.layout;
    const begin = async () => {
      send("pointerdown", start);
      send("pointermove", target);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      assert(JSON.parse(source.dataset.widgetPosition).column === 1 &&
        JSON.parse(source.dataset.widgetPosition).row === 1, "Target not previewed before drop");
      assert(children().map(node => node.dataset.kpiId).join() === initialOrder, "Preview reordered the DOM");
      assert(S.dashboardLayoutDraft.layout === originalDraft, "Preview committed the draft early");
    };

    await begin();
    source.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    assert(coordinates() === baseline, "Escape failed to restore exact positions");
    await settle();

    await begin();
    send("pointercancel", target);
    assert(coordinates() === baseline, "Pointer cancellation failed to restore positions");
    await settle();

    await begin();
    send("pointerup", target);
    const saved = S.dashboardLayoutDraft.layout;
    assert(saved.map(card => card.id).join() === [ids.at(-1), ...ids.slice(0, -1), "turnaround"].join(), "Drop failed to insert in reading order");
    assert(saved.every((card, i) => card.width === 1 &&
      card.position.tracks === tracks && card.position.column === (i === ids.length ? 1 : (i % columns) * 2 + 1) &&
      card.position.row === (i === ids.length ? 4 : Math.floor(i / columns) + 1)), "Drop coordinates do not match the predicted grid");
    await settle();

    grid.style.maxHeight = "140px";
    const edge = {x: target.x, y: grid.getBoundingClientRect().bottom - 2};
    const scrollBefore = grid.scrollTop;
    send("pointerdown", point(source));
    send("pointermove", edge);
    await settle();
    assert(grid.scrollTop > scrollBefore, "Holding near the edge did not scroll the board");
    send("pointercancel", edge);
    assert(grid.scrollTop === scrollBefore, "Cancellation did not restore scroll position");

    return {tracks, passed: ["live preview", "Escape", "pointer cancel", "drop coordinates", "edge scroll"]};
  } finally {
    document.querySelector('[data-editor="cancel"]')?.click();
  }
}
