import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { hydrate } from "./lib/refdata.js";
import "./index.css";

/* Reference data is fetched BEFORE the first render, so the app never paints
   with the bundled seed and then jump to the real article list. */
hydrate().finally(() => {
  createRoot(document.getElementById("root")).render(<App />);
});
