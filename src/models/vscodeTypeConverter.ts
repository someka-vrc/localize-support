import { URI } from "vscode-uri";
import * as vscode from "vscode";
import { MyLocation, MyRange, MyRelativePattern } from "./vscodeTypes";

export function toVscUri(uri: URI): vscode.Uri {
  return uri as vscode.Uri;
}
export function toURI(uri: URI): URI {
  return uri as URI;
}

export function toVscPattern(pattern: string | MyRelativePattern): string | vscode.RelativePattern {
  if (typeof pattern === "string") {
    return pattern;
  }
  return new vscode.RelativePattern(pattern.baseUri as vscode.Uri, pattern.pattern);
}

export function toVscRange(range: MyRange): vscode.Range {
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}

export function toVscLocation(location: MyLocation): vscode.Location {
  return new vscode.Location(toVscUri(location.uri), toVscRange(location.range));
}
