import { useEffect, useRef } from "react";

let lockCount = 0;
let originalOverflow = "";

export function useBodyScrollLock(open: boolean) {
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      wasOpen.current = true;
      if (lockCount === 0) {
        originalOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
      }
      lockCount++;
    } else if (!open && wasOpen.current) {
      wasOpen.current = false;
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.style.overflow = originalOverflow;
      }
    }

    return () => {
      if (wasOpen.current) {
        wasOpen.current = false;
        lockCount = Math.max(0, lockCount - 1);
        if (lockCount === 0) {
          document.body.style.overflow = originalOverflow;
        }
      }
    };
  }, [open]);
}
