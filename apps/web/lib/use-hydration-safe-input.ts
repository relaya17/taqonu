"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

/**
 * State for a controlled text input that keeps what the user typed into the
 * server-rendered input before hydration. React leaves that text in the DOM
 * but not in state, and the next re-render overwrites it with `initial`.
 * Pass the returned ref as the input's `inputRef`.
 */
export function useHydrationSafeInput(
  initial: string,
): [string, Dispatch<SetStateAction<string>>, RefObject<HTMLInputElement | null>] {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initial);
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (node && node.value !== initial) setValue(node.value);
  }, [initial]);
  return [value, setValue, inputRef];
}
