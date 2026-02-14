import { MyLocation, MyRange } from "../models/vscTypes";

export type PlainLocation = { uri: string; range: MyRange };

/**
 * Convert internal MyLocation -> plain serializable object for easier testing.
 * Provider implementations use the equivalent logic to map to vscode.Location.
 */
export function myLocationToPlain(loc: MyLocation): PlainLocation {
  return {
    uri: (loc.uri as any).toString(),
    range: loc.range,
  };
}

export function myLocationsToPlain(locs: MyLocation[] = []): PlainLocation[] {
  return locs.map(myLocationToPlain);
}
