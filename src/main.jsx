import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { hydrate } from "./lib/refdata.js";
import "./index.css";

/* Reference data is fetched BEFORE the first render, so the app never paints
   with the bundled seed and then jump to the real article list. */
hydrate().then(() => {
  createRoot(document.getElementById("root")).render(<App />);
}).catch(error=>{
  createRoot(document.getElementById("root")).render(
    <main style={{fontFamily:"system-ui",maxWidth:720,margin:"64px auto",padding:24}}>
      <h1 style={{fontSize:22}}>Factory OS could not start safely</h1>
      <p>The live article master, BOM and packing rules could not be loaded. No orders have been opened with fallback data.</p>
      <pre style={{whiteSpace:"pre-wrap",background:"#fff1f2",padding:12,borderRadius:8,color:"#9f1239"}}>{String(error.message||error)}</pre>
      <button onClick={()=>location.reload()} style={{padding:"8px 14px"}}>Retry</button>
    </main>);
});
