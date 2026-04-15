import { render } from "solid-js/web";
import { Router } from "@solidjs/router";
import App from "./App";
import "./styles/global.css";
import "./styles/variables.css";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Root element #app not found");
}

render(
  () => (
    <Router>
      <App />
    </Router>
  ),
  root,
);
