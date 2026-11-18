"use client"

import { useCallback, useSyncExternalStore } from "react"

const KEY = "steam-stats-shortcuts"
const EVENT = "steam-stats:prefs"

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb)
  window.addEventListener(EVENT, cb)
  return () => {
    window.removeEventListener("storage", cb)
    window.removeEventListener(EVENT, cb)
  }
}

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off"
  } catch {
    return true
  }
}

/** Single-key shortcuts on/off, kept in localStorage (WCAG 2.1.4). Default on. */
export function useShortcutsPref(): [boolean, (on: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, read, () => true)
  const setEnabled = useCallback((on: boolean) => {
    try {
      window.localStorage.setItem(KEY, on ? "on" : "off")
    } catch {
      // private mode: the switch still works for this page view via the event
    }
    window.dispatchEvent(new Event(EVENT))
  }, [])
  return [enabled, setEnabled]
}
