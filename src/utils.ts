export function parsePo(content: string): Map<string, {translation: string; line: number}> {
  const map = new Map<string, {translation: string; line: number}>();
  const lines = content.split(/\r?\n/);
  let state: "none" | "msgid" | "msgstr" = "none";
  let msgidParts: string[] = [];
  let msgstrParts: string[] = [];
  let msgidLine = 0;

  const flush = () => {
    if (msgidParts.length > 0) {
      const id = msgidParts.join("");
      const str = msgstrParts.join("");
      // Ignore header entries where both msgid and msgstr are exactly empty (metadata header like "Language: ...")
      if (!(id === "" && str === "")) {
        map.set(unescapePo(id), { translation: unescapePo(str), line: msgidLine });
      }
    }
    msgidParts = [];
    msgstrParts = [];
    state = "none";
    msgidLine = 0;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const lineTrimmed = raw.trim();
    if (lineTrimmed.startsWith("msgid")) {
      if (state !== "none") {
        flush();
      }
      msgidParts = [extractQuoted(lineTrimmed)];
      msgidLine = idx;
      state = "msgid";
    } else if (lineTrimmed.startsWith("msgstr")) {
      msgstrParts = [extractQuoted(lineTrimmed)];
      state = "msgstr";
    } else {
      const m = raw.match(/^"(.*)"$/);
      if (m) {
        if (state === "msgid") {
          msgidParts.push(m[1]);
        } else if (state === "msgstr") {
          msgstrParts.push(m[1]);
        }
      } else if (lineTrimmed === "") {
        if (state !== "none") {
          flush();
        }
      }
    }
  }
  if (state !== "none") {
    flush();
  }
  return map;
}

export function parsePoEntries(content: string) {
  const entries: Array<{id: string; translation: string; line: number}> = [];
  const lines = content.split(/\r?\n/);
  let state: "none" | "msgid" | "msgstr" = "none";
  let msgidParts: string[] = [];
  let msgstrParts: string[] = [];
  let msgidLine = 0;

  const flushEntry = () => {
    if (msgidParts.length > 0) {
      const id = msgidParts.join("");
      const str = msgstrParts.join("");
      // Ignore header entries where both msgid and msgstr are exactly empty (they serve as file metadata)
      // Also ignore common header metadata that begins with "Language:" when id === "".
      if (!(id === "" && str === "") && !(id === "" && str.startsWith("Language:"))) {
        entries.push({ id: unescapePo(id), translation: unescapePo(str), line: msgidLine });
      }
    }
    msgidParts = [];
    msgstrParts = [];
    state = "none";
    msgidLine = 0;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const lineTrimmed = raw.trim();
    if (lineTrimmed.startsWith("msgid")) {
      if (state !== "none") {
        flushEntry();
      }
      msgidParts = [extractQuoted(lineTrimmed)];
      msgidLine = idx;
      state = "msgid";
    } else if (lineTrimmed.startsWith("msgstr")) {
      msgstrParts = [extractQuoted(lineTrimmed)];
      state = "msgstr";
    } else {
      const m = raw.match(/^"(.*)"$/);
      if (m) {
        if (state === "msgid") {
          msgidParts.push(m[1]);
        } else if (state === "msgstr") {
          msgstrParts.push(m[1]);
        }
      } else if (lineTrimmed === "") {
        if (state !== "none") {
          flushEntry();
        }
      }
    }
  }
  if (state !== "none") {
    flushEntry();
  }
  return entries;
}

export function extractQuoted(line: string) {
  const first = line.indexOf('"');
  const last = line.lastIndexOf('"');
  if (first >= 0 && last > first) {
    return line.substring(first + 1, last);
  }
  return "";
}

