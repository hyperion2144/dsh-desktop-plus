/**
 * 壳内的最小 JSON 读写。
 *
 * ## 为什么自己写
 *
 * ArkTS 是静态语言：全局 `JSON.parse` 的返回类型是 `any`（arkts-stdlib 的声明），
 * `@ohos.util.json` 的 `parse` 返回 `Object | null`——两者都不能直接给出字段级类型，
 * 只能靠 `as` 断言绕过，那等于把类型检查丢在门外。
 *
 * 壳要读的东西很少、且形状固定（lane 的配对应答、主机条目表），
 * 所以这里给一个**有类型的最小 JSON 树**：解析失败返回 null，调用方自己决定降级。
 * 写方向仍用平台 `JSON.stringify`（入参是声明过的类，返回字符串，类型安全）。
 */

/** JSON 值的种类。 */
export class JsonKind {
  static readonly NULL: number = 0;
  static readonly BOOLEAN: number = 1;
  static readonly NUMBER: number = 2;
  static readonly STRING: number = 3;
  static readonly ARRAY: number = 4;
  static readonly OBJECT: number = 5;
}

/**
 * 一个 JSON 节点。
 *
 * 读法全部是**显式的**：先问种类，再取对应形态，取错形态返回空值而不是抛错。
 */
export class JsonNode {
  private readonly kind: number;
  private readonly text: string;
  private readonly num: number;
  private readonly flag: boolean;
  private readonly items: JsonNode[];
  private readonly fields: Map<string, JsonNode>;

  constructor(kind: number, text: string, num: number, flag: boolean, items: JsonNode[], fields: Map<string, JsonNode>) {
    this.kind = kind;
    this.text = text;
    this.num = num;
    this.flag = flag;
    this.items = items;
    this.fields = fields;
  }

  kindOf(): number {
    return this.kind;
  }

  isObject(): boolean {
    return this.kind === JsonKind.OBJECT;
  }

  isArray(): boolean {
    return this.kind === JsonKind.ARRAY;
  }

  isString(): boolean {
    return this.kind === JsonKind.STRING;
  }

  /** 取对象字段；不存在或不是对象时返回 null。 */
  get(name: string): JsonNode | null {
    if (this.kind !== JsonKind.OBJECT) {
      return null;
    }
    const found = this.fields.get(name);
    return found === undefined ? null : found;
  }

  /** 取数组元素；越界或不是数组时返回 null。 */
  item(index: number): JsonNode | null {
    if (this.kind !== JsonKind.ARRAY || index < 0 || index >= this.items.length) {
      return null;
    }
    return this.items[index];
  }

  /** 数组长度；不是数组时返回 0。 */
  size(): number {
    return this.kind === JsonKind.ARRAY ? this.items.length : 0;
  }

  /** 字符串值；不是字符串时返回空串。 */
  asString(): string {
    return this.kind === JsonKind.STRING ? this.text : '';
  }

  /** 数字值；不是数字时返回 0。 */
  asNumber(): number {
    return this.kind === JsonKind.NUMBER ? this.num : 0;
  }

  /** 布尔值；不是布尔时返回 false。 */
  asBoolean(): boolean {
    return this.kind === JsonKind.BOOLEAN ? this.flag : false;
  }

  /** 便捷读取：对象里的字符串字段。 */
  stringField(name: string): string {
    const node = this.get(name);
    return node === null ? '' : node.asString();
  }

  /** 便捷读取：对象里的数字字段。 */
  numberField(name: string): number {
    const node = this.get(name);
    return node === null ? 0 : node.asNumber();
  }

  /** 对象的字段名（按插入顺序）。 */
  keys(): string[] {
    const names: string[] = [];
    this.fields.forEach((value: JsonNode, name: string) => {
      names.push(name);
    });
    return names;
  }

  /** 便捷读取：对象里的布尔字段。 */
  booleanField(name: string): boolean {
    const node = this.get(name);
    return node === null ? false : node.asBoolean();
  }
}

