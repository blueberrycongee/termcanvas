import test from "node:test";
import assert from "node:assert/strict";

import type { Terminal } from "@xterm/xterm";
import { patchXtermMouseService } from "../src/terminal/xtermMouseScalePatch.ts";

type MouseEventCoords = { clientX: number; clientY: number };

function createRectElement(rect: { left: number; top: number }): HTMLElement {
  return {
    getBoundingClientRect() {
      return rect;
    },
  } as HTMLElement;
}

function createTerminal(core: unknown): Terminal {
  return { _core: core } as unknown as Terminal;
}

test("patchXtermMouseService scales xterm mouse-service coordinates under viewport zoom", () => {
  const screenElement = createRectElement({ left: 100, top: 50 });
  const captured: MouseEventCoords[] = [];
  const mouseService = {
    getCoords(
      event: MouseEventCoords,
      _element: HTMLElement,
      _cols: number,
      _rows: number,
      _isSelection?: boolean,
    ): [number, number] {
      captured.push(event);
      return [1, 1];
    },
    getMouseReportCoords(event: MouseEventCoords): unknown {
      captured.push(event);
      return {};
    },
  };

  const dispose = patchXtermMouseService(
    createTerminal({ _mouseService: mouseService }),
    () => 2,
  );

  mouseService.getCoords({ clientX: 300, clientY: 250 }, screenElement, 80, 24, true);
  mouseService.getMouseReportCoords({ clientX: 500, clientY: 450 }, screenElement);

  assert.deepEqual(captured, [
    { clientX: 200, clientY: 150 },
    { clientX: 300, clientY: 250 },
  ]);

  dispose();
  mouseService.getCoords({ clientX: 300, clientY: 250 }, screenElement, 80, 24, true);
  assert.deepEqual(captured.at(-1), { clientX: 300, clientY: 250 });
});

test("patchXtermMouseService scales selection drag-scroll threshold checks", () => {
  const screenElement = createRectElement({ left: 0, top: 100 });
  const selectionService = {
    _screenElement: screenElement,
    _renderService: { dimensions: { css: { canvas: { height: 200 } } } },
    _getMouseEventScrollAmount(event: MouseEventCoords): number {
      const offset = event.clientY - this._screenElement.getBoundingClientRect().top;
      const terminalHeight = this._renderService.dimensions.css.canvas.height;
      return offset >= 0 && offset <= terminalHeight ? 0 : 1;
    },
  };

  const dispose = patchXtermMouseService(
    createTerminal({ _selectionService: selectionService }),
    () => 2,
  );

  // Visual terminal bottom is 100 + 200 * 2 = 500. Without scaling this event
  // looks like offset 398 and wrongly starts drag-scroll; with scaling it maps
  // back to CSS offset 199 and remains a normal in-terminal selection drag.
  assert.equal(
    selectionService._getMouseEventScrollAmount({ clientX: 0, clientY: 498 }),
    0,
  );
  assert.equal(
    selectionService._getMouseEventScrollAmount({ clientX: 0, clientY: 502 }),
    1,
  );

  dispose();
  assert.equal(
    selectionService._getMouseEventScrollAmount({ clientX: 0, clientY: 498 }),
    1,
  );
});
