import { createRoot } from "react-dom/client";
import "./demo.css";
import { DemoAnimation } from "./DemoAnimation";

const el = document.getElementById("demo-animation");
if (el) {
  createRoot(el).render(<DemoAnimation autoplay />);
}