/** 最小 JSON 解析器。 */
export class Json {
  /**
   * 解析一段 JSON 文本。
   *
   * @param text 待解析文本。
   * @returns 解析结果；文本非法时返回 null（调用方据此降级，不抛错）。
   */
  static parse(text: string): JsonNode | null {
    const reader = new JsonReader(text);
    const node = reader.readValue();
    if (node === null) {
      return null;
    }
    reader.skipWhitespace();
    return reader.atEnd() ? node : null;
  }

  /**
   * 把一段文本转义成 JSON 字符串字面量（含首尾引号）。
   *
   * 壳里需要**手写** JSON 的地方不多，但都有：引导载荷（页面契约）、
   * 原生请求桥的应答（页面契约）。这两处的形状是固定的，手写比走通用序列化更可控：
   * 键名不会因为字段改名而漂移，页面契约一眼可见。
   */
  static quote(value: string): string {
    let result = '"';
    for (let index = 0; index < value.length; index++) {
      const ch = value.charAt(index);
      if (ch === '"' || ch === '\\') {
        result += `\\${ch}`;
      } else if (ch === '\n') {
        result += '\\n';
      } else if (ch === '\r') {
        result += '\\r';
      } else if (ch === '\t') {
        result += '\\t';
      } else if (ch < ' ') {
        result += `\\u${Json.hex4(value.charCodeAt(index))}`;
      } else {
        result += ch;
      }
    }
    return `${result}"`;
  }

  /** 字符码 → 四位十六进制。 */
  static hex4(code: number): string {
    const digits = '0123456789abcdef';
    let result = '';
    for (let shift = 12; shift >= 0; shift -= 4) {
      result += digits.charAt((code >> shift) & 0xF);
    }
    return result;
  }
}

/** 递归下降的 JSON 读取器（内部使用）。 */
class JsonReader {
  private readonly source: string;
  private cursor: number = 0;

  constructor(source: string) {
    this.source = source;
  }

  atEnd(): boolean {
    return this.cursor >= this.source.length;
  }

  skipWhitespace(): void {
    while (this.cursor < this.source.length) {
      const code = this.source.charCodeAt(this.cursor);
      if (code !== 32 && code !== 9 && code !== 10 && code !== 13) {
        return;
      }
      this.cursor += 1;
    }
  }

  readValue(): JsonNode | null {
    this.skipWhitespace();
    if (this.atEnd()) {
      return null;
    }
    const ch = this.source.charAt(this.cursor);
    if (ch === '{') {
      return this.readObject();
    }
    if (ch === '[') {
      return this.readArray();
    }
    if (ch === '"') {
      const text = this.readString();
      return text === null ? null : new JsonNode(JsonKind.STRING, text, 0, false, [], new Map<string, JsonNode>());
    }
    if (this.source.startsWith('true', this.cursor)) {
      this.cursor += 4;
      return new JsonNode(JsonKind.BOOLEAN, '', 0, true, [], new Map<string, JsonNode>());
    }
    if (this.source.startsWith('false', this.cursor)) {
      this.cursor += 5;
      return new JsonNode(JsonKind.BOOLEAN, '', 0, false, [], new Map<string, JsonNode>());
    }
    if (this.source.startsWith('null', this.cursor)) {
      this.cursor += 4;
      return new JsonNode(JsonKind.NULL, '', 0, false, [], new Map<string, JsonNode>());
    }
    return this.readNumber();
  }

