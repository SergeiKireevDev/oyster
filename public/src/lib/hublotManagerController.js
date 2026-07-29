export function createHublotManagerController({ openModal }) {
  function show() {
    openModal({ title: "New live interface widget", wide: true, content: "hublotManager" });
  }
  return { show };
}
