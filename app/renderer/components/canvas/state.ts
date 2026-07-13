import { useState, type Dispatch, type SetStateAction } from "react";
import type { CanvasEdge, CanvasNode } from "./types";

/**
 * Typed `useState` wrappers mirroring the old React Flow `useNodesState`/
 * `useEdgesState` call sites (minus the change-event handler, which the engine
 * doesn't emit — node drag reports via `onNodePositionChange`, and deletes go
 * through explicit page handlers).
 */
export function useNodesState<T = Record<string, unknown>>(
  initial: CanvasNode<T>[]
): [CanvasNode<T>[], Dispatch<SetStateAction<CanvasNode<T>[]>>] {
  return useState<CanvasNode<T>[]>(initial);
}

export function useEdgesState<T = Record<string, unknown>>(
  initial: CanvasEdge<T>[]
): [CanvasEdge<T>[], Dispatch<SetStateAction<CanvasEdge<T>[]>>] {
  return useState<CanvasEdge<T>[]>(initial);
}

/** Append an edge if an identical source/target pair doesn't already exist. */
export function addEdge<T = Record<string, unknown>>(edge: CanvasEdge<T>, edges: CanvasEdge<T>[]): CanvasEdge<T>[] {
  if (!edge.source || !edge.target) return edges;
  if (edges.some((e) => e.source === edge.source && e.target === edge.target)) return edges;
  return edges.concat(edge);
}
