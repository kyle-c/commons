import { useEffect, useState } from "react";

/**
 * This device's stable id (main generates and persists it). Working-copy
 * links are scoped by it — a path only exists on the machine that wrote it.
 */

let cached: string | null = null;

export function useMachineId(): string | null {
  const [id, setId] = useState(cached);
  useEffect(() => {
    if (cached) return;
    if (!window.commons) {
      cached = "web";
      setId(cached);
      return;
    }
    window.commons
      .getMachineId()
      .then((value) => {
        cached = value;
        setId(value);
      })
      .catch(() => {
        cached = "web";
        setId(cached);
      });
  }, []);
  return id;
}
