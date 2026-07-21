export function storeSnapshot(store) {
  let value;
  const unsubscribe = store.subscribe((next) => { value = next; });
  unsubscribe();
  return value;
}
