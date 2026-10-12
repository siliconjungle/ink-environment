// Verbatim exact JSON codec from ink-runtime b225add86164ca478ef611079cd27d4e3e3a59f3, hosts/state-wasm.mjs.
export function stringifyExactJSON(value) {
  const seen = new Set();
  function encode(value, depth) {
    if (depth > 128) throw new RangeError("JSON nesting limit");
    if (value === null) return "null";
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        throw new RangeError("JSON numbers must be finite");
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        const s = String(value);
        return /[.eE]/.test(s) ? s : s + ".0";
      } // float token: integer Wire readers reject it
      return Object.is(value, -0) ? "-0.0" : String(value);
    }
    if (typeof value === "string" || typeof value === "boolean")
      return JSON.stringify(value);
    if (typeof value !== "object")
      throw new TypeError("Unsupported JSON value");
    if (seen.has(value)) throw new TypeError("Cyclic JSON value");
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++)
          if (!Object.hasOwn(value, i))
            throw new TypeError("Sparse JSON array");
        return "[" + value.map((v) => encode(v, depth + 1)).join(",") + "]";
      }
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw new TypeError("Expected a plain JSON object");
      return (
        "{" +
        Object.entries(value)
          .map(([key, v]) => JSON.stringify(key) + ":" + encode(v, depth + 1))
          .join(",") +
        "}"
      );
    } finally {
      seen.delete(value);
    }
  }
  return encode(value, 0);
}
export function parseExactJSON(text) {
  let position = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const fail = () => {
    throw new SyntaxError("Invalid JSON at " + position);
  };
  const space = () => {
    while (" \n\r\t".includes(text[position]) && position < text.length)
      position++;
  };
  function string() {
    const start = position++;
    let escaped = false;
    while (position < text.length) {
      const c = text[position++];
      if (c === '"')
        return escaped
          ? JSON.parse(text.slice(start, position))
          : text.slice(start + 1, position - 1);
      if (c < " ") fail();
      if (c === "\\") {
        escaped = true;
        position++;
      }
    }
    fail();
  }
  function value(depth) {
    if (depth > 128) throw new RangeError("JSON nesting limit");
    space();
    const c = text[position];
    if (c === '"') return string();
    if (c === "[") {
      position++;
      const result = [];
      space();
      if (text[position] === "]") {
        position++;
        return result;
      }
      while (true) {
        result.push(value(depth + 1));
        space();
        const next = text[position++];
        if (next === "]") return result;
        if (next !== ",") fail();
      }
    }
    if (c === "{") {
      position++;
      const result = {};
      space();
      if (text[position] === "}") {
        position++;
        return result;
      }
      while (true) {
        space();
        if (text[position] !== '"') fail();
        const key = string();
        space();
        if (text[position++] !== ":") fail();
        Object.defineProperty(result, key, {
          value: value(depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
        space();
        const next = text[position++];
        if (next === "}") return result;
        if (next !== ",") fail();
      }
    }
    if (text.startsWith("true", position)) {
      position += 4;
      return true;
    }
    if (text.startsWith("false", position)) {
      position += 5;
      return false;
    }
    if (text.startsWith("null", position)) {
      position += 4;
      return null;
    }
    numberPattern.lastIndex = position;
    const match = numberPattern.exec(text);
    if (!match) fail();
    position += match[0].length;
    if (/^-?[0-9]+$/.test(match[0])) return BigInt(match[0]);
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail();
    return number;
  }
  const result = value(0);
  space();
  if (position !== text.length) fail();
  return result;
}
