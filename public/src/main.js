import { mount } from "svelte";
import App from "./App.svelte";
import "katex/dist/katex.min.css";
import "./style.css";
import { registerServiceWorker } from "./runtime/registerServiceWorker.js";
import { createBrowserApplicationScope } from "./runtime/createBrowserApplicationScope.js";
import { resolveBrowserEnvironment } from "./runtime/browserEnvironment.js";

const browser = resolveBrowserEnvironment();
if (browser) {
  const applicationScope = createBrowserApplicationScope({
    ...browser,
    attachPageIntegrations: import.meta.env.PROD ? registerServiceWorker : undefined,
  });
  mount(App, { target: browser.documentTarget.body, props: { applicationScope } });
}
