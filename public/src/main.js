import { mount } from "svelte";
import App from "./App.svelte";
import "katex/dist/katex.min.css";
import "./style.css";

mount(App, { target: document.body });
