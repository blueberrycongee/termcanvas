import {
  useBrowserCardStore,
  type BrowserCardData,
} from "../stores/browserCardStore";
import { useSelectionStore } from "../stores/selectionStore";

function removeCardSelection(cardId: string) {
  useSelectionStore.setState((state) => ({
    selectedItems: state.selectedItems.filter(
      (item) => item.type !== "card" || item.cardId !== cardId,
    ),
  }));
}

export function createBrowserCardInScene(
  url: string,
  position?: { x: number; y: number },
): string {
  return useBrowserCardStore.getState().addCard(url, position);
}

export function updateBrowserCardInScene(
  cardId: string,
  patch: Partial<BrowserCardData>,
) {
  useBrowserCardStore.getState().updateCard(cardId, patch);
}

export function removeBrowserCardFromScene(cardId: string) {
  useBrowserCardStore.getState().removeCard(cardId);
  removeCardSelection(`browser:${cardId}`);
}

export function restoreBrowserCardsInScene(
  cards: Record<string, BrowserCardData>,
) {
  useBrowserCardStore.setState({ cards });
}
