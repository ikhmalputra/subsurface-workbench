import { useMemo, useSyncExternalStore } from "react";
import { BASE } from "../base.ts";
import { useFetched } from "./fetch.ts";
import { SYNTHETIC_FILES, annulusFromLas, catalogueInFrame, surveyFromLas } from "./synthetic.ts";
import type { AnnulusRecord, ObservedCatalogue, TemperatureSurvey } from "./synthetic.ts";

/**
 * The standard-format files a module reads: the deck's synthetic stand-in by default, or one the
 * user loads (a QuakeML catalogue, a LAS temperature survey, a LAS annulus record), kept for the
 * session. A loaded file is parsed by the same reader, so a real file and the stand-in are one path.
 */
type Kind = keyof typeof SYNTHETIC_FILES;
const loaded: Partial<Record<Kind, { name: string; text: string }>> = {};
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const useVersion = () => useSyncExternalStore(subscribe, () => version);

/** Use a file the user chose in place of the stand-in; null goes back to the stand-in. */
export async function loadOwn(kind: Kind, file: File | null) {
  if (file) loaded[kind] = { name: file.name, text: await file.text() }; else delete loaded[kind];
  version++;
  for (const listener of [...listeners]) listener();
}

const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);
function useText(kind: Kind) {
  useVersion();
  const own = loaded[kind];
  const fetched = useFetched(own ? null : `${BASE}data/synthetic/${SYNTHETIC_FILES[kind]}`, decode);
  return own ? { text: own.text, name: own.name, own: true, error: null } : { text: fetched.value, name: SYNTHETIC_FILES[kind], own: false, error: fetched.error };
}
function useParsed<T>(kind: Kind, parse: (text: string, name: string) => T) {
  const { text, name, own, error } = useText(kind);
  return useMemo(() => {
    if (error) return { value: null, error, own };
    if (text === null) return { value: null, error: null, own };
    try { return { value: parse(text, name), error: null, own }; } catch (cause) { return { value: null, error: cause instanceof Error ? cause.message : String(cause), own }; }
  }, [text, name, own, error]);
}

export const useCatalogue = (): { value: ObservedCatalogue | null; error: string | null; own: boolean } => useParsed("catalogue", catalogueInFrame);
export const useTemperatureSurvey = (): { value: TemperatureSurvey | null; error: string | null; own: boolean } => useParsed("dts", surveyFromLas);
export const useAnnulusRecord = (): { value: AnnulusRecord | null; error: string | null; own: boolean } => useParsed("annulus", annulusFromLas);
