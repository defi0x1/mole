/**
 * Minimal glob matcher supporting `*`, `**`, and `?` — enough for the
 * include/exclude patterns in mole.json. No dependency on a glob package
 * since the project ships zero runtime dependencies.
 */
function globToRegExp(pattern: string): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          // `**/` matches zero or more whole path segments
          re += "(?:.*/)?";
          i += 2;
        } else {
          // trailing `**` (no following slash) matches the rest of the path
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

export function matchesGlob(filePath: string, pattern: string): boolean {
  return globToRegExp(pattern).test(filePath);
}

export function matchesAny(filePath: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesGlob(filePath, p));
}
