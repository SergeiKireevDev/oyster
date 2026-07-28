export function createHublotManagerController({ resetCarousel, openModal, refresh, getScopeAll }) {
  async function show() {
    resetCarousel();
    openModal({ title: getScopeAll() ? "Live interface widgets — all sessions" : "Pin widget", wide: true, content: "hublotManager" });
    await refresh({ loading: true });
  }
  return { show };
}
