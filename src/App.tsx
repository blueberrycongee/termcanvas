import { Canvas } from "./canvas/Canvas";
import { Toolbar } from "./toolbar/Toolbar";

export function App() {
  return (
    <>
      <Toolbar />
      <div className="pt-10 h-screen">
        <Canvas />
      </div>
    </>
  );
}
