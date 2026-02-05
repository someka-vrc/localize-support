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
      map.set(unescapePo(id), { translation: unescapePo(str), line: msgidLine });
    }
    msgidParts = [];
    msgstrParts = [];
    state = "none";
    msgidLine = 0;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.trim();
    if (line.startsWith("msgid")) {
      if (state !== "none") {
        flush();
      }
      msgidParts = [extractQuoted(line)];
      msgidLine = idx;
      state = "msgid";
    } else if (line.startsWith("msgstr")) {
      msgstrParts = [extractQuoted(line)];
      state = "msgstr";
    } else {
      const m = line.match(/^"(.*)"$/);
      if (m) {
        if (state === "msgid") {
          msgidParts.push(m[1]);
        } else if (state === "msgstr") {
          msgstrParts.push(m[1]);
        }
      } else if (line === "") {
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
      entries.push({ id: unescapePo(id), translation: unescapePo(str), line: msgidLine });
    }
    msgidParts = [];
    msgstrParts = [];
    state = "none";
    msgidLine = 0;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.trim();
    if (line.startsWith("msgid")) {
      if (state !== "none") {
        flushEntry();
      }
      msgidParts = [extractQuoted(line)];
      msgidLine = idx;
      state = "msgid";
    } else if (line.startsWith("msgstr")) {
      msgstrParts = [extractQuoted(line)];
      state = "msgstr";
    } else {
      const m = line.match(/^"(.*)"$/);
      if (m) {
        if (state === "msgid") {
          msgidParts.push(m[1]);
        } else if (state === "msgstr") {
          msgstrParts.push(m[1]);
        }
      } else if (line === "") {
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
