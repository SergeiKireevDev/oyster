import { mount } from "svelte";
import App from "./App.svelte";
import "katex/dist/katex.min.css";
import "./style.css";
import { registerServiceWorker } from "./runtime/registerServiceWorker.js";

mount(App, { target: document.body });

if (import.meta.env.PROD) registerServiceWorker();
