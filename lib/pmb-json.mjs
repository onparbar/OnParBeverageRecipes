export function parsePmbJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const source = String(text || "");
    const safe = [];
    let inString = false;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (!inString) {
        if (char === '"') inString = true;
        if (char === ",") {
          let next = index + 1;
          while (/[\t\n\r ]/.test(source[next] || "")) next += 1;
          let previousIndex = safe.length - 1;
          while (previousIndex >= 0 && /^[\t\n\r ]$/.test(safe[previousIndex])) previousIndex -= 1;
          const previous = safe[previousIndex];
          if ((source[next] === "}" || source[next] === "]")
            && previous && !"[{,:".includes(previous)) continue;
        }
        safe.push(char);
        continue;
      }
      if (char === "\\") {
        const next = source[index + 1];
        if (next && '"\\/bfnrtu'.includes(next)) {
          // Keep valid escapes intact. JSON.parse still rejects malformed \u
          // sequences instead of guessing at their intended characters.
          safe.push(char, next);
          index += 1;
        } else {
          // PMB sometimes sends literal backslashes in customer names (\2).
          // Preserve that text without interpreting it as an escape sequence.
          safe.push("\\\\");
        }
        continue;
      }
      if (char === '"') {
        safe.push(char);
        inString = false;
        continue;
      }
      if (char.charCodeAt(0) < 32) {
        safe.push(`\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
        continue;
      }
      safe.push(char);
    }

    try {
      return JSON.parse(safe.join(""));
    } catch {
      return null;
    }
  }
}
