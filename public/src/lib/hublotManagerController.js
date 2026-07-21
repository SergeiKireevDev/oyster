export function createHublotManagerController({ resetCarousel, openModal, refresh, getScopeAll }) {
  async function show() {
    resetCarousel();
    openModal({ title: getScopeAll() ? "Hublots — all sessions" : "Hublots — this session", wide: true, content: "hublotManager" });
    await refresh({ loading: true });
  }
  return { show };
}
