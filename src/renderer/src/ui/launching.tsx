import { createContext, useContext } from 'react';

/** Ids of the workspaces whose Claude session is launching (spec §6.3, launch spinner). */
export const LaunchingContext = createContext<ReadonlySet<string>>(new Set());

/** Pass `.has(workspace.id)` to glyphFor as `launching`. */
export const useLaunching = () => useContext(LaunchingContext);