export function unescapePo(s: string) {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\\"/g, '"')
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

export function isInComment(text: string, offset: number): boolean {
  let inComment = false;
  let inString = false;
  let i = 0;
  while (i < offset) {
    if (inString) {
      if (text[i] === '"' && (i === 0 || text[i - 1] !== "\\")) {
        inString = false;
      }
    } else if (inComment) {
      if (text[i] === '*' && i + 1 < text.length && text[i + 1] === '/') {
        inComment = false;
        i += 2;
        continue;
      }
    } else {
      if (text[i] === '/' && i + 1 < text.length && text[i + 1] === '/') {
        while (i < offset && text[i] !== '\n') {
          i++;
        }
        continue;
      } else if (text[i] === '/' && i + 1 < text.length && text[i + 1] === '*') {
        inComment = true;
        i += 2;
        continue;
      } else if (text[i] === '"') {
        inString = true;
      }
    }
    i++;
  }
  return inComment;
}

export function extractFirstStringArgument(inside: string) {
  let i = 0;
  while (i < inside.length && /\s/.test(inside[i])) {
    i++;
  }
  if (i >= inside.length) {
    return null;
  }
  if (inside[i] === '@' && inside[i + 1] === '"') {
    let j = i + 2;
    let out = '';
    while (j < inside.length) {
      if (inside[j] === '"') {
        if (inside[j + 1] === '"') {
          out += '"';
          j += 2;
          continue;
        }
        return out;
      }
      out += inside[j++];
    }
    return null;
  } else if (inside[i] === '"') {
    let j = i + 1;
    let out = '';
    while (j < inside.length) {
      if (inside[j] === '"' && inside[j - 1] !== "\\") {
        return unescapePo(out);
      }
      if (inside[j] === "\\" && j + 1 < inside.length) {
        const esc = inside[j + 1];
        if (esc === 'n') {
          out += '\n';
        } else if (esc === 't') {
          out += '\t';
        } else {
          out += esc;
        }
        j += 2;
        continue;
      }
      out += inside[j++];
    }
    return null;
  }
  return null;
}

// Return the msgid and its absolute start/end offsets (end is the offset of the closing quote, exclusive)
export function extractFirstStringArgumentRange(inside: string, baseOffset: number) {
  let i = 0;
  while (i < inside.length && /\s/.test(inside[i])) {
    i++;
  }
  if (i >= inside.length) {
    return null;
  }
  if (inside[i] === '@' && inside[i + 1] === '"') {
    // verbatim string: opening quote is at i+1
    const start = i + 1; // opening quote index
    let j = i + 2;
    let out = '';
    while (j < inside.length) {
      if (inside[j] === '"') {
        if (inside[j + 1] === '"') {
          out += '"';
          j += 2;
          continue;
        }
        // return start as index of first char inside, end as index of closing quote (exclusive)
        return { msgid: out, start: baseOffset + (i + 2), end: baseOffset + j };
      }
      out += inside[j++];
    }
    return null;
  } else if (inside[i] === '"') {
    // normal string: opening quote is at i
    // opening quote is at i, first char inside at i+1
    let j = i + 1;
    let out = '';
    while (j < inside.length) {
      if (inside[j] === '"') {
        // determine if quote is escaped by counting preceding backslashes
        let k = j - 1;
        let backslashes = 0;
        while (k >= 0 && inside[k] === '\\') {
          backslashes++;
          k--;
        }
        if (backslashes % 2 === 0) {
          // return start as index of first char inside, end as index of closing quote (exclusive)
          return { msgid: unescapePo(out), start: baseOffset + (i + 1), end: baseOffset + j };
        }
      }
      if (inside[j] === "\\" && j + 1 < inside.length) {
        const esc = inside[j + 1];
        if (esc === 'n') {
          out += '\n';
        } else if (esc === 't') {
          out += '\t';
        } else {
          out += esc;
        }
        j += 2;
        continue;
      }
      out += inside[j++];
    }
    return null;
  }
  return null;
}

// Find all localization function calls in the text and return their msgid ranges and metadata.
export function findAllLocalizationCalls(text: string, funcs: string[] = ['G']) {
  const res: Array<{ msgid: string; start: number; end: number; callStart: number; callEnd: number; funcName: string }> = [];
  if (!funcs || funcs.length === 0) {
    funcs = ['G'];
  }
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(?:${funcs.map(escapeRegExp).join("|")})\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const matchIndex = match.index;
    let i = matchIndex + match[0].length;
    while (i < text.length && /\s/.test(text[i])) {
      i++;
    }
    if (i >= text.length || text[i] !== '(') {
      continue;
    }
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) {
          const inside = text.substring(i + 1, j);
          const arg = extractFirstStringArgumentRange(inside, i + 1);
          if (!arg) {
            break;
          }
          res.push({ msgid: arg.msgid, start: arg.start, end: arg.end, callStart: matchIndex, callEnd: j + 1, funcName: match[0] });
          break;
        }
      }
    }
  }
  return res;
}

// Find a localization call (if any) that contains the given offset
export function findLocalizationCallAtOffset(text: string, offset: number, funcs: string[] = ['G']) {
  const calls = findAllLocalizationCalls(text, funcs);
  for (const c of calls) {
    // end is exclusive
    if (offset >= c.start && offset < c.end) {
      return c;
    }
  }
  return null;
}
