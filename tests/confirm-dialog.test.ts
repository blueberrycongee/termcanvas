import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  focusInitialDialogTarget,
  trapDialogTabKey,
} from "../src/components/ui/ConfirmDialog.tsx";

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><button id='trigger'>Open</button></body></html>",
    { url: "http://localhost", pretendToBeVisual: true },
  );
  const { window } = dom;

  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;

  return dom;
}

function createDialog() {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.textContent = "Delete";

  dialog.append(closeButton, cancelButton, confirmButton);
  document.body.append(dialog);

  return { dialog, closeButton, cancelButton, confirmButton };
}

test("focusInitialDialogTarget moves focus inside when the opener still owns focus", () => {
  const dom = installDom();
  try {
    const trigger = document.getElementById("trigger") as HTMLButtonElement;
    const { dialog, confirmButton } = createDialog();

    trigger.focus();
    assert.equal(document.activeElement, trigger);

    focusInitialDialogTarget(dialog, confirmButton);
    assert.equal(document.activeElement, confirmButton);
  } finally {
    dom.window.close();
  }
});

test("focusInitialDialogTarget preserves an autofocus field inside the dialog", () => {
  const dom = installDom();
  try {
    const trigger = document.getElementById("trigger") as HTMLButtonElement;
    const { dialog, confirmButton } = createDialog();
    const input = document.createElement("input");
    input.setAttribute("autofocus", "");
    dialog.prepend(input);

    trigger.focus();
    focusInitialDialogTarget(dialog, confirmButton);

    assert.equal(document.activeElement, input);
  } finally {
    dom.window.close();
  }
});

test("trapDialogTabKey wraps focus at dialog boundaries and recaptures escaped focus", () => {
  const dom = installDom();
  try {
    const trigger = document.getElementById("trigger") as HTMLButtonElement;
    const { dialog, closeButton, confirmButton } = createDialog();

    confirmButton.focus();
    trapDialogTabKey(dialog, {
      key: "Tab",
      shiftKey: false,
      preventDefault() {},
    });
    assert.equal(document.activeElement, closeButton);

    closeButton.focus();
    trapDialogTabKey(dialog, {
      key: "Tab",
      shiftKey: true,
      preventDefault() {},
    });
    assert.equal(document.activeElement, confirmButton);

    trigger.focus();
    trapDialogTabKey(dialog, {
      key: "Tab",
      shiftKey: false,
      preventDefault() {},
    });
    assert.equal(document.activeElement, closeButton);
  } finally {
    dom.window.close();
  }
});
