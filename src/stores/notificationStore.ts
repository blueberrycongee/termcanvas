import { create } from "zustand";

export type NotificationType = "error" | "warn" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  timestamp: number;
}

interface NotificationStore {
  notifications: Notification[];
  notify: (type: NotificationType, message: string) => void;
  dismiss: (id: string) => void;
}

let notifyId = 0;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],

  notify: (type, message) => {
    const id = `notif-${++notifyId}`;
    const notification: Notification = {
      id,
      type,
      message,
      timestamp: Date.now(),
    };

    const logFn =
      type === "error"
        ? console.error
        : type === "warn"
          ? console.warn
          : console.info;
    logFn(`[TermCanvas] ${message}`);

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));

    setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      }));
    }, 5000);
  },

  dismiss: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
}));