  private readObject(): JsonNode | null {
    this.cursor += 1;
    const fields: Map<string, JsonNode> = new Map<string, JsonNode>();
    this.skipWhitespace();
    if (!this.atEnd() && this.source.charAt(this.cursor) === '}') {
      this.cursor += 1;
      return new JsonNode(JsonKind.OBJECT, '', 0, false, [], fields);
    }
    while (true) {
      this.skipWhitespace();
      const name = this.readString();
      if (name === null) {
        return null;
      }
      this.skipWhitespace();
      if (this.atEnd() || this.source.charAt(this.cursor) !== ':') {
        return null;
      }
      this.cursor += 1;
      const value = this.readValue();
      if (value === null) {
        return null;
      }
      fields.set(name, value);
      this.skipWhitespace();
      if (this.atEnd()) {
        return null;
      }
      const ch = this.source.charAt(this.cursor);
      if (ch === ',') {
        this.cursor += 1;
        continue;
      }
      if (ch === '}') {
        this.cursor += 1;
        return new JsonNode(JsonKind.OBJECT, '', 0, false, [], fields);
      }
      return null;
    }
  }

  private readArray(): JsonNode | null {
    this.cursor += 1;
    const items: JsonNode[] = [];
    this.skipWhitespace();
    if (!this.atEnd() && this.source.charAt(this.cursor) === ']') {
      this.cursor += 1;
      return new JsonNode(JsonKind.ARRAY, '', 0, false, items, new Map<string, JsonNode>());
    }
    while (true) {
      const value = this.readValue();
      if (value === null) {
        return null;
      }
      items.push(value);
      this.skipWhitespace();
      if (this.atEnd()) {
        return null;
      }
      const ch = this.source.charAt(this.cursor);
      if (ch === ',') {
        this.cursor += 1;
        continue;
      }
      if (ch === ']') {
        this.cursor += 1;
        return new JsonNode(JsonKind.ARRAY, '', 0, false, items, new Map<string, JsonNode>());
      }
      return null;
    }
  }

  private readString(): string | null {
    if (this.atEnd() || this.source.charAt(this.cursor) !== '"') {
      return null;
    }
    this.cursor += 1;
    let result = '';
    while (this.cursor < this.source.length) {
      const ch = this.source.charAt(this.cursor);
      this.cursor += 1;
      if (ch === '"') {
        return result;
      }
      if (ch !== '\\') {
        result += ch;
        continue;
      }
      if (this.atEnd()) {
        return null;
      }
      const escaped = this.source.charAt(this.cursor);
      this.cursor += 1;
      switch (escaped) {
        case '"':
          result += '"';
          break;
        case '\\':
          result += '\\';
          break;
        case '/':
          result += '/';
          break;
        case 'b':
          result += '\b';
          break;
        case 'f':
          result += '\f';
          break;
        case 'n':
          result += '\n';
          break;
        case 'r':
          result += '\r';
          break;
        case 't':
          result += '\t';
          break;
        case 'u': {
          const hex = this.source.substring(this.cursor, this.cursor + 4);
          if (hex.length < 4) {
            return null;
          }
          this.cursor += 4;
          const code = parseInt(hex, 16);
          if (isNaN(code)) {
            return null;
          }
          result += String.fromCharCode(code);
          break;
        }
        default:
          return null;
      }
    }
    return null;
  }

  private readNumber(): JsonNode | null {
    const start = this.cursor;
    if (!this.atEnd() && (this.source.charAt(this.cursor) === '-' || this.source.charAt(this.cursor) === '+')) {
      this.cursor += 1;
    }
    let digits = 0;
    while (!this.atEnd()) {
      const ch = this.source.charAt(this.cursor);
      if (ch < '0' || ch > '9') {
        break;
      }
      this.cursor += 1;
      digits += 1;
    }
    if (digits === 0) {
      return null;
    }
    if (!this.atEnd() && this.source.charAt(this.cursor) === '.') {
      this.cursor += 1;
      while (!this.atEnd()) {
        const ch = this.source.charAt(this.cursor);
        if (ch < '0' || ch > '9') {
          break;
        }
        this.cursor += 1;
      }
    }
    const text = this.source.substring(start, this.cursor);
    const value = Number(text);
    if (isNaN(value)) {
      return null;
    }
    return new JsonNode(JsonKind.NUMBER, text, value, false, [], new Map<string, JsonNode>());
  }
}
